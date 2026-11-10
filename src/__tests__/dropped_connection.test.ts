/**
 * Replay-once on dropped connections. Real `node:http` servers drop sockets
 * rather than mocking fetch, so the tests exercise the codes undici raises.
 */
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { CyborgDB } from "../client";
import {
	CyborgDBServiceError,
	CyborgDBTransportError,
	isDroppedConnectionError,
} from "../errors";

interface TestServer {
	url: string;
	attempts: () => number;
	close: () => Promise<void>;
}

/** A server whose handler is invoked once per request attempt. */
async function serve(
	handler: (attempt: number, req: IncomingMessage, res: ServerResponse) => void,
): Promise<TestServer> {
	let attempts = 0;
	const server: Server = createServer((req, res) => {
		attempts++;
		handler(attempts, req, res);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		attempts: () => attempts,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

const ok = (res: ServerResponse) => {
	res.writeHead(200, { "Content-Type": "application/json" });
	res.end(JSON.stringify({ indexes: [] }));
};

describe("replay on dropped connection", () => {
	it("replays once and succeeds when the service drops the connection", async () => {
		const srv = await serve((attempt, req, res) => {
			if (attempt === 1) {
				req.socket.destroy();
				return;
			}
			ok(res);
		});
		try {
			const client = new CyborgDB({ baseUrl: srv.url, apiKey: "test-key" });
			await expect(client.listIndexes()).resolves.toEqual([]);
			expect(srv.attempts()).toBe(2);
		} finally {
			await srv.close();
		}
	});

	it("replays at most once when the service keeps dropping", async () => {
		const srv = await serve((_attempt, req) => {
			req.socket.destroy();
		});
		try {
			const client = new CyborgDB({ baseUrl: srv.url, apiKey: "test-key" });
			await expect(client.listIndexes()).rejects.toBeInstanceOf(
				CyborgDBTransportError,
			);
			expect(srv.attempts()).toBe(2);
		} finally {
			await srv.close();
		}
	});

	it("does not replay when the service answers with an error status", async () => {
		const srv = await serve((_attempt, _req, res) => {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ detail: "synthetic failure" }));
		});
		try {
			const client = new CyborgDB({ baseUrl: srv.url, apiKey: "test-key" });
			await expect(client.listIndexes()).rejects.toBeInstanceOf(
				CyborgDBServiceError,
			);
			expect(srv.attempts()).toBe(1);
		} finally {
			await srv.close();
		}
	});

	it("does not replay when nothing is listening", async () => {
		const srv = await serve(() => {});
		await srv.close();
		const client = new CyborgDB({ baseUrl: srv.url, apiKey: "test-key" });
		await expect(client.listIndexes()).rejects.toBeInstanceOf(
			CyborgDBTransportError,
		);
	});

	it("does not replay a non-idempotent operation", async () => {
		const srv = await serve((_attempt, req) => {
			req.socket.destroy();
		});
		try {
			const client = new CyborgDB({ baseUrl: srv.url, apiKey: "test-key" });
			await expect(
				client.createIndex({
					indexName: "idx",
					indexKey: new Uint8Array(32),
					dimension: 4,
				}),
			).rejects.toBeInstanceOf(CyborgDBTransportError);
			expect(srv.attempts()).toBe(1);
		} finally {
			await srv.close();
		}
	});

	it("replays a binary upsert whose connection dropped", async () => {
		const describeBody = JSON.stringify({
			index_name: "idx",
			is_trained: false,
			index_type: "ivfflat",
			training_state: "untrained",
			storage_precision: "float32",
			dimension: 4,
			metric: "euclidean",
			n_lists: 1,
		});
		let upsertAttempts = 0;
		const srv = await serve((_attempt, req, res) => {
			if (req.url?.endsWith("/v1/indexes/describe")) {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(describeBody);
				return;
			}
			upsertAttempts++;
			if (upsertAttempts === 1) {
				req.socket.destroy();
				return;
			}
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ status: "success", message: "ok" }));
		});
		try {
			const client = new CyborgDB({ baseUrl: srv.url, apiKey: "test-key" });
			const index = await client.loadIndex({
				indexName: "idx",
				indexKey: new Uint8Array(32),
			});
			await expect(
				index.upsert({ ids: ["a", "b"], vectors: new Float32Array(8) }),
			).resolves.toMatchObject({ status: "success" });
			expect(upsertAttempts).toBe(2);
		} finally {
			await srv.close();
		}
	});
});

describe("isDroppedConnectionError", () => {
	it.each(["EPIPE", "ECONNRESET", "UND_ERR_SOCKET"])(
		"matches %s at any depth of the cause chain",
		(code) => {
			expect(isDroppedConnectionError({ code })).toBe(true);
			expect(
				isDroppedConnectionError(
					new TypeError("fetch failed", { cause: { code } }),
				),
			).toBe(true);
			expect(
				isDroppedConnectionError(
					new TypeError("fetch failed", {
						cause: new Error("other side closed", { cause: { code } }),
					}),
				),
			).toBe(true);
		},
	);

	it.each(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN"])(
		"does not match %s",
		(code) => {
			expect(
				isDroppedConnectionError(
					new TypeError("fetch failed", { cause: { code } }),
				),
			).toBe(false);
		},
	);

	it("does not match errors without a code", () => {
		expect(isDroppedConnectionError(new Error("boom"))).toBe(false);
		expect(isDroppedConnectionError(undefined)).toBe(false);
		expect(isDroppedConnectionError("EPIPE")).toBe(false);
	});

	it("terminates on a cyclic cause chain", () => {
		const cyclic: { code: string; cause?: unknown } = { code: "EOTHER" };
		cyclic.cause = cyclic;
		expect(isDroppedConnectionError(cyclic)).toBe(false);
	});
});
