/**
 * Forwarding test for the conformance adapter (cyborgdb-tests ADAPTERS.md,
 * "Recording fake"). Runs the adapter's real dispatch against a fake Client and
 * EncryptedIndex that record every call, and checks that params reach the SDK
 * exactly as sent: omitted stays omitted, null/empty/zero/false are forwarded,
 * batch shapes aren't changed, and the variant picks the SDK path. The error
 * classes are the SDK's real ones, so the error mapping is checked against the
 * types it ships.
 *
 * The fd framing test runs adapter.ts itself, which loads the built package:
 * it needs `npm run build`.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as cyborgdb from "../../src/index";
import {
	CODE_ADAPTER,
	CODE_INVALID_PARAMS,
	CODE_OP_FAILED,
	CODE_UNSUPPORTED,
	createAdapter,
	parseRequest,
	type ResponseBody,
	type RpcError,
	type Sdk,
} from "./dispatch";

const ADAPTER_PATH = join(__dirname, "adapter.ts");
const KEY_BYTES = Uint8Array.from({ length: 32 }, (_, i) => i);
const KEY = { $bytes: Buffer.from(KEY_BYTES).toString("base64") };

const CLIENT_METHODS = [
	"listIndexes",
	"getHealth",
	"getTrainingStatus",
	"listEmbeddingModels",
	"createIndex",
	"loadIndex",
];
const INDEX_METHODS = [
	"deleteIndex",
	"upsert",
	"get",
	"delete",
	"listIds",
	"train",
	"query",
	"queryMetadata",
	"createUser",
	"listUsers",
	"deleteUser",
	"describe",
	"getNumVectors",
];

// What each index method returns unless a test says otherwise: the SDK's
// result types, empty.
const INDEX_DEFAULTS: Record<string, unknown> = {
	get: [],
	query: { results: [] },
	listIds: { ids: [], count: 0 },
	createUser: { userId: "00", apiKey: "k" },
	listUsers: [],
	queryMetadata: [],
};

type Call = [string, ...unknown[]];
type Params = Record<string, unknown>;

/**
 * A fake `cyborgdb` module. Every call is appended to `calls` as
 * `[name, ...args]`. `returns[name]` is what the call resolves to, or an
 * Error it throws.
 */
function fakeSdk(returns: Record<string, unknown>) {
	const calls: Call[] = [];
	const outcome = (name: string, fallback: unknown) => {
		const value = name in returns ? returns[name] : fallback;
		if (value instanceof Error) throw value;
		return value;
	};
	const methods = (
		prefix: string,
		names: string[],
		fallback: (method: string) => unknown,
	) =>
		Object.fromEntries(
			names.map((method) => [
				method,
				async (...args: unknown[]) => {
					calls.push([`${prefix}.${method}`, ...args]);
					return outcome(`${prefix}.${method}`, fallback(method));
				},
			]),
		);
	const index = () =>
		methods("index", INDEX_METHODS, (method) => INDEX_DEFAULTS[method] ?? null);
	class Client {
		constructor(...args: unknown[]) {
			calls.push(["Client", ...args]);
			outcome("Client", null);
			// createIndex and loadIndex return a fresh fake index.
			Object.assign(
				this,
				methods("client", CLIENT_METHODS, (method) =>
					["createIndex", "loadIndex"].includes(method) ? index() : null,
				),
			);
		}
	}
	const module = { ...cyborgdb, Client, VERSION: "9.9.9" } as unknown as Sdk;
	return { calls, module };
}

/**
 * An adapter with a client `c` and an index `i` already open, and the calls
 * that made them cleared.
 */
async function harness({
	variant = "json",
	env = {},
	returns = {},
}: {
	variant?: string;
	env?: Record<string, string>;
	returns?: Record<string, unknown>;
} = {}) {
	const fake = fakeSdk(returns);
	const adapter = createAdapter(fake.module, { variant, env });
	const call = (method: string, params: Params) =>
		adapter.handle({ method, params });
	for (const response of [
		await call("client.new", { as: "c", base_url: "http://localhost:8000" }),
		await call("client.create_index", {
			client: "c",
			as: "i",
			name: "n",
			key: KEY,
		}),
	]) {
		expect(errorOf(response)).toBeUndefined();
	}
	fake.calls.length = 0;
	return {
		call,
		calls: fake.calls,
		returns,
		/** The one call made, asserting there was exactly one. */
		only(): Call {
			expect(fake.calls).toHaveLength(1);
			return fake.calls[0];
		},
	};
}

type Harness = Awaited<ReturnType<typeof harness>>;

function errorOf(response: ResponseBody): RpcError | undefined {
	return "error" in response ? response.error : undefined;
}

async function ok(
	h: Harness,
	method: string,
	params: Params,
): Promise<unknown> {
	const response = await h.call(method, params);
	expect(errorOf(response)).toBeUndefined();
	return (response as { result: unknown }).result;
}

async function errorCode(
	h: Harness,
	method: string,
	params: Params,
): Promise<number> {
	const error = errorOf(await h.call(method, params));
	expect(error).toBeDefined();
	return (error as RpcError).code;
}

describe("params are forwarded exactly", () => {
	const cases: { name: string; method: string; params: Params; call: Call }[] =
		[
			{
				name: "client.new without api_key leaves it out (and never sets verifySsl)",
				method: "client.new",
				params: { as: "c2", base_url: "https://x" },
				call: ["Client", { baseUrl: "https://x" }],
			},
			{
				name: "client.new forwards an empty api_key",
				method: "client.new",
				params: { as: "c2", base_url: "https://x", api_key: "" },
				call: ["Client", { baseUrl: "https://x", apiKey: "" }],
			},
			{
				name: "create_index renames and keeps zero, false and null",
				method: "client.create_index",
				params: {
					client: "c",
					as: "i2",
					name: "n2",
					key: KEY,
					dimension: 0,
					metric: null,
					storage_precision: "tq4",
					text_fields: [],
					bm25_k1: 0,
					bm25_b: 1,
					embedding_model: "m",
					kms_name: "slot",
				},
				call: [
					"client.createIndex",
					{
						indexName: "n2",
						indexKey: KEY_BYTES,
						dimension: 0,
						metric: null,
						storagePrecision: "tq4",
						textFields: [],
						bm25K1: 0,
						bm25B: 1,
						embeddingModel: "m",
						kmsName: "slot",
					},
				],
			},
			{
				name: "create_index with only a name sends only a name",
				method: "client.create_index",
				params: { client: "c", as: "i2", name: "n2" },
				call: ["client.createIndex", { indexName: "n2" }],
			},
			{
				name: "metadata_schema renames full_text only, inside policies",
				method: "client.create_index",
				params: {
					client: "c",
					as: "i2",
					name: "n2",
					metadata_schema: {
						$default: { filterable: false },
						full_text: { full_text: true, bogus: 1 },
						"geo.region": { filterable: true, pattern: false },
						odd: "not an object",
					},
				},
				call: [
					"client.createIndex",
					{
						indexName: "n2",
						metadataSchema: {
							$default: { filterable: false },
							full_text: { bogus: 1, fullText: true },
							"geo.region": { filterable: true, pattern: false },
							odd: "not an object",
						},
					},
				],
			},
			{
				name: "load_index without key leaves it out",
				method: "client.load_index",
				params: { client: "c", as: "i2", name: "n" },
				call: ["client.loadIndex", { indexName: "n" }],
			},
			{
				name: "get without include leaves the SDK default",
				method: "index.get",
				params: { index: "i", ids: ["a"] },
				call: ["index.get", { ids: ["a"] }],
			},
			{
				name: "get forwards an empty include",
				method: "index.get",
				params: { index: "i", ids: { $range: [0, 2] }, include: [] },
				call: ["index.get", { ids: ["0", "1"], include: [] }],
			},
			{
				name: "delete",
				method: "index.delete",
				params: { index: "i", ids: [] },
				call: ["index.delete", { ids: [] }],
			},
			{
				name: "train with no settings sends none",
				method: "index.train",
				params: { index: "i" },
				call: ["index.train", {}],
			},
			{
				name: "train renames and keeps zeros",
				method: "index.train",
				params: {
					index: "i",
					n_lists: 0,
					batch_size: 0,
					max_iters: 1,
					tolerance: 0,
					max_memory: 0,
				},
				call: [
					"index.train",
					{
						nLists: 0,
						batchSize: 0,
						maxIters: 1,
						tolerance: 0,
						maxMemory: 0,
					},
				],
			},
			{
				name: "query_metadata with nothing sends nothing",
				method: "index.query_metadata",
				params: { index: "i" },
				call: ["index.queryMetadata", {}],
			},
			{
				name: "query_metadata renames and keeps false and the dict order_by",
				method: "index.query_metadata",
				params: {
					index: "i",
					filters: { a: { $gt: 1 } },
					top_k: 0,
					order_by: { a: -1 },
					ascending: false,
					text: "",
					text_fields: ["t"],
					text_field_weights: [0],
					require_all_terms: false,
				},
				call: [
					"index.queryMetadata",
					{
						filters: { a: { $gt: 1 } },
						topK: 0,
						orderBy: { a: -1 },
						ascending: false,
						text: "",
						textFields: ["t"],
						textFieldWeights: [0],
						requireAllTerms: false,
					},
				],
			},
			{
				name: "a $datetime in a filter arrives as a Date",
				method: "index.query_metadata",
				params: {
					index: "i",
					filters: { at: { $gte: { $datetime: "2026-01-02T03:04:05Z" } } },
				},
				call: [
					"index.queryMetadata",
					{ filters: { at: { $gte: new Date("2026-01-02T03:04:05Z") } } },
				],
			},
			{
				name: "create_user",
				method: "index.create_user",
				params: { index: "i", permissions: [] },
				call: ["index.createUser", { permissions: [] }],
			},
			{
				name: "delete_user passes a hex string through",
				method: "index.delete_user",
				params: { index: "i", user_id: "00ff" },
				call: ["index.deleteUser", { userId: "00ff" }],
			},
			{
				name: "delete_user turns bytes into the SDK's hex form",
				method: "index.delete_user",
				params: { index: "i", user_id: { $bytes: "AP8=" } },
				call: ["index.deleteUser", { userId: "00ff" }],
			},
		];
	test.each(cases)("$name", async ({ method, params, call }) => {
		const h = await harness();
		await ok(h, method, params);
		expect(h.only()).toStrictEqual(call);
	});
});

describe("json variant", () => {
	test("upsert forwards items unchanged, contents as given", async () => {
		const h = await harness();
		const items = [
			{ id: "a", vector: [1, 2], contents: "text", metadata: { k: null } },
			{ id: "b", contents: { $bytes: "/wD+" } },
			{ id: "c", vector: [1, 2, 3] }, // ragged: forwarded, not reshaped
		];
		await ok(h, "index.upsert", { index: "i", items });
		expect(h.only()).toStrictEqual([
			"index.upsert",
			{
				items: [
					items[0],
					{ id: "b", contents: Uint8Array.from([0xff, 0x00, 0xfe]) },
					items[2],
				],
			},
		]);
	});

	test("upsert forwards ids, vectors and parallel metadata as given", async () => {
		const h = await harness();
		await ok(h, "index.upsert", {
			index: "i",
			ids: ["a", "b"],
			vectors: { $f32: [[1, 2]] }, // count mismatch reaches the SDK
			metadata: [null, { k: 1 }, { k: 2 }],
		});
		expect(h.only()).toStrictEqual([
			"index.upsert",
			{
				ids: ["a", "b"],
				vectors: [[1, 2]],
				metadata: [null, { k: 1 }, { k: 2 }],
			},
		]);
	});

	test("upsert with ids and no vectors reaches the SDK", async () => {
		const h = await harness();
		await ok(h, "index.upsert", { index: "i", ids: ["a"] });
		expect(h.only()).toStrictEqual(["index.upsert", { ids: ["a"] }]);
	});

	test("$tensor vectors go as plain arrays, never a Float32Array", async () => {
		const dir = mkdtempSync(join(tmpdir(), "adapter-test-"));
		try {
			const path = join(dir, "v.f32");
			writeFileSync(
				path,
				Buffer.from(new Float32Array([9, 1, 2, 3, 4]).buffer),
			);
			const h = await harness();
			const vectors = {
				$tensor: { path, dtype: "f32", offset: 4, shape: [2, 2] },
			};
			await ok(h, "index.upsert", { index: "i", ids: ["a", "b"], vectors });
			const options = h.only()[1] as Params;
			expect(options.vectors).not.toBeInstanceOf(Float32Array);
			expect(options.vectors).toStrictEqual([
				[1, 2],
				[3, 4],
			]);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	test("query renames options and keeps zero, false and empty", async () => {
		const h = await harness();
		await ok(h, "index.query", {
			index: "i",
			vectors: { $f32: [[1, 2]] },
			top_k: 0,
			n_probes: 0,
			filters: {},
			include: [],
			greedy: false,
			rerank_mult: 0,
			text: "",
			text_fields: [],
			text_field_weights: [],
			require_all_terms: false,
			alpha: 0,
			rrf_k: 0,
			window_mult: 0,
		});
		expect(h.only()).toStrictEqual([
			"index.query",
			{
				queryVectors: [[1, 2]],
				topK: 0,
				nProbes: 0,
				filters: {},
				include: [],
				greedy: false,
				rerankMult: 0,
				text: "",
				textFields: [],
				textFieldWeights: [],
				requireAllTerms: false,
				alpha: 0,
				rrfK: 0,
				windowMult: 0,
			},
		]);
	});

	test("query with only vectors sends only vectors", async () => {
		const h = await harness();
		await ok(h, "index.query", { index: "i", vectors: { $f32: [[1, 2]] } });
		expect(h.only()).toStrictEqual(["index.query", { queryVectors: [[1, 2]] }]);
	});

	test("query by one text sends queryContents", async () => {
		const h = await harness();
		await ok(h, "index.query", { index: "i", contents: "fox" });
		expect(h.only()).toStrictEqual(["index.query", { queryContents: "fox" }]);
	});

	test("query by a list of texts is unsupported", async () => {
		const h = await harness();
		expect(
			await errorCode(h, "index.query", { index: "i", contents: ["a"] }),
		).toBe(CODE_UNSUPPORTED);
		expect(h.calls).toHaveLength(0);
	});
});

describe("binary variant", () => {
	test("upsert sends ids and one flat Float32Array", async () => {
		const h = await harness({ variant: "binary" });
		await ok(h, "index.upsert", {
			index: "i",
			ids: ["a", "b"],
			vectors: {
				$f32: [
					[1, 2],
					[3, { $float: "nan" }],
				],
			},
			metadata: [null],
		});
		const [name, options] = h.only() as [string, Params];
		expect(name).toBe("index.upsert");
		expect(options.vectors).toBeInstanceOf(Float32Array);
		expect(Array.from(options.vectors as Float32Array)).toStrictEqual([
			1,
			2,
			3,
			Number.NaN,
		]);
		expect(options.ids).toStrictEqual(["a", "b"]);
		expect(options.metadata).toStrictEqual([null]);
	});

	test("upsert items become columns", async () => {
		const h = await harness({ variant: "binary" });
		await ok(h, "index.upsert", {
			index: "i",
			items: [
				{ id: "a", vector: [1, 2], metadata: { k: 1 } },
				{ id: "b", vector: [3, 4], contents: "x" },
			],
		});
		const options = h.only()[1] as Params;
		expect(options.ids).toStrictEqual(["a", "b"]);
		expect(Array.from(options.vectors as Float32Array)).toStrictEqual([
			1, 2, 3, 4,
		]);
		expect(options.metadata).toStrictEqual([{ k: 1 }, null]);
		expect(options.contents).toStrictEqual([null, "x"]);
	});

	test("upsert items without metadata or contents send neither column", async () => {
		const h = await harness({ variant: "binary" });
		await ok(h, "index.upsert", {
			index: "i",
			items: [{ id: "a", vector: [1] }],
		});
		expect(Object.keys(h.only()[1] as Params).sort()).toStrictEqual([
			"ids",
			"vectors",
		]);
	});

	test.each([
		["ragged vectors", { ids: ["a", "b"], vectors: { $f32: [[1, 2], [3]] } }],
		["ids without vectors", { ids: ["a"] }],
		["an item without a vector", { items: [{ id: "a", contents: "x" }] }],
		[
			"an item field beyond id/vector/contents/metadata",
			{ items: [{ id: "a", vector: [1], extra: 1 }] },
		],
		["a non-number element", { ids: ["a"], vectors: [[1, "2"]] }],
		[
			"bytes contents",
			{ items: [{ id: "a", vector: [1], contents: { $bytes: "eA==" } }] },
		],
	])("upsert with %s is unsupported", async (_name, params) => {
		const h = await harness({ variant: "binary" });
		expect(await errorCode(h, "index.upsert", { index: "i", ...params })).toBe(
			CODE_UNSUPPORTED,
		);
		expect(h.calls).toHaveLength(0);
	});

	test("query sends a flat Float32Array and the rows' own length", async () => {
		const h = await harness({
			variant: "binary",
			returns: { "index.query": { results: [[], []] } },
		});
		await ok(h, "index.query", {
			index: "i",
			vectors: {
				$f32: [
					[1, 2, 3],
					[4, 5, 6],
				],
			},
			top_k: 3,
		});
		const options = h.only()[1] as Params;
		expect(options.queryVectors).toBeInstanceOf(Float32Array);
		expect(Array.from(options.queryVectors as Float32Array)).toStrictEqual([
			1, 2, 3, 4, 5, 6,
		]);
		expect(options.dimension).toBe(3);
		expect(options.topK).toBe(3);
	});

	test("query with zero $tensor rows takes the length from the shape", async () => {
		const h = await harness({ variant: "binary" });
		const vectors = {
			$tensor: { path: "/nonexistent", dtype: "f32", offset: 0, shape: [0, 2] },
		};
		await ok(h, "index.query", { index: "i", vectors });
		const options = h.only()[1] as Params;
		expect((options.queryVectors as Float32Array).length).toBe(0);
		expect(options.dimension).toBe(2);
	});

	test("query with zero inline rows sends no dimension", async () => {
		const h = await harness({ variant: "binary" });
		await ok(h, "index.query", { index: "i", vectors: { $f32: [] } });
		const options = h.only()[1] as Params;
		expect((options.queryVectors as Float32Array).length).toBe(0);
		expect(options).not.toHaveProperty("dimension");
	});

	test.each([{ contents: "fox" }, { text: "fox" }])(
		"query by %o alone is unsupported",
		async (params) => {
			const h = await harness({ variant: "binary" });
			expect(await errorCode(h, "index.query", { index: "i", ...params })).toBe(
				CODE_UNSUPPORTED,
			);
		},
	);
});

describe("unsupported params", () => {
	test.each([
		["client.new", { as: "c2", base_url: "http://x", storage: {} }],
		["client.load_index", { client: "c", as: "i2", name: "n", user_id: KEY }],
		["index.delete_index", { index: "i", key: KEY }],
		["index.upsert", { index: "i", items: [], user_id: KEY }],
		["index.get", { index: "i", ids: [], key: KEY }],
		["index.num_vectors", { index: "i", user_id: KEY }],
		["index.query", { index: "i", vectors: [[1]], key: KEY }],
		["index.create_user", { index: "i", permissions: ["read"], user_kek: KEY }],
		[
			"index.upsert",
			{
				index: "i",
				items: [{ id: "a", vector: [1], m: { $i64: "9007199254740993" } }],
			},
		],
	])("%s %o", async (method, params) => {
		const h = await harness();
		expect(await errorCode(h, method, params)).toBe(CODE_UNSUPPORTED);
		expect(h.calls).toHaveLength(0);
	});

	test.each([
		"client.kms_create",
		"client.kms_push",
		"client.kms_get",
		"client.kms_delete",
	])("%s is core only", async (method) => {
		const h = await harness();
		expect(await errorCode(h, method, { index: "i", client: "c" })).toBe(
			CODE_UNSUPPORTED,
		);
	});
});

describe("results", () => {
	test.each([
		[
			"one row, flattened by the SDK",
			{ $f32: [[1]] },
			[{ id: "a" }],
			[[{ id: "a" }]],
		],
		[
			"one row, kept nested by the SDK",
			{ $f32: [[1]] },
			[[{ id: "a" }]],
			[[{ id: "a" }]],
		],
		["one row, empty", { $f32: [[1]] }, [], [[]]],
		["one flat vector", { $f32: [1] }, [{ id: "a" }], [[{ id: "a" }]]],
		[
			"two rows",
			{ $f32: [[1], [2]] },
			[[{ id: "a" }], []],
			[[{ id: "a" }], []],
		],
	])(
		"query returns one list per row: %s",
		async (_name, vectors, results, expected) => {
			const h = await harness({ returns: { "index.query": { results } } });
			expect(await ok(h, "index.query", { index: "i", vectors })).toStrictEqual(
				expected,
			);
		},
	);

	test("query encodes float specials", async () => {
		const results = [[{ id: "a", distance: Number.POSITIVE_INFINITY }]];
		const h = await harness({ returns: { "index.query": { results } } });
		expect(
			await ok(h, "index.query", { index: "i", vectors: [[1]] }),
		).toStrictEqual([[{ id: "a", distance: { $float: "inf" } }]]);
	});

	test("get encodes vector, contents and metadata", async () => {
		const rows = [
			{
				id: "a",
				vector: [0.5, Number.NaN],
				contents: "héllo",
				metadata: { k: 1 },
			},
			{ id: "b", metadata: '{"k":2}' },
		];
		const h = await harness({ returns: { "index.get": rows } });
		expect(
			await ok(h, "index.get", { index: "i", ids: ["a", "b"] }),
		).toStrictEqual([
			{
				id: "a",
				vector: { $f32: [0.5, { $float: "nan" }] },
				contents: { $bytes: Buffer.from("héllo").toString("base64") },
				metadata: { k: 1 },
			},
			{ id: "b", metadata: { k: 2 } },
		]);
	});

	test("list_ids unwraps {ids, count}", async () => {
		const h = await harness({
			returns: { "index.listIds": { ids: ["a"], count: 1 } },
		});
		expect(await ok(h, "index.list_ids", { index: "i" })).toStrictEqual(["a"]);
	});

	test("create_user and list_users rename to the contract's fields", async () => {
		const h = await harness({
			returns: {
				"index.createUser": { userId: "00ff", apiKey: "k" },
				"index.listUsers": [{ userId: "00ff", permissions: ["read"] }],
			},
		});
		expect(
			await ok(h, "index.create_user", { index: "i", permissions: ["read"] }),
		).toStrictEqual({ user_id: "00ff", api_key: "k" });
		expect(await ok(h, "index.list_users", { index: "i" })).toStrictEqual([
			{ user_id: "00ff", permissions: ["read"] },
		]);
	});

	test("describe renames to the contract's fields, not the schema's field names", async () => {
		const h = await harness({
			returns: {
				"index.describe": {
					indexName: "n",
					indexType: "disk_ivf",
					dimension: 0,
					metric: "euclidean",
					storagePrecision: "float32",
					nLists: 1,
					trainingState: "untrained",
					metadataSchema: {
						$default: { filterable: false },
						fieldName: { filterable: true, pattern: false, fullText: true },
					},
					bm25: { k1: 1.2, b: 0.75, analyzerVersion: null },
					embeddingModel: "m",
				},
			},
		});
		expect(await ok(h, "index.describe", { index: "i" })).toStrictEqual({
			name: "n",
			index_type: "disk_ivf",
			dimension: 0,
			metric: "euclidean",
			storage_precision: "float32",
			n_lists: 1,
			training_state: "untrained",
			embedding_model: "m",
			metadata_schema: {
				$default: { filterable: false },
				fieldName: { filterable: true, pattern: false, full_text: true },
			},
			bm25: { k1: 1.2, b: 0.75, analyzer_version: null },
		});
		expect(h.only()).toStrictEqual(["index.describe"]);
	});

	test("describe keeps a null bm25 and no embedding_model", async () => {
		const h = await harness({
			returns: {
				"index.describe": { indexName: "n", metadataSchema: {}, bm25: null },
			},
		});
		expect(await ok(h, "index.describe", { index: "i" })).toStrictEqual({
			name: "n",
			metadata_schema: {},
			bm25: null,
		});
	});

	test("num_vectors returns the count", async () => {
		const h = await harness({ returns: { "index.getNumVectors": 3 } });
		expect(await ok(h, "index.num_vectors", { index: "i" })).toBe(3);
		expect(h.only()).toStrictEqual(["index.getNumVectors"]);
	});

	test("training_status renames to the contract's fields", async () => {
		const h = await harness({
			returns: {
				"client.getTrainingStatus": {
					trainingIndexes: ["n"],
					retrainThreshold: 65536,
				},
			},
		});
		expect(
			await ok(h, "client.training_status", { client: "c" }),
		).toStrictEqual({ training_indexes: ["n"], retrain_threshold: 65536 });
	});

	test("embedding_models renames each model's fields", async () => {
		const h = await harness({
			returns: {
				"client.listEmbeddingModels": [
					{ name: "m", dimension: 384, maxSeqLength: 256 },
				],
			},
		});
		expect(
			await ok(h, "client.embedding_models", { client: "c" }),
		).toStrictEqual([{ name: "m", dimension: 384, max_seq_length: 256 }]);
	});

	test("write ops return null", async () => {
		const h = await harness({
			returns: { "index.train": { status: "error" } },
		});
		expect(await ok(h, "index.train", { index: "i" })).toBeNull();
	});
});

describe("errors", () => {
	const E = cyborgdb;
	test.each([
		[
			new E.CyborgDBValidationError("m", { statusCode: 422 }),
			"invalid_argument",
			"CyborgDBValidationError 422",
		],
		[
			new E.CyborgDBValidationError("m"),
			"invalid_argument",
			"CyborgDBValidationError",
		],
		[
			new E.CyborgDBAuthenticationError("m", { statusCode: 401 }),
			"unauthenticated",
			"CyborgDBAuthenticationError 401",
		],
		[
			new E.CyborgDBAuthenticationError("m", { statusCode: 403 }),
			"permission_denied",
			"CyborgDBAuthenticationError 403",
		],
		[
			new E.CyborgDBNotFoundError("m", { statusCode: 404 }),
			"not_found",
			"CyborgDBNotFoundError 404",
		],
		[
			new E.CyborgDBConflictError("m", { statusCode: 409 }),
			"already_exists",
			"CyborgDBConflictError 409",
		],
		[
			new E.CyborgDBRateLimitError("m", { statusCode: 429 }),
			"rate_limited",
			"CyborgDBRateLimitError 429",
		],
		[
			new E.CyborgDBServiceError("m", { statusCode: 500 }),
			"internal",
			"CyborgDBServiceError 500",
		],
		[
			new E.CyborgDBServiceError("m", { statusCode: 503 }),
			"unavailable",
			"CyborgDBServiceError 503",
		],
		[new E.CyborgDBTransportError("m"), "transport", "CyborgDBTransportError"],
		[
			new E.CyborgDBError("m", { statusCode: 418 }),
			"internal",
			"CyborgDBError 418",
		],
		[new TypeError("m"), "internal", "TypeError"],
	])("%s is %s", async (error, kind, native) => {
		const h = await harness({ returns: { "index.listIds": error } });
		expect(
			errorOf(await h.call("index.list_ids", { index: "i" })),
		).toStrictEqual({
			code: CODE_OP_FAILED,
			message: "m",
			data: { kind, native },
		});
	});

	test("the SDK's own kind wins over the status table", async () => {
		const error = Object.assign(
			new E.CyborgDBAuthenticationError("m", { statusCode: 401 }),
			{ kind: "wrong_key" },
		);
		const h = await harness({ returns: { "index.listIds": error } });
		const wire = errorOf(await h.call("index.list_ids", { index: "i" }));
		expect(wire?.data?.kind).toBe("wrong_key");
	});

	test("a Client constructor error gets a kind", async () => {
		const h = await harness();
		h.returns.Client = new E.CyborgDBValidationError("bad url");
		const error = errorOf(
			await h.call("client.new", { as: "c2", base_url: "ftp://x" }),
		);
		expect(error?.code).toBe(CODE_OP_FAILED);
		expect(error?.data?.kind).toBe("invalid_argument");
	});

	test("the adapter's own failures are -32603 with no kind", async () => {
		const h = await harness({ returns: { "index.get": "not a list" } });
		const error = errorOf(
			await h.call("index.get", { index: "i", ids: ["a"] }),
		);
		expect(error?.code).toBe(CODE_ADAPTER);
		expect(error?.data).toBeUndefined();
	});

	test.each([
		["index.get", { ids: ["a"] }],
		["index.get", { index: "nope", ids: ["a"] }],
		["client.create_index", { client: "c", name: "n" }],
		["index.upsert", { index: "i" }],
		[
			"index.upsert",
			{ index: "i", items: [{ id: "a", contents: { $bytes: "not base64!" } }] },
		],
		[
			"index.query_metadata",
			{ index: "i", filters: { at: { $datetime: "never" } } },
		],
	])("bad params never reach the SDK: %s %o", async (method, params) => {
		const h = await harness();
		expect(await errorCode(h, method, params)).toBe(CODE_INVALID_PARAMS);
		expect(h.calls).toHaveLength(0);
	});
});

describe("typed values and the handshake", () => {
	test("integers beyond 2^53 are kept as source text, other numbers parse as usual", () => {
		const parsed = parseRequest(
			'{"a":18446744073709551615,"b":-9007199254740993,"c":9007199254740991,"d":1e300,"e":1.5,"f":[4294967296]}',
		) as Record<string, unknown>;
		expect(parsed.a).toMatchObject({ source: "18446744073709551615" });
		expect(parsed.b).toMatchObject({ source: "-9007199254740993" });
		expect(parsed.c).toBe(9007199254740991);
		expect(parsed.d).toBe(1e300);
		expect(parsed.e).toBe(1.5);
		expect(parsed.f).toStrictEqual([4294967296]);
	});

	test("an integer a JS number can't hold is unsupported, never rounded", async () => {
		const h = await harness();
		const { params } = parseRequest(
			'{"params":{"client":"c","as":"w","name":"w","dimension":18446744073709551615}}',
		) as { params: Params };
		expect(await errorCode(h, "client.create_index", params)).toBe(
			CODE_UNSUPPORTED,
		);
		expect(h.calls).toHaveLength(0);
	});

	test("unknown $ keys are data and $literal passes verbatim", async () => {
		const h = await harness();
		await ok(h, "index.query_metadata", {
			index: "i",
			filters: {
				$and: [{ a: { $literal: { $bytes: "x" } } }],
				$x: 1,
				k: { $f32: [1], y: 2 },
			},
		});
		expect((h.only()[1] as Params).filters).toStrictEqual({
			$and: [{ a: { $bytes: "x" } }],
			$x: 1,
			k: { $f32: [1], y: 2 },
		});
	});

	test("hello reports the variant's capabilities", async () => {
		const hello = async (variant: string) =>
			(
				(await (
					await harness({ variant })
				).call("hello", {
					protocol: 1,
				})) as {
					result: { impl: string; version: string; capabilities: string[] };
				}
			).result;
		const json = await hello("json");
		const binary = await hello("binary");
		expect(json.impl).toBe("cyborgdb-js");
		expect(json.version).toBe("9.9.9");
		expect(json.capabilities).toContain("ragged_batches");
		expect(binary.capabilities).not.toContain("ragged_batches");
		expect(json.capabilities).not.toContain("kms_provider");
	});

	test("kms_provider only with a KMS slot", async () => {
		const h = await harness({ env: { CYBORGDB_KMS_NAME_SM: "slot" } });
		const response = (await h.call("hello", { protocol: 1 })) as {
			result: { capabilities: string[] };
		};
		expect(response.result.capabilities).toContain("kms_provider");
	});

	test("an unknown variant is refused", () => {
		expect(() =>
			createAdapter(cyborgdb as unknown as Sdk, { variant: "async" }),
		).toThrow(/async/);
	});

	test("frames requests over fds 3 and 4", async () => {
		const child = spawn(process.execPath, [ADAPTER_PATH], {
			stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
		});
		let stderr = "";
		child.stderr?.on("data", (chunk) => {
			stderr += chunk;
		});
		let out = "";
		const fd3 = child.stdio[3] as NodeJS.WritableStream;
		const fd4 = child.stdio[4] as NodeJS.ReadableStream;
		fd4.on("data", (chunk) => {
			out += chunk;
		});
		fd3.end(
			[
				'{"jsonrpc":"2.0","id":1,"method":"hello","params":{"protocol":1}}',
				"",
				"not json",
				'{"jsonrpc":"2.0","id":2,"method":"client.kms_get","params":{}}',
				"",
			].join("\n"),
		);
		const code = await new Promise((resolve) => child.on("close", resolve));
		expect({ code, stderr: code === 0 ? "" : stderr }).toStrictEqual({
			code: 0,
			stderr: "",
		});
		const [hello, parse, kmsGet] = out
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(hello.id).toBe(1);
		expect(hello.result.version).toBe(cyborgdb.VERSION);
		expect(parse.error.code).toBe(-32700);
		expect([kmsGet.id, kmsGet.error.code]).toStrictEqual([2, CODE_UNSUPPORTED]);
	});
});
