/**
 * Large-batch behaviour, binary/JSON path parity, and training boundaries.
 *
 * Mirrors py tests/test_scale_and_paths.py. These cost more wall-clock than the
 * rest of the suite and are aimed at the overnight run rather than per-PR CI.
 * They exercise what small fixtures cannot: the binary encoder, the auto-train
 * threshold, and the accuracy cost of quantised storage.
 */

import { randomBytes, randomUUID } from "node:crypto";
import * as dotenv from "dotenv";
import { Client, type EncryptedIndex } from "../index";
import { flattenResults, waitForIds } from "./test-helpers";

dotenv.config({ path: ".env.local" });
jest.setTimeout(300000);

const BASE_URL = process.env.CYBORGDB_BASE_URL || "http://localhost:8000";
const API_KEY = process.env.CYBORGDB_API_KEY || "";
const DIM = 64;
const SCALE_N = 2000;

const newClient = () =>
	new Client({ baseUrl: BASE_URL, apiKey: API_KEY, verifySsl: false });
const newIndexName = (prefix: string) =>
	`${prefix}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;

/**
 * Deterministic corpus: every assertion below must be reproducible across runs,
 * so the vectors come from a seeded generator rather than Math.random.
 * mulberry32 is small, fast and adequate for fixture data.
 */
function mulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const rng = mulberry32(20260918);
const randomVectors = (count: number, dim = DIM): number[][] =>
	Array.from({ length: count }, () =>
		Array.from({ length: dim }, () => rng()),
	);

const SCALE_VECTORS = randomVectors(SCALE_N);
const SCALE_IDS = Array.from(
	{ length: SCALE_N },
	(_, i) => `v${String(i).padStart(5, "0")}`,
);

/** Exhaustive ground truth by squared euclidean distance. */
function bruteForceNearest(
	query: number[],
	vectors: number[][],
	ids: string[],
	k: number,
): string[] {
	return vectors
		.map((v, i) => ({
			id: ids[i],
			i,
			d: v.reduce((acc, x, j) => acc + (x - query[j]) ** 2, 0),
		}))
		// Stable on ties: fall back to insertion order, matching numpy's
		// kind="stable" argsort in the Python fixture.
		.sort((a, b) => a.d - b.d || a.i - b.i)
		.slice(0, k)
		.map((r) => r.id);
}

const flatten = (vectors: number[][]) =>
	Float32Array.from(vectors.flatMap((v) => v));

describe("binary/JSON path parity", () => {
	// The binary and JSON encoders must be interchangeable. Two encodings of the
	// same data with no differential test between them is where silent
	// divergence lives.
	let client: Client;
	let jsonIndex: EncryptedIndex;
	let binaryIndex: EncryptedIndex;

	const vectors = randomVectors(200);
	const ids = Array.from(
		{ length: 200 },
		(_, i) => `b${String(i).padStart(3, "0")}`,
	);

	beforeAll(async () => {
		client = newClient();
		jsonIndex = await client.createIndex({
			indexName: newIndexName("parity_json"),
			indexKey: new Uint8Array(randomBytes(32)),
			dimension: DIM,
			metric: "euclidean",
		});
		await jsonIndex.upsert({
			items: ids.map((id, n) => ({
				id,
				vector: vectors[n],
				metadata: { n },
			})),
		});

		binaryIndex = await client.createIndex({
			indexName: newIndexName("parity_bin"),
			indexKey: new Uint8Array(randomBytes(32)),
			dimension: DIM,
			metric: "euclidean",
		});
		// A Float32Array routes to the binary encoder; a list of items would go
		// through JSON regardless of the vector type, exercising binary on the
		// query side only.
		await binaryIndex.upsert({
			ids,
			vectors: flatten(vectors),
			metadata: ids.map((_, n) => ({ n })),
		});

		await waitForIds(jsonIndex, ids);
		await waitForIds(binaryIndex, ids);
	});

	afterAll(async () => {
		for (const index of [jsonIndex, binaryIndex]) {
			try {
				await index.deleteIndex();
			} catch {
				// best-effort cleanup
			}
		}
	});

	it("ranks identically through both encoders", async () => {
		const jsonIds = flattenResults(
			(await jsonIndex.query({ queryVectors: vectors[7], topK: 20 })).results,
		).map((r) => r.id);
		const binaryIds = flattenResults(
			(
				await binaryIndex.query({
					queryVectors: Float32Array.from(vectors[7]),
					topK: 20,
					dimension: DIM,
				})
			).results,
		).map((r) => r.id);
		// Anchored as well as compared: identical encoders that were both wrong
		// would agree with each other.
		expect(jsonIds).toEqual(binaryIds);
		expect(jsonIds[0]).toBe(ids[7]);
	});

	it.each([
		[[] as string[]],
		[["distance"]],
		[["metadata"]],
		[["distance", "metadata"]],
	])("returns the same result shape for include=%p", async (include) => {
		// The two paths build their result rows differently, so compare keys and
		// not just ids.
		const jsonRows = flattenResults(
			(await jsonIndex.query({ queryVectors: vectors[1], topK: 3, include }))
				.results,
		);
		const binaryRows = flattenResults(
			(
				await binaryIndex.query({
					queryVectors: Float32Array.from(vectors[1]),
					topK: 3,
					dimension: DIM,
					include,
				})
			).results,
		);
		expect(Object.keys(jsonRows[0]).sort()).toEqual(
			Object.keys(binaryRows[0]).sort(),
		);
	});

	it("round-trips vectors identically through both encoders", async () => {
		const fromJson = (
			await jsonIndex.get({ ids: [ids[3]], include: ["vector"] })
		)[0].vector as number[];
		const fromBinary = (
			await binaryIndex.get({ ids: [ids[3]], include: ["vector"] })
		)[0].vector as number[];
		expect(fromJson).toHaveLength(DIM);
		for (let i = 0; i < DIM; i++) {
			expect(fromJson[i]).toBeCloseTo(fromBinary[i], 5);
			expect(fromJson[i]).toBeCloseTo(vectors[3][i], 4);
		}
	});

	it("applies metadata filters identically on both", async () => {
		const filters = { n: { $lt: 50 } };
		const jsonIds = new Set(
			flattenResults(
				(
					await jsonIndex.query({
						queryVectors: vectors[0],
						topK: 200,
						filters,
					})
				).results,
			).map((r) => r.id),
		);
		const binaryIds = new Set(
			flattenResults(
				(
					await binaryIndex.query({
						queryVectors: Float32Array.from(vectors[0]),
						topK: 200,
						dimension: DIM,
						filters,
					})
				).results,
			).map((r) => r.id),
		);
		expect(jsonIds).toEqual(binaryIds);
		expect(jsonIds).toEqual(new Set(ids.slice(0, 50)));
	});
});

describe("include projection", () => {
	// What `include` accepts and what it silently discards. Only the
	// unknown-value case is asserted as a bug: whether query() should return
	// vector/contents the way get() does is an open question — cyborgdb-core#2404
	// asks for a decision rather than asserting one.
	let client: Client;
	let index: EncryptedIndex;
	const vector = randomVectors(1)[0];

	beforeAll(async () => {
		client = newClient();
		index = await client.createIndex({
			indexName: newIndexName("include"),
			indexKey: new Uint8Array(randomBytes(32)),
			dimension: DIM,
			metric: "euclidean",
		});
		await index.upsert({
			items: [{ id: "only", vector, metadata: { n: 1 }, contents: "hello" }],
		});
		await waitForIds(index, ["only"]);
	});

	afterAll(async () => {
		try {
			await index.deleteIndex();
		} catch {
			// best-effort cleanup
		}
	});

	it("honours the supported include values", async () => {
		const withDistance = flattenResults(
			(await index.query({ queryVectors: vector, topK: 1, include: ["distance"] }))
				.results,
		);
		expect(withDistance[0]).toHaveProperty("distance");
		const withMetadata = flattenResults(
			(await index.query({ queryVectors: vector, topK: 1, include: ["metadata"] }))
				.results,
		);
		expect(withMetadata[0].metadata).toEqual({ n: 1 });
	});

	it("honours vector and contents on get", async () => {
		// The asymmetry in cyborgdb-core#2404: these work on get() and are
		// discarded on query(). Asserted here only for get(), where the contract
		// is documented.
		const row = (
			await index.get({ ids: ["only"], include: ["vector", "contents"] })
		)[0];
		expect(row).toHaveProperty("vector");
		expect(row.contents).toBe("hello");
	});

	it("rejects unknown include values", async () => {
		// KNOWN BUG — fails today. cyborgdb-core#2404: an unrecognised value is
		// silently discarded on both methods, so a typo such as "metdata" costs
		// the caller the field with no error. Unlike the vector/contents
		// question, this needs no documentation to be wrong.
		await expect(
			index.query({ queryVectors: vector, topK: 1, include: ["bogus"] }),
		).rejects.toThrow();
		await expect(
			index.get({ ids: ["only"], include: ["bogus"] }),
		).rejects.toThrow();
	});
});

describe("large batch", () => {
	// 2000 vectors — well above the rest of the suite's 100, still exhaustive.
	// Not enough to train: AUTO_TRAIN_MIN_VECTORS is 65536, so search here is
	// still exact. That makes the assertions below verifiable against
	// brute-force ground truth.
	let client: Client;
	let index: EncryptedIndex;

	beforeAll(async () => {
		client = newClient();
		index = await client.createIndex({
			indexName: newIndexName("scale"),
			indexKey: new Uint8Array(randomBytes(32)),
			dimension: DIM,
			metric: "euclidean",
		});
		await index.upsert({
			items: SCALE_IDS.map((id, n) => ({
				id,
				vector: SCALE_VECTORS[n],
				metadata: { bucket: n % 10 },
			})),
		});
		await waitForIds(index, [SCALE_IDS[0], SCALE_IDS[SCALE_N - 1]]);
	});

	afterAll(async () => {
		try {
			await index.deleteIndex();
		} catch {
			// best-effort cleanup
		}
	});

	it("keeps every vector retrievable", async () => {
		const { ids } = await index.listIds();
		const present = new Set(ids);
		const missing = SCALE_IDS.filter((id) => !present.has(id));
		expect(missing).toEqual([]);
	});

	it("matches brute force on exact search", async () => {
		const query = SCALE_VECTORS[123];
		const got = flattenResults(
			(await index.query({ queryVectors: query, topK: 10 })).results,
		).map((r) => r.id);
		expect(got).toEqual(
			bruteForceNearest(query, SCALE_VECTORS, SCALE_IDS, 10),
		);
	});

	it("filters at scale", async () => {
		const got = new Set(
			flattenResults(
				(
					await index.query({
						queryVectors: SCALE_VECTORS[0],
						topK: SCALE_N,
						filters: { bucket: 3 },
					})
				).results,
			).map((r) => r.id),
		);
		expect(got).toEqual(
			new Set(SCALE_IDS.filter((_, n) => n % 10 === 3)),
		);
	});

	it("keeps topK a prefix invariant", async () => {
		// The first k of a larger result must equal the smaller result. Only
		// meaningful once the corpus exceeds topK * windowMult, which the small
		// fixtures elsewhere never do.
		const query = SCALE_VECTORS[500];
		const wide = flattenResults(
			(await index.query({ queryVectors: query, topK: 50 })).results,
		).map((r) => r.id);
		const narrow = flattenResults(
			(await index.query({ queryVectors: query, topK: 10 })).results,
		).map((r) => r.id);
		expect(wide.slice(0, 10)).toEqual(narrow);
	});
});

describe("training boundaries", () => {
	// train() at and below the documented minimum.
	let client: Client;
	let index: EncryptedIndex;

	beforeEach(async () => {
		client = newClient();
		index = await client.createIndex({
			indexName: newIndexName("trainmin"),
			indexKey: new Uint8Array(randomBytes(32)),
			dimension: DIM,
			metric: "euclidean",
		});
	});

	afterEach(async () => {
		try {
			await index.deleteIndex();
		} catch {
			// best-effort cleanup
		}
	});

	const seed = async (n: number) => {
		const vectors = randomVectors(n);
		const ids = Array.from(
			{ length: n },
			(_, i) => `t${String(i).padStart(5, "0")}`,
		);
		await index.upsert({
			items: ids.map((id, i) => ({ id, vector: vectors[i] })),
		});
		await waitForIds(index, [ids[0]]);
		return ids;
	};

	it("treats training below the minimum as a silent no-op", async () => {
		// AUTO_TRAIN_MIN_VECTORS is 65536, so train() silently does nothing for
		// any index below it — returns successfully, leaves the index untrained,
		// and isTrained() is the only signal.
		const ids = await seed(5);
		await index.train({ nLists: 64 });
		expect(await index.isTrained()).toBe(false);
		const got = flattenResults(
			(await index.query({ queryVectors: randomVectors(1)[0], topK: 3 }))
				.results,
		).map((r) => r.id);
		expect(got.every((id) => ids.includes(id))).toBe(true);
	});

	it("treats more lists than vectors as a silent no-op", async () => {
		// Degenerate case, same contract: no error, no training, correct results.
		const ids = await seed(2);
		await index.train({ nLists: 2 });
		expect(await index.isTrained()).toBe(false);
		const got = new Set(
			flattenResults(
				(await index.query({ queryVectors: randomVectors(1)[0], topK: 2 }))
					.results,
			).map((r) => r.id),
		);
		expect(got).toEqual(new Set(ids));
	});

	it("still queries an untrained index", async () => {
		// Training is an optimisation, not a prerequisite: an untrained index
		// answers exactly via exhaustive search.
		const ids = await seed(20);
		const got = flattenResults(
			(await index.query({ queryVectors: randomVectors(1)[0], topK: 5 }))
				.results,
		).map((r) => r.id);
		expect(got).toHaveLength(5);
		expect(got.every((id) => ids.includes(id))).toBe(true);
		expect(await index.isTrained()).toBe(false);
	});
});

describe("storage precision accuracy", () => {
	// Quantised storage trades accuracy for size — bound the trade.
	// storage_precision.test.ts covers validation and lifecycle across every
	// tier, but nothing asserts that a quantised index still returns sensible
	// results.
	const N = 500;
	const PRECISIONS = ["float32", "float16", "tq8"] as const;

	let client: Client;
	const indexes: Record<string, EncryptedIndex> = {};
	const vectors = randomVectors(N);
	const ids = Array.from(
		{ length: N },
		(_, i) => `p${String(i).padStart(4, "0")}`,
	);
	const query = vectors[42];
	const truth = bruteForceNearest(query, vectors, ids, 10);

	beforeAll(async () => {
		client = newClient();
		for (const precision of PRECISIONS) {
			const index = await client.createIndex({
				indexName: newIndexName(`prec_${precision}`),
				indexKey: new Uint8Array(randomBytes(32)),
				dimension: DIM,
				metric: "euclidean",
				storagePrecision: precision,
			});
			await index.upsert({
				items: ids.map((id, i) => ({ id, vector: vectors[i] })),
			});
			indexes[precision] = index;
		}
		for (const index of Object.values(indexes)) {
			await waitForIds(index, [ids[0]]);
		}
	});

	afterAll(async () => {
		for (const index of Object.values(indexes)) {
			try {
				await index.deleteIndex();
			} catch {
				// best-effort cleanup
			}
		}
	});

	const topIds = async (precision: string, k: number, q = query) =>
		flattenResults(
			(await indexes[precision].query({ queryVectors: q, topK: k })).results,
		).map((r) => r.id);

	it("is exact at float32", async () => {
		// No quantisation, exhaustive search: the result must equal ground truth
		// outright, not merely approximate it.
		expect(await topIds("float32", 10)).toEqual(truth);
	});

	it.each([
		["float16", 0.9],
		["tq8", 0.5],
	])("keeps %s usable (recall@10 >= %p)", async (precision, floor) => {
		// Deliberately loose floors. The purpose is to catch a tier that has
		// become badly wrong, not to police small accuracy movements — a tight
		// threshold here would be a flaky test rather than a useful one.
		const got = await topIds(precision as string, 10);
		const hits = got.filter((id) => truth.includes(id)).length;
		expect(hits / truth.length).toBeGreaterThanOrEqual(floor as number);
	});

	it.each(PRECISIONS)("finds a vector itself at %s", async (precision) => {
		// The weakest possible accuracy guarantee, and the one that must hold
		// even at the most aggressive quantisation.
		const got = await topIds(precision, 1, vectors[7]);
		expect(got[0]).toBe(ids[7]);
	});
});
