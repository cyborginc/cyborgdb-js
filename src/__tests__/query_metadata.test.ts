/**
 * Metadata-only query (index.queryMetadata) and the per-field indexing policy
 * it enforces (createIndex({ metadataSchema })).
 *
 * Mirrors py tests/test_query_metadata.py and go test/query_metadata_test.go.
 *
 * The point is the asymmetry between the two read paths. query() can always
 * fall back to a post-filter over the decrypted metadata, so there the policy
 * only affects speed. queryMetadata() resolves everything from the index with
 * no fallback, so the policy is enforced: $regex/$contains need a pattern field
 * and a non-filterable field cannot be filtered at all. Each rejection is
 * paired with the same filter succeeding via query(), so a failure points at
 * the policy rather than at a broken filter.
 */

import { randomBytes, randomUUID } from "node:crypto";
import * as dotenv from "dotenv";
import {
	Client,
	type EncryptedIndex,
	type FilterExpression,
	type MetadataResult,
} from "../index";
import { flattenResults } from "./test-helpers";

/** Pull the ids out of queryMetadata's `{ id }` rows (core's shape). */
const idsOf = (rows: MetadataResult[]) => rows.map((r) => r.id);

dotenv.config({ path: ".env.local" });
jest.setTimeout(120000);

const BASE_URL = process.env.CYBORGDB_BASE_URL || "http://localhost:8000";
const API_KEY = process.env.CYBORGDB_API_KEY || "";
const DIM = 8;
const N = 6;

// `color` opts into the regex dictionary, `shape` is indexed but not pattern,
// `hidden` opts out of indexing entirely. Even ids are red/square/secret.
const SCHEMA = {
	color: { filterable: true, pattern: true },
	shape: { filterable: true, pattern: false },
	hidden: { filterable: false },
};
const EVEN = ["i0", "i2", "i4"];
const ODD = ["i1", "i3", "i5"];

const sorted = (ids: string[]) => [...ids].sort();

async function seed(
	client: Client,
	metadataSchema?: Record<
		string,
		{ filterable?: boolean; pattern?: boolean; fullText?: boolean }
	>,
): Promise<EncryptedIndex> {
	const index = await client.createIndex({
		indexName: `query_metadata_${randomUUID().replace(/-/g, "").slice(0, 8)}`,
		indexKey: new Uint8Array(randomBytes(32)),
		dimension: DIM,
		metric: "euclidean",
		metadataSchema,
	});
	await index.upsert({
		items: Array.from({ length: N }, (_, i) => ({
			id: `i${i}`,
			vector: Array.from({ length: DIM }, () => Math.random()),
			metadata: {
				color: i % 2 === 0 ? "red" : "green",
				shape: i % 2 === 0 ? "square" : "circle",
				hidden: i % 2 === 0 ? "secret" : "public",
				rank: i,
				loc: { city: i % 2 === 0 ? "paris" : "lyon" },
			},
		})),
	});
	await new Promise((r) => setTimeout(r, 2000));
	return index;
}

describe("queryMetadata with a per-field policy", () => {
	let client: Client;
	let index: EncryptedIndex;

	beforeAll(async () => {
		client = new Client({
			baseUrl: BASE_URL,
			apiKey: API_KEY,
			verifySsl: false,
		});
		index = await seed(client, SCHEMA);
	});

	afterAll(async () => {
		try {
			await index.deleteIndex();
		} catch {
			// best-effort cleanup
		}
	});

	/** Same filter through the vector path, for comparison. */
	async function queryIds(filters: FilterExpression): Promise<string[]> {
		const response = await index.query({
			queryVectors: Array.from({ length: DIM }, () => Math.random()),
			topK: N,
			filters,
		});
		return sorted(flattenResults(response.results).map((r) => r.id));
	}

	it("round-trips the schema through describe", async () => {
		const schema = await index.metadataSchema();
		expect(schema).toEqual({
			color: { filterable: true, pattern: true, fullText: false },
			shape: { filterable: true, pattern: false, fullText: false },
			hidden: { filterable: false, pattern: false, fullText: false },
		});
	});

	it("matches everything with no filters", async () => {
		const rows = await index.queryMetadata();
		expect(sorted(idsOf(rows))).toEqual(sorted([...EVEN, ...ODD]));
		expect(rows.length).toBe(N);
	});

	it("returns { id } rows without a score", async () => {
		// Filter-only rows match core's list[MetadataResult]: { id } only, no
		// `score` key (nothing to score without `text`).
		const rows = await index.queryMetadata({ filters: { color: "red" } });
		expect(rows.every((r) => Object.keys(r).length === 1 && "id" in r)).toBe(
			true,
		);
	});

	it("filters on equality", async () => {
		const rows = await index.queryMetadata({ filters: { color: "red" } });
		expect(sorted(idsOf(rows))).toEqual(EVEN);
	});

	it("filters on a nested dot-path", async () => {
		const rows = await index.queryMetadata({
			filters: { "loc.city": "paris" },
		});
		expect(sorted(idsOf(rows))).toEqual(EVEN);
	});

	it("resolves $regex on a pattern field", async () => {
		const rows = await index.queryMetadata({
			filters: { color: { $regex: "^r" } },
		});
		expect(sorted(idsOf(rows))).toEqual(EVEN);
	});

	it("resolves $contains on a pattern field", async () => {
		const rows = await index.queryMetadata({
			filters: { color: { $contains: "ree" } },
		});
		expect(sorted(idsOf(rows))).toEqual(ODD);
	});

	it("returns empty for a no-match filter", async () => {
		const rows = await index.queryMetadata({
			filters: { color: "mauve" },
		});
		expect(rows).toEqual([]);
	});

	it("orders by a field in both directions", async () => {
		const filters = { rank: { $gte: 0 } };
		const ascending = await index.queryMetadata({
			filters,
			orderBy: "rank",
			ascending: true,
		});
		expect(idsOf(ascending)).toEqual(["i0", "i1", "i2", "i3", "i4", "i5"]);

		const descending = await index.queryMetadata({
			filters,
			orderBy: "rank",
			ascending: false,
		});
		expect(idsOf(descending)).toEqual(["i5", "i4", "i3", "i2", "i1", "i0"]);
	});

	it("accepts the mongo-style single-field object form of orderBy", async () => {
		// { field: -1 } is core's form; the wrapper normalizes it for the service.
		const rows = await index.queryMetadata({
			filters: { rank: { $gte: 0 } },
			orderBy: { rank: -1 },
		});
		expect(idsOf(rows)).toEqual(["i5", "i4", "i3", "i2", "i1", "i0"]);
	});

	it("rejects an orderBy object with two fields", async () => {
		await expect(
			index.queryMetadata({ orderBy: { rank: 1, color: -1 } }),
		).rejects.toThrow(/exactly one|single-field/);
	});

	it("applies topK after the sort", async () => {
		const rows = await index.queryMetadata({
			filters: { rank: { $gte: 0 } },
			orderBy: "rank",
			topK: 2,
		});
		expect(idsOf(rows)).toEqual(["i0", "i1"]);
	});

	it("rejects $regex on a non-pattern field, which query() still serves", async () => {
		const filters = { shape: { $regex: "^sq" } };
		await expect(index.queryMetadata({ filters })).rejects.toThrow();
		expect(await queryIds(filters)).toEqual(EVEN);
	});

	it("rejects a non-filterable field, which query() still serves", async () => {
		const filters = { hidden: "secret" };
		await expect(index.queryMetadata({ filters })).rejects.toThrow();
		expect(await queryIds(filters)).toEqual(EVEN);
	});

	it("rejects an unsupported operator", async () => {
		// FilterOperator has no $type, so TS blocks this at compile time; the
		// cast checks the runtime rejection that a plain-JS caller would hit.
		const filters = {
			rank: { $type: "number" },
		} as unknown as FilterExpression;
		await expect(index.queryMetadata({ filters })).rejects.toThrow();
	});
});

describe("queryMetadata on a default-posture index", () => {
	let client: Client;
	let index: EncryptedIndex;

	beforeAll(async () => {
		client = new Client({
			baseUrl: BASE_URL,
			apiKey: API_KEY,
			verifySsl: false,
		});
		index = await seed(client);
	});

	afterAll(async () => {
		try {
			await index.deleteIndex();
		} catch {
			// best-effort cleanup
		}
	});

	it("reports an empty schema", async () => {
		expect(await index.metadataSchema()).toEqual({});
	});

	it("filters on equality without any opt-in", async () => {
		const rows = await index.queryMetadata({ filters: { color: "red" } });
		expect(sorted(idsOf(rows))).toEqual(EVEN);
	});

	it("still needs a pattern field for $regex", async () => {
		// Every field is indexed, but no regex dictionary was built for any.
		await expect(
			index.queryMetadata({ filters: { color: { $regex: "^r" } } }),
		).rejects.toThrow();
	});
});
