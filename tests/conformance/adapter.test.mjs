/**
 * Forwarding test for adapter.mjs (cyborgdb-tests ADAPTERS.md, "Recording
 * fake"). Runs the adapter's real dispatch against a fake Client and
 * EncryptedIndex that record every call, and checks that params reach the SDK
 * exactly as sent: omitted stays omitted, null/empty/zero/false are forwarded,
 * batch shapes aren't changed, and the variant picks the SDK path. The error
 * classes are the real ones from the built package, so the error mapping is
 * checked against the types the SDK ships.
 *
 * Needs `npm run build`. Run: node --test tests/conformance/
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import * as cyborgdb from "cyborgdb";
import {
	CODE_ADAPTER,
	CODE_INVALID_PARAMS,
	CODE_OP_FAILED,
	CODE_UNSUPPORTED,
	createAdapter,
} from "./adapter.mjs";

const ADAPTER_PATH = fileURLToPath(new URL("./adapter.mjs", import.meta.url));
const KEY_BYTES = Uint8Array.from({ length: 32 }, (_, i) => i);
const KEY = { $bytes: Buffer.from(KEY_BYTES).toString("base64") };

const CLIENT_METHODS = ["listIndexes", "getHealth", "createIndex", "loadIndex"];
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
];

/**
 * A fake `cyborgdb` module. Every call is appended to `calls` as
 * `[name, ...args]`. `returns[name]` is what the call resolves to, or an
 * Error it throws.
 */
function fakeSdk(returns) {
	const calls = [];
	const outcome = (name, fallback) => {
		const value = name in returns ? returns[name] : fallback;
		if (value instanceof Error) throw value;
		return value;
	};
	// What each index method returns unless a test says otherwise: the SDK's
	// result types, empty.
	const indexDefaults = {
		get: [],
		query: { results: [] },
		listIds: { ids: [], count: 0 },
		createUser: { userId: "00", apiKey: "k" },
		listUsers: [],
		queryMetadata: [],
	};
	class FakeIndex {}
	for (const method of INDEX_METHODS) {
		FakeIndex.prototype[method] = async (...args) => {
			calls.push([`index.${method}`, ...args]);
			return outcome(`index.${method}`, indexDefaults[method] ?? null);
		};
	}
	class Client {
		constructor(...args) {
			calls.push(["Client", ...args]);
			outcome("Client", null);
		}
	}
	for (const method of CLIENT_METHODS) {
		Client.prototype[method] = async (...args) => {
			calls.push([`client.${method}`, ...args]);
			const made = ["createIndex", "loadIndex"].includes(method)
				? new FakeIndex()
				: null;
			return outcome(`client.${method}`, made);
		};
	}
	return { calls, module: { ...cyborgdb, Client, VERSION: "9.9.9" } };
}

/**
 * An adapter with a client `c` and an index `i` already open, and the calls
 * that made them cleared.
 */
async function harness({ variant = "json", env = {}, returns = {} } = {}) {
	const fake = fakeSdk(returns);
	const adapter = createAdapter(fake.module, { variant, env });
	const call = (method, params) =>
		adapter.handle({ jsonrpc: "2.0", id: 1, method, params });
	const setup = [
		await call("client.new", { as: "c", base_url: "http://localhost:8000" }),
		await call("client.create_index", {
			client: "c",
			as: "i",
			name: "n",
			key: KEY,
		}),
	];
	for (const response of setup) assert.equal(response.error, undefined);
	fake.calls.length = 0;
	return {
		call,
		returns,
		calls: fake.calls,
		/** The one call made, asserting there was exactly one. */
		only() {
			assert.equal(fake.calls.length, 1, JSON.stringify(fake.calls));
			return fake.calls[0];
		},
	};
}

async function ok(h, method, params) {
	const response = await h.call(method, params);
	assert.equal(response.error, undefined, JSON.stringify(response.error));
	return response.result;
}

async function errorCode(h, method, params) {
	const response = await h.call(method, params);
	assert.ok(
		response.error,
		`expected an error, got ${JSON.stringify(response)}`,
	);
	return response.error.code;
}

describe("params are forwarded exactly", () => {
	const cases = [
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
				{ nLists: 0, batchSize: 0, maxIters: 1, tolerance: 0, maxMemory: 0 },
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
	for (const { name, method, params, call } of cases) {
		test(name, async () => {
			const h = await harness();
			await ok(h, method, params);
			assert.deepEqual(h.only(), call);
		});
	}
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
		const [, options] = h.only();
		assert.deepEqual(options, {
			items: [
				items[0],
				{ id: "b", contents: Uint8Array.from([0xff, 0x00, 0xfe]) },
				items[2],
			],
		});
	});

	test("upsert forwards ids, vectors and parallel metadata as given", async () => {
		const h = await harness();
		const params = {
			index: "i",
			ids: ["a", "b"],
			vectors: { $f32: [[1, 2]] }, // count mismatch reaches the SDK
			metadata: [null, { k: 1 }, { k: 2 }],
		};
		await ok(h, "index.upsert", params);
		assert.deepEqual(h.only(), [
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
		assert.deepEqual(h.only(), ["index.upsert", { ids: ["a"] }]);
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
			const [, options] = h.only();
			assert.ok(!(options.vectors instanceof Float32Array));
			assert.deepEqual(options.vectors, [
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
		assert.deepEqual(h.only(), [
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
		const h = await harness({ returns: { "index.query": { results: [] } } });
		await ok(h, "index.query", { index: "i", vectors: { $f32: [[1, 2]] } });
		assert.deepEqual(h.only(), ["index.query", { queryVectors: [[1, 2]] }]);
	});

	test("query by one text sends queryContents", async () => {
		const h = await harness({ returns: { "index.query": { results: [] } } });
		await ok(h, "index.query", { index: "i", contents: "fox" });
		assert.deepEqual(h.only(), ["index.query", { queryContents: "fox" }]);
	});

	test("query by a list of texts is unsupported", async () => {
		const h = await harness();
		const code = await errorCode(h, "index.query", {
			index: "i",
			contents: ["a"],
		});
		assert.equal(code, CODE_UNSUPPORTED);
		assert.equal(h.calls.length, 0);
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
		const [name, options] = h.only();
		assert.equal(name, "index.upsert");
		assert.ok(options.vectors instanceof Float32Array);
		assert.deepEqual(Array.from(options.vectors), [1, 2, 3, Number.NaN]);
		assert.deepEqual(options.ids, ["a", "b"]);
		assert.deepEqual(options.metadata, [null]);
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
		const [, options] = h.only();
		assert.deepEqual(options.ids, ["a", "b"]);
		assert.deepEqual(Array.from(options.vectors), [1, 2, 3, 4]);
		assert.deepEqual(options.metadata, [{ k: 1 }, null]);
		assert.deepEqual(options.contents, [null, "x"]);
	});

	test("upsert items without metadata or contents send neither column", async () => {
		const h = await harness({ variant: "binary" });
		await ok(h, "index.upsert", {
			index: "i",
			items: [{ id: "a", vector: [1] }],
		});
		const [, options] = h.only();
		assert.deepEqual(Object.keys(options).sort(), ["ids", "vectors"]);
	});

	const inexpressible = {
		"ragged vectors": { ids: ["a", "b"], vectors: { $f32: [[1, 2], [3]] } },
		"ids without vectors": { ids: ["a"] },
		"an item without a vector": { items: [{ id: "a", contents: "x" }] },
		"an item field beyond id/vector/contents/metadata": {
			items: [{ id: "a", vector: [1], extra: 1 }],
		},
		"a non-number element": { ids: ["a"], vectors: [[1, "2"]] },
		"bytes contents": {
			items: [{ id: "a", vector: [1], contents: { $bytes: "eA==" } }],
		},
	};
	for (const [name, params] of Object.entries(inexpressible)) {
		test(`upsert with ${name} is unsupported`, async () => {
			const h = await harness({ variant: "binary" });
			const code = await errorCode(h, "index.upsert", {
				index: "i",
				...params,
			});
			assert.equal(code, CODE_UNSUPPORTED);
			assert.equal(h.calls.length, 0);
		});
	}

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
		const [, options] = h.only();
		assert.ok(options.queryVectors instanceof Float32Array);
		assert.deepEqual(Array.from(options.queryVectors), [1, 2, 3, 4, 5, 6]);
		assert.equal(options.dimension, 3);
		assert.equal(options.topK, 3);
	});

	test("query with zero $tensor rows takes the length from the shape", async () => {
		const h = await harness({
			variant: "binary",
			returns: { "index.query": { results: [] } },
		});
		const vectors = {
			$tensor: { path: "/nonexistent", dtype: "f32", offset: 0, shape: [0, 2] },
		};
		await ok(h, "index.query", { index: "i", vectors });
		const [, options] = h.only();
		assert.equal(options.queryVectors.length, 0);
		assert.equal(options.dimension, 2);
	});

	test("query with zero inline rows sends no dimension", async () => {
		const h = await harness({
			variant: "binary",
			returns: { "index.query": { results: [] } },
		});
		await ok(h, "index.query", { index: "i", vectors: { $f32: [] } });
		const [, options] = h.only();
		assert.equal(options.queryVectors.length, 0);
		assert.ok(!("dimension" in options));
	});

	for (const params of [{ contents: "fox" }, { text: "fox" }]) {
		test(`query by ${Object.keys(params)[0]} alone is unsupported`, async () => {
			const h = await harness({ variant: "binary" });
			const code = await errorCode(h, "index.query", { index: "i", ...params });
			assert.equal(code, CODE_UNSUPPORTED);
		});
	}
});

describe("unsupported params", () => {
	const cases = [
		["client.new", { as: "c2", base_url: "http://x", storage: {} }],
		["client.load_index", { client: "c", as: "i2", name: "n", user_id: KEY }],
		["index.delete_index", { index: "i", key: KEY }],
		["index.upsert", { index: "i", items: [], user_id: KEY }],
		["index.get", { index: "i", ids: [], key: KEY }],
		["index.query", { index: "i", vectors: [[1]], key: KEY }],
		["index.create_user", { index: "i", permissions: ["read"], user_kek: KEY }],
		[
			"index.upsert",
			{
				index: "i",
				items: [{ id: "a", vector: [1], m: { $i64: "9007199254740993" } }],
			},
		],
	];
	for (const [method, params] of cases) {
		test(`${method} with ${Object.keys(params).at(-1)}`, async () => {
			const h = await harness();
			assert.equal(await errorCode(h, method, params), CODE_UNSUPPORTED);
			assert.equal(h.calls.length, 0);
		});
	}

	for (const method of [
		"index.describe",
		"index.num_vectors",
		"client.training_status",
		"client.embedding_models",
		"client.kms_create",
	]) {
		test(`${method} has no SDK method`, async () => {
			const h = await harness();
			assert.equal(
				await errorCode(h, method, { index: "i", client: "c" }),
				CODE_UNSUPPORTED,
			);
		});
	}
});

describe("results", () => {
	const rowCases = [
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
	];
	for (const [name, vectors, results, expected] of rowCases) {
		test(`query returns one list per row: ${name}`, async () => {
			const h = await harness({ returns: { "index.query": { results } } });
			assert.deepEqual(
				await ok(h, "index.query", { index: "i", vectors }),
				expected,
			);
		});
	}

	test("query encodes float specials", async () => {
		const results = [[{ id: "a", distance: Number.POSITIVE_INFINITY }]];
		const h = await harness({ returns: { "index.query": { results } } });
		const result = await ok(h, "index.query", { index: "i", vectors: [[1]] });
		assert.deepEqual(result, [[{ id: "a", distance: { $float: "inf" } }]]);
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
		assert.deepEqual(
			await ok(h, "index.get", { index: "i", ids: ["a", "b"] }),
			[
				{
					id: "a",
					vector: { $f32: [0.5, { $float: "nan" }] },
					contents: { $bytes: Buffer.from("héllo").toString("base64") },
					metadata: { k: 1 },
				},
				{ id: "b", metadata: { k: 2 } },
			],
		);
	});

	test("list_ids unwraps {ids, count}", async () => {
		const h = await harness({
			returns: { "index.listIds": { ids: ["a"], count: 1 } },
		});
		assert.deepEqual(await ok(h, "index.list_ids", { index: "i" }), ["a"]);
	});

	test("create_user and list_users rename to the contract's fields", async () => {
		const h = await harness({
			returns: {
				"index.createUser": { userId: "00ff", apiKey: "k" },
				"index.listUsers": [{ userId: "00ff", permissions: ["read"] }],
			},
		});
		assert.deepEqual(
			await ok(h, "index.create_user", { index: "i", permissions: ["read"] }),
			{
				user_id: "00ff",
				api_key: "k",
			},
		);
		assert.deepEqual(await ok(h, "index.list_users", { index: "i" }), [
			{ user_id: "00ff", permissions: ["read"] },
		]);
	});

	test("write ops return null", async () => {
		const h = await harness({
			returns: { "index.train": { status: "error" } },
		});
		assert.equal(await ok(h, "index.train", { index: "i" }), null);
	});
});

describe("errors", () => {
	const E = cyborgdb;
	const cases = [
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
	];
	for (const [error, kind, native] of cases) {
		test(`${native} is ${kind}`, async () => {
			const h = await harness({ returns: { "index.listIds": error } });
			const { error: wire } = await h.call("index.list_ids", { index: "i" });
			assert.deepEqual(wire, {
				code: CODE_OP_FAILED,
				message: "m",
				data: { kind, native },
			});
		});
	}

	test("the SDK's own kind wins over the status table", async () => {
		const error = Object.assign(
			new E.CyborgDBAuthenticationError("m", { statusCode: 401 }),
			{
				kind: "wrong_key",
			},
		);
		const h = await harness({ returns: { "index.listIds": error } });
		const { error: wire } = await h.call("index.list_ids", { index: "i" });
		assert.equal(wire.data.kind, "wrong_key");
	});

	test("a Client constructor error gets a kind", async () => {
		const h = await harness();
		h.returns.Client = new E.CyborgDBValidationError("bad url");
		const { error } = await h.call("client.new", {
			as: "c2",
			base_url: "ftp://x",
		});
		assert.equal(error.code, CODE_OP_FAILED);
		assert.equal(error.data.kind, "invalid_argument");
	});

	test("the adapter's own failures are -32603 with no kind", async () => {
		const h = await harness({ returns: { "index.get": "not a list" } });
		const { error } = await h.call("index.get", { index: "i", ids: ["a"] });
		assert.equal(error.code, CODE_ADAPTER);
		assert.equal(error.data, undefined);
	});

	const badParams = [
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
	];
	for (const [method, params] of badParams) {
		test(`bad params never reach the SDK: ${method} ${JSON.stringify(params)}`, async () => {
			const h = await harness();
			assert.equal(await errorCode(h, method, params), CODE_INVALID_PARAMS);
			assert.equal(h.calls.length, 0);
		});
	}
});

describe("typed values and the handshake", () => {
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
		assert.deepEqual(h.only()[1].filters, {
			$and: [{ a: { $bytes: "x" } }],
			$x: 1,
			k: { $f32: [1], y: 2 },
		});
	});

	test("hello reports the variant's capabilities", async () => {
		const json = await (await harness()).call("hello", { protocol: 1 });
		const binary = await (await harness({ variant: "binary" })).call("hello", {
			protocol: 1,
		});
		assert.equal(json.result.impl, "cyborgdb-js");
		assert.equal(json.result.version, "9.9.9");
		assert.ok(json.result.capabilities.includes("ragged_batches"));
		assert.ok(!binary.result.capabilities.includes("ragged_batches"));
		assert.ok(!json.result.capabilities.includes("kms_provider"));
	});

	test("kms_provider only with a KMS slot", async () => {
		const h = await harness({ env: { CYBORGDB_KMS_NAME_SM: "slot" } });
		const { result } = await h.call("hello", { protocol: 1 });
		assert.ok(result.capabilities.includes("kms_provider"));
	});

	test("an unknown variant is refused", () => {
		assert.throws(() => createAdapter(cyborgdb, { variant: "async" }), /async/);
	});

	test("frames requests over fds 3 and 4", async () => {
		const child = spawn(process.execPath, [ADAPTER_PATH], {
			stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
		});
		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		let out = "";
		child.stdio[4].on("data", (chunk) => {
			out += chunk;
		});
		child.stdio[3].end(
			[
				'{"jsonrpc":"2.0","id":1,"method":"hello","params":{"protocol":1}}',
				"",
				"not json",
				'{"jsonrpc":"2.0","id":2,"method":"index.describe","params":{}}',
				"",
			].join("\n"),
		);
		const code = await new Promise((resolve) => child.on("close", resolve));
		assert.equal(code, 0, stderr);
		const [hello, parse, describe] = out.trim().split("\n").map(JSON.parse);
		assert.equal(hello.id, 1);
		assert.equal(hello.result.version, cyborgdb.VERSION);
		assert.equal(parse.error.code, -32700);
		assert.deepEqual([describe.id, describe.error.code], [2, CODE_UNSUPPORTED]);
	});
});
