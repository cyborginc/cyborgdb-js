/**
 * `describe()` and `getNumVectors()` against a local stand-in, so no service
 * is needed. Mirrors py tests/test_describe_num_vectors.py.
 */
import { CyborgDBNotFoundError } from "../errors";
import { Client } from "../index";
import { startStandIn } from "./test-helpers";

const KEY = new Uint8Array(32).fill(1);
const KEY_HEX = "01".repeat(32);

const DESCRIBED = {
	index_name: "idx",
	is_trained: true,
	index_type: "disk_ivf",
	training_state: "trained",
	storage_precision: "tq8",
	dimension: 384,
	metric: "cosine",
	n_lists: 16,
	metadata_schema: {
		$default: { filterable: false, pattern: false, full_text: false },
		title: { filterable: true, pattern: true },
		body: { filterable: false, full_text: true },
	},
	bm25: { k1: 1.2, b: 0.75, analyzer_version: "v1" },
	embedding_model: "sentence-transformers/all-MiniLM-L6-v2",
};

let describeBody: Record<string, unknown>;
// Set after loadIndex() so the load itself still succeeds.
let failWith: number | undefined;
let standIn: Awaited<ReturnType<typeof startStandIn>>;

beforeAll(async () => {
	standIn = await startStandIn(({ url }) => {
		if (failWith !== undefined) {
			return {
				status: failWith,
				body: { detail: "Index 'idx' does not exist" },
			};
		}
		if (url === "/v1/vectors/num_vectors") return { body: { result: 15 } };
		return { body: describeBody };
	});
});

afterAll(() => standIn.close());

beforeEach(() => {
	describeBody = DESCRIBED;
	failWith = undefined;
	standIn.requests.length = 0;
});

const load = ({ keyless = false } = {}) =>
	new Client({ baseUrl: standIn.url, apiKey: "k" }).loadIndex({
		indexName: "idx",
		indexKey: keyless ? undefined : KEY,
	});

const lastRequest = () => standIn.requests[standIn.requests.length - 1];

describe("describe()", () => {
	it("maps every field", async () => {
		const index = await load();
		expect(await index.describe()).toEqual({
			indexName: "idx",
			indexType: "disk_ivf",
			dimension: 384,
			metric: "cosine",
			storagePrecision: "tq8",
			nLists: 16,
			trainingState: "trained",
			metadataSchema: {
				$default: { filterable: false },
				title: { filterable: true, pattern: true, fullText: false },
				body: { filterable: false, pattern: false, fullText: true },
			},
			bm25: { k1: 1.2, b: 0.75, analyzerVersion: "v1" },
			embeddingModel: "sentence-transformers/all-MiniLM-L6-v2",
		});
	});

	it("has no isTrained", async () => {
		const index = await load();
		expect(await index.describe()).not.toHaveProperty("isTrained");
	});

	it.each([
		["omits", undefined],
		["sends null for", null],
	])("leaves embeddingModel out when the service %s it", async (_, model) => {
		describeBody = { ...DESCRIBED, embedding_model: model };
		const index = await load();
		expect(await index.describe()).not.toHaveProperty("embeddingModel");
	});

	it("returns an empty schema and null bm25 when the service omits them", async () => {
		describeBody = {
			...DESCRIBED,
			metadata_schema: undefined,
			bm25: undefined,
		};
		const index = await load();
		const described = await index.describe();
		expect(described.metadataSchema).toEqual({});
		expect(described.bm25).toBeNull();
	});

	it.each(["untrained", "training", "trained"])(
		"passes training state %s through",
		async (trainingState) => {
			describeBody = { ...DESCRIBED, training_state: trainingState };
			const index = await load();
			expect((await index.describe()).trainingState).toBe(trainingState);
		},
	);

	it("sends the index name and key", async () => {
		const index = await load();
		await index.describe();
		expect(lastRequest()).toMatchObject({
			url: "/v1/indexes/describe",
			body: { index_name: "idx", index_key: KEY_HEX },
		});
	});

	it("sends no key for a KMS-managed index", async () => {
		const index = await load({ keyless: true });
		await index.describe();
		expect(lastRequest().body).toEqual({ index_name: "idx" });
	});

	it("maps errors to typed errors", async () => {
		const index = await load();
		failWith = 404;
		await expect(index.describe()).rejects.toThrow(CyborgDBNotFoundError);
	});
});

describe("getNumVectors()", () => {
	it("returns the count", async () => {
		const index = await load();
		expect(await index.getNumVectors()).toBe(15);
	});

	it("sends the index name and key", async () => {
		const index = await load();
		await index.getNumVectors();
		expect(lastRequest()).toMatchObject({
			url: "/v1/vectors/num_vectors",
			body: { index_name: "idx", index_key: KEY_HEX },
		});
	});

	it("maps errors to typed errors", async () => {
		const index = await load();
		failWith = 404;
		await expect(index.getNumVectors()).rejects.toThrow(CyborgDBNotFoundError);
	});
});
