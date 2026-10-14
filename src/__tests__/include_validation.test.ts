/**
 * `include` is checked against the service's allowlist before the request
 * is sent: `distance` / `metadata` on `query()`, `vector` / `contents` /
 * `metadata` on `get()`. Runs against a local stand-in, so no service is
 * needed; the stand-in records which data-path requests reached it.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CyborgDBValidationError } from "../errors";
import { Client } from "../index";

let server: Server;
let baseUrl: string;
let sent: { url?: string; body: Record<string, unknown> }[] = [];

beforeAll(async () => {
	server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => {
			res.writeHead(200, { "Content-Type": "application/json" });
			if (req.url === "/v1/indexes/describe") {
				res.end(JSON.stringify({ index_name: "idx", dimension: 2 }));
				return;
			}
			sent.push({
				url: req.url,
				body: JSON.parse(Buffer.concat(chunks).toString() || "{}"),
			});
			res.end(
				JSON.stringify(
					req.url === "/v1/vectors/get"
						? { results: [{ id: "a" }] }
						: { results: [{ id: "a", distance: 0.1 }] },
				),
			);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
	sent = [];
});

const load = () =>
	new Client({ baseUrl, apiKey: "k" }).loadIndex({
		indexName: "idx",
		indexKey: new Uint8Array(32),
	});

const queryShapes = {
	single: { queryVectors: [0.1, 0.2] },
	batch: { queryVectors: [[0.1, 0.2]] },
	binary: { queryVectors: new Float32Array([0.1, 0.2]), dimension: 2 },
};

describe.each(Object.entries(queryShapes))("query (%s)", (_, shape) => {
	test.each([
		["contents"],
		["vector"],
		["score"],
		["distance", "contents"],
	])("rejects %p before sending", async (...include) => {
		const index = await load();
		const call = index.query({ ...shape, topK: 1, include });
		await expect(call).rejects.toThrow(CyborgDBValidationError);
		await expect(index.query({ ...shape, topK: 1, include })).rejects.toThrow(
			/Valid values: 'distance', 'metadata'.*index\.get\(/,
		);
		expect(sent).toEqual([]);
	});

	test.each([
		[[]],
		[["distance"]],
		[["metadata"]],
		[["distance", "metadata"]],
	])("forwards %p", async (include) => {
		const index = await load();
		await index.query({ ...shape, topK: 1, include });
		expect(sent).toHaveLength(1);
		expect(sent[0].body.include).toEqual(include);
	});

	test("omits include when not given", async () => {
		const index = await load();
		await index.query({ ...shape, topK: 1 });
		expect(sent[0].body).not.toHaveProperty("include");
	});
});

describe("get", () => {
	test.each([
		["distance"],
		["score"],
		["Contents"],
	])("rejects %p before sending", async (...include) => {
		const index = await load();
		await expect(index.get({ ids: ["a"], include })).rejects.toThrow(
			/Valid values: 'vector', 'contents', 'metadata'/,
		);
		expect(sent).toEqual([]);
	});

	test("rejects a bare string", async () => {
		const index = await load();
		await expect(
			index.get({ ids: ["a"], include: "metadata" as unknown as string[] }),
		).rejects.toThrow(/not a single string/);
		expect(sent).toEqual([]);
	});

	test.each([
		[["vector"]],
		[["contents", "metadata"]],
		[[]],
	])("forwards %p", async (include) => {
		const index = await load();
		await index.get({ ids: ["a"], include });
		expect(sent[0].body.include).toEqual(include);
	});
});
