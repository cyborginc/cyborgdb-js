/**
 * `listEmbeddingModels()` against a local stand-in, so no service is needed.
 * Mirrors py tests/test_embedding_models.py.
 */
import { CyborgDBServiceError } from "../errors";
import { Client } from "../index";
import { startStandIn } from "./test-helpers";

let models: unknown[];
let failWith: number | undefined;
let standIn: Awaited<ReturnType<typeof startStandIn>>;

beforeAll(async () => {
	standIn = await startStandIn(() =>
		failWith !== undefined
			? { status: failWith, body: { detail: "boom" } }
			: { body: { models } },
	);
});

afterAll(() => standIn.close());

beforeEach(() => {
	failWith = undefined;
	standIn.requests.length = 0;
	models = [
		{
			name: "sentence-transformers/all-MiniLM-L6-v2",
			dimension: 384,
			max_seq_length: 256,
		},
		{ name: "BAAI/bge-base-en-v1.5", dimension: 768, max_seq_length: 512 },
	];
});

const client = () => new Client({ baseUrl: standIn.url, apiKey: "k" });

describe("listEmbeddingModels()", () => {
	it("maps every field, in service order", async () => {
		expect(await client().listEmbeddingModels()).toEqual([
			{
				name: "sentence-transformers/all-MiniLM-L6-v2",
				dimension: 384,
				maxSeqLength: 256,
			},
			{ name: "BAAI/bge-base-en-v1.5", dimension: 768, maxSeqLength: 512 },
		]);
	});

	it("returns an empty list when the service has none", async () => {
		models = [];
		expect(await client().listEmbeddingModels()).toEqual([]);
	});

	it("calls the embedding-models endpoint", async () => {
		await client().listEmbeddingModels();
		expect(standIn.requests).toEqual([
			expect.objectContaining({ method: "GET", url: "/v1/embedding-models" }),
		]);
	});

	it("maps errors to typed errors", async () => {
		failWith = 503;
		await expect(client().listEmbeddingModels()).rejects.toThrow(
			CyborgDBServiceError,
		);
	});
});
