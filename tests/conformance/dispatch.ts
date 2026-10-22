/**
 * Op dispatch for the cyborgdb-tests adapter (see adapter.ts and cyborgdb-tests
 * ADAPTERS.md). Maps each protocol op to one call on the SDK passed to
 * createAdapter: the built package in adapter.ts, a recording fake in
 * adapter_forwarding.test.ts. No defaults are filled in and no results are
 * reshaped beyond what ADAPTERS.md allows.
 *
 * Params are forwarded as the spec sent them, not checked against the SDK's
 * types: invalid inputs must reach the API so the product can reject them. The
 * rename tables are typed against the SDK's option names, so an SDK rename
 * fails to compile here instead of silently dropping a param.
 */

import { closeSync, openSync, readSync } from "node:fs";
import type * as Cyborgdb from "../../src/index";

export const PROTOCOL = 1;
export const IMPL = "cyborgdb-js";
export const CODE_OP_FAILED = -32000;
export const CODE_UNSUPPORTED = -32601;
export const CODE_INVALID_PARAMS = -32602;
export const CODE_ADAPTER = -32603;
export const CODE_PARSE = -32700;

export const VARIANTS = ["json", "binary"];

/** What the adapter needs from the `cyborgdb` module. */
export type Sdk = Pick<
	typeof Cyborgdb,
	"Client" | "VERSION" | "CyborgDBTransportError" | "CyborgDBValidationError"
>;
type Client = InstanceType<typeof Cyborgdb.Client>;
type Index = Cyborgdb.EncryptedIndex;
type Params = Record<string, unknown>;
/** The options object an SDK method takes. */
type Options<F extends (...args: any[]) => unknown> = NonNullable<
	Parameters<F>[0]
>;

export interface RpcError {
	code: number;
	message: string;
	data?: { kind: string; native: string };
}
export type ResponseBody = { result: unknown } | { error: RpcError };

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

/**
 * A JSON integer a JS number can't hold exactly (beyond 2^53), kept as its
 * source text. JSON.parse would round it, so the SDK would get a different
 * value than the spec sent; decode reports it as -32601 instead.
 */
export class UnsafeInteger {
	source: string;

	constructor(source: string) {
		this.source = source;
	}
}

/**
 * JSON.parse with integers beyond 2^53 kept as UnsafeInteger. Uses the
 * reviver's source text (Node >= 21).
 */
export function parseRequest(line: string): unknown {
	return JSON.parse(line, (_key, value, context?: { source?: string }) => {
		const source = context?.source;
		if (
			typeof value === "number" &&
			!Number.isSafeInteger(value) &&
			source !== undefined &&
			/^-?\d+$/.test(source)
		) {
			return new UnsafeInteger(source);
		}
		return value;
	});
}

/** An error thrown by a cyborgdb call. The only failure that gets a kind. */
class SdkError extends Error {
	nativeError: unknown;

	constructor(nativeError: unknown) {
		super(
			nativeError instanceof Error ? nativeError.message : String(nativeError),
		);
		this.nativeError = nativeError;
	}
}

/**
 * Calls into cyborgdb and awaits the result. Anything thrown here is the
 * product's answer; everything else is the adapter's.
 */
async function sdk<T>(call: () => T | Promise<T>): Promise<T> {
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
	values: Float32Array;
	shape: number[];

	constructor(values: Float32Array, shape: number[]) {
		this.values = values;
		this.shape = shape;
	}

	/** The values as plain nested arrays, as the JSON path takes them. */
	rows(): number[] | number[][] {
		if (this.shape.length !== 2) return Array.from(this.values);
		const [rowCount, rowLength] = this.shape;
		const rows: number[][] = [];
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
export function decode(wireValue: unknown): unknown {
	if (wireValue instanceof UnsafeInteger) {
		throw new Unsupported(`a JS number can't hold ${wireValue.source} exactly`);
	}
	if (Array.isArray(wireValue)) return wireValue.map(decode);
	if (isPlainObject(wireValue)) {
		const keys = Object.keys(wireValue);
		if (keys.length === 1 && TYPED_TAGS.has(keys[0])) {
			return decodeTyped(keys[0], wireValue[keys[0]]);
		}
		const native: Params = {};
		for (const [key, value] of Object.entries(wireValue)) {
			native[key] = decode(value);
		}
		return native;
	}
	return wireValue;
}

// Payload shapes come from the protocol schema; a malformed one throws while
// decoding and is reported as -32602.
function decodeTyped(tag: string, payload: any): unknown {
	switch (tag) {
		case "$literal":
			return payload;
		case "$bytes":
			return decodeBase64(payload);
		case "$f32":
			// Plain arrays, never Float32Array: a Float32Array sends the SDK down
			// the binary path, so the ops pick the array type per variant.
			if (payload.length > 0 && Array.isArray(payload[0])) {
				return payload.map((row: unknown[]) => row.map(decodeNumber));
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
			const ids: string[] = [];
			for (let i = start; i < stop; i++) ids.push(String(i));
			return ids;
		}
		case "$tensor":
			return readTensor(payload);
	}
	throw new BadParams(`unknown typed value ${tag}`);
}

function decodeNumber(number: unknown): unknown {
	if (isPlainObject(number) && "$float" in number) {
		return decodeFloat(number.$float);
	}
	return number;
}

const FLOATS: Record<string, number> = {
	nan: Number.NaN,
	inf: Number.POSITIVE_INFINITY,
	"-inf": Number.NEGATIVE_INFINITY,
};

function decodeFloat(name: unknown): number {
	if (typeof name !== "string" || !(name in FLOATS)) {
		throw new BadParams(`bad $float ${name}`);
	}
	return FLOATS[name];
}

const BASE64 =
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodeBase64(text: unknown): Uint8Array {
	// Buffer.from skips characters it doesn't know, so check strictly first.
	if (typeof text !== "string" || !BASE64.test(text)) {
		throw new BadParams("bad $bytes base64");
	}
	return new Uint8Array(Buffer.from(text, "base64"));
}

const TENSOR_DTYPES: Record<
	string,
	{ size: number; read: (buf: Buffer, at: number) => number }
> = {
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
function readTensor({
	path,
	dtype,
	offset,
	shape,
}: {
	path: string;
	dtype: string;
	offset: number | string;
	shape: (number | string)[];
}): Tensor {
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

function halfToFloat(bits: number): number {
	const sign = bits & 0x8000 ? -1 : 1;
	const exponent = (bits >> 10) & 0x1f;
	const fraction = bits & 0x3ff;
	if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
	if (exponent === 0x1f) {
		return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
	}
	return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

/** Converts a native result to a wire value. */
export function encode(nativeValue: unknown): unknown {
	if (nativeValue instanceof Uint8Array) {
		return { $bytes: Buffer.from(nativeValue).toString("base64") };
	}
	if (nativeValue instanceof Float32Array) return encodeF32(nativeValue);
	if (Array.isArray(nativeValue)) return nativeValue.map(encode);
	if (typeof nativeValue === "number") return encodeFloat(nativeValue);
	if (typeof nativeValue === "bigint") return { $i64: String(nativeValue) };
	if (isPlainObject(nativeValue)) {
		const wire: Params = {};
		for (const [key, value] of Object.entries(nativeValue)) {
			if (value !== undefined) wire[key] = encode(value);
		}
		return wire;
	}
	return nativeValue === undefined ? null : nativeValue;
}

function encodeFloat(number: number): unknown {
	if (Number.isNaN(number)) return { $float: "nan" };
	if (number === Number.POSITIVE_INFINITY) return { $float: "inf" };
	if (number === Number.NEGATIVE_INFINITY) return { $float: "-inf" };
	return number;
}

function encodeF32(vector: ArrayLike<number>): unknown {
	return { $f32: Array.from(vector, encodeFloat) };
}

function isPlainObject(value: unknown): value is Params {
	if (value === null || typeof value !== "object") return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

// ---------- params ----------

function requireParam(params: Params, name: string): unknown {
	if (!(name in params)) throw new BadParams(`missing ${name}`);
	return params[name];
}

/**
 * Selects the params a spec set, leaving omitted ones out and renaming them
 * to the SDK's camelCase. A param sent as null is forwarded as null.
 */
function pickParams<T>(
	params: Params,
	renames: Record<string, keyof T & string>,
): Partial<T> {
	const picked: Partial<T> = {};
	for (const [specName, sdkName] of Object.entries(renames)) {
		if (specName in params)
			picked[sdkName] = params[specName] as T[keyof T & string];
	}
	return picked;
}

/** Rejects params the SDK has no way to express. */
function rejectParams(params: Params, ...names: string[]): void {
	const present = names.filter((name) => name in params);
	if (present.length > 0) {
		throw new Unsupported(`the SDK can't express ${present.join(", ")}`);
	}
}

/**
 * Renames `full_text` to the SDK's `fullText` inside each field policy. Field
 * names (including `$default`) and any other policy keys are left as sent.
 */
function sdkMetadataSchema(schema: unknown): unknown {
	if (!isPlainObject(schema)) return schema;
	const renamed: Params = {};
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
function jsonVectors(vectors: unknown): unknown {
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
function binaryVectors(vectors: unknown): {
	flat: Float32Array;
	dimension?: number;
} {
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
	const numbers: unknown[] = rows ? vectors.flat() : vectors;
	if (!numbers.every((number) => typeof number === "number")) {
		throw new Unsupported("the binary path can only carry numbers");
	}
	let dimension: number | undefined;
	if (rows) dimension = vectors[0].length;
	else if (vectors.length > 0) dimension = vectors.length;
	return { flat: Float32Array.from(numbers as number[]), dimension };
}

/** Counts the query rows a request asked for. */
function queryRowCount(vectors: unknown, contents: unknown): number {
	if (vectors !== undefined) {
		if (vectors instanceof Tensor) {
			return vectors.shape.length === 2 ? vectors.shape[0] : 1;
		}
		if (
			Array.isArray(vectors) &&
			vectors.length > 0 &&
			Array.isArray(vectors[0])
		) {
			return vectors.length;
		}
		return 1;
	}
	if (Array.isArray(contents)) return contents.length;
	return 1;
}

/** Restores the per-row nesting the SDK drops for a single query. */
function oneListPerRow(results: unknown[], rowCount: number): unknown[] {
	if (rowCount === 1 && (results.length === 0 || !Array.isArray(results[0]))) {
		return [results];
	}
	return results;
}

// ---------- result encoding ----------

/** Renames an SDK result's camelCase keys to the contract's snake_case. */
function snakeKeys(fields: object): Params {
	const renamed: Params = {};
	for (const [key, value] of Object.entries(fields)) {
		renamed[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] =
			value;
	}
	return renamed;
}

/** Encodes one `get` row: vector as `$f32`, contents as `$bytes`. */
function encodeItem(item: object): unknown {
	const row: Params = {};
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
const STATUS_KINDS: Record<number, string> = {
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
 * Builds the adapter around an SDK module.
 *
 * @param cyborgdb `Client`, `VERSION` and the error classes it maps.
 * @param variant "json" or "binary".
 * @param env Environment variables, for the KMS slots.
 * @returns `{handle}`: runs one decoded JSON-RPC request, resolving to the
 *   response body (`{result}` or `{error}`).
 */
export function createAdapter(
	cyborgdb: Sdk,
	{
		variant = "json",
		env = {},
	}: { variant?: string; env?: Record<string, string | undefined> } = {},
): {
	handle: (request: {
		method?: unknown;
		params?: unknown;
	}) => Promise<ResponseBody>;
} {
	if (!VARIANTS.includes(variant)) {
		throw new Error(
			`CYBORGDB_TESTS_VARIANT=${variant}, want one of ${VARIANTS.join(", ")}`,
		);
	}
	const clients = new Map<unknown, Client>();
	const indexes = new Map<unknown, Index>();

	function lookup<T>(
		handles: Map<unknown, T>,
		params: Params,
		name: string,
	): T {
		const handleName = requireParam(params, name);
		const handle = handles.get(handleName);
		if (handle === undefined) {
			throw new BadParams(
				`unknown ${name} handle ${JSON.stringify(handleName)}`,
			);
		}
		return handle;
	}

	/**
	 * The op's index. The SDK binds the key at create/load, so a per-call `key`
	 * or `user_id` override can't be passed.
	 */
	function indexForOp(params: Params, ...overrides: string[]): Index {
		rejectParams(params, ...overrides);
		return lookup(indexes, params, "index");
	}

	// ---------- ops: client ----------

	async function clientNew(params: Params): Promise<null> {
		const handleName = requireParam(params, "as");
		rejectParams(params, "storage", "cpu_threads", "gpu");
		type ClientOptions = ConstructorParameters<typeof cyborgdb.Client>[0];
		const options = {
			baseUrl: requireParam(params, "base_url"),
			...pickParams<ClientOptions>(params, { api_key: "apiKey" }),
		} as ClientOptions;
		clients.set(handleName, await sdk(() => new cyborgdb.Client(options)));
		return null;
	}

	async function listIndexes(params: Params): Promise<unknown> {
		const client = lookup(clients, params, "client");
		return encode(await sdk(() => client.listIndexes()));
	}

	async function health(params: Params): Promise<unknown> {
		const client = lookup(clients, params, "client");
		return encode(await sdk(() => client.getHealth()));
	}

	async function createIndex(params: Params): Promise<null> {
		const client = lookup(clients, params, "client");
		const handleName = requireParam(params, "as");
		type CreateOptions = Options<Client["createIndex"]>;
		const options = {
			indexName: requireParam(params, "name"),
			...pickParams<CreateOptions>(params, {
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
		} as CreateOptions;
		if ("metadataSchema" in options) {
			options.metadataSchema = sdkMetadataSchema(
				options.metadataSchema,
			) as CreateOptions["metadataSchema"];
		}
		indexes.set(handleName, await sdk(() => client.createIndex(options)));
		return null;
	}

	async function loadIndex(params: Params): Promise<null> {
		const client = lookup(clients, params, "client");
		const handleName = requireParam(params, "as");
		rejectParams(params, "user_id");
		type LoadOptions = Options<Client["loadIndex"]>;
		const options = {
			indexName: requireParam(params, "name"),
			...pickParams<LoadOptions>(params, { key: "indexKey" }),
		} as LoadOptions;
		indexes.set(handleName, await sdk(() => client.loadIndex(options)));
		return null;
	}

	// ---------- ops: index ----------

	async function deleteIndex(params: Params): Promise<null> {
		const index = indexForOp(params, "key");
		await sdk(() => index.deleteIndex());
		return null;
	}

	type UpsertOptions = Options<Index["upsert"]>;

	async function upsert(params: Params): Promise<null> {
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
	function jsonUpsertOptions(params: Params): UpsertOptions {
		if ("items" in params) {
			return pickParams<UpsertOptions>(params, { items: "items" });
		}
		const options = pickParams<UpsertOptions>(params, {
			ids: "ids",
			vectors: "vectors",
			metadata: "metadata",
		});
		if ("vectors" in options) {
			options.vectors = jsonVectors(
				options.vectors,
			) as UpsertOptions["vectors"];
		}
		return options;
	}

	/**
	 * `upsert` options for the binary path: ids and a flat Float32Array, which
	 * is what routes the SDK to /upsert-binary. Items become columns.
	 */
	function binaryUpsertOptions(params: Params): UpsertOptions {
		if ("ids" in params) {
			if (!("vectors" in params)) {
				throw new Unsupported("the binary upsert needs vectors");
			}
			return {
				...pickParams<UpsertOptions>(params, {
					ids: "ids",
					metadata: "metadata",
				}),
				vectors: binaryVectors(params.vectors).flat,
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
		const columns: Params = {
			ids: items.map((item) => item.id),
			vectors: binaryVectors(items.map((item) => item.vector)).flat,
		};
		for (const field of ["metadata", "contents"]) {
			if (items.some((item) => field in item)) {
				columns[field] = items.map((item) =>
					field in item ? item[field] : null,
				);
			}
		}
		// The binary upsert takes contents as (string | null)[]; bytes are only
		// expressible on the JSON path.
		const contents = columns.contents as unknown[] | undefined;
		if (contents?.some((value) => value instanceof Uint8Array)) {
			throw new Unsupported(
				"the binary upsert takes contents as strings, not bytes",
			);
		}
		return columns as UpsertOptions;
	}

	async function get(params: Params): Promise<unknown> {
		const index = indexForOp(params, "key", "user_id");
		type GetOptions = Options<Index["get"]>;
		const options = {
			ids: requireParam(params, "ids"),
			...pickParams<GetOptions>(params, { include: "include" }),
		} as GetOptions;
		const rows = await sdk(() => index.get(options));
		return rows.map(encodeItem);
	}

	async function deleteIds(params: Params): Promise<null> {
		const index = indexForOp(params, "key", "user_id");
		const ids = requireParam(params, "ids") as string[];
		await sdk(() => index.delete({ ids }));
		return null;
	}

	async function listIds(params: Params): Promise<unknown> {
		const index = indexForOp(params, "key", "user_id");
		const response = await sdk(() => index.listIds());
		return encode(response.ids); // unwrap the documented {ids, count} envelope
	}

	async function train(params: Params): Promise<null> {
		const index = indexForOp(params, "key", "user_id");
		const options = pickParams<Options<Index["train"]>>(params, {
			n_lists: "nLists",
			batch_size: "batchSize",
			max_iters: "maxIters",
			tolerance: "tolerance",
			max_memory: "maxMemory",
		});
		await sdk(() => index.train(options));
		return null;
	}

	type QueryOptions = Options<Index["query"]>;

	async function query(params: Params): Promise<unknown> {
		const index = indexForOp(params, "key", "user_id");
		const options = pickParams<QueryOptions>(params, {
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
		});
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
				options.queryVectors = jsonVectors(
					params.vectors,
				) as QueryOptions["queryVectors"];
			}
			if ("contents" in params) {
				if (Array.isArray(params.contents)) {
					throw new Unsupported("queryContents takes one string, not a list");
				}
				options.queryContents = params.contents as string;
			}
		}
		const response = await sdk(() => index.query(options));
		const rowCount = queryRowCount(params.vectors, params.contents);
		return encode(oneListPerRow(response.results, rowCount));
	}

	async function queryMetadata(params: Params): Promise<unknown> {
		const index = indexForOp(params, "key", "user_id");
		const options = pickParams<Options<Index["queryMetadata"]>>(params, {
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

	async function createUser(params: Params): Promise<unknown> {
		const index = indexForOp(params, "key", "user_id", "user_kek");
		const permissions = requireParam(params, "permissions") as string[];
		const user = await sdk(() => index.createUser({ permissions }));
		return encode({ user_id: user.userId, api_key: user.apiKey });
	}

	async function listUsers(params: Params): Promise<unknown> {
		const index = indexForOp(params, "key");
		const users = await sdk(() => index.listUsers());
		return encode(
			users.map((user) => ({
				user_id: user.userId,
				permissions: user.permissions,
			})),
		);
	}

	async function deleteUser(params: Params): Promise<null> {
		const index = indexForOp(params, "key");
		let userId = requireParam(params, "user_id");
		if (userId instanceof Uint8Array) {
			userId = Buffer.from(userId).toString("hex"); // the SDK's hex form
		}
		await sdk(() => index.deleteUser({ userId: userId as string }));
		return null;
	}

	async function describe(params: Params): Promise<unknown> {
		const index = indexForOp(params);
		const description = await sdk(() => index.describe());
		const { indexName, metadataSchema, bm25, ...rest } = description;
		// Field names in the schema are user data: only the policy keys rename.
		const schema: Params = {};
		for (const [field, policy] of Object.entries(metadataSchema ?? {})) {
			schema[field] = snakeKeys(policy);
		}
		return encode({
			name: indexName, // the contract calls it `name`
			...snakeKeys(rest),
			metadata_schema: metadataSchema === undefined ? undefined : schema,
			bm25: bm25 == null ? bm25 : snakeKeys(bm25),
		});
	}

	async function numVectors(params: Params): Promise<unknown> {
		const index = indexForOp(params, "key", "user_id");
		return encode(await sdk(() => index.getNumVectors()));
	}

	async function trainingStatus(params: Params): Promise<unknown> {
		const client = lookup(clients, params, "client");
		return encode(snakeKeys(await sdk(() => client.getTrainingStatus())));
	}

	async function embeddingModels(params: Params): Promise<unknown> {
		const client = lookup(clients, params, "client");
		const models = await sdk(() => client.listEmbeddingModels());
		return encode(models.map((model) => snakeKeys(model)));
	}

	// The client.kms_* blob ops are core only; they stay out of OPS so they
	// reply -32601.
	const OPS: Record<string, (params: Params) => Promise<unknown>> = {
		"client.new": clientNew,
		"client.list_indexes": listIndexes,
		"client.health": health,
		"client.embedding_models": embeddingModels,
		"client.training_status": trainingStatus,
		"client.create_index": createIndex,
		"client.load_index": loadIndex,
		"index.describe": describe,
		"index.num_vectors": numVectors,
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

	function capabilities(): string[] {
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
			"training_status",
			"service_auth",
			// The data lives in the service, so it outlives an adapter restart.
			"durable_storage",
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

	function kindOf(nativeError: unknown): string {
		const fields = (nativeError ?? {}) as {
			kind?: unknown;
			statusCode?: unknown;
		};
		// Prefer the SDK's own kind once it exposes one (SDK.md area 14); until
		// then, the error class and status code. Never the message.
		if (typeof fields.kind === "string" && fields.kind) return fields.kind;
		if (nativeError instanceof cyborgdb.CyborgDBTransportError) {
			return "transport";
		}
		const statusCode = fields.statusCode ?? null;
		if (
			statusCode === null &&
			nativeError instanceof cyborgdb.CyborgDBValidationError
		) {
			return "invalid_argument";
		}
		return STATUS_KINDS[statusCode as number] ?? "internal";
	}

	function nativeDescription(nativeError: unknown): string {
		const fields = (nativeError ?? {}) as {
			name?: unknown;
			statusCode?: unknown;
		};
		const name =
			typeof fields.name === "string" ? fields.name : typeof nativeError;
		const statusCode = fields.statusCode ?? null;
		return statusCode === null ? name : `${name} ${statusCode}`;
	}

	/** Runs one decoded JSON-RPC request; resolves to `{result}` or `{error}`. */
	async function handle(request: {
		method?: unknown;
		params?: unknown;
	}): Promise<ResponseBody> {
		const method = String(request.method);
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
		let params: Params;
		try {
			params = decode(request.params ?? {}) as Params;
		} catch (error) {
			if (error instanceof Unsupported) {
				return { error: { code: CODE_UNSUPPORTED, message: error.message } };
			}
			return {
				error: {
					code: CODE_INVALID_PARAMS,
					message: `could not decode params: ${(error as Error).message}`,
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

/** The response for a bug in the adapter itself: -32603, never a kind. */
export function adapterError(error: unknown): ResponseBody {
	const detail =
		error instanceof Error ? (error.stack ?? error.message) : error;
	return { error: { code: CODE_ADAPTER, message: `adapter error: ${detail}` } };
}
