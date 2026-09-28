/**
 * Conformance tests for the typed error taxonomy
 *
 * The expected shape is written out below rather than read from the canonical
 * taxonomy file — the SDK repos are public and that file is not, so a test that
 * reached for it would skip in CI and enforce nothing. The Python and Go suites
 * carry the same table; the three are reviewed together when it changes.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CyborgDB } from "../client";
import type { EncryptedIndex } from "../encryptedIndex";
import {
	CyborgDBAuthenticationError,
	CyborgDBConflictError,
	CyborgDBError,
	CyborgDBNotFoundError,
	CyborgDBRateLimitError,
	CyborgDBServiceError,
	CyborgDBTransportError,
	CyborgDBValidationError,
	handleApiError,
} from "../errors";
import { FetchError } from "../runtime";

/** status -> [class, retryable]. */
const TAXONOMY: Array<[number, typeof CyborgDBError, boolean]> = [
	[400, CyborgDBValidationError, false],
	[422, CyborgDBValidationError, false],
	[401, CyborgDBAuthenticationError, false],
	[403, CyborgDBAuthenticationError, false],
	[404, CyborgDBNotFoundError, false],
	[409, CyborgDBConflictError, false],
	[429, CyborgDBRateLimitError, true],
	[500, CyborgDBServiceError, true],
	[502, CyborgDBServiceError, true],
	[503, CyborgDBServiceError, true],
	[504, CyborgDBServiceError, true],
];

/** A server that answers every request with one status and a FastAPI body. */
async function serverReturning(
	status: number,
): Promise<{ url: string; close: () => Promise<void> }> {
	const server: Server = createServer((_req, res) => {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"X-Request-Id": "req-abc123",
		};
		if (status === 429) headers["Retry-After"] = "2.5";
		res.writeHead(status, headers);
		res.end(JSON.stringify({ detail: "synthetic failure" }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

async function errorFromStatus(status: number): Promise<unknown> {
	const { url, close } = await serverReturning(status);
	try {
		const client = new CyborgDB({ baseUrl: url, apiKey: "test-key" });
		await client.listIndexes();
		throw new Error(`HTTP ${status}: expected a rejection, got success`);
	} catch (err) {
		return err;
	} finally {
		await close();
	}
}

describe("status mapping", () => {
	it.each(
		TAXONOMY,
	)("maps HTTP %i to the class the taxonomy names", async (status, expected, retryable) => {
		const err = await errorFromStatus(status);
		expect(err).toBeInstanceOf(expected);
		expect((err as CyborgDBError).retryable).toBe(retryable);
		expect((err as CyborgDBError).statusCode).toBe(status);
	});
});

describe("typed errors", () => {
	it("populates statusCode, requestId and detail", async () => {
		const err = await errorFromStatus(503);
		expect(err).toBeInstanceOf(CyborgDBServiceError);
		const typed = err as CyborgDBServiceError;
		expect(typed.statusCode).toBe(503);
		expect(typed.requestId).toBe("req-abc123");
		expect(typed.detail).toBe("synthetic failure");
		expect(typed.retryable).toBe(true);
		expect(typed).toBeInstanceOf(CyborgDBError);
	});

	it("parses Retry-After on a 429", async () => {
		const err = await errorFromStatus(429);
		expect(err).toBeInstanceOf(CyborgDBRateLimitError);
		expect((err as CyborgDBRateLimitError).retryAfter).toBe(2.5);
	});

	it("preserves the cause chain", async () => {
		const err = await errorFromStatus(500);
		expect((err as CyborgDBError).cause).toBeDefined();
	});

	it.each([
		405, 413, 418,
	])("throws the base CyborgDBError for unmapped HTTP %i", async (status) => {
		const err = await errorFromStatus(status);
		expect(err).toBeInstanceOf(CyborgDBError);
		expect(err?.constructor).toBe(CyborgDBError);
		const typed = err as CyborgDBError;
		expect(typed.statusCode).toBe(status);
		expect(typed.detail).toBe("synthetic failure");
		expect(typed.requestId).toBe("req-abc123");
		expect(typed.retryable).toBe(false);
	});

	it("throws CyborgDBTransportError when nothing answers", async () => {
		const { url, close } = await serverReturning(200);
		await close(); // nothing is listening now
		const client = new CyborgDB({ baseUrl: url, apiKey: "test-key" });
		await expect(client.listIndexes()).rejects.toBeInstanceOf(
			CyborgDBTransportError,
		);
	});

	// Built in this realm on purpose. A real rejection from Jest's global
	// fetch comes from another realm, skips the runtime's FetchError wrapping,
	// and so passes the test above even when unwrapping is broken.
	it("unwraps the runtime's FetchError into CyborgDBTransportError", () => {
		const socketError = Object.assign(
			new Error("connect ECONNREFUSED 127.0.0.1:1"),
			{ code: "ECONNREFUSED" },
		);
		const fetchError = new FetchError(
			new TypeError("fetch failed", { cause: socketError }),
			"The request failed and the interceptors did not return an alternative response",
		);
		let err: unknown;
		try {
			handleApiError(fetchError);
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(CyborgDBTransportError);
		const typed = err as CyborgDBTransportError;
		expect(typed.message).toBe(
			"Network request failed: connect ECONNREFUSED 127.0.0.1:1",
		);
		expect(typed.statusCode).toBeNull();
		expect(typed.retryable).toBe(true);
		expect(typed.cause).toBe(fetchError);
	});
});

// describeIndex classifies the error first; loadIndex must not re-wrap it.
describe("loadIndex", () => {
	async function loadIndexError(status: number): Promise<unknown> {
		const { url, close } = await serverReturning(status);
		try {
			const client = new CyborgDB({ baseUrl: url, apiKey: "test-key" });
			await client.loadIndex({
				indexName: "missing",
				indexKey: new Uint8Array(32),
			});
			throw new Error(`HTTP ${status}: expected a rejection, got success`);
		} catch (err) {
			return err;
		} finally {
			await close();
		}
	}

	it.each(TAXONOMY)("keeps HTTP %i typed", async (status, expected) => {
		const err = await loadIndexError(status);
		expect(err).toBeInstanceOf(expected);
		const typed = err as CyborgDBError;
		expect(typed.statusCode).toBe(status);
		expect(typed.detail).toBe("synthetic failure");
		expect(typed.indexName).toBe("missing");
	});

	it("keeps a transport failure typed", async () => {
		const { url, close } = await serverReturning(200);
		await close();
		const client = new CyborgDB({ baseUrl: url, apiKey: "test-key" });
		await expect(
			client.loadIndex({ indexName: "missing", indexKey: new Uint8Array(32) }),
		).rejects.toBeInstanceOf(CyborgDBTransportError);
	});
});

describe("handleApiError", () => {
	it("rethrows an already-typed error unchanged", () => {
		const original = new CyborgDBNotFoundError("404 - gone", {
			statusCode: 404,
		});
		expect(() => handleApiError(original)).toThrow(original);
	});
});

// Checks that run before any request: typed as CyborgDBValidationError with
// the original message (not re-wrapped as "HTTP error Unknown: ..."), and
// nothing but the loadIndex describe reaches the server.
describe("pre-flight argument checks", () => {
	let url: string;
	let close: () => Promise<void>;
	const paths: string[] = [];

	beforeAll(async () => {
		const server: Server = createServer((req, res) => {
			paths.push(req.url ?? "");
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ index_name: "idx", dimension: 2 }));
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		close = () => new Promise<void>((resolve) => server.close(() => resolve()));
	});

	afterAll(async () => {
		await close();
	});

	const load = () =>
		new CyborgDB({ baseUrl: url, apiKey: "k" }).loadIndex({
			indexName: "idx",
			indexKey: new Uint8Array(32),
		});

	const cases: Array<[string, (index: EncryptedIndex) => Promise<unknown>]> = [
		[
			"upsert with mismatched ids and vectors",
			(i) => i.upsert({ ids: ["a", "b"], vectors: [[0.1, 0.2]] }),
		],
		[
			"upsert item without vector or contents",
			(i) => i.upsert({ items: [{ id: "a" }] }),
		],
		[
			"upsert contents of an unsupported type",
			(i) =>
				i.upsert({
					items: [{ id: "a", vector: [0.1, 0.2], contents: 42 as never }],
				}),
		],
		[
			"upsert Float32Array without ids",
			(i) => i.upsert({ vectors: new Float32Array(2) } as never),
		],
		["query with nothing to search", (i) => i.query({})],
		[
			"query Float32Array without dimension",
			(i) => i.query({ queryVectors: new Float32Array(2) }),
		],
		[
			"queryMetadata orderBy with two keys",
			(i) => i.queryMetadata({ orderBy: { a: 1, b: -1 } }),
		],
	];

	it.each(cases)("%s", async (_label, call) => {
		const index = await load();
		paths.length = 0;
		const err = await call(index).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(CyborgDBValidationError);
		const typed = err as CyborgDBValidationError;
		expect(typed.statusCode).toBeNull();
		expect(typed.message).not.toMatch(/^HTTP error/);
		expect(paths).toEqual([]);
	});

	it.each([
		[
			"createIndex without indexKey or kmsName",
			(c: CyborgDB) => c.createIndex({ indexName: "idx" }),
		],
		[
			"loadIndex with a short key",
			(c: CyborgDB) =>
				c.loadIndex({ indexName: "idx", indexKey: new Uint8Array(3) }),
		],
	])("%s", async (_label, call) => {
		paths.length = 0;
		const err = await call(new CyborgDB({ baseUrl: url, apiKey: "k" })).catch(
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(CyborgDBValidationError);
		expect(paths).toEqual([]);
	});
});

describe("baseUrl validation", () => {
	it.each([
		["empty", ""],
		["not a url", "not-a-url"],
		["wrong scheme", "ftp://example.com"],
	])("rejects %s synchronously", (_name, baseUrl) => {
		expect(() => new CyborgDB({ baseUrl, apiKey: "k" })).toThrow(
			CyborgDBValidationError,
		);
	});

	it("reports statusCode null for a pre-flight failure", () => {
		try {
			new CyborgDB({ baseUrl: "not-a-url", apiKey: "k" });
			throw new Error("expected a throw");
		} catch (err) {
			expect((err as CyborgDBValidationError).statusCode).toBeNull();
		}
	});

	it.each([
		"http://localhost:8080",
		"https://api.example.com",
		"http://127.0.0.1:7000",
	])("accepts %s", (baseUrl) => {
		expect(() => new CyborgDB({ baseUrl, apiKey: "k" })).not.toThrow();
	});
});
