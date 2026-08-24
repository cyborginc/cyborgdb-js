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
import { flattenResults } from "./test-helpers";

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
		await sleep(2000);
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
		// Scored dicts, not bare IDs, and sorted by descending score.
		expect(
			results.every((r) => Object.keys(r).sort().join() === "id,score"),
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
		expect(
			results.every((r) => Object.keys(r).sort().join() === "id,score"),
		).toBe(true);
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
		await sleep(2000);
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

	it("accepts field weights and keeps the matched set stable", async () => {
		// Per-field weights (parallel to the searched fields) are forwarded and
		// accepted; the matched set is unchanged by re-weighting.
		const got = idSet(
			await index.queryMetadata({
				text: "quantum",
				textFields: ["title", "body"],
				textFieldWeights: [2.0, 1.0],
			}),
		);
		expect(got).toEqual(QUANTUM_ANY_FIELD);
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
		await sleep(2000);
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
