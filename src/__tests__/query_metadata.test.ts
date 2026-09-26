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
import { flattenResults, waitForIds } from "./test-helpers";

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

// o2 and o4 omit `author` entirely, and o3's `tags` is empty — the two cases
// that make operator semantics ambiguous. Mirrors py TestFilterOperators.
const OPERATOR_SCHEMA = {
	color: { filterable: true, pattern: true },
	rank: { filterable: true },
	tags: { filterable: true },
	author: { filterable: true },
};
const OPERATOR_ROWS: Array<[string, string, number, string[], string | null]> =
	[
		["o0", "red", 0, ["design", "search"], "ada"],
		["o1", "green", 10, ["design"], "bob"],
		["o2", "blue", 20, ["search"], null],
		["o3", "red", 30, [], "ada"],
		["o4", "green", 40, ["design", "search", "ml"], null],
	];
const ALL_OPS = ["o0", "o1", "o2", "o3", "o4"];

// Each expected answer is a proper subset of the corpus, so a filter that
// silently matched everything or nothing fails rather than passing by luck.
const OPERATOR_CASES: Array<[string, FilterExpression, string[]]> = [
	["$eq", { color: { $eq: "red" } }, ["o0", "o3"]],
	["$ne", { color: { $ne: "red" } }, ["o1", "o2", "o4"]],
	["$in", { color: { $in: ["red", "blue"] } }, ["o0", "o2", "o3"]],
	["$nin", { color: { $nin: ["red"] } }, ["o1", "o2", "o4"]],
	["$gt", { rank: { $gt: 20 } }, ["o3", "o4"]],
	["$gte", { rank: { $gte: 20 } }, ["o2", "o3", "o4"]],
	["$lt", { rank: { $lt: 20 } }, ["o0", "o1"]],
	["$lte", { rank: { $lte: 20 } }, ["o0", "o1", "o2"]],
	["$exists true", { author: { $exists: true } }, ["o0", "o1", "o3"]],
	["$exists false", { author: { $exists: false } }, ["o2", "o4"]],
	["$and", { $and: [{ color: "red" }, { rank: { $gte: 30 } }] }, ["o3"]],
	["$or", { $or: [{ color: "blue" }, { rank: { $lt: 10 } }] }, ["o0", "o2"]],
	["$nor", { $nor: [{ color: "red" }, { color: "green" }] }, ["o2"]],
	// `$not` is deliberately absent — openapi.json documents it, but the engine
	// rejects it on both read paths. See cyborgdb-core#2395.
	["$regex", { color: { $regex: "^r" } }, ["o0", "o3"]],
	["$contains", { color: { $contains: "ree" } }, ["o1", "o4"]],
];

describe("filter operators on both read paths", () => {
	let client: Client;
	let index: EncryptedIndex;

	beforeAll(async () => {
		client = new Client({
			baseUrl: BASE_URL,
			apiKey: API_KEY,
			verifySsl: false,
		});
		index = await client.createIndex({
			indexName: `operators_${randomUUID().replace(/-/g, "").slice(0, 8)}`,
			indexKey: new Uint8Array(randomBytes(32)),
			dimension: DIM,
			metric: "euclidean",
			metadataSchema: OPERATOR_SCHEMA,
		});
		await index.upsert({
			items: OPERATOR_ROWS.map(([id, color, rank, tags, author]) => ({
				id,
				vector: Array.from({ length: DIM }, () => Math.random()),
				// `author` is omitted rather than null: these exercise absence.
				metadata:
					author === null
						? { color, rank, tags }
						: { color, rank, tags, author },
			})),
		});
		await waitForIds(index, ALL_OPS);
	});

	afterAll(async () => {
		try {
			await index.deleteIndex();
		} catch {
			// best-effort cleanup
		}
	});

	const metaIds = async (filters: FilterExpression) =>
		sorted(idsOf(await index.queryMetadata({ filters })));
	const vectorIds = async (filters: FilterExpression) =>
		sorted(
			flattenResults(
				(
					await index.query({
						queryVectors: Array.from({ length: DIM }, () => Math.random()),
						topK: ALL_OPS.length,
						filters,
					})
				).results,
			).map((r) => r.id),
		);

	it.each(
		OPERATOR_CASES,
	)("resolves %s on the metadata path", async (_n, filters, expected) => {
		expect(await metaIds(filters)).toEqual(sorted(expected));
	});

	it.each(
		OPERATOR_CASES,
	)("resolves %s on the vector path", async (_n, filters, expected) => {
		// query() post-filters over decrypted metadata rather than resolving
		// from the index; the answers must still match.
		expect(await vectorIds(filters)).toEqual(sorted(expected));
	});

	it.each(
		OPERATOR_CASES,
	)("agrees across both paths for %s", async (_name, filters, expected) => {
		// Anchored as well as compared: a bug in the shared filter parser would
		// break both paths identically and slip past an agreement-only check.
		const meta = await metaIds(filters);
		expect(meta).toEqual(await vectorIds(filters));
		expect(meta).toEqual(sorted(expected));
	});

	it("excludes a missing field from $ne but includes it in $nin", async () => {
		// `$ne` drops documents lacking the field, `$nin` keeps them. Both are
		// defensible; the point is that the contract is pinned, not inferred.
		expect(await metaIds({ author: { $ne: "ada" } })).toEqual(["o1"]);
		expect(await metaIds({ author: { $nin: ["ada"] } })).toEqual(
			sorted(["o1", "o2", "o4"]),
		);
	});

	it("includes a missing field in $nor", async () => {
		expect(await metaIds({ $nor: [{ author: "ada" }] })).toEqual(
			sorted(["o1", "o2", "o4"]),
		);
	});

	it("treats a bare value on an array field as contains", async () => {
		expect(await metaIds({ tags: "design" })).toEqual(
			sorted(["o0", "o1", "o4"]),
		);
	});

	it("treats $in on an array field as any-of", async () => {
		expect(await metaIds({ tags: { $in: ["ml", "search"] } })).toEqual(
			sorted(["o0", "o2", "o4"]),
		);
	});

	it("expresses has-all as $and of two memberships", async () => {
		expect(
			await metaIds({ $and: [{ tags: "design" }, { tags: "search" }] }),
		).toEqual(sorted(["o0", "o4"]));
	});

	it("matches no membership for an empty array", async () => {
		expect(await metaIds({ tags: "design" })).not.toContain("o3");
		expect(await metaIds({ tags: { $in: ["design", "ml"] } })).not.toContain(
			"o3",
		);
	});

	it("matches everything for an empty filter", async () => {
		expect(await metaIds({})).toEqual(sorted(ALL_OPS));
	});

	it("matches nothing for an empty $in list", async () => {
		expect(await metaIds({ color: { $in: [] } })).toEqual([]);
	});

	it("matches everything for an empty $nin list", async () => {
		expect(await metaIds({ color: { $nin: [] } })).toEqual(sorted(ALL_OPS));
	});

	it("treats empty boolean operands as vacuous", async () => {
		// $and over nothing is vacuously true, $or vacuously false.
		expect(await metaIds({ $and: [] })).toEqual(sorted(ALL_OPS));
		expect(await metaIds({ $or: [] })).toEqual([]);
	});

	it("resolves an int and a float to the same key", async () => {
		// Anchored to the expected answer, not just compared to each other:
		// two empty results would otherwise satisfy the comparison.
		expect(await metaIds({ rank: 20 })).toEqual(["o2"]);
		expect(await metaIds({ rank: 20.0 })).toEqual(["o2"]);
		expect(await metaIds({ rank: { $gte: 20 } })).toEqual(
			sorted(["o2", "o3", "o4"]),
		);
	});

	it("rejects $not, which openapi.json documents", async () => {
		// KNOWN BUG — fails today. cyborgdb-core#2395: the engine rejects `$not`
		// on both read paths although openapi.json documents it.
		const filters = { color: { $not: { $eq: "red" } } } as FilterExpression;
		expect(await metaIds(filters)).toEqual(sorted(["o1", "o2", "o4"]));
		expect(await vectorIds(filters)).toEqual(sorted(["o1", "o2", "o4"]));
	});
});

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

describe("datetime handling", () => {
	// Native Date values passed as metadata. Core stores epoch millis and
	// supports range filters; JSON.stringify turns a Date into an ISO 8601
	// string, so equality matches but every range comparison fails.
	// Mirrors py TestDatetimeHandling.
	const BASE = new Date(Date.UTC(2026, 0, 1));
	const plusDays = (n: number) =>
		new Date(BASE.getTime() + n * 24 * 60 * 60 * 1000);

	let client: Client;
	let index: EncryptedIndex;

	beforeAll(async () => {
		client = new Client({
			baseUrl: BASE_URL,
			apiKey: API_KEY,
			verifySsl: false,
		});
		index = await client.createIndex({
			indexName: `datetime_${randomUUID().replace(/-/g, "").slice(0, 8)}`,
			indexKey: new Uint8Array(randomBytes(32)),
			dimension: DIM,
			metric: "euclidean",
			metadataSchema: {
				created: { filterable: true },
				createdMs: { filterable: true },
			},
		});
		await index.upsert({
			items: [0, 1, 2].map((i) => ({
				id: `t${i}`,
				vector: Array.from({ length: DIM }, () => Math.random()),
				metadata: {
					created: plusDays(10 * i),
					createdMs: plusDays(10 * i).getTime(),
				},
			})),
		});
		await waitForIds(index, ["t0", "t1", "t2"]);
	});

	afterAll(async () => {
		try {
			await index.deleteIndex();
		} catch {
			// best-effort cleanup
		}
	});

	// Unlike Python, TypeScript's FilterExpression does not admit a Date at
	// all — these casts are what a caller would have to write to get a Date
	// past the compiler. The cast is deliberate: it pins what the service does
	// when the types are bypassed, which is the behaviour cyborgdb-core#2396
	// describes.
	const dateFilter = (v: unknown) => v as FilterExpression;

	it("matches equality on a datetime", async () => {
		// Survives because it degenerates to string comparison.
		const got = await index.queryMetadata({
			filters: dateFilter({ created: BASE }),
		});
		expect(new Set(idsOf(got))).toEqual(new Set(["t0"]));
	});

	it("supports a range on a datetime", async () => {
		// KNOWN BUG — fails today. cyborgdb-core#2396: the ISO string reaches
		// the service, which rejects it with "$gte requires a numeric value".
		const got = await index.queryMetadata({
			filters: dateFilter({ created: { $gte: plusDays(5) } }),
		});
		expect(new Set(idsOf(got))).toEqual(new Set(["t1", "t2"]));
	});

	it("supports ranges on epoch millis", async () => {
		// The workaround callers need today.
		const cutoff = plusDays(5).getTime();
		const got = await index.queryMetadata({
			filters: { createdMs: { $gte: cutoff } },
		});
		expect(new Set(idsOf(got))).toEqual(new Set(["t1", "t2"]));
	});

	it("round-trips epoch millis exactly", async () => {
		// A float conversion anywhere would corrupt the low digits.
		const row = (await index.get({ ids: ["t0"], include: ["metadata"] }))[0];
		expect((row.metadata as Record<string, unknown>).createdMs).toBe(
			BASE.getTime(),
		);
	});
});
