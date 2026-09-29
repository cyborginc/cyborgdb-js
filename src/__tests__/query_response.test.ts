/**
 * `QueryResponse.results` is typed and shaped as documented: a flat list for
 * a single query, one list per vector for a batch. Runs against a local
 * stand-in, so no service is needed.
 *
 * The assignments to `QueryResultItem[] | QueryResultItem[][]` without a cast
 * are the type check: they fail to compile if `results` regresses to the
 * generated `{}`.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client, type QueryResponse, type QueryResultItem } from "../index";

const hit = (id: string) => ({ id, distance: 0.1, metadata: { tag: id } });

let server: Server;
let baseUrl: string;

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
			const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
			const count = body.query_vectors?.length ?? 1;
			res.end(
				JSON.stringify({
					results: Array.from({ length: count }, (_, i) => [hit(`v${i}`)]),
				}),
			);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

const load = () =>
	new Client({ baseUrl, apiKey: "k" }).loadIndex({
		indexName: "idx",
		indexKey: new Uint8Array(32),
	});

test("a single query returns a flat list of typed items", async () => {
	const index = await load();
	const response: QueryResponse = await index.query({
		queryVectors: [0.1, 0.2],
		topK: 1,
	});
	const results: QueryResultItem[] | QueryResultItem[][] = response.results;
	expect(results).toEqual([hit("v0")]);
});

test("a batch query returns one typed list per vector", async () => {
	const index = await load();
	const response = await index.query({
		queryVectors: [
			[0.1, 0.2],
			[0.3, 0.4],
		],
		topK: 1,
	});
	const results: QueryResultItem[] | QueryResultItem[][] = response.results;
	expect(results).toEqual([[hit("v0")], [hit("v1")]]);
});
