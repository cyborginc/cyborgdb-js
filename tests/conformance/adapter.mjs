/**
 * cyborgdb-tests adapter for the cyborgdb JS SDK.
 *
 * Reads JSON-RPC requests on fd 3 and writes responses on fd 4 (see
 * cyborgdb-tests ADAPTERS.md). Maps each op to one call on the built `cyborgdb`
 * package, imported by name so it resolves through package.json `exports` to
 * `dist/`, the code users install. Run `npm run build` first. No defaults are
 * filled in and no results are reshaped beyond what ADAPTERS.md allows.
 *
 * CYBORGDB_TESTS_VARIANT picks the SDK path: json (default) or binary. The JS
 * client is already Promise-based, so there is no async variant.
 *
 * Run under the driver, from a cyborgdb-tests checkout:
 *   CYBORG_TEST_SDK_BASE_URL=http://localhost:8000 bin/cyborgdb-tests run \
 *     --adapter "node ../cyborgdb-js/tests/conformance/adapter.mjs" \
 *     --env sdk --variant json
 */

import {
	closeSync,
	createReadStream,
	fstatSync,
	openSync,
	readSync,
	realpathSync,
	writeSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export const PROTOCOL = 1;
export const IMPL = "cyborgdb-js";
export const CODE_OP_FAILED = -32000;
export const CODE_UNSUPPORTED = -32601;
export const CODE_INVALID_PARAMS = -32602;
export const CODE_ADAPTER = -32603;
export const CODE_PARSE = -32700;

export const VARIANTS = ["json", "binary"];

const TYPED_TAGS = new Set([
	"$f32",
	"$bytes",
	"$i64",
	"$datetime",
	"$float",
	"$tensor",
	"$range",
	"$literal",
]);

/** The SDK can't express the request; reported as -32601. */
export class Unsupported extends Error {}

/** The request itself is malformed; reported as -32602. */
export class BadParams extends Error {}

/** An error thrown by a cyborgdb call. The only failure that gets a kind. */
class SdkError extends Error {
	constructor(nativeError) {
		super(String(nativeError?.message ?? nativeError));
		this.nativeError = nativeError;
	}
}

/**
 * Calls into cyborgdb and awaits the result. Anything thrown here is the
 * product's answer; everything else is the adapter's.
 */
async function sdk(call) {
	try {
		return await call();
	} catch (nativeError) {
		throw new SdkError(nativeError);
	}
}

// ---------- typed values ----------

/**
 * A decoded `$tensor`. Keeps the shape next to the values so the binary path
 * knows the row length even when there are no rows.
 */
export class Tensor {
	constructor(values, shape) {
		this.values = values;
		this.shape = shape;
	}

	/** The values as plain nested arrays, as the JSON path takes them. */
	rows() {
		if (this.shape.length !== 2) return Array.from(this.values);
		const [rowCount, rowLength] = this.shape;
		const rows = [];
		for (let i = 0; i < rowCount; i++) {
			rows.push(
				Array.from(this.values.subarray(i * rowLength, (i + 1) * rowLength)),
			);
		}
		return rows;
	}
}

/**
 * Converts a wire value to native JS. Only a single-key object whose key is a
 * known tag is typed; any other `$` key is data.
 */
export function decode(wireValue) {
	if (Array.isArray(wireValue)) return wireValue.map(decode);
	if (isPlainObject(wireValue)) {
		const keys = Object.keys(wireValue);
		if (keys.length === 1 && TYPED_TAGS.has(keys[0])) {
			return decodeTyped(keys[0], wireValue[keys[0]]);
		}
		const native = {};
		for (const [key, value] of Object.entries(wireValue)) {
			native[key] = decode(value);
		}
		return native;
	}
	return wireValue;
}

function decodeTyped(tag, payload) {
	switch (tag) {
		case "$literal":
			return payload;
		case "$bytes":
			return decodeBase64(payload);
		case "$f32":
			// Plain arrays, never Float32Array: a Float32Array sends the SDK down
			// the binary path, so the ops pick the array type per variant.
			if (payload.length > 0 && Array.isArray(payload[0])) {
				return payload.map((row) => row.map(decodeNumber));
			}
			return payload.map(decodeNumber);
		case "$float":
			return decodeFloat(payload);
		case "$i64": {
			const number = Number(payload);
			if (!Number.isSafeInteger(number)) {
				throw new Unsupported(`a JS number can't hold ${payload} exactly`);
			}
			return number;
		}
		case "$datetime": {
			const date = new Date(payload);
			if (Number.isNaN(date.getTime())) {
				throw new BadParams(`bad $datetime ${payload}`);
			}
			return date;
		}
		case "$range": {
			const [start, stop] = payload.map(Number);
			const ids = [];
			for (let i = start; i < stop; i++) ids.push(String(i));
			return ids;
		}
		case "$tensor":
			return readTensor(payload);
	}
	throw new BadParams(`unknown typed value ${tag}`);
}

function decodeNumber(number) {
	if (isPlainObject(number) && "$float" in number) {
		return decodeFloat(number.$float);
	}
	return number;
}

function decodeFloat(name) {
	const floats = { nan: Number.NaN, inf: Infinity, "-inf": -Infinity };
	if (!(name in floats)) throw new BadParams(`bad $float ${name}`);
	return floats[name];
}

const BASE64 =
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodeBase64(text) {
	// Buffer.from skips characters it doesn't know, so check strictly first.
	if (typeof text !== "string" || !BASE64.test(text)) {
		throw new BadParams("bad $bytes base64");
	}
	return new Uint8Array(Buffer.from(text, "base64"));
}

const TENSOR_DTYPES = {
	f32: { size: 4, read: (buf, at) => buf.readFloatLE(at) },
	f16: { size: 2, read: (buf, at) => halfToFloat(buf.readUInt16LE(at)) },
	i32: { size: 4, read: (buf, at) => buf.readInt32LE(at) },
	i64: {
		size: 8,
		read: (buf, at) => {
			const number = Number(buf.readBigInt64LE(at));
			if (!Number.isSafeInteger(number)) {
				throw new Unsupported("a JS number can't hold this i64 exactly");
			}
			return number;
		},
	},
	u8: { size: 1, read: (buf, at) => buf.readUInt8(at) },
};

/** Reads a wire-form `$tensor` (an absolute path from the driver). */
function readTensor({ path, dtype, offset, shape }) {
	const type = TENSOR_DTYPES[dtype];
	if (!type) throw new BadParams(`unknown $tensor dtype ${dtype}`);
	const dims = shape.map(Number);
	const count = dims.reduce((product, size) => product * size, 1);
	const values = new Float32Array(count);
	if (count > 0) {
		const buf = Buffer.alloc(count * type.size);
		const fd = openSync(path, "r");
		try {
			const read = readSync(fd, buf, 0, buf.length, Number(offset));
			if (read !== buf.length) {
				throw new BadParams(`$tensor ${path}: short read`);
			}
		} finally {
			closeSync(fd);
		}
		for (let i = 0; i < count; i++) values[i] = type.read(buf, i * type.size);
	}
	return new Tensor(values, dims);
}

function halfToFloat(bits) {
	const sign = bits & 0x8000 ? -1 : 1;
	const exponent = (bits >> 10) & 0x1f;
	const fraction = bits & 0x3ff;
	if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
	if (exponent === 0x1f) return fraction ? Number.NaN : sign * Infinity;
	return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

/** Converts a native result to a wire value. */
export function encode(nativeValue) {
	if (nativeValue instanceof Uint8Array) {
		return { $bytes: Buffer.from(nativeValue).toString("base64") };
	}
	if (nativeValue instanceof Float32Array) return encodeF32(nativeValue);
	if (Array.isArray(nativeValue)) return nativeValue.map(encode);
	if (typeof nativeValue === "number") return encodeFloat(nativeValue);
	if (typeof nativeValue === "bigint") return { $i64: String(nativeValue) };
	if (isPlainObject(nativeValue)) {
		const wire = {};
		for (const [key, value] of Object.entries(nativeValue)) {
			if (value !== undefined) wire[key] = encode(value);
		}
		return wire;
	}
	return nativeValue === undefined ? null : nativeValue;
}

function encodeFloat(number) {
	if (Number.isNaN(number)) return { $float: "nan" };
	if (number === Infinity) return { $float: "inf" };
	if (number === -Infinity) return { $float: "-inf" };
	return number;
}

function encodeF32(vector) {
	return { $f32: Array.from(vector, encodeFloat) };
}

function isPlainObject(value) {
	if (value === null || typeof value !== "object") return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

// ---------- params ----------

function requireParam(params, name) {
	if (!(name in params)) throw new BadParams(`missing ${name}`);
	return params[name];
}

/**
 * Selects the params a spec set, leaving omitted ones out and renaming them
 * to the SDK's camelCase. A param sent as null is forwarded as null.
 */
function pickParams(params, renames) {
	const picked = {};
	for (const [specName, sdkName] of Object.entries(renames)) {
		if (specName in params) picked[sdkName] = params[specName];
	}
	return picked;
}

/** Rejects params the SDK has no way to express. */
function rejectParams(params, ...names) {
	const present = names.filter((name) => name in params);
	if (present.length > 0) {
		throw new Unsupported(`the SDK can't express ${present.join(", ")}`);
	}
}

/**
 * Renames `full_text` to the SDK's `fullText` inside each field policy. Field
 * names (including `$default`) and any other policy keys are left as sent.
 */
function sdkMetadataSchema(schema) {
	if (!isPlainObject(schema)) return schema;
	const renamed = {};
	for (const [field, policy] of Object.entries(schema)) {
		if (isPlainObject(policy) && "full_text" in policy) {
			const { full_text, ...rest } = policy;
			renamed[field] = { ...rest, fullText: full_text };
		} else {
			renamed[field] = policy;
		}
	}
	return renamed;
}

// ---------- vectors per variant ----------

/** Vectors for the JSON path: plain arrays, never a Float32Array. */
function jsonVectors(vectors) {
	return vectors instanceof Tensor ? vectors.rows() : vectors;
}

/**
 * Vectors for the binary path: one flat Float32Array, plus the row length.
 *
 * The JS SDK takes the binary path only for a flat Float32Array, and a binary
 * query needs the row length passed as `dimension`. It is read from the spec's
 * own rows (or a `$tensor`'s shape), never from the index, so a wrong-length
 * query still reaches the service. This is the same information a numpy
 * array's shape carries for the Python SDK. Zero inline rows give no length,
 * so `dimension` is left undefined for the SDK to reject.
 */
function binaryVectors(vectors) {
	if (vectors instanceof Tensor) {
		const shape = vectors.shape;
		return { flat: vectors.values, dimension: shape[shape.length - 1] };
	}
	if (!Array.isArray(vectors)) {
		throw new Unsupported("the binary path needs vectors as rows of numbers");
	}
	const rows = vectors.length > 0 && Array.isArray(vectors[0]);
	if (rows && !vectors.every((row) => Array.isArray(row))) {
		throw new Unsupported("the binary path can't carry mixed rows and numbers");
	}
	if (rows && new Set(vectors.map((row) => row.length)).size > 1) {
		throw new Unsupported(
			"the binary path can't carry vectors of different lengths",
		);
	}
	const numbers = rows ? vectors.flat() : vectors;
	if (!numbers.every((number) => typeof number === "number")) {
		throw new Unsupported("the binary path can only carry numbers");
	}
	let dimension;
	if (rows) dimension = vectors[0].length;
	else if (vectors.length > 0) dimension = vectors.length;
	return { flat: Float32Array.from(numbers), dimension };
}

/** Counts the query rows a request asked for. */
function queryRowCount(vectors, contents) {
	if (vectors !== undefined) {
		if (vectors instanceof Tensor) {
			return vectors.shape.length === 2 ? vectors.shape[0] : 1;
		}
		if (vectors.length > 0 && Array.isArray(vectors[0])) return vectors.length;
		return 1;
	}
	if (Array.isArray(contents)) return contents.length;
	return 1;
}

/** Restores the per-row nesting the SDK drops for a single query. */
function oneListPerRow(results, rowCount) {
	if (rowCount === 1 && (results.length === 0 || !Array.isArray(results[0]))) {
		return [results];
	}
	return results;
}

// ---------- result encoding ----------

/** Encodes one `get` row: vector as `$f32`, contents as `$bytes`. */
function encodeItem(item) {
	const row = {};
	for (const [field, value] of Object.entries(item)) {
		if (value === undefined) continue;
		if (field === "vector" && value !== null) {
			row[field] = encodeF32(value);
		} else if (field === "contents" && typeof value === "string") {
			row[field] = encode(new Uint8Array(Buffer.from(value, "utf8")));
		} else if (field === "metadata" && typeof value === "string") {
			row[field] = encode(JSON.parse(value));
		} else {
			row[field] = encode(value);
		}
	}
	return row;
}

// ---------- errors ----------

// HTTP status -> kind, from errors.yaml. 401 and 403 each name two kinds; the
// SDK can't tell them apart, so each gets one fixed kind and the wrong guesses
// are declared in expected-failures/cyborgdb-js.yaml.
const STATUS_KINDS = {
	400: "invalid_argument",
	401: "unauthenticated",
	403: "permission_denied",
	404: "not_found",
	409: "already_exists",
	422: "invalid_argument",
	429: "rate_limited",
	500: "internal",
	502: "unavailable",
	503: "unavailable",
	504: "unavailable",
};

// The service's KMS slot names, as the driver reads them (internal/run/secrets.go).
const KMS_SLOT_VARIABLES = [
	"CYBORGDB_TESTS_KMS_NAME_AWS_KMS",
	"CYBORGDB_KMS_NAME_REAL",
	"CYBORGDB_TESTS_KMS_NAME_AWS",
	"CYBORGDB_KMS_NAME_SM",
];

// ---------- the adapter ----------

/**
 * Builds the adapter around an SDK module: the real `cyborgdb` in main(), a
 * recording fake in the forwarding test.
 *
 * @param cyborgdb `Client`, `VERSION` and the `CyborgDB*Error` classes.
 * @param variant "json" or "binary".
 * @param env Environment variables, for the KMS slots.
 * @returns `{handle}`: runs one decoded JSON-RPC request, resolving to the
 *   response body (`{result}` or `{error}`).
 */
export function createAdapter(cyborgdb, { variant = "json", env = {} } = {}) {
	if (!VARIANTS.includes(variant)) {
		throw new Error(
			`CYBORGDB_TESTS_VARIANT=${variant}, want one of ${VARIANTS.join(", ")}`,
		);
	}
	const clients = new Map(); // handle name -> Client
	const indexes = new Map(); // handle name -> EncryptedIndex

	function lookup(handles, params, name) {
		const handleName = requireParam(params, name);
		if (!handles.has(handleName)) {
			throw new BadParams(
				`unknown ${name} handle ${JSON.stringify(handleName)}`,
			);
		}
		return handles.get(handleName);
	}

	/**
	 * The op's index. The SDK binds the key at create/load, so a per-call `key`
	 * or `user_id` override can't be passed.
	 */
	function indexForOp(params, ...overrides) {
		rejectParams(params, ...overrides);
		return lookup(indexes, params, "index");
	}

	// ---------- ops: client ----------

	async function clientNew(params) {
		const handleName = requireParam(params, "as");
		rejectParams(params, "storage", "cpu_threads", "gpu");
		const options = {
			baseUrl: requireParam(params, "base_url"),
			...pickParams(params, { api_key: "apiKey" }),
		};
		clients.set(handleName, await sdk(() => new cyborgdb.Client(options)));
		return null;
	}

	async function listIndexes(params) {
		const client = lookup(clients, params, "client");
		return encode(await sdk(() => client.listIndexes()));
	}

	async function health(params) {
		const client = lookup(clients, params, "client");
		return encode(await sdk(() => client.getHealth()));
	}

	async function createIndex(params) {
		const client = lookup(clients, params, "client");
		const handleName = requireParam(params, "as");
		const options = {
			indexName: requireParam(params, "name"),
			...pickParams(params, {
				key: "indexKey",
				kms_name: "kmsName",
				dimension: "dimension",
				metric: "metric",
				storage_precision: "storagePrecision",
				metadata_schema: "metadataSchema",
				text_fields: "textFields",
				bm25_k1: "bm25K1",
				bm25_b: "bm25B",
				embedding_model: "embeddingModel",
			}),
		};
		if ("metadataSchema" in options) {
			options.metadataSchema = sdkMetadataSchema(options.metadataSchema);
		}
		indexes.set(handleName, await sdk(() => client.createIndex(options)));
		return null;
	}

	async function loadIndex(params) {
		const client = lookup(clients, params, "client");
		const handleName = requireParam(params, "as");
		rejectParams(params, "user_id");
		const options = {
			indexName: requireParam(params, "name"),
			...pickParams(params, { key: "indexKey" }),
		};
		indexes.set(handleName, await sdk(() => client.loadIndex(options)));
		return null;
	}

	// ---------- ops: index ----------

	async function deleteIndex(params) {
		const index = indexForOp(params, "key");
		await sdk(() => index.deleteIndex());
		return null;
	}

	async function upsert(params) {
		const index = indexForOp(params, "key", "user_id");
		if (!("items" in params) && !("ids" in params)) {
			throw new BadParams("upsert needs items or ids");
		}
		const options =
			variant === "binary"
				? binaryUpsertOptions(params)
				: jsonUpsertOptions(params);
		await sdk(() => index.upsert(options));
		return null;
	}

	/** `upsert` options for the JSON path: items, or ids + vectors + metadata. */
	function jsonUpsertOptions(params) {
		if ("items" in params) return { items: params.items };
		const options = pickParams(params, {
			ids: "ids",
			vectors: "vectors",
			metadata: "metadata",
		});
		if ("vectors" in options) options.vectors = jsonVectors(options.vectors);
		return options;
	}

	/**
	 * `upsert` options for the binary path: ids and a flat Float32Array, which
	 * is what routes the SDK to /upsert-binary. Items become columns.
	 */
	function binaryUpsertOptions(params) {
		if ("ids" in params) {
			if (!("vectors" in params)) {
				throw new Unsupported("the binary upsert needs vectors");
			}
			return {
				ids: params.ids,
				vectors: binaryVectors(params.vectors).flat,
				...pickParams(params, { metadata: "metadata" }),
			};
		}
		const items = params.items;
		if (!Array.isArray(items)) {
			throw new Unsupported("the binary upsert needs items as a list");
		}
		for (const item of items) {
			if (!isPlainObject(item) || !("id" in item) || !("vector" in item)) {
				throw new Unsupported(
					"the binary upsert needs an id and a vector for every item",
				);
			}
			const extra = Object.keys(item).filter(
				(field) => !["id", "vector", "contents", "metadata"].includes(field),
			);
			if (extra.length > 0) {
				throw new Unsupported(
					`the binary upsert can't carry ${extra.join(", ")}`,
				);
			}
		}
		const options = {
			ids: items.map((item) => item.id),
			vectors: binaryVectors(items.map((item) => item.vector)).flat,
		};
		for (const field of ["metadata", "contents"]) {
			if (items.some((item) => field in item)) {
				options[field] = items.map((item) =>
					field in item ? item[field] : null,
				);
			}
		}
		// The binary upsert takes contents as (string | null)[]; bytes are only
		// expressible on the JSON path.
		if (options.contents?.some((contents) => contents instanceof Uint8Array)) {
			throw new Unsupported(
				"the binary upsert takes contents as strings, not bytes",
			);
		}
		return options;
	}

	async function get(params) {
		const index = indexForOp(params, "key", "user_id");
		const options = {
			ids: requireParam(params, "ids"),
			...pickParams(params, { include: "include" }),
		};
		const rows = await sdk(() => index.get(options));
		return rows.map(encodeItem);
	}

	async function deleteIds(params) {
		const index = indexForOp(params, "key", "user_id");
		const ids = requireParam(params, "ids");
		await sdk(() => index.delete({ ids }));
		return null;
	}

	async function listIds(params) {
		const index = indexForOp(params, "key", "user_id");
		const response = await sdk(() => index.listIds());
		return encode(response.ids); // unwrap the documented {ids, count} envelope
	}

	async function train(params) {
		const index = indexForOp(params, "key", "user_id");
		const options = pickParams(params, {
			n_lists: "nLists",
			batch_size: "batchSize",
			max_iters: "maxIters",
			tolerance: "tolerance",
			max_memory: "maxMemory",
		});
		await sdk(() => index.train(options));
		return null;
	}

	const QUERY_OPTIONS = {
		top_k: "topK",
		n_probes: "nProbes",
		filters: "filters",
		include: "include",
		greedy: "greedy",
		rerank_mult: "rerankMult",
		text: "text",
		text_fields: "textFields",
		text_field_weights: "textFieldWeights",
		require_all_terms: "requireAllTerms",
		alpha: "alpha",
		rrf_k: "rrfK",
		window_mult: "windowMult",
	};

	async function query(params) {
		const index = indexForOp(params, "key", "user_id");
		const options = pickParams(params, QUERY_OPTIONS);
		if (variant === "binary") {
			rejectParams(params, "contents");
			if (!("vectors" in params)) {
				throw new Unsupported("the binary query needs vectors");
			}
			const { flat, dimension } = binaryVectors(params.vectors);
			options.queryVectors = flat;
			if (dimension !== undefined) options.dimension = dimension;
		} else {
			if ("vectors" in params) {
				options.queryVectors = jsonVectors(params.vectors);
			}
			if ("contents" in params) {
				if (Array.isArray(params.contents)) {
					throw new Unsupported("queryContents takes one string, not a list");
				}
				options.queryContents = params.contents;
			}
		}
		const response = await sdk(() => index.query(options));
		const rowCount = queryRowCount(params.vectors, params.contents);
		return encode(oneListPerRow(response.results, rowCount));
	}

	async function queryMetadata(params) {
		const index = indexForOp(params, "key", "user_id");
		const options = pickParams(params, {
			filters: "filters",
			top_k: "topK",
			order_by: "orderBy",
			ascending: "ascending",
			text: "text",
			text_fields: "textFields",
			text_field_weights: "textFieldWeights",
			require_all_terms: "requireAllTerms",
		});
		return encode(await sdk(() => index.queryMetadata(options)));
	}

	async function createUser(params) {
		const index = indexForOp(params, "key", "user_id", "user_kek");
		const permissions = requireParam(params, "permissions");
		const user = await sdk(() => index.createUser({ permissions }));
		return encode({ user_id: user.userId, api_key: user.apiKey });
	}

	async function listUsers(params) {
		const index = indexForOp(params, "key");
		const users = await sdk(() => index.listUsers());
		return encode(
			users.map((user) => ({
				user_id: user.userId,
				permissions: user.permissions,
			})),
		);
	}

	async function deleteUser(params) {
		const index = indexForOp(params, "key");
		let userId = requireParam(params, "user_id");
		if (userId instanceof Uint8Array) {
			userId = Buffer.from(userId).toString("hex"); // the SDK's hex form
		}
		await sdk(() => index.deleteUser({ userId }));
		return null;
	}

	// index.describe, index.num_vectors, client.embedding_models and
	// client.training_status have no SDK method, and the client.kms_* blob ops
	// are core only; they stay out of OPS so they reply -32601.
	const OPS = {
		"client.new": clientNew,
		"client.list_indexes": listIndexes,
		"client.health": health,
		"client.create_index": createIndex,
		"client.load_index": loadIndex,
		"index.delete_index": deleteIndex,
		"index.upsert": upsert,
		"index.get": get,
		"index.delete": deleteIds,
		"index.list_ids": listIds,
		"index.train": train,
		"index.query": query,
		"index.query_metadata": queryMetadata,
		"index.create_user": createUser,
		"index.list_users": listUsers,
		"index.delete_user": deleteUser,
	};

	function capabilities() {
		const names = [
			"vector",
			"auto_dimension",
			"metadata_schema",
			"pattern",
			"bm25",
			"text_fields_sugar",
			"training",
			"storage_precision",
			"rbac",
			"embedding",
			"health",
			"service_auth",
			// Both forms pass the metadata list straight to the SDK.
			"parallel_metadata",
		];
		if (variant === "json") {
			names.push("ragged_batches"); // JSON items carry each vector on its own
		}
		if (KMS_SLOT_VARIABLES.some((name) => env[name])) {
			names.push("kms_provider");
		}
		return names;
	}

	function kindOf(nativeError) {
		// Prefer the SDK's own kind once it exposes one (SDK.md area 14); until
		// then, the error class and status code. Never the message.
		if (typeof nativeError?.kind === "string" && nativeError.kind) {
			return nativeError.kind;
		}
		if (nativeError instanceof cyborgdb.CyborgDBTransportError) {
			return "transport";
		}
		const statusCode = nativeError?.statusCode ?? null;
		if (
			statusCode === null &&
			nativeError instanceof cyborgdb.CyborgDBValidationError
		) {
			return "invalid_argument";
		}
		return STATUS_KINDS[statusCode] ?? "internal";
	}

	function nativeDescription(nativeError) {
		const name = nativeError?.name ?? typeof nativeError;
		const statusCode = nativeError?.statusCode ?? null;
		return statusCode === null ? name : `${name} ${statusCode}`;
	}

	/** Runs one decoded JSON-RPC request; resolves to `{result}` or `{error}`. */
	async function handle(request) {
		const method = request.method;
		if (method === "hello") {
			return {
				result: {
					protocol: PROTOCOL,
					impl: IMPL,
					version: cyborgdb.VERSION,
					capabilities: capabilities(),
				},
			};
		}
		const op = Object.hasOwn(OPS, method) ? OPS[method] : undefined;
		if (op === undefined) {
			return {
				error: {
					code: CODE_UNSUPPORTED,
					message: `${IMPL} does not implement ${method}`,
				},
			};
		}
		// A decoding failure never reached the SDK, so it is never a product error.
		let params;
		try {
			params = decode(request.params ?? {});
		} catch (error) {
			if (error instanceof Unsupported) {
				return { error: { code: CODE_UNSUPPORTED, message: error.message } };
			}
			return {
				error: {
					code: CODE_INVALID_PARAMS,
					message: `could not decode params: ${error.message}`,
				},
			};
		}
		try {
			return { result: await op(params) };
		} catch (error) {
			if (error instanceof Unsupported) {
				return { error: { code: CODE_UNSUPPORTED, message: error.message } };
			}
			if (error instanceof BadParams) {
				return { error: { code: CODE_INVALID_PARAMS, message: error.message } };
			}
			if (error instanceof SdkError) {
				return {
					error: {
						code: CODE_OP_FAILED,
						message: error.message,
						data: {
							kind: kindOf(error.nativeError),
							native: nativeDescription(error.nativeError),
						},
					},
				};
			}
			return adapterError(error); // the adapter's own bug, never a product error
		}
	}

	return { handle };
}

function adapterError(error) {
	return {
		error: {
			code: CODE_ADAPTER,
			message: `adapter error: ${error?.stack ?? error}`,
		},
	};
}

/** Serves requests from fd 3 until the driver closes it, one at a time. */
async function main() {
	const variant = process.env.CYBORGDB_TESTS_VARIANT || "json";
	try {
		fstatSync(3);
		fstatSync(4);
	} catch {
		console.error(
			"adapter: fd 3/4 not open; run under the cyborgdb-tests driver",
		);
		process.exit(1);
	}
	const cyborgdb = await import("cyborgdb");
	let adapter;
	try {
		adapter = createAdapter(cyborgdb, { variant, env: process.env });
	} catch (error) {
		console.error(`adapter: ${error.message}`);
		process.exit(1);
	}
	const lines = createInterface({
		input: createReadStream(null, { fd: 3 }),
		crlfDelay: Infinity,
	});
	for await (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) continue;
		let response;
		let request;
		try {
			request = JSON.parse(line);
		} catch (error) {
			response = {
				jsonrpc: "2.0",
				id: null,
				error: { code: CODE_PARSE, message: error.message },
			};
		}
		if (response === undefined) {
			response = { jsonrpc: "2.0", id: request?.id ?? null };
			try {
				Object.assign(response, await adapter.handle(request));
			} catch (error) {
				Object.assign(response, adapterError(error)); // report it, keep serving
			}
		}
		writeSync(4, `${JSON.stringify(response)}\n`);
	}
}

if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	await main();
}
