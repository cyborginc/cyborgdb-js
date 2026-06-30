/**
 * Query rerank_mult knob (0.17.0 API). Mirrors go rerank_test.go and
 * py test_rerank.py: rerank_mult is the stage-1 retrieval multiplier for
 * reranking indexes — optional, with a server-side default when unset. This
 * verifies the SDK threads the value into the request and the server accepts
 * it on a standard query.
 */

import { randomBytes, randomUUID } from "node:crypto";
import * as dotenv from "dotenv";
import { Client, type EncryptedIndex } from "../index";
import { flattenResults } from "./test-helpers";

dotenv.config({ path: ".env.local" });
jest.setTimeout(60000);

const BASE_URL = process.env.CYBORGDB_BASE_URL || "http://localhost:8000";
const API_KEY = process.env.CYBORGDB_API_KEY || "";
const DIM = 8;

describe("Query rerankMult", () => {
	let client: Client;
	let index: EncryptedIndex;

	beforeAll(async () => {
		client = new Client({
			baseUrl: BASE_URL,
			apiKey: API_KEY,
			verifySsl: false,
		});
		const name = `rerank_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
		index = await client.createIndex({
			indexName: name,
			indexKey: new Uint8Array(randomBytes(32)),
			dimension: DIM,
			metric: "euclidean",
		});
		const vectors = Array.from({ length: 20 }, () =>
			Array.from({ length: DIM }, () => Math.random()),
		);
		const ids = vectors.map((_, i) => `rerank_${i}`);
		await index.upsert({ ids, vectors });
	});

	afterAll(async () => {
		try {
			await index.deleteIndex();
		} catch {
			/* cleanup */
		}
	});

	test("threads rerankMult into the query and the server accepts it", async () => {
		const qv = Array.from({ length: DIM }, () => Math.random());
		const response = await index.query({
			queryVectors: qv,
			topK: 5,
			rerankMult: 4,
			include: ["distance"],
		});
		expect(flattenResults(response.results).length).toBeGreaterThanOrEqual(1);
	});
});
