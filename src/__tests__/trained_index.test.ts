/**
 * The approximate search path.
 *
 * Mirrors py tests/test_trained_index.py. Everything else in the suite runs on
 * untrained indexes, where search is exhaustive and exact. The service only
 * trains past AUTO_TRAIN_MIN_VECTORS (65536 by default), so reaching the
 * approximate path at all needs a corpus that size.
 *
 * The corpus is loadSampleDataset() (quickstart-75k): 75,000 vectors, 100
 * queries, and ground-truth neighbours for both the trained and untrained
 * cases. Building the index takes a couple of minutes, so this file is aimed at
 * the overnight run.
 *
 * Covers rerankMult, which cannot be tested anywhere else: it widens the
 * candidate set before a final exact re-scoring pass, so on an exhaustive index
 * it is a no-op by construction.
 */

import { randomBytes, randomUUID } from "node:crypto";
import * as dotenv from "dotenv";
import {
	Client,
	type EncryptedIndex,
	type FilterExpression,
	loadSampleDataset,
	type SampleDataset,
} from "../index";
import { flattenResults } from "./test-helpers";

dotenv.config({ path: ".env.local" });
jest.setTimeout(1_800_000);

const BASE_URL = process.env.CYBORGDB_BASE_URL || "http://localhost:8000";
const API_KEY = process.env.CYBORGDB_API_KEY || "";
const UPSERT_BATCH = 5000;
const TRAIN_TIMEOUT_MS = 600_000;
const HYBRID_TEXT = "grape cherry";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Evaluate the dataset's example filters locally, as an oracle. */
function matchesFilter(
	metadata: Record<string, unknown>,
	filters: Record<string, unknown>,
): boolean {
	for (const [field, condition] of Object.entries(filters)) {
		const value = metadata[field];
		if (condition === null || typeof condition !== "object") {
			if (Array.isArray(value)) {
				if (!value.includes(condition)) return false;
			} else if (value !== condition) {
				return false;
			}
			continue;
		}
		for (const [op, operand] of Object.entries(
			condition as Record<string, unknown>,
		)) {
			const n = value as number;
			if (op === "$lt" && !(n < (operand as number))) return false;
			if (op === "$lte" && !(n <= (operand as number))) return false;
			if (op === "$gte" && !(n >= (operand as number))) return false;
			if (op === "$in") {
				const candidates = Array.isArray(value) ? value : [value];
				const wanted = operand as unknown[];
				if (!candidates.some((c) => wanted.includes(c))) return false;
			}
		}
	}
	return true;
}

describe("trained index (approximate search)", () => {
	let client: Client;
	let index: EncryptedIndex;
	let data: SampleDataset;
	let ids: string[];
	let queries: number[][];
	let truth: number[][];

	beforeAll(async () => {
		data = await loadSampleDataset();
		ids = data.ids;
		queries = data.queries;
		truth = data.trained_neighbors;

		client = new Client({ baseUrl: BASE_URL, apiKey: API_KEY, verifySsl: false });
		// `fruits` derives from the dataset's `list` field: ten terms, each in
		// ~35% of documents. Marking `string` full_text instead would make it
		// non-filterable and break the example-filter test below.
		index = await client.createIndex({
			indexName: `trained_${randomUUID().replace(/-/g, "").slice(0, 8)}`,
			indexKey: new Uint8Array(randomBytes(32)),
			dimension: data.dimension,
			metric: data.metric as "euclidean" | "squared_euclidean" | "cosine",
			textFields: ["fruits"],
		});

		for (let start = 0; start < ids.length; start += UPSERT_BATCH) {
			const stop = Math.min(start + UPSERT_BATCH, ids.length);
			const items = [];
			for (let i = start; i < stop; i++) {
				const meta = data.metadata[i] as Record<string, unknown>;
				items.push({
					id: ids[i],
					vector: data.vectors[i],
					metadata: {
						...meta,
						fruits: ((meta.list as string[]) ?? []).join(" "),
					},
				});
			}
			await index.upsert({ items });
		}

		// Crossing AUTO_TRAIN_MIN_VECTORS queues training on a background
		// worker, so the index is not trained the moment the upsert returns.
		const deadline = Date.now() + TRAIN_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (await index.isTrained()) break;
			await sleep(5000);
		}
		if (!(await index.isTrained())) {
			throw new Error(
				`index did not train within ${TRAIN_TIMEOUT_MS}ms of upserting ${ids.length} vectors`,
			);
		}
	});

	afterAll(async () => {
		try {
			await index.deleteIndex();
		} catch {
			// best-effort cleanup
		}
	});

	/** Mean recall@k across every query in the dataset. */
	const recallAtK = async (
		k: number,
		extra: Record<string, unknown> = {},
	): Promise<number> => {
		const response = await index.query({
			queryVectors: queries,
			topK: k,
			...extra,
		});
		const rows = response.results as unknown as { id: string }[][];
		let total = 0;
		for (let q = 0; q < rows.length; q++) {
			const expected = new Set(truth[q].slice(0, k).map((i) => ids[i]));
			const got = rows[q].filter((r) => expected.has(r.id)).length;
			total += got / k;
		}
		return total / rows.length;
	};

	const queryIds = async (extra: Record<string, unknown> = {}) =>
		flattenResults(
			(await index.query({ queryVectors: queries[0], topK: 10, ...extra }))
				.results,
		).map((r) => r.id);

	it("is trained", async () => {
		expect(await index.isTrained()).toBe(true);
		expect(await index.getNLists()).toBeGreaterThan(0);
	});

	it("meets the dataset's stated recall expectation", async () => {
		// The dataset ships the recall its authors measured for the trained
		// case. Compared against that rather than a number invented here, with
		// headroom so ordinary index-build variation does not trip it.
		const expected = data.trained_recall;
		const recall = await recallAtK(100);
		expect(recall).toBeGreaterThanOrEqual(expected * 0.98);
	});

	it("keeps every vector retrievable after training", async () => {
		// Training rebuilds the index; nothing may be lost in the process.
		const sample = ids.filter((_, i) => i % 5000 === 0);
		const got = await index.get({ ids: sample, include: ["vector"] });
		expect(new Set(got.map((r) => r.id))).toEqual(new Set(sample));
	});

	// -- rerankMult: only assertable where search is approximate ----------- //

	it("does not reduce recall with wider reranking", async () => {
		// The real contract: a wider candidate set cannot make results worse.
		// Averaged over all 100 queries — on any single query the two can
		// legitimately tie, so a per-query strict inequality would be flaky.
		const narrow = await recallAtK(10, { rerankMult: 1 });
		const wide = await recallAtK(10, { rerankMult: 8 });
		// Measured sweep of recall@10: 0.783 / 0.944 / 0.971 / 0.977 / 0.977 for
		// rerankMult 1 / 2 / 4 / 8 / 16. The effect is large and saturates
		// around 8, so assert a real improvement rather than merely "not worse"
		// — the latter would pass if rerankMult were ignored entirely.
		expect(wide).toBeGreaterThanOrEqual(narrow + 0.05);
		expect(narrow).toBeGreaterThan(0.7);
	});

	it.each([1, 4, 16])(
		"does not change the result count at rerankMult=%i",
		async (rerankMult) => {
			const rows = flattenResults(
				(await index.query({ queryVectors: queries[0], topK: 10, rerankMult }))
					.results,
			);
			expect(rows).toHaveLength(10);
		},
	);

	it.each([1, 8])(
		"stays ordered by distance at rerankMult=%i",
		async (rerankMult) => {
			const rows = flattenResults(
				(
					await index.query({
						queryVectors: queries[0],
						topK: 20,
						rerankMult,
						include: ["distance"],
					})
				).results,
			);
			const distances = rows.map((r) => r.distance as number);
			expect(distances).toEqual([...distances].sort((a, b) => a - b));
		},
	);

	it("enforces the topK * rerankMult ceiling", async () => {
		// Nothing anywhere asserted the 10000 ceiling, or that the error names
		// the parameter responsible.
		await expect(
			index.query({ queryVectors: queries[0], topK: 5000, rerankMult: 4 }),
		).rejects.toThrow(/10000/);

		// KNOWN BUG — this assertion fails today. cyborgdb-core#2401: the
		// message says "top_k exceeds kMaxTopK" even though topK=5000 is itself
		// under the limit; it is the product with rerankMult that breaches it. A
		// caller reducing topK to 2500 still fails.
		await expect(
			index.query({ queryVectors: queries[0], topK: 5000, rerankMult: 4 }),
		).rejects.toThrow(/rerank_mult|rerankMult/);
	});

	it.each([
		[2000, 5],
		[1000, 10],
		[100, 100],
	])(
		"accepts topK=%i with rerankMult=%i at exactly the ceiling",
		async (topK, rerankMult) => {
			// Exactly 10000 is accepted; only above it is rejected. Without this
			// the test above would still pass if the limit were off by one.
			const rows = flattenResults(
				(await index.query({ queryVectors: queries[0], topK, rerankMult }))
					.results,
			);
			expect(rows.length).toBeGreaterThan(0);
		},
	);

	// -- metadata filtering against the approximate path ------------------- //

	it("resolves every example filter the dataset ships", async () => {
		// The dataset ships filters its authors consider representative. Each
		// must return something and every row must satisfy the filter.
		for (const example of data.exampleFilters) {
			const rows = flattenResults(
				(
					await index.query({
						queryVectors: queries[0],
						topK: 50,
						filters: example.filter as FilterExpression,
						include: ["metadata"],
					})
				).results,
			);
			expect(rows.length).toBeGreaterThan(0);
			for (const row of rows) {
				expect(
					matchesFilter(
						row.metadata as Record<string, unknown>,
						example.filter as Record<string, unknown>,
					),
				).toBe(true);
			}
		}
	});

	// -- hybrid on the approximate path ------------------------------------ //
	//
	// Not relevance tests: every term sits in ~35% of documents, so the ranking
	// is mostly ties. These assert the wiring only, and are differential, so the
	// weak text does not matter.

	it("returns fused scores on a trained index", async () => {
		const rows = flattenResults(
			(
				await index.query({
					queryVectors: queries[0],
					text: HYBRID_TEXT,
					topK: 10,
				})
			).results,
		);
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((r) => typeof r.score === "number")).toBe(true);
		expect(rows.some((r) => r.distance !== undefined)).toBe(false);
	});

	it("reproduces the approximate vector ranking at alpha=1", async () => {
		// The new ground covered here: at alpha=1 the fused result must match
		// the plain vector query, which on a trained index is the *approximate*
		// ranking. Nothing else checks that fusion leaves it intact.
		const vectorOnly = await queryIds();
		const fused = await queryIds({ text: HYBRID_TEXT, alpha: 1.0 });
		expect(fused).toEqual(vectorOnly);
	});

	it("reproduces the pure BM25 ranking at alpha=0", async () => {
		const textOnly = (
			await index.queryMetadata({ text: HYBRID_TEXT, topK: 10 })
		).map((r) => r.id);
		const fused = await queryIds({ text: HYBRID_TEXT, alpha: 0.0 });
		expect(fused).toEqual(textOnly);
	});

	it("has disagreeing alpha endpoints on a trained index", async () => {
		// Guards the two above: if the vector and text rankings coincided they
		// would both pass while proving nothing.
		const vectorOnly = await queryIds();
		const textOnly = (
			await index.queryMetadata({ text: HYBRID_TEXT, topK: 10 })
		).map((r) => r.id);
		expect(vectorOnly).not.toEqual(textOnly);
	});

	it("prefilters both legs of a hybrid query when trained", async () => {
		const rows = flattenResults(
			(
				await index.query({
					queryVectors: queries[0],
					text: HYBRID_TEXT,
					filters: { number: { $lt: 100 } },
					topK: 20,
					include: ["metadata"],
				})
			).results,
		);
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) {
			expect(
				(row.metadata as Record<string, number>).number,
			).toBeLessThan(100);
		}
	});
});
