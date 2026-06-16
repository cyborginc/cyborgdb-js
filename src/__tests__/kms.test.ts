/**
 * KMS BYOK integration tests for the CyborgDB JS SDK.
 *
 * Direct port of cyborgdb-py/tests/test_kms_byok.py — same suite shape,
 * same lifecycle ordering, same assertions. See the Python file for the
 * authoritative description of the two wire encodings and the
 * `kms_name` / `index_key` strict mutex; this comment mirrors only what
 * a JS reader needs.
 *
 *   * SDK-supplied KEK — `indexKey` alone, no `kmsName`. Persisted
 *     envelope is `provider="none"`; the SDK re-supplies the same key
 *     on every request.
 *   * KMS-managed KEK — `kmsName` alone, no `indexKey`. The service
 *     generates the KEK, wraps it via the named registry slot, and
 *     resolves it server-side on every subsequent request.
 *
 * KMS-managed suites are gated on the registry slot envs:
 *   - CYBORGDB_KMS_NAME_REAL — `provider: aws-kms` (HSM-resident KEK).
 *   - CYBORGDB_KMS_NAME_SM   — `provider: aws`     (Secrets Manager KEK).
 *
 * The SDK-supplied path needs no slot and runs whenever
 * CYBORGDB_API_KEY is set.
 */

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import * as dotenv from "dotenv";
import { Client, EncryptedIndex } from "../index";

dotenv.config({ path: ".env.local" });
jest.setTimeout(120000);

const BASE_URL = process.env.CYBORGDB_BASE_URL || "http://localhost:8000";
const API_KEY = process.env.CYBORGDB_API_KEY ?? "";
const KMS_NAME_REAL = process.env.CYBORGDB_KMS_NAME_REAL;
const KMS_NAME_SM = process.env.CYBORGDB_KMS_NAME_SM;

const DIMENSION = 128;
const NUM_VECTORS = 10;

// Seeded RNG so each run produces the same vectors — mirrors py's
// `np.random.default_rng(seed=1234)`. Mulberry32 is a 32-bit PRNG with
// enough quality for test fixtures.
function mulberry32(seed: number): () => number {
	let t = seed >>> 0;
	return () => {
		t = (t + 0x6d2b79f5) >>> 0;
		let r = t;
		r = Math.imul(r ^ (r >>> 15), r | 1);
		r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}

function makeVectors(): {
	items: Array<{ id: string; vector: number[]; metadata: { idx: number } }>;
	vectors: number[][];
} {
	const rng = mulberry32(1234);
	const vectors: number[][] = [];
	for (let i = 0; i < NUM_VECTORS; i++) {
		const v: number[] = [];
		for (let j = 0; j < DIMENSION; j++) v.push(rng());
		vectors.push(v);
	}
	const items = vectors.map((vector, i) => ({
		id: String(i),
		vector,
		metadata: { idx: i },
	}));
	return { items, vectors };
}

// Mirrors py's `unittest.skipUnless` — when `condition` is falsy the
// whole suite is skipped, otherwise it runs.
function describeIf(condition: unknown, name: string, body: () => void) {
	(condition ? describe : describe.skip)(name, body);
}

// ---------------------------------------------------------------------------
// Shared round-trip suite — mirrors _KMSRoundTripBase from the py file.
// ---------------------------------------------------------------------------

/**
 * Run the four-step lifecycle suite (create → load → upsert/query →
 * other data-plane) against one slot configuration.
 *
 * The Python file expresses this as `_KMSRoundTripBase` plus two
 * subclasses (`_RealKMSRoundTrip` for KMS-managed, the SDK-supplied
 * class overriding test_01/test_02 directly). JS has no comparable
 * inheritance for test classes, so we collapse the two layers into one
 * factory and branch on `needsSdkKey` for the create/load step.
 */
function runKMSRoundTripSuite(opts: {
	label: string;
	kmsName: string;
	needsSdkKey: boolean;
}) {
	const { label, kmsName, needsSdkKey } = opts;

	describe(label, () => {
		let client: Client;
		let indexName: string;
		let indexKey: Uint8Array | undefined;
		// Shared across the ordered tests in this suite — test_01 creates
		// it, test_03/test_04 reuse it. Mirrors `cls.index` in py.
		let index: EncryptedIndex | undefined;

		beforeAll(() => {
			client = new Client({
				baseUrl: BASE_URL,
				apiKey: API_KEY,
				verifySsl: false,
			});
			const slug = (kmsName || "sdk").replace(/[^a-zA-Z0-9]/g, "_");
			indexName = `test_kms_${slug}_${Math.random().toString(16).slice(2, 10)}`;
			indexKey = needsSdkKey ? Client.generateKey() : undefined;
		});

		afterAll(async () => {
			if (index !== undefined) {
				try {
					await index.deleteIndex();
				} catch {
					/* ignore */
				}
			}
		});

		if (needsSdkKey) {
			it("test_01_create_index_with_sdk_key", async () => {
				index = await client.createIndex({
					indexName,
					indexKey,
					dimension: DIMENSION,
					metric: "euclidean",
				});
				expect(index).toBeInstanceOf(EncryptedIndex);
				expect(await index.getIndexName()).toBe(indexName);
				// Internal-state parity with py's `self.assertEqual(index._index_key, self.index_key)`.
				// JS stores the key as hex internally; compare against the hex of the supplied bytes.
				const expectedHex = Buffer.from(indexKey as Uint8Array).toString("hex");
				expect((index as unknown as { indexKeyHex?: string }).indexKeyHex).toBe(
					expectedHex,
				);
			});

			it("test_02_load_index_with_key", async () => {
				const loaded = await client.loadIndex({ indexName, indexKey });
				expect(loaded).toBeInstanceOf(EncryptedIndex);
				const expectedHex = Buffer.from(indexKey as Uint8Array).toString("hex");
				expect(
					(loaded as unknown as { indexKeyHex?: string }).indexKeyHex,
				).toBe(expectedHex);
			});
		} else {
			it("test_01_create_index_kms_only", async () => {
				index = await client.createIndex({
					indexName,
					kmsName,
					dimension: DIMENSION,
					metric: "euclidean",
				});
				expect(index).toBeInstanceOf(EncryptedIndex);
				expect(await index.getIndexName()).toBe(indexName);
				// Keyless on the SDK side — server resolves the KEK from its envelope.
				expect(
					(index as unknown as { indexKeyHex?: string }).indexKeyHex,
				).toBeUndefined();
			});

			it("test_02_load_index_without_key", async () => {
				const loaded = await client.loadIndex({ indexName });
				expect(loaded).toBeInstanceOf(EncryptedIndex);
				expect(
					(loaded as unknown as { indexKeyHex?: string }).indexKeyHex,
				).toBeUndefined();
			});
		}

		it("test_03_upsert_and_query", async () => {
			expect(index).toBeDefined();
			const { items, vectors } = makeVectors();

			await (index as EncryptedIndex).upsert({ items });

			const response = await (index as EncryptedIndex).query({
				queryVectors: vectors[0],
				topK: 3,
				include: ["distance", "metadata"],
			});
			// Single-query path: SDK unwraps `results` to the hits array.
			const results = response.results as unknown as Array<{
				id: string;
				distance?: number;
				metadata?: Record<string, unknown>;
			}>;
			expect(results).toHaveLength(3);
			expect(results[0].id).toBe("0"); // closest match to itself
			expect(results[0].distance).toBeDefined();
			expect(results[0].metadata).toBeDefined();
		});

		it("test_04_other_data_plane_methods", async () => {
			expect(index).toBeDefined();
			const idx = index as EncryptedIndex;

			const all = await idx.listIds();
			expect(all.ids.length).toBeGreaterThanOrEqual(NUM_VECTORS);

			const fetched = await idx.get({ ids: ["0"], include: ["metadata"] });
			expect(fetched).toHaveLength(1);
			expect(fetched[0].id).toBe("0");

			expect(typeof (await idx.isTrained())).toBe("boolean");
			expect(typeof (await idx.isTraining())).toBe("boolean");

			await idx.delete({ ids: ["0"] });
			const remaining = await idx.listIds();
			expect(remaining.ids).not.toContain("0");
		});
	});
}

// ---------------------------------------------------------------------------
// Live suites — one per slot type, gated on the matching env var. Same
// gating shape as py's `@unittest.skipUnless`.
// ---------------------------------------------------------------------------

describeIf(
	KMS_NAME_REAL,
	"CyborgDB KMS BYOK — aws-kms (HSM): KEK lives in the HSM; service asks KMS to wrap the DEK",
	() => {
		runKMSRoundTripSuite({
			label: "TestKMSReal",
			kmsName: KMS_NAME_REAL ?? "",
			needsSdkKey: false,
		});
	},
);

describeIf(
	KMS_NAME_SM,
	"CyborgDB KMS BYOK — aws (Secrets Manager): KEK fetched from SM; service does AES-GCM wrap",
	() => {
		runKMSRoundTripSuite({
			label: "TestKMSSecretsManager",
			kmsName: KMS_NAME_SM ?? "",
			needsSdkKey: false,
		});
	},
);

describeIf(
	API_KEY,
	"CyborgDB KMS BYOK — SDK-supplied KEK: indexKey alone, no kmsName",
	() => {
		runKMSRoundTripSuite({
			label: "TestSDKSuppliedKEK",
			kmsName: "",
			needsSdkKey: true,
		});
	},
);

// ---------------------------------------------------------------------------
// Negative paths — direct ports of the two py classes.
// ---------------------------------------------------------------------------

describeIf(
	KMS_NAME_REAL,
	"TestKMSRealRejectsSDKKey — real-provider slot rejects a caller-supplied index_key",
	() => {
		// A real-provider slot generates the KEK itself, so supplying
		// `indexKey` alongside `kmsName` is contradictory and the service
		// returns 400 with `detail` matching "index_key must not be supplied
		// alongside …". The SDK forwards both fields untouched — the
		// rejection is the server's call.
		let client: Client;
		let indexName: string;

		beforeAll(() => {
			client = new Client({
				baseUrl: BASE_URL,
				apiKey: API_KEY,
				verifySsl: false,
			});
		});

		afterAll(async () => {
			// Best-effort cleanup in case the service unexpectedly created the index.
			try {
				const idx = await client.loadIndex({ indexName });
				await idx.deleteIndex();
			} catch {
				/* ignore */
			}
		});

		it("test_create_index_with_real_kms_and_key_is_rejected", async () => {
			indexName = `test_kms_neg_${Math.random().toString(16).slice(2, 10)}`;
			await expect(
				client.createIndex({
					indexName,
					indexKey: Client.generateKey(),
					kmsName: KMS_NAME_REAL,
					dimension: DIMENSION,
					metric: "euclidean",
				}),
			).rejects.toThrow(/index_key must not be supplied alongside/);
		});
	},
);

describeIf(
	API_KEY,
	"TestStrictMutexFiresBeforeSlotLookup — mutex check runs before registry lookup",
	() => {
		// Hits the endpoint directly via fetch — bypassing the SDK helper
		// so we can inspect the server's `detail` field, which the
		// generated client wraps inside a longer message. Direct probe
		// keeps the assertion precise. Mirrors py's urllib usage.
		it("test_unknown_slot_plus_index_key_returns_mutex_400", async () => {
			const indexKeyHex = Buffer.from(Client.generateKey()).toString("hex");
			const res = await fetch(`${BASE_URL}/v1/indexes/create`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-API-Key": API_KEY,
				},
				body: JSON.stringify({
					index_name: `test_kms_mutex_${Math.random().toString(16).slice(2, 10)}`,
					index_key: indexKeyHex,
					kms_name: "definitely-not-a-registered-slot",
					dimension: DIMENSION,
				}),
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as { detail?: string };
			expect(typeof body.detail).toBe("string");
			expect(body.detail).toMatch(/index_key must not be supplied alongside/);
		});
	},
);
