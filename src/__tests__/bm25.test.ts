/**
 * BM25 full-text search: the `fullText` metadata policy, the `bm25` scorer
 * config, and the `text` legs on queryMetadata (pure BM25) and query (hybrid
 * BM25 + vector).
 *
 * Mirrors py tests/test_bm25.py. BM25 is opt-in and derived: an index with at
 * least one `fullText` field reports a `bm25` config and accepts the `text`
 * legs; an index with none reports `bm25() === null` and rejects them
 * server-side. Full-text search resolves from the metadata index and needs no
 * training, so these run on small untrained indexes.
 */

import { randomBytes, randomUUID } from "node:crypto";
import * as dotenv from "dotenv";
import {
	Client,
	type EncryptedIndex,
	type MetadataResult,
	type QueryResultItem,
} from "../index";
import {
	flattenResults,
	waitFor,
	waitForIds,
	waitUntilGone,
} from "./test-helpers";

dotenv.config({ path: ".env.local" });
jest.setTimeout(120000);

const BASE_URL = process.env.CYBORGDB_BASE_URL || "http://localhost:8000";
const API_KEY = process.env.CYBORGDB_API_KEY || "";
const DIM = 8;

const newClient = () =>
	new Client({ baseUrl: BASE_URL, apiKey: API_KEY, verifySsl: false });
const randVec = () => Array.from({ length: DIM }, () => Math.random());
const newIndexName = (prefix: string) =>
	`${prefix}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;

/** Pull the ids out of queryMetadata's `{ id }` rows into a Set. */
const idSet = (rows: MetadataResult[]) => new Set(rows.map((r) => r.id));
/** Every element of `got` is contained in `superset`. */
const isSubset = (got: Set<string>, superset: Set<string>) =>
	[...got].every((id) => superset.has(id));

// `body` is analyzed by BM25; `topic` stays an exact-match filterable field so
// we can pre-filter the text leg. Docs 0/2/4 are about quantum computing to
// differing degrees; 1/3/5 are unrelated noise.
const DOCS: [string, string, string][] = [
	["d0", "quantum computing breakthroughs in error correction", "physics"],
	["d1", "classical machine learning models for tabular data", "ml"],
	["d2", "quantum entanglement and superposition explained", "physics"],
	["d3", "cooking pasta with fresh tomatoes and basil", "food"],
	["d4", "advances in quantum computing hardware and qubits", "physics"],
	["d5", "financial markets and stock trading strategies", "finance"],
];
// "quantum computing" — both terms in d0/d4, only "quantum" in d2.
const BOTH_TERMS = new Set(["d0", "d4"]);
const ANY_TERM = new Set(["d0", "d2", "d4"]);

const HYBRID_DIM = 4;

// Ported from cyborgdb-core tests/bm25_api_test.py via py test_bm25.py.
// Distances to the query are strictly ordered — d2 (0.0125) < d1 (1.8125) <
// d0 (1.9125) < d3 (2.0125) — so no assertion rests on a tie-break. The
// euclidean metric and dimension 4 are load-bearing: change either and the
// ordering stops holding.
const HYBRID_DOCS: [string, number[], string, string, string][] = [
	["d0", [1.0, 0.0, 0.0, 0.0], "apple banana", "date date elder", "ann"],
	["d1", [0.0, 1.0, 0.0, 0.0], "banana", "date", "bob"],
	["d2", [0.0, 0.0, 1.0, 0.0], "cherry", "elder", "ann"],
	["d3", [0.0, 0.0, 0.0, 1.0], "apple", "fig", "bob"],
];
const HYBRID_QUERY_VECTOR = [0.05, 0.1, 1.0, 0.0];
const HYBRID_TEXT = "apple date";

describe("BM25 full-text search (single full_text field)", () => {
	let client: Client;
	let index: EncryptedIndex;

	beforeAll(async () => {
		client = newClient();
		index = await client.createIndex({
			indexName: newIndexName("bm25"),
			indexKey: new Uint8Array(randomBytes(32)),
			dimension: DIM,
			metric: "euclidean",
			metadataSchema: { topic: { filterable: true } },
			textFields: ["body"],
			bm25K1: 1.5,
			bm25B: 0.7,
		});
		await index.upsert({
			items: DOCS.map(([id, body, topic]) => ({
				id,
				vector: randVec(),
				metadata: { body, topic },
			})),
		});
		await waitForIds(
			index,
			DOCS.map(([id]) => id),
		);
	});

	afterAll(async () => {
		try {
			await index.deleteIndex();
		} catch {
			// best-effort cleanup
		}
	});

	// -- schema / config round-trip -------------------------------------- //

	it("reports the full_text field in the schema", async () => {
		const schema = await index.metadataSchema();
		expect(schema.body).toEqual({
			filterable: false,
			pattern: false,
			fullText: true,
		});
	});

	it("reports the BM25 tuning params", async () => {
		const config = await index.bm25();
		expect(config).not.toBeNull();
		expect(config?.k1).toBeCloseTo(1.5);
		expect(config?.b).toBeCloseTo(0.7);
		expect(config).toHaveProperty("analyzerVersion");
	});

	// -- queryMetadata({ text }) : pure BM25 ----------------------------- //

	it("returns scored { id, score } rows ranked by descending score", async () => {
		const results = await index.queryMetadata({ text: "quantum computing" });
		expect(results.length).toBeGreaterThan(0);
		// Scored rows: each carries a real numeric BM25 score (not just a present
		// key — the mapping always sets `score`, so its value is what matters),
		// and they come back sorted by descending score.
		expect(
			results.every(
				(r) => typeof r.id === "string" && typeof r.score === "number",
			),
		).toBe(true);
		const scores = results.map((r) => r.score as number);
		expect(scores).toEqual([...scores].sort((a, b) => b - a));
		// Every hit is a quantum doc; the top hit contains both query terms.
		expect(isSubset(idSet(results), ANY_TERM)).toBe(true);
		expect(BOTH_TERMS.has(results[0].id)).toBe(true);
	});

	it("narrows to AND with requireAllTerms", async () => {
		const got = idSet(
			await index.queryMetadata({
				text: "quantum computing",
				requireAllTerms: true,
			}),
		);
		expect(got).toEqual(BOTH_TERMS);
	});

	it("caps results with topK", async () => {
		const results = await index.queryMetadata({ text: "quantum", topK: 1 });
		expect(results.length).toBe(1);
	});

	it("accepts textFields naming the only full_text field", async () => {
		// `body` is the only full_text field; naming it explicitly is a no-op
		// but must be accepted.
		const results = await index.queryMetadata({
			text: "quantum",
			textFields: ["body"],
		});
		expect(isSubset(idSet(results), ANY_TERM)).toBe(true);
	});

	it("pre-filters the text leg with an equality filter", async () => {
		// topic=food excludes every quantum doc, so the text leg scores nothing.
		const results = await index.queryMetadata({
			text: "quantum",
			filters: { topic: "food" },
		});
		expect(results).toEqual([]);
	});

	it("pre-filters the text leg with an operator filter", async () => {
		// An operator filter ($in) must pre-filter the text leg the same way an
		// equality filter does: only physics docs survive, so only quantum docs
		// can score.
		const results = await index.queryMetadata({
			text: "quantum",
			filters: { topic: { $in: ["physics"] } },
		});
		expect(idSet(results)).toEqual(ANY_TERM);
		// Survivors of the pre-filter are scored: each carries a numeric score.
		expect(results.every((r) => typeof r.score === "number")).toBe(true);
	});

	it("composes requireAllTerms with a filter", async () => {
		// AND-matching and the pre-filter apply together: requireAllTerms narrows
		// to {d0, d4}, and topic=physics keeps both (they are physics).
		const got = idSet(
			await index.queryMetadata({
				text: "quantum computing",
				requireAllTerms: true,
				filters: { topic: "physics" },
			}),
		);
		expect(got).toEqual(BOTH_TERMS);
	});

	it("treats empty text as filter-only", async () => {
		// Documented contract: an empty `text` keeps this a filter-only query —
		// { id } rows with no `score` — even though the SDK still forwards the
		// empty string to the service.
		const rows = await index.queryMetadata({
			text: "",
			filters: { topic: "physics" },
		});
		expect(idSet(rows)).toEqual(new Set(["d0", "d2", "d4"]));
		expect(rows.every((r) => Object.keys(r).length === 1 && "id" in r)).toBe(
			true,
		);
	});

	it("returns empty when the text matches no document", async () => {
		// A term that appears in no `body` scores nothing: empty result, no error.
		expect(await index.queryMetadata({ text: "zzzznonexistent" })).toEqual([]);
	});

	it("treats topK above the match count as a cap, not a floor", async () => {
		const results = await index.queryMetadata({ text: "quantum", topK: 100 });
		expect(idSet(results)).toEqual(ANY_TERM);
	});

	it("is case-insensitive", async () => {
		// The BM25 analyzer lower-cases terms, so an upper-case query matches the
		// same docs as its lower-case form.
		const upper = idSet(
			await index.queryMetadata({ text: "QUANTUM COMPUTING" }),
		);
		const lower = idSet(
			await index.queryMetadata({ text: "quantum computing" }),
		);
		expect(upper).toEqual(lower);
		expect(lower).toEqual(ANY_TERM);
	});

	it("rejects orderBy together with text", async () => {
		// Text results are relevance-ranked, so `orderBy` alongside `text` is
		// unsupported and must reject rather than silently ignore one of them.
		await expect(
			index.queryMetadata({ text: "quantum", orderBy: "topic" }),
		).rejects.toThrow();
	});

	it("enforces the schema on the text path too", async () => {
		// A pre-filter on a non-filterable field raises, exactly as it does
		// without `text` (there is no post-filter fallback in queryMetadata).
		await expect(
			index.queryMetadata({ text: "quantum", filters: { body: "quantum" } }),
		).rejects.toThrow();
	});

	// -- query({ text, filters }) : hybrid + pre-filter ------------------ //

	it("applies the metadata filter to a hybrid query", async () => {
		// With topic=food, no quantum doc survives and the text leg contributes
		// nothing, so only food docs (if any) can appear — never a quantum doc.
		const response = await index.query({
			queryVectors: randVec(),
			text: "quantum computing",
			filters: { topic: "food" },
			topK: 6,
		});
		const flat = flattenResults(response.results);
		expect(isSubset(new Set(flat.map((r) => r.id)), new Set(["d3"]))).toBe(
			true,
		);
		expect(flat.every((r) => !("distance" in r))).toBe(true);
	});

	it("without text stays a filter-only query returning { id } rows", async () => {
		const rows = await index.queryMetadata({ filters: { topic: "physics" } });
		expect(idSet(rows)).toEqual(new Set(["d0", "d2", "d4"]));
		expect(rows.every((r) => Object.keys(r).length === 1 && "id" in r)).toBe(
			true,
		);
	});

	// -- query({ text }) : hybrid BM25 + vector -------------------------- //

	it("carries a fused score on a list-vector hybrid query", async () => {
		const response = await index.query({
			queryVectors: randVec(),
			text: "quantum computing",
			topK: 6,
		});
		const flat = flattenResults(response.results);
		expect(flat.length).toBeGreaterThan(0);
		// Hybrid rows are scored (fused), not distance-ranked.
		expect(flat.every((r) => "score" in r)).toBe(true);
		expect(flat.some((r) => "distance" in r)).toBe(false);
	});

	it("carries a fused score on a Float32Array (binary) hybrid query", async () => {
		// Float32Array input routes through the binary path; it must forward the
		// text leg too.
		const response = await index.query({
			queryVectors: new Float32Array(randVec()),
			dimension: DIM,
			text: "quantum computing",
			topK: 6,
			alpha: 0.5,
		});
		const flat = flattenResults(response.results);
		expect(flat.length).toBeGreaterThan(0);
		expect(flat.every((r) => "score" in r)).toBe(true);
	});

	it("returns hybrid scores in descending order", async () => {
		// Fused (BM25 + vector) rows are ranked: scores come back non-increasing.
		// Vector inputs are random so the ordering of ids isn't deterministic, but
		// the score column must still be sorted.
		const response = await index.query({
			queryVectors: randVec(),
			text: "quantum computing",
			topK: 6,
		});
		const flat = flattenResults(response.results);
		expect(flat.length).toBeGreaterThan(0);
		const scores = flat.map((r: QueryResultItem) => r.score as number);
		expect(scores).toEqual([...scores].sort((a, b) => b - a));
	});

	it("forwards alpha to the service", async () => {
		// `alpha` must reach the service: an out-of-[0, 1] value is rejected
		// there, proving the SDK forwards it rather than dropping it.
		await expect(
			index.query({
				queryVectors: randVec(),
				text: "quantum computing",
				alpha: 5.0,
			}),
		).rejects.toThrow();
	});

	it("forwards textFields to the service", async () => {
		// `textFields` must reach the service: naming a non-full-text field
		// (`topic`) is rejected there, proving forwarding on the hybrid path.
		await expect(
			index.query({
				queryVectors: randVec(),
				text: "quantum",
				textFields: ["topic"],
			}),
		).rejects.toThrow();
	});

	it("still uses distance for a pure vector query", async () => {
		// `include` defaults to [] (IDs only); distance must be requested.
		const response = await index.query({
			queryVectors: randVec(),
			topK: 6,
			include: ["distance"],
		});
		const flat = flattenResults(response.results);
		expect(flat.length).toBeGreaterThan(0);
		expect(flat.every((r) => "distance" in r)).toBe(true);
		expect(flat.some((r) => "score" in r)).toBe(false);
	});
});

describe("BM25 metadata-filter narrowing (two full_text fields)", () => {
	// Two full_text fields (`title`, `body`) plus a discriminating filterable
	// field (`lang`), so a single text term matches several docs and a metadata
	// filter can narrow the hits to a proper subset — the case the single-topic
	// fixture above can't express. Also lets `textFields` genuinely exclude a hit
	// (a term present only in the un-searched field).
	let client: Client;
	let index: EncryptedIndex;

	// "quantum" appears in different fields per doc; `lang` splits the matches.
	const ROWS: [string, string, string, string][] = [
		["a", "quantum theory", "notes on physics", "en"], // title
		["b", "kitchen recipes", "a quantum leap forward", "en"], // body only
		["c", "quantum hardware", "qubit fabrication", "fr"], // title
		["d", "sourdough bread", "baking at home", "en"], // no match
	];
	const QUANTUM_ANY_FIELD = new Set(["a", "b", "c"]);
	const QUANTUM_IN_TITLE = new Set(["a", "c"]);

	beforeAll(async () => {
		client = newClient();
		index = await client.createIndex({
			indexName: newIndexName("bm25_filter"),
			indexKey: new Uint8Array(randomBytes(32)),
			dimension: DIM,
			metric: "euclidean",
			metadataSchema: { lang: { filterable: true } },
			textFields: ["title", "body"],
		});
		await index.upsert({
			items: ROWS.map(([id, title, body, lang]) => ({
				id,
				vector: randVec(),
				metadata: { title, body, lang },
			})),
		});
		await waitForIds(
			index,
			ROWS.map(([id]) => id),
		);
	});

	afterAll(async () => {
		try {
			await index.deleteIndex();
		} catch {
			// best-effort cleanup
		}
	});

	it("matches the term across both full_text fields", async () => {
		const got = idSet(await index.queryMetadata({ text: "quantum" }));
		expect(got).toEqual(QUANTUM_ANY_FIELD);
	});

	it("narrows text matches to a proper subset with a filter", async () => {
		// text matches {a, b, c}; lang=en drops the French doc `c`, leaving a
		// strict subset — proving the pre-filter intersects rather than replaces.
		const got = idSet(
			await index.queryMetadata({ text: "quantum", filters: { lang: "en" } }),
		);
		expect(got).toEqual(new Set(["a", "b"]));
		expect(
			isSubset(got, QUANTUM_ANY_FIELD) && got.size < QUANTUM_ANY_FIELD.size,
		).toBe(true);
	});

	it("excludes a match in an unsearched field via textFields", async () => {
		// Restricting to `title` drops `b`, whose only "quantum" is in `body`.
		const got = idSet(
			await index.queryMetadata({ text: "quantum", textFields: ["title"] }),
		);
		expect(got).toEqual(QUANTUM_IN_TITLE);
	});

	it("composes textFields and a filter", async () => {
		// Both narrowings apply together: title-only → {a, c}, then lang=en drops
		// the French `c`, leaving just {a}.
		const got = idSet(
			await index.queryMetadata({
				text: "quantum",
				textFields: ["title"],
				filters: { lang: "en" },
			}),
		);
		expect(got).toEqual(new Set(["a"]));
	});

	it("flips the top result when the field weights flip", async () => {
		// `a`/`c` match in title only, `b` in body only. 10:1 against 1:10 is a
		// 100x swing — wider than any term-frequency or field-length difference
		// here, so the flip does not ride on the per-field BM25 formula.
		const titleHeavy = (
			await index.queryMetadata({
				text: "quantum",
				textFields: ["title", "body"],
				textFieldWeights: [10.0, 1.0],
			})
		).map((r) => r.id);
		const bodyHeavy = (
			await index.queryMetadata({
				text: "quantum",
				textFields: ["title", "body"],
				textFieldWeights: [1.0, 10.0],
			})
		).map((r) => r.id);

		// Re-weighting reorders; it never filters.
		expect(new Set(titleHeavy)).toEqual(QUANTUM_ANY_FIELD);
		expect(new Set(bodyHeavy)).toEqual(QUANTUM_ANY_FIELD);
		// The winner changes. If the service ignored the weights both lists
		// would be identical, which the previous set-equality check could not
		// have caught.
		expect(QUANTUM_IN_TITLE.has(titleHeavy[0])).toBe(true);
		expect(bodyHeavy[0]).toBe("b");
		expect(titleHeavy[0]).not.toBe(bodyHeavy[0]);
	});
});

describe("BM25 not configured (no full_text field)", () => {
	// An index with no full_text field: BM25 is absent, not empty.
	let client: Client;
	let index: EncryptedIndex;

	beforeAll(async () => {
		client = newClient();
		index = await client.createIndex({
			indexName: newIndexName("bm25_none"),
			indexKey: new Uint8Array(randomBytes(32)),
			dimension: DIM,
			metric: "euclidean",
		});
		await index.upsert({
			items: Array.from({ length: 4 }, (_, i) => ({
				id: `i${i}`,
				vector: randVec(),
				metadata: { body: "quantum computing" },
			})),
		});
		await waitForIds(index, ["i0", "i1", "i2", "i3"]);
	});

	afterAll(async () => {
		try {
			await index.deleteIndex();
		} catch {
			// best-effort cleanup
		}
	});

	it("reports bm25 as null", async () => {
		expect(await index.bm25()).toBeNull();
	});

	it("rejects a text query without a full_text field", async () => {
		await expect(index.queryMetadata({ text: "quantum" })).rejects.toThrow();
	});
});

describe("MetadataResult contract (offline)", () => {
	// queryMetadata returns plain `{ id }` / `{ id, score }` rows (matching
	// core). The wire model `MetadataResult` is generated from openapi.json, so
	// its shape pins the contract; if core adds/renames a field the regenerated
	// model changes and this fails. No service needed.

	it("exports MetadataResult at the top level", () => {
		// Type-only re-export; runtime presence is checked via the generated
		// serializer, imported here to prove the symbol resolves.
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const models = require("../models");
		expect(typeof models.MetadataResultFromJSON).toBe("function");
	});

	it("deserializes an { id } row without a score", () => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { MetadataResultFromJSON } = require("../models");
		const row = MetadataResultFromJSON({ id: "d0" });
		expect(row.id).toBe("d0");
		expect(row.score).toBeUndefined();
	});

	it("deserializes an { id, score } row on the text path", () => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { MetadataResultFromJSON } = require("../models");
		const row = MetadataResultFromJSON({ id: "d0", score: 1.25 });
		expect(row.id).toBe("d0");
		expect(row.score).toBeCloseTo(1.25);
	});
});

describe("BM25 analyzer", () => {
	// Observable behaviour of the tokenizer/stemmer pipeline. Not configurable
	// from the SDK — only reported as `analyzerVersion` — so a change here would
	// otherwise go unnoticed. Every expectation was measured against a running
	// service, not assumed. Mirrors py TestBM25Analyzer.
	let client: Client;
	let index: EncryptedIndex;

	const ROWS: Record<string, string> = {
		stem: "running runner runs",
		punct: "mind-killer, fear! (really)",
		accent: "café résumé naïve",
		stop: "the a an and or but of",
		num: "version 42 build 7",
		case: "MixedCase WORD",
		plural: "boxes churches",
	};

	const ids = async (text: string) =>
		idSet(await index.queryMetadata({ text }));

	beforeAll(async () => {
		client = newClient();
		index = await client.createIndex({
			indexName: newIndexName("bm25_analyzer"),
			indexKey: new Uint8Array(randomBytes(32)),
			dimension: HYBRID_DIM,
			metric: "euclidean",
			textFields: ["body"],
		});
		await index.upsert({
			items: Object.entries(ROWS).map(([id, body]) => ({
				id,
				vector: [0.1, 0.2, 0.3, 0.4],
				metadata: { body },
			})),
		});
		await waitForIds(index, Object.keys(ROWS));
	});

	afterAll(async () => {
		try {
			await index.deleteIndex();
		} catch {
			// best-effort cleanup
		}
	});

	it.each(["run", "runs", "runner", "running"])("stems %s", async (term) => {
		expect(await ids(term)).toContain("stem");
	});

	it("stems plurals to their singular", async () => {
		expect(await ids("box")).toContain("plural");
		expect(await ids("church")).toContain("plural");
	});

	it("strips punctuation and splits hyphens", async () => {
		expect(await ids("mind")).toContain("punct");
		expect(await ids("killer")).toContain("punct");
		expect(await ids("fear")).toContain("punct");
	});

	it("folds case both ways", async () => {
		expect(await ids("mixedcase")).toContain("case");
		expect(await ids("WORD")).toContain("case");
	});

	it.each(["the", "and", "of"])("drops the stop word %s", async (term) => {
		expect(await ids(term)).toEqual(new Set());
	});

	it("indexes numeric tokens", async () => {
		expect(await ids("42")).toContain("num");
	});

	it("does not fold accents", async () => {
		// A limitation, pinned deliberately: adding accent folding is a
		// user-visible search change and should break this test.
		expect(await ids("café")).toContain("accent");
		expect(await ids("cafe")).toEqual(new Set());
	});
});

// Each pair below differs in exactly one BM25 property:
//   IDF      "zeppelin" in one document, "common" in five; both candidates are
//            the same length and match one query term, so only rarity separates.
//   LENGTH   same term and term-frequency, very different lengths.
//   TF       same length, different term-frequency.
const SCORING_DOCS: [string, string][] = [
	["idf_rare", "zeppelin padding padding padding"],
	["idf_common", "common padding padding padding"],
	["c1", "common padding padding padding"],
	["c2", "common padding padding padding"],
	["c3", "common padding padding padding"],
	["c4", "common padding padding padding"],
	["len_short", "target"],
	["len_long", `target ${"filler ".repeat(24)}`],
	["tf_one", "saturate alpha beta gamma delta"],
	["tf_many", "saturate saturate saturate saturate saturate"],
];

const scoringItems = () =>
	SCORING_DOCS.map(([id, body]) => ({
		id,
		vector: [0.1, 0.2, 0.3, 0.4],
		metadata: { body },
	}));

describe("BM25 scoring properties", () => {
	// IDF, length normalisation and term-frequency saturation through the SDK.
	// Only relative order is asserted, never an absolute score: scores shift
	// legitimately with `analyzerVersion`. Mirrors py TestBM25ScoringProperties.
	let client: Client;
	let index: EncryptedIndex;

	const ranked = async (text: string) =>
		(await index.queryMetadata({ text })).map((r) => r.id);
	const scores = async (text: string) =>
		Object.fromEntries(
			(await index.queryMetadata({ text })).map((r) => [r.id, r.score ?? 0]),
		);

	beforeAll(async () => {
		client = newClient();
		index = await client.createIndex({
			indexName: newIndexName("bm25_scoring"),
			indexKey: new Uint8Array(randomBytes(32)),
			dimension: HYBRID_DIM,
			metric: "euclidean",
			textFields: ["body"],
		});
		await index.upsert({ items: scoringItems() });
		await waitForIds(
			index,
			SCORING_DOCS.map(([id]) => id),
		);
	});

	afterAll(async () => {
		try {
			await index.deleteIndex();
		} catch {
			// best-effort cleanup
		}
	});

	it("ranks a rare term above a common one", async () => {
		const order = await ranked("zeppelin common");
		expect(order).toContain("idf_rare");
		expect(order).toContain("idf_common");
		expect(order.indexOf("idf_rare")).toBeLessThan(
			order.indexOf("idf_common"),
		);
	});

	it("ranks a shorter document above a longer one", async () => {
		expect((await ranked("target")).slice(0, 2)).toEqual([
			"len_short",
			"len_long",
		]);
	});

	it("scores higher term frequency higher", async () => {
		expect((await ranked("saturate")).slice(0, 2)).toEqual([
			"tf_many",
			"tf_one",
		]);
	});

	it("still scores a term present in every document", async () => {
		// IDF shrinks with document frequency but must not reach zero.
		const got = await scores("common");
		expect(new Set(Object.keys(got))).toEqual(
			new Set(["idf_common", "c1", "c2", "c3", "c4"]),
		);
		for (const [id, score] of Object.entries(got)) {
			expect(`${id}:${score > 0}`).toBe(`${id}:true`);
		}
	});
});

describe("BM25 tuning parameters", () => {
	// `bm25K1` and `bm25B` change ranking, not just `describe` output. Each test
	// builds a second index differing in one parameter and asserts the ranking
	// difference that parameter is responsible for. Mirrors py
	// TestBM25TuningParameters.
	let client: Client;
	const indexes: EncryptedIndex[] = [];

	const seeded = async (label: string, opts: Record<string, number> = {}) => {
		const index = await client.createIndex({
			indexName: newIndexName(`bm25_tune_${label}`),
			indexKey: new Uint8Array(randomBytes(32)),
			dimension: HYBRID_DIM,
			metric: "euclidean",
			textFields: ["body"],
			...opts,
		});
		indexes.push(index);
		await index.upsert({ items: scoringItems() });
		await waitForIds(
			index,
			SCORING_DOCS.map(([id]) => id),
		);
		return index;
	};

	const rankedIn = async (index: EncryptedIndex, text: string) =>
		(await index.queryMetadata({ text })).map((r) => r.id);
	const scoresIn = async (index: EncryptedIndex, text: string) =>
		Object.fromEntries(
			(await index.queryMetadata({ text })).map((r) => [r.id, r.score ?? 0]),
		);

	beforeAll(() => {
		client = newClient();
	});

	afterAll(async () => {
		for (const index of indexes) {
			try {
				await index.deleteIndex();
			} catch {
				// best-effort cleanup
			}
		}
	});

	it("removes the length penalty at b=0", async () => {
		const defaultB = await seeded("bdefault");
		const noLength = await seeded("bzero", { bm25B: 0.0 });

		expect((await rankedIn(defaultB, "target")).slice(0, 2)).toEqual([
			"len_short",
			"len_long",
		]);

		const got = await scoresIn(noLength, "target");
		expect(new Set(Object.keys(got))).toEqual(
			new Set(["len_short", "len_long"]),
		);
		expect(got.len_short).toBeCloseTo(got.len_long, 5);
	});

	it("makes scoring binary at k1=0", async () => {
		// At k1=0 the tf component collapses to presence/absence. The default
		// case is asserted alongside so the comparison means something.
		const defaultK1 = await seeded("kdefault");
		const binary = await seeded("kzero", { bm25K1: 0.0 });

		const defaults = await scoresIn(defaultK1, "saturate");
		expect(defaults.tf_many).toBeGreaterThan(defaults.tf_one);

		const flat = await scoresIn(binary, "saturate");
		expect(flat.tf_many).toBeCloseTo(flat.tf_one, 5);
	});
});

describe("BM25 lifecycle", () => {
	// BM25 after mutation. Scores depend on corpus-wide statistics (document
	// count, total length) that feed IDF and length normalisation. CEI tests
	// those hard at its own layer; nothing checked they are wired through
	// core -> service -> SDK, where stale statistics would skew every score with
	// no error surface. Mirrors py TestBM25Lifecycle.
	let client: Client;
	let index: EncryptedIndex;

	const ids = async (text: string) =>
		idSet(await index.queryMetadata({ text }));

	beforeEach(async () => {
		client = newClient();
		index = await client.createIndex({
			indexName: newIndexName("bm25_lifecycle"),
			indexKey: new Uint8Array(randomBytes(32)),
			dimension: HYBRID_DIM,
			metric: "euclidean",
			textFields: ["body"],
		});
		await index.upsert({
			items: ["alpha beta", "alpha gamma", "delta epsilon", "alpha zeta"].map(
				(body, i) => ({
					id: `m${i}`,
					vector: Array.from({ length: HYBRID_DIM }, (_, j) =>
						i === j ? 1.0 : 0.0,
					),
					metadata: { body },
				}),
			),
		});
		await waitForIds(index, ["m0", "m1", "m2", "m3"]);
	});

	afterEach(async () => {
		try {
			await index.deleteIndex();
		} catch {
			// best-effort cleanup
		}
	});

	it("drops a deleted document from text results", async () => {
		expect(await ids("alpha")).toEqual(new Set(["m0", "m1", "m3"]));
		await index.delete({ ids: ["m1"] });
		await waitUntilGone(index, ["m1"]);
		expect(await ids("alpha")).toEqual(new Set(["m0", "m3"]));
	});

	it("never resurfaces a deleted document", async () => {
		await index.delete({ ids: ["m0"] });
		await waitUntilGone(index, ["m0"]);
		for (const text of ["alpha", "alpha beta", "beta"]) {
			expect(await ids(text)).not.toContain("m0");
		}
	});

	it("moves a document between results when its text field is rewritten", async () => {
		expect(await ids("alpha")).not.toContain("m2");
		await index.upsert({
			items: [
				{
					id: "m2",
					vector: [0.0, 0.0, 1.0, 0.0],
					metadata: { body: "alpha omega" },
				},
			],
		});
		await waitFor(
			async () => (await ids("alpha")).has("m2"),
			"m2 becomes searchable for 'alpha' after its body was rewritten",
		);
		// ...and the old term no longer matches it: the update replaced the
		// document's postings rather than adding to them.
		expect(await ids("delta")).not.toContain("m2");
	});

	it("does not double-count a re-upserted document", async () => {
		// Double-counted corpus statistics would shift IDF and the length
		// normaliser, moving every score.
		const before = Object.fromEntries(
			(await index.queryMetadata({ text: "alpha" })).map((r) => [
				r.id,
				r.score ?? 0,
			]),
		);
		// `marker` rides along only to give the poll below something to observe;
		// `body` is byte-identical, so BM25 must be unaffected.
		await index.upsert({
			items: [
				{
					id: "m0",
					vector: [1.0, 0.0, 0.0, 0.0],
					metadata: { body: "alpha beta", marker: "reupserted" },
				},
			],
		});
		await waitFor(
			async () =>
				(await index.queryMetadata({ filters: { marker: "reupserted" } }))
					.length === 1,
			"the re-upserted m0 carries its new marker",
		);

		const after = Object.fromEntries(
			(await index.queryMetadata({ text: "alpha" })).map((r) => [
				r.id,
				r.score ?? 0,
			]),
		);
		expect(new Set(Object.keys(after))).toEqual(new Set(Object.keys(before)));
		for (const id of Object.keys(before)) {
			expect(after[id]).toBeCloseTo(before[id], 5);
		}
	});
});

describe("hybrid fusion (deterministic)", () => {
	// Hybrid fusion with hand-chosen vectors, so the fused ranking is a fact
	// rather than noise. Core proves the fusion maths; these prove the wiring.
	// Mirrors py TestHybridFusionDeterministic.
	let client: Client;
	let index: EncryptedIndex;

	type HybridOpts = Parameters<EncryptedIndex["query"]>[0];

	const hybrid = async (opts: HybridOpts = {}) =>
		flattenResults(
			(
				await index.query({
					queryVectors: HYBRID_QUERY_VECTOR,
					text: HYBRID_TEXT,
					topK: 4,
					...opts,
				})
			).results,
		);
	const hybridIds = async (opts: HybridOpts = {}) =>
		(await hybrid(opts)).map((r) => r.id);
	const textOnlyIds = async () =>
		(await index.queryMetadata({ text: HYBRID_TEXT, topK: 4 })).map(
			(r) => r.id,
		);
	const vectorOnlyIds = async () =>
		flattenResults(
			(await index.query({ queryVectors: HYBRID_QUERY_VECTOR, topK: 4 }))
				.results,
		).map((r) => r.id);

	beforeAll(async () => {
		client = newClient();
		index = await client.createIndex({
			indexName: newIndexName("hybrid_fusion"),
			indexKey: new Uint8Array(randomBytes(32)),
			dimension: HYBRID_DIM,
			metric: "euclidean",
			// filterable spelled out because of cyborgdb-core#2393.
			metadataSchema: {
				title: { fullText: true, filterable: false },
				body: { fullText: true, filterable: false },
				author: { filterable: true },
			},
		});
		await index.upsert({
			items: HYBRID_DOCS.map(([id, vector, title, body, author]) => ({
				id,
				vector,
				metadata: { title, body, author },
			})),
		});
		await waitForIds(
			index,
			HYBRID_DOCS.map(([id]) => id),
		);
	});

	afterAll(async () => {
		try {
			await index.deleteIndex();
		} catch {
			// best-effort cleanup
		}
	});

	it("reproduces the pure BM25 ranking at alpha=0", async () => {
		// Anchored as well as compared: agreement alone would hold if both legs
		// returned the same wrong answer. "apple date" matches d0 on both terms,
		// d1 and d3 on one each, and d2 on neither.
		expect(await hybridIds({ alpha: 0.0 })).toEqual(await textOnlyIds());
		expect(new Set(await hybridIds({ alpha: 0.0 }))).toEqual(
			new Set(["d0", "d1", "d3"]),
		);
	});

	it("reproduces the pure vector ranking at alpha=1", async () => {
		// Distances to the query vector are strictly ordered, so the expected
		// order is fixed rather than merely consistent.
		expect(await hybridIds({ alpha: 1.0 })).toEqual(await vectorOnlyIds());
		expect(await hybridIds({ alpha: 1.0 })).toEqual(["d2", "d1", "d0", "d3"]);
	});

	it("has disagreeing alpha endpoints", async () => {
		// Without this, both tests above would pass vacuously if the two
		// rankings ever coincided.
		expect(await textOnlyIds()).not.toEqual(await vectorOnlyIds());
	});

	it("promotes a document neither leg ranked first", async () => {
		// Vector order d2, d1, d0, d3; text order d0, then d1/d3. At the
		// defaults (alpha 0.5, rrfK 60) d0 wins on agreement across both legs
		// (0.5/61 + 0.5/63) ahead of d1 (0.5/62 + 0.5/62), while d2 — rank 1 on
		// vectors, absent from text — falls to last on 0.5/61 alone. Either
		// ordering of the d1/d3 text tie fuses the same way.
		expect(await hybridIds()).toEqual(["d0", "d1", "d3", "d2"]);
	});

	it("reaches the fusion with rrfK", async () => {
		// RRF contributes 1/(k + rank) per leg, so a smaller k raises every
		// score. Asserted on scores, not order: on four documents the order
		// margins are under 1% and would flake.
		const small = Object.fromEntries(
			(await hybrid({ rrfK: 1.0 })).map((r) => [r.id, r.score ?? 0]),
		);
		const large = Object.fromEntries(
			(await hybrid({ rrfK: 60.0 })).map((r) => [r.id, r.score ?? 0]),
		);
		expect(new Set(Object.keys(small))).toEqual(new Set(Object.keys(large)));
		expect(small).not.toEqual(large);
		for (const id of Object.keys(small)) {
			expect(`${id}:${small[id] > large[id]}`).toBe(`${id}:true`);
		}
	});

	it("rejects windowMult below one", async () => {
		// Only the bound is assertable: search is exhaustive on an untrained
		// index, so the candidate window cannot affect the ranking.
		await expect(hybrid({ windowMult: 0 })).rejects.toThrow();
	});

	it("returns the fused winner's metadata with include", async () => {
		const results = await hybrid({ include: ["metadata"], topK: 2 });
		expect(results).toHaveLength(2);
		for (const row of results) {
			expect(row.metadata).toBeDefined();
			expect(row.metadata).toHaveProperty("title");
		}
		expect(results[0].id).toBe("d0");
		expect(results[0].metadata?.author).toBe("ann");
	});

	it("fuses each row of a batch independently", async () => {
		// Two identical vectors must fuse identically and match the
		// single-vector result: the text leg applies per row, not per batch.
		const expected = await hybridIds();
		const batched = (
			await index.query({
				queryVectors: [HYBRID_QUERY_VECTOR, HYBRID_QUERY_VECTOR],
				text: HYBRID_TEXT,
				topK: 4,
			})
		).results as unknown as QueryResultItem[][];
		expect(batched).toHaveLength(2);
		for (const row of batched) {
			expect(row.map((r) => r.id)).toEqual(expected);
		}
	});

	it("prefilters both legs of the hybrid", async () => {
		// author=ann keeps d0 and d2; the order must be the fused order
		// restricted to them, not an arbitrary subset.
		expect(await hybridIds({ filters: { author: "ann" } })).toEqual([
			"d0",
			"d2",
		]);
	});

	it("returns identical results for repeated queries", async () => {
		// Precondition for every order assertion above.
		const first = await hybrid();
		const second = await hybrid();
		expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));
		expect(first.map((r) => r.score)).toEqual(second.map((r) => r.score));
	});
});
