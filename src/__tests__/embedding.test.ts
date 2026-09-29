/**
 * Built-in text embedding (cyborgdb-embed).
 *
 * cyborgdb-core now embeds in C++ via cyborgdb-embed rather than calling
 * sentence-transformers from Python (cyborgdb-core#2422). The service half
 * is the service half: it drops the sentence-transformers gate, adds
 * `GET /v1/embedding-models`, and maps core's EmbeddingModelUnavailable to 503
 * instead of letting it fall through as a 500.
 *
 * These assert the contract the service change defines, so they double as the
 * SDK-side check that it landed.
 * Mirrors py tests/test_embedding.py.
 */

import { randomBytes, randomUUID } from "node:crypto";
import * as dotenv from "dotenv";
import { Client, type EncryptedIndex } from "../index";
import { flattenResults, waitForIds } from "./test-helpers";

dotenv.config({ path: ".env.local" });
jest.setTimeout(180000);

const BASE_URL = process.env.CYBORGDB_BASE_URL || "http://localhost:8000";
const API_KEY = process.env.CYBORGDB_API_KEY || "";

const MODEL = "sentence-transformers/all-MiniLM-L6-v2";
const MODEL_DIM = 384;

// Three distinct topics, so a semantic hit is unambiguous. Ported from
// cyborgdb-core tests/embedding_test.cpp.
const CORPUS: Record<string, string> = {
	fox: "The quick brown fox jumps over the lazy dog.",
	revenue: "Quarterly revenue grew eleven percent year over year.",
	weather: "Heavy rain and strong winds are expected tomorrow.",
};

const newClient = () =>
	new Client({ baseUrl: BASE_URL, apiKey: API_KEY, verifySsl: false });
const newIndexName = (prefix: string) =>
	`${prefix}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;

describe("embedding model catalog", () => {
	// Called directly — the SDK has no wrapper for this endpoint yet.
	it("lists the supported models", async () => {
		const response = await fetch(`${BASE_URL}/v1/embedding-models`, {
			headers: { "X-API-Key": API_KEY },
		});
		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			models: { name: string; dimension: number; max_seq_length: number }[];
		};
		const byName = Object.fromEntries(body.models.map((m) => [m.name, m]));
		expect(byName[MODEL]).toBeDefined();
		expect(byName[MODEL].dimension).toBe(MODEL_DIM);
		for (const model of body.models) {
			expect(model.dimension).toBeGreaterThan(0);
			expect(model.max_seq_length).toBeGreaterThan(0);
		}
	});
});

describe("embedding model validation", () => {
	let client: Client;
	const created: EncryptedIndex[] = [];

	const makeIndex = async (opts: Record<string, unknown>) => {
		const index = await client.createIndex({
			indexName: newIndexName("embed"),
			indexKey: new Uint8Array(randomBytes(32)),
			...opts,
		});
		created.push(index);
		return index;
	};

	beforeAll(() => {
		client = newClient();
	});

	afterAll(async () => {
		for (const index of created) {
			try {
				await index.deleteIndex();
			} catch {
				// best-effort cleanup
			}
		}
	});

	it("accepts a bare, mixed-case model name", async () => {
		// cyborgdb-embed accepts the name with or without the org prefix.
		const index = await makeIndex({ embeddingModel: "ALL-MINILM-L6-V2" });
		expect(await index.getDimension()).toBe(MODEL_DIM);
	});

	it("accepts the full model name", async () => {
		const index = await makeIndex({ embeddingModel: MODEL });
		expect(await index.getDimension()).toBe(MODEL_DIM);
	});

	it("rejects an unknown model as a client error", async () => {
		// Before #271 this was a 500, which tells a caller to retry something
		// that can never succeed.
		await expect(
			makeIndex({ embeddingModel: "not-a-real-model" }),
		).rejects.toMatchObject({ statusCode: 400 });
	});

	it("rejects an openai-style model name", async () => {
		await expect(
			makeIndex({ embeddingModel: "text-embedding-3-small" }),
		).rejects.toMatchObject({ statusCode: 400 });
	});

	it("rejects a dimension contradicting the model", async () => {
		await expect(
			makeIndex({ embeddingModel: MODEL, dimension: MODEL_DIM + 1 }),
		).rejects.toMatchObject({ statusCode: 400 });
	});

	it("accepts a dimension matching the model", async () => {
		// Anchors the test above: the rejection is about the contradiction,
		// not about passing a dimension at all.
		const index = await makeIndex({
			embeddingModel: MODEL,
			dimension: MODEL_DIM,
		});
		expect(await index.getDimension()).toBe(MODEL_DIM);
	});
});

describe("embedding round trip", () => {
	// Text in, semantically-related text finds it again.
	let client: Client;
	let index: EncryptedIndex;

	beforeAll(async () => {
		client = newClient();
		index = await client.createIndex({
			indexName: newIndexName("embed_rt"),
			indexKey: new Uint8Array(randomBytes(32)),
			embeddingModel: MODEL,
		});
		await index.upsert({
			items: Object.entries(CORPUS).map(([id, contents]) => ({ id, contents })),
		});
		await waitForIds(index, Object.keys(CORPUS));
	});

	afterAll(async () => {
		try {
			await index.deleteIndex();
		} catch {
			// best-effort cleanup
		}
	});

	const topHit = async (text: string) => {
		const rows = flattenResults(
			(await index.query({ queryContents: text, topK: 1 })).results,
		);
		return rows.length > 0 ? rows[0].id : null;
	};

	it("finds the right document from a paraphrase", async () => {
		// Neither query shares a distinctive word with its target, so a match
		// has to come from the embedding rather than lexical overlap.
		expect(await topHit("a fox leaping over a sleepy dog")).toBe("fox");
		expect(await topHit("company earnings this quarter")).toBe("revenue");
		expect(await topHit("a storm is coming")).toBe("weather");
	});

	it("stores contents alongside the vector", async () => {
		const row = (await index.get({ ids: ["fox"], include: ["contents"] }))[0];
		expect(row.contents).toBe(CORPUS.fox);
	});

	it("embeds to the model's dimension", async () => {
		const row = (await index.get({ ids: ["fox"], include: ["vector"] }))[0];
		expect((row.vector as number[]).length).toBe(MODEL_DIM);
	});
});
