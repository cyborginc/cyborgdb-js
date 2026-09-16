/**
 * Conformance tests for the typed error taxonomy
 *
 * The expected shape is written out below rather than read from the canonical
 * taxonomy file — the SDK repos are public and that file is not, so a test that
 * reached for it would skip in CI and enforce nothing. The Python and Go suites
 * carry the same table; the three are reviewed together when it changes.
 */
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { CyborgDB } from "../client";
import {
	CyborgDBAuthenticationError,
	CyborgDBConflictError,
	CyborgDBError,
	CyborgDBNotFoundError,
	CyborgDBRateLimitError,
	CyborgDBServiceError,
	CyborgDBTransportError,
	CyborgDBValidationError,
} from "../errors";

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
async function serverReturning(status: number): Promise<{ url: string; close: () => Promise<void> }> {
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
	it.each(TAXONOMY)(
		"maps HTTP %i to the class the taxonomy names",
		async (status, expected, retryable) => {
			const err = await errorFromStatus(status);
			expect(err).toBeInstanceOf(expected);
			expect((err as CyborgDBError).retryable).toBe(retryable);
			expect((err as CyborgDBError).statusCode).toBe(status);
		},
	);
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

	it("leaves a status the taxonomy does not name untyped", async () => {
		const err = await errorFromStatus(418);
		expect(err).toBeInstanceOf(Error);
		expect(err).not.toBeInstanceOf(CyborgDBError);
	});

	it("throws CyborgDBTransportError when nothing answers", async () => {
		const { url, close } = await serverReturning(200);
		await close(); // nothing is listening now
		const client = new CyborgDB({ baseUrl: url, apiKey: "test-key" });
		await expect(client.listIndexes()).rejects.toBeInstanceOf(
			CyborgDBTransportError,
		);
	});
});

describe("baseUrl validation", () => {
	it.each([["empty", ""], ["not a url", "not-a-url"], ["wrong scheme", "ftp://example.com"]])(
		"rejects %s synchronously",
		(_name, baseUrl) => {
			expect(() => new CyborgDB({ baseUrl, apiKey: "k" })).toThrow(
				CyborgDBValidationError,
			);
		},
	);

	it("reports statusCode null for a pre-flight failure", () => {
		try {
			new CyborgDB({ baseUrl: "not-a-url", apiKey: "k" });
			throw new Error("expected a throw");
		} catch (err) {
			expect((err as CyborgDBValidationError).statusCode).toBeNull();
		}
	});

	it.each(["http://localhost:8080", "https://api.example.com", "http://127.0.0.1:7000"])(
		"accepts %s",
		(baseUrl) => {
			expect(() => new CyborgDB({ baseUrl, apiKey: "k" })).not.toThrow();
		},
	);
});
