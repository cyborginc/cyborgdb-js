/**
 * Comprehensive test coverage for TypeScript SDK to achieve standardization
 * Covers SSL, error handling, edge cases for the DiskIVF index.
 */

import { randomBytes } from "node:crypto";
import * as dotenv from "dotenv";
import { Client } from "../index";
import { flattenResults } from "./test-helpers";

// Load environment variables from .env.local
dotenv.config({ path: ".env.local" });

const API_URL = "http://localhost:8000";
const CYBORGDB_API_KEY = process.env.CYBORGDB_API_KEY;

if (!CYBORGDB_API_KEY) {
	throw new Error("CYBORGDB_API_KEY environment variable is not set");
}

// Set global timeout
jest.setTimeout(60000);

function generateUniqueName(prefix = "test"): string {
	return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function generateRandomKey(): Uint8Array {
	return new Uint8Array(randomBytes(32));
}

/**
 * Create a CyborgDB client - simplified for reliable local testing
 */
function createClient(): any {
	return new Client({
		baseUrl: API_URL,
		apiKey: CYBORGDB_API_KEY,
		verifySsl: false,
	});
}

describe("SSL Verification Tests", () => {
	const apiKey = process.env.CYBORGDB_API_KEY || "test-key";
	const localhostUrl = "http://localhost:8000";
	const productionUrl = "https://api.cyborgdb.com";

	test("should handle SSL auto-detection for localhost URLs", async () => {
		const client = new Client({
			baseUrl: localhostUrl,
			apiKey,
			verifySsl: false,
		});
		expect(client).toBeDefined();

		// Basic connectivity test
		const health = await client.getHealth();
		expect(typeof health).toBeTruthy();
	});

	test("should handle explicit SSL verification disable", async () => {
		const client = new Client({
			baseUrl: productionUrl,
			apiKey,
			verifySsl: false,
		});
		expect(client).toBeDefined();
	});

	test("should handle explicit SSL verification enable", async () => {
		const client = new Client({
			baseUrl: productionUrl,
			apiKey,
			verifySsl: true,
		});
		expect(client).toBeDefined();
	});

	test("should handle SSL certificate validation scenarios", async () => {
		const client = new Client({
			baseUrl: productionUrl,
			apiKey,
			verifySsl: true,
		});

		try {
			await client.getHealth();
			expect(true).toBe(true);
		} catch (error: any) {
			const networkErrors = [
				"ENOTFOUND",
				"ECONNREFUSED",
				"Network Error",
				"timeout",
				"getaddrinfo",
			];
			const hasNetworkError = networkErrors.some(
				(errorType) =>
					error.message?.includes(errorType) || error.code === errorType,
			);

			const hasSSLError =
				error.message?.includes("SSL") ||
				error.message?.includes("certificate");

			expect(hasNetworkError || hasSSLError).toBe(true);
		}
	});

	test("should auto-detect connection method", async () => {
		const client = createClient();
		expect(client).toBeDefined();

		const health = await client.getHealth();
		expect(typeof health).toBeTruthy();
	});
});

describe("DiskIVF Index Tests", () => {
	const client = createClient();
	const dimension = 128;
	let index: any;
	let indexName: string;
	let indexKey: Uint8Array;
	let testVectors: number[][];

	beforeEach(async () => {
		indexName = generateUniqueName();
		indexKey = generateRandomKey();
		testVectors = Array(10)
			.fill(0)
			.map(() =>
				Array(dimension)
					.fill(0)
					.map(() => Math.random()),
			);
	});

	afterEach(async () => {
		if (index) {
			try {
				await index.deleteIndex();
			} catch (error) {
				console.error(`Error cleaning up index: ${error}`);
			}
		}
	});

	test("should create and operate DiskIVF index successfully", async () => {
		index = await client.createIndex({
			indexName,
			indexKey,
			dimension,
			metric: "euclidean",
		});

		expect(index).toBeDefined();
		expect(await index.getIndexName()).toBe(indexName);

		const testIds = testVectors.map((_, i) => `vec_${i}`);
		await index.upsert({ ids: testIds, vectors: testVectors });

		const queryVector = testVectors[0];
		const results = await index.query({ queryVectors: [queryVector], topK: 5 });

		expect(results.results).toBeDefined();
		expect(Array.isArray(results.results)).toBe(true);
		if (results.results.length > 0 && results.results[0].length > 0) {
			expect(results.results[0][0]).toHaveProperty("id");
		}
	});

	test("should create DiskIVF index without explicit dimension", async () => {
		index = await client.createIndex({
			indexName,
			indexKey,
			metric: "euclidean",
		});

		const testIds = testVectors.map((_, i) => `auto_${i}`);
		await index.upsert({ ids: testIds, vectors: testVectors });

		const results = await index.query({
			queryVectors: [testVectors[0]],
			topK: 5,
		});
		expect(results.results).toBeDefined();
	});
});

describe("Error Handling Tests", () => {
	const client = createClient();

	(process.env.CYBORGDB_SERVICE_ROOT_KEY ? test : test.skip)(
		"should handle invalid API key",
		async () => {
			const invalidClient = new Client({
				baseUrl: API_URL,
				apiKey: "invalid-key-12345",
				verifySsl: false,
			});

			await expect(
				invalidClient.createIndex({
					indexName: generateUniqueName(),
					indexKey: generateRandomKey(),
					dimension: 128,
					metric: "euclidean",
				}),
			).rejects.toThrow();
		},
	);

	test("should handle malformed requests", async () => {
		const indexName = generateUniqueName();
		const indexKey = generateRandomKey();

		// Negative dimension should be rejected by the server
		await expect(
			client.createIndex({
				indexName,
				indexKey,
				dimension: -1,
				metric: "euclidean",
			}),
		).rejects.toThrow();

		// Invalid metric should be rejected
		await expect(
			client.createIndex({
				indexName: generateUniqueName(),
				indexKey: generateRandomKey(),
				dimension: 128,
				metric: "invalid_metric" as any,
			}),
		).rejects.toThrow();
	});

	test("should handle network connectivity issues", async () => {
		const unreachableClient = new Client({
			baseUrl: "http://non-existent-server:8000",
			apiKey: "test-key",
			verifySsl: false,
		});

		await expect(unreachableClient.getHealth()).rejects.toThrow();
	});

	test("should handle invalid vector dimensions", async () => {
		const indexName = generateUniqueName();
		const indexKey = generateRandomKey();

		const index = await client.createIndex({
			indexName,
			indexKey,
			dimension: 128,
			metric: "euclidean",
		});

		try {
			const wrongDimVector = Array(64)
				.fill(0)
				.map(() => Math.random());

			await expect(
				index.upsert({
					ids: ["wrong_dim"],
					vectors: [wrongDimVector],
				}),
			).rejects.toThrow();
		} finally {
			await index.deleteIndex();
		}
	});

	test("should handle server error responses", async () => {
		const indexKey = generateRandomKey();

		// Test empty index name
		await expect(
			client.createIndex({
				indexName: "",
				indexKey,
				dimension: 128,
				metric: "euclidean",
			}),
		).rejects.toThrow();

		// Test invalid index key format
		const shortKey = new Uint8Array(8);
		await expect(
			client.createIndex({
				indexName: generateUniqueName(),
				indexKey: shortKey,
				dimension: 128,
				metric: "euclidean",
			}),
		).rejects.toThrow();
	});
});

describe("Edge Cases Tests", () => {
	const client = createClient();
	let index: any;
	let indexName: string;
	let indexKey: Uint8Array;

	beforeEach(async () => {
		indexName = generateUniqueName("edge");
		indexKey = generateRandomKey();

		index = await client.createIndex({
			indexName,
			indexKey,
			dimension: 128,
			metric: "euclidean",
		});
	});

	afterEach(async () => {
		if (index) {
			try {
				await index.deleteIndex();
			} catch (error) {
				console.error(`Error cleaning up index: ${error}`);
			}
		}
	});

	test("should handle empty query results", async () => {
		const queryVector = Array(128)
			.fill(0)
			.map(() => Math.random());
		const results = await index.query({
			queryVectors: [queryVector],
			topK: 10,
		});

		expect(results.results).toBeDefined();
		expect(Array.isArray(results.results)).toBe(true);
		if (Array.isArray(results.results[0])) {
			expect(results.results[0].length).toBe(0);
		}
	});

	test("should validate mismatched parameter lengths", async () => {
		const vectors = Array(3)
			.fill(0)
			.map(() =>
				Array(128)
					.fill(0)
					.map(() => Math.random()),
			);
		const ids = ["id1", "id2"]; // Fewer IDs than vectors

		await expect(
			index.upsert({
				ids: ids,
				vectors: vectors,
			}),
		).rejects.toThrow();
	});

	test("should preserve content through operations", async () => {
		const originalVector = Array(128)
			.fill(0)
			.map(() => Math.random());
		const originalMetadata = { test_key: "test_value", number: 42 };

		await index.upsert({
			items: [
				{
					id: "preserve_test",
					vector: originalVector,
					metadata: originalMetadata,
				},
			],
		});

		await new Promise((resolve) => setTimeout(resolve, 1000));

		const results = await index.get({
			ids: ["preserve_test"],
			include: ["vector", "metadata"],
		});

		expect(results.length).toBe(1);
		const retrieved = results[0];
		expect(retrieved.id).toBe("preserve_test");

		expect(retrieved.vector.length).toBe(originalVector.length);
		for (let i = 0; i < originalVector.length; i++) {
			expect(retrieved.vector[i]).toBeCloseTo(originalVector[i], 5);
		}

		expect(retrieved.metadata).toEqual(originalMetadata);
	});

	test("should handle index cleanup errors", async () => {
		const testIndexName = generateUniqueName("cleanup");
		const testIndexKey = generateRandomKey();

		const testIndex = await client.createIndex({
			indexName: testIndexName,
			indexKey: testIndexKey,
			dimension: 128,
			metric: "euclidean",
		});

		await testIndex.deleteIndex();

		// Try to delete again - should throw error
		await expect(testIndex.deleteIndex()).rejects.toThrow();
	});

	test("should handle concurrent operations", async () => {
		const numOperations = 5;
		const operations = Array(numOperations)
			.fill(0)
			.map(async (_, i) => {
				const vector = Array(128)
					.fill(0)
					.map(() => Math.random());
				return index.upsert({
					items: [
						{
							id: `concurrent_${i}`,
							vector: vector,
							metadata: { batch: i },
						},
					],
				});
			});

		await Promise.all(operations);
		await new Promise((resolve) => setTimeout(resolve, 2000));

		const listResult = await index.listIds();
		const concurrentIds = listResult.ids.filter((id: string) =>
			id.startsWith("concurrent_"),
		);
		expect(concurrentIds.length).toBe(numOperations);
	});

	test("should handle boundary values", async () => {
		// Extreme float values must survive the upsert→get round-trip. Expected
		// values are quantized to float32 (Math.fround) before comparison because
		// the server stores vectors as float32 while JS numbers are float64.
		// Mirrors go TestBoundaryVectorValuesRoundTrip /
		// py test_boundary_vector_values_round_trip.
		const cases: Array<[string, number[]]> = [
			["very small (1e-10)", Array(128).fill(1e-10)],
			["very large (1e10)", Array(128).fill(1e10)],
			[
				"mixed signs",
				Array(128)
					.fill(0)
					.map((_, i) => (i % 2 === 0 ? i / 100.0 : -i / 100.0)),
			],
		];

		for (let i = 0; i < cases.length; i++) {
			await index.upsert({
				items: [{ id: `boundary_${i}`, vector: cases[i][1] }],
			});
		}
		await new Promise((resolve) => setTimeout(resolve, 2000));

		for (let i = 0; i < cases.length; i++) {
			const vec = cases[i][1];
			const results = await index.get({
				ids: [`boundary_${i}`],
				include: ["vector"],
			});
			expect(results.length).toBe(1);
			const retrieved = results[0].vector as number[];
			expect(retrieved.length).toBe(128);
			for (let j = 0; j < vec.length; j++) {
				const expected = Math.fround(vec[j]);
				const tol = Math.max(Math.abs(expected) * 1e-4, 1e-4);
				expect(Math.abs(retrieved[j] - expected)).toBeLessThanOrEqual(tol);
			}
		}
	});

	test("should handle large metadata objects", async () => {
		const largeMetadata = {
			description: "A".repeat(1000),
			nested: {
				level1: {
					level2: {
						level3: Array(100)
							.fill(0)
							.map((_, i) => ({ id: i, value: `item_${i}` })),
					},
				},
			},
			array: Array(50)
				.fill(0)
				.map((_, i) => i),
			tags: Array(20)
				.fill(0)
				.map((_, i) => `tag_${i}`),
		};

		const vector = Array(128)
			.fill(0)
			.map(() => Math.random());

		await index.upsert({
			items: [
				{
					id: "large_metadata",
					vector: vector,
					metadata: largeMetadata,
				},
			],
		});

		await new Promise((resolve) => setTimeout(resolve, 1000));

		const results = await index.get({
			ids: ["large_metadata"],
			include: ["metadata"],
		});

		expect(results.length).toBe(1);
		expect(results[0].metadata).toEqual(largeMetadata);
	});
});

describe("Backend Compatibility Tests", () => {
	const client = createClient();

	test("should detect backend capabilities", async () => {
		const health = await client.getHealth();
		expect(health).toBeDefined();

		const indexName = generateUniqueName("backend_test");
		const indexKey = generateRandomKey();

		const index = await client.createIndex({
			indexName,
			indexKey,
			dimension: 128,
			metric: "euclidean",
		});

		await index.deleteIndex();
	});

	test("should support basic DiskIVF operations", async () => {
		const indexName = generateUniqueName("lite_test");
		const indexKey = generateRandomKey();

		const index = await client.createIndex({
			indexName,
			indexKey,
			dimension: 128,
			metric: "euclidean",
		});

		try {
			const testVector = Array(128)
				.fill(0)
				.map(() => Math.random());
			await index.upsert({
				items: [
					{
						id: "lite_test",
						vector: testVector,
						metadata: { backend: "test" },
					},
				],
			});

			await new Promise((resolve) => setTimeout(resolve, 1000));

			const results = await index.query({
				queryVectors: [testVector],
				topK: 1,
			});
			expect(results.results).toBeDefined();
		} finally {
			await index.deleteIndex();
		}
	});
});

describe("Data Integrity Tests", () => {
	const client = createClient();
	let index: any;
	let indexName: string;
	let indexKey: Uint8Array;

	beforeEach(async () => {
		indexName = generateUniqueName("integrity");
		indexKey = generateRandomKey();
		index = await client.createIndex({
			indexName,
			indexKey,
			dimension: 128,
			metric: "euclidean",
		});
	});

	afterEach(async () => {
		if (index) {
			try {
				await index.deleteIndex();
			} catch (error) {
				console.error(`Error cleaning up index: ${error}`);
			}
		}
	});

	test("upsert overwrite preserves latest data", async () => {
		// Overwriting an ID returns the latest vector and metadata — no stale
		// cache, and version-1 metadata must not leak into version 2.
		const vecV1 = Array(128)
			.fill(0)
			.map(() => Math.random());
		await index.upsert({
			items: [
				{
					id: "overwrite_test",
					vector: vecV1,
					metadata: { version: 1, old_field: "should_disappear" },
				},
			],
		});
		await new Promise((resolve) => setTimeout(resolve, 2000));

		const vecV2 = Array(128)
			.fill(0)
			.map(() => Math.random() + 10.0);
		await index.upsert({
			items: [
				{
					id: "overwrite_test",
					vector: vecV2,
					metadata: { version: 2, new_field: "present" },
				},
			],
		});
		await new Promise((resolve) => setTimeout(resolve, 2000));

		const results = await index.get({
			ids: ["overwrite_test"],
			include: ["vector", "metadata"],
		});
		expect(results.length).toBe(1);
		const retrieved = results[0];
		for (let i = 0; i < vecV2.length; i++) {
			expect(retrieved.vector[i]).toBeCloseTo(vecV2[i], 4);
		}
		expect(retrieved.metadata.version).toBe(2);
		expect(retrieved.metadata.new_field).toBe("present");
	});

	test("delete actually removes data", async () => {
		// After delete, vectors are gone from get(), listIds(), and query().
		const vectors = Array(10)
			.fill(0)
			.map(() =>
				Array(128)
					.fill(0)
					.map(() => Math.random()),
			);
		const ids = vectors.map((_, i) => `del_test_${i}`);
		await index.upsert({ ids, vectors });
		await new Promise((resolve) => setTimeout(resolve, 2000));

		const deleteIds = ids.slice(0, 5);
		await index.delete({ ids: deleteIds });
		await new Promise((resolve) => setTimeout(resolve, 2000));

		// get() returns nothing for deleted IDs
		const got = await index.get({ ids: deleteIds, include: ["vector"] });
		expect(got.length).toBe(0);

		// listIds() shows only the surviving 5
		const listResult = await index.listIds();
		for (const d of deleteIds) {
			expect(listResult.ids).not.toContain(d);
		}
		expect(listResult.ids.length).toBe(5);

		// query() must not surface a deleted vector
		const response = await index.query({
			queryVectors: [vectors[0]],
			topK: 10,
		});
		const returned = flattenResults(response.results).map((it) => it.id);
		for (const d of deleteIds) {
			expect(returned).not.toContain(d);
		}
	});

	test("get non-existent IDs", async () => {
		// get() on a mix of real and missing IDs returns only the real ones.
		await index.upsert({
			items: [
				{
					id: "exists",
					vector: Array(128)
						.fill(0)
						.map(() => Math.random()),
				},
			],
		});
		await new Promise((resolve) => setTimeout(resolve, 2000));

		const results = await index.get({
			ids: ["exists", "ghost_1", "ghost_2"],
			include: ["vector"],
		});
		expect(results.length).toBe(1);
		expect(results[0].id).toBe("exists");
	});

	test("duplicate index name rejected", async () => {
		// `indexName` already exists (created in beforeEach); recreating it must
		// fail rather than silently overwrite live data.
		await expect(
			client.createIndex({
				indexName,
				indexKey: generateRandomKey(),
				dimension: 128,
				metric: "euclidean",
			}),
		).rejects.toThrow();
	});

	test("wrong key cannot access data", async () => {
		const name = generateUniqueName("wrongkey");
		const wrongIndex = await client.createIndex({
			indexName: name,
			indexKey: generateRandomKey(),
			dimension: 128,
			metric: "euclidean",
		});
		try {
			await wrongIndex.upsert({
				items: [
					{
						id: "secret_data",
						vector: Array(128)
							.fill(0)
							.map(() => Math.random()),
					},
				],
			});
			await new Promise((resolve) => setTimeout(resolve, 2000));

			// Loading with a different key must be rejected.
			await expect(
				client.loadIndex({ indexName: name, indexKey: generateRandomKey() }),
			).rejects.toThrow();
		} finally {
			await wrongIndex.deleteIndex();
		}
	});
});
