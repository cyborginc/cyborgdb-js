/**
 * `getDimension()` / `getMetric()` caching against a local stand-in whose
 * index is created without a dimension: describe reports 0 until the first
 * upsert sets it. No service is needed.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "../index";

let server: Server;
let baseUrl: string;
let dimension = 0;
let describeCalls = 0;

beforeAll(async () => {
	server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			res.writeHead(200, { "Content-Type": "application/json" });
			if (req.url === "/v1/indexes/describe") {
				describeCalls++;
				res.end(
					JSON.stringify({ index_name: "idx", dimension, metric: "cosine" }),
				);
			} else if (req.url === "/v1/vectors/upsert") {
				dimension = 2;
				res.end(JSON.stringify({ status: "success", message: "Upserted 1" }));
			} else {
				res.writeHead(404);
				res.end();
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
	dimension = 0;
	describeCalls = 0;
});

const load = () =>
	new Client({ baseUrl, apiKey: "k" }).loadIndex({
		indexName: "idx",
		indexKey: new Uint8Array(32),
	});

const upsertOne = (index: Awaited<ReturnType<typeof load>>) =>
	index.upsert({ items: [{ id: "a", vector: [0.1, 0.2] }] });

test("getDimension picks up the dimension set by the first upsert", async () => {
	const index = await load();
	expect(await index.getDimension()).toBe(0);
	await upsertOne(index);
	expect(await index.getDimension()).toBe(2);
});

test("getMetric before the first upsert does not pin the dimension at 0", async () => {
	const index = await load();
	expect(await index.getMetric()).toBe("cosine");
	await upsertOne(index);
	expect(await index.getDimension()).toBe(2);
});

test("a known dimension and the metric are cached", async () => {
	dimension = 2;
	const index = await load();
	const afterLoad = describeCalls;
	expect(await index.getDimension()).toBe(2);
	expect(await index.getMetric()).toBe("cosine");
	expect(await index.getDimension()).toBe(2);
	expect(describeCalls - afterLoad).toBe(1);
});
