/**
 * TurboQuant storage precision: the `storagePrecision` create-time knob and its
 * quantized tiers `tq12` / `tq8` / `tq6` / `tq4`.
 *
 * `storagePrecision` picks the on-disk rerank-vector format, chosen at create
 * and immutable. Alongside the existing `float32` / `float16`, the TurboQuant
 * tiers pack 12 / 8 / 6 / 4 bits per dimension, trading a little recall and
 * latency for a large storage saving. `tq4` is only valid with the cosine
 * metric.
 *
 * Two layers of coverage (mirrors cyborgdb-py's tests/test_turboquant.py):
 *
 * * Model-level (no service) — `CreateIndexRequest` exposes every valid tier on
 *   its precision enum and serializes the value through to the wire dict. Unlike
 *   pydantic, the generated TS model does no runtime validation — invalid tiers
 *   are caught at compile time by the enum/union type, so the "rejects garbage"
 *   checks live in the type system, not here. These are the direct,
 *   deterministic checks that the tiers were wired in.
 * * End-to-end (live service on localhost:8000) — each tier survives the full
 *   create -> upsert -> train -> query round-trip and returns sane, high
 *   self-recall results. Skipped automatically when no service is reachable.
 *
 * The index-info response does not echo `storage_precision` back, so the
 * end-to-end layer verifies the tiers by behavior, not by reading the value
 * back off the index.
 */

import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import * as dotenv from "dotenv";
import { Client, type EncryptedIndex } from "../index";
import {
	CreateIndexRequestFromJSON,
	CreateIndexRequestStoragePrecisionEnum,
	CreateIndexRequestToJSON,
} from "../models";

dotenv.config({ path: ".env.local" });
dotenv.config();

const BASE_URL = process.env.CYBORGDB_BASE_URL || "http://localhost:8000";
const API_KEY = process.env.CYBORGDB_API_KEY || "";

type Precision = "float32" | "float16" | "tq12" | "tq8" | "tq6" | "tq4";
const VALID_PRECISIONS: Precision[] = [
	"float32",
	"float16",
	"tq12",
	"tq8",
	"tq6",
	"tq4",
];
const TURBOQUANT_TIERS: Array<"tq12" | "tq8" | "tq6" | "tq4"> = [
	"tq12",
	"tq8",
	"tq6",
	"tq4",
];

// Enough vectors to clear the core training floor (train() silently no-ops
// below 10k vectors) while staying quick.
const NUM_VECTORS = 10000;
const DIM = 64;
const N_LISTS = 8;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Round-trip a model through JSON to see exactly what reaches the wire —
// JSON.stringify drops `undefined` keys, which is the service's "no key" path.
const wire = (obj: unknown) => JSON.parse(JSON.stringify(obj));

// -----------------------------------------------------------------------------
// Model-level contract — no service required.
// -----------------------------------------------------------------------------
describe("TurboQuant storagePrecision (model)", () => {
	it("exposes every valid precision on the enum", () => {
		const enumValues = Object.values(CreateIndexRequestStoragePrecisionEnum);
		for (const precision of VALID_PRECISIONS) {
			expect(enumValues).toContain(precision);
		}
	});

	it("exposes the four TurboQuant tiers on the enum", () => {
		// The tiers this change adds, called out explicitly.
		expect(CreateIndexRequestStoragePrecisionEnum.Tq12).toBe("tq12");
		expect(CreateIndexRequestStoragePrecisionEnum.Tq8).toBe("tq8");
		expect(CreateIndexRequestStoragePrecisionEnum.Tq6).toBe("tq6");
		expect(CreateIndexRequestStoragePrecisionEnum.Tq4).toBe("tq4");
	});

	it("serializes every valid precision to the wire dict", () => {
		for (const precision of VALID_PRECISIONS) {
			const payload = wire(
				CreateIndexRequestToJSON({
					indexName: "idx",
					storagePrecision: precision,
				} as never),
			);
			expect(payload.storage_precision).toBe(precision);
		}
	});

	it("omits storage_precision when not set", () => {
		const payload = wire(CreateIndexRequestToJSON({ indexName: "idx" } as never));
		expect(payload.storage_precision == null).toBe(true);
	});

	it("round-trips each TurboQuant tier through from/to JSON", () => {
		for (const tier of TURBOQUANT_TIERS) {
			const restored = CreateIndexRequestFromJSON({
				index_name: "idx",
				storage_precision: tier,
			});
			expect(restored.storagePrecision).toBe(tier);
			const payload = wire(CreateIndexRequestToJSON(restored));
			expect(payload.storage_precision).toBe(tier);
		}
	});
});

// -----------------------------------------------------------------------------
// End-to-end — each TurboQuant tier survives the full index lifecycle.
//
// One shared, cosine-metric corpus is built once (cosine is required by `tq4`
// and valid for every other tier). Each tier gets its own index so a failure
// names the tier that broke. Skipped automatically when no service is reachable.
// -----------------------------------------------------------------------------
describe("TurboQuant storagePrecision (integration)", () => {
	let serviceUp = false;
	let client: Client;
	let vectors: number[][];
	let ids: string[];
	const created: EncryptedIndex[] = [];

	async function serviceReachable(): Promise<boolean> {
		try {
			const resp = await fetch(`${BASE_URL}/v1/health`, {
				signal: AbortSignal.timeout(2000),
			});
			return resp.status === 200;
		} catch {
			return false;
		}
	}

	// Build a normalized corpus so cosine self-queries are unambiguous.
	function buildCorpus(): number[][] {
		const rows: number[][] = [];
		for (let i = 0; i < NUM_VECTORS; i++) {
			const v: number[] = new Array(DIM);
			let sumSq = 0;
			for (let j = 0; j < DIM; j++) {
				const x = Math.random();
				v[j] = x;
				sumSq += x * x;
			}
			const norm = Math.max(Math.sqrt(sumSq), 1e-12);
			for (let j = 0; j < DIM; j++) v[j] /= norm;
			rows.push(v);
		}
		return rows;
	}

	async function buildTrainedIndex(precision: Precision): Promise<EncryptedIndex> {
		const index = await client.createIndex({
			indexName: `tq_${precision}_${randomBytes(4).toString("hex")}`,
			indexKey: Client.generateKey(),
			dimension: DIM,
			metric: "cosine",
			storagePrecision: precision,
		});
		created.push(index);

		// Upsert in chunks — one 10k-vector payload is large; the tier under test
		// is unaffected by how many calls the corpus arrives in.
		const CHUNK = 2500;
		for (let start = 0; start < NUM_VECTORS; start += CHUNK) {
			const end = Math.min(start + CHUNK, NUM_VECTORS);
			await index.upsert({
				ids: ids.slice(start, end),
				vectors: vectors.slice(start, end),
			});
		}
		await sleep(1000);
		expect((await index.listIds()).count).toBe(NUM_VECTORS);

		await index.train({ nLists: N_LISTS });
		for (let attempt = 0; attempt < 60; attempt++) {
			if (!(await index.isTraining()) && (await index.isTrained())) break;
			await sleep(2000);
		}
		expect(await index.isTrained()).toBe(true);
		return index;
	}

	// Query with vectors that are in the index; each should find itself.
	// Exhaustive search (nProbes == nLists) removes IVF partitioning as a
	// variable, so the only recall loss left is TurboQuant's quantization.
	async function assertSelfRecall(
		index: EncryptedIndex,
		precision: Precision,
		minRecall: number,
		numProbe = 50,
	): Promise<void> {
		const probeVectors = vectors.slice(0, numProbe);
		const response = await index.query({
			queryVectors: probeVectors,
			topK: 10,
			nProbes: N_LISTS,
		});
		const results = response.results as Array<Array<{ id: string }>>;
		expect(results.length).toBe(numProbe);

		let hits = 0;
		for (let localId = 0; localId < numProbe; localId++) {
			const returned = new Set(results[localId].map((r) => r.id));
			if (returned.has(String(localId))) hits++;
		}
		const recall = hits / numProbe;
		// Surface the tier in the message so a failure names what broke.
		// (@jest/globals `expect` takes no message arg, so assert explicitly.)
		if (recall < minRecall) {
			throw new Error(
				`${precision}: self-recall ${recall.toFixed(2)} below ${minRecall}`,
			);
		}
		expect(recall).toBeGreaterThanOrEqual(minRecall);
	}

	beforeAll(async () => {
		serviceUp = await serviceReachable();
		if (!serviceUp) {
			console.warn(
				`No CyborgDB service reachable at ${BASE_URL} — skipping TurboQuant integration tests.`,
			);
			return;
		}
		client = new Client({ baseUrl: BASE_URL, apiKey: API_KEY, verifySsl: false });
		vectors = buildCorpus();
		ids = Array.from({ length: NUM_VECTORS }, (_, i) => String(i));
	}, 60000);

	afterAll(async () => {
		for (const index of created) {
			try {
				await index.deleteIndex();
			} catch {
				// best-effort cleanup
			}
		}
	});

	it("tq12 survives the full lifecycle with high self-recall", async () => {
		if (!serviceUp) return;
		// tq12 is the least aggressive tier, so it should hold the highest recall.
		const index = await buildTrainedIndex("tq12");
		await assertSelfRecall(index, "tq12", 0.9);
	}, 300000);

	it("tq8 survives the full lifecycle with high self-recall", async () => {
		if (!serviceUp) return;
		const index = await buildTrainedIndex("tq8");
		await assertSelfRecall(index, "tq8", 0.9);
	}, 300000);

	it("tq6 survives the full lifecycle with high self-recall", async () => {
		if (!serviceUp) return;
		const index = await buildTrainedIndex("tq6");
		await assertSelfRecall(index, "tq6", 0.85);
	}, 300000);

	it("tq4 survives the full lifecycle with high self-recall", async () => {
		if (!serviceUp) return;
		// tq4 is the most aggressive tier and is only valid with cosine.
		const index = await buildTrainedIndex("tq4");
		await assertSelfRecall(index, "tq4", 0.7);
	}, 300000);

	it("tq4 with a non-cosine metric is rejected by the service", async () => {
		if (!serviceUp) return;
		await expect(
			client.createIndex({
				indexName: `tq4_bad_${randomBytes(4).toString("hex")}`,
				indexKey: Client.generateKey(),
				dimension: DIM,
				metric: "euclidean",
				storagePrecision: "tq4",
			}),
		).rejects.toThrow();
	}, 30000);
});
