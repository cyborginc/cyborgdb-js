/**
 * RBAC user-management integration tests for the CyborgDB TypeScript SDK.
 *
 * These exercise the user-key lifecycle the service exposes when it runs
 * with `CYBORGDB_ROOT_API_KEY` set (RBAC enabled, see the service's
 * `rbac.md`):
 *
 *   * the **root** client mints per-user API keys with
 *     `EncryptedIndex.createUser({ permissions: [...] })`;
 *   * a **user** client authenticates with the returned `cdbk_` key and
 *     is confined to that one index with `read` / `write` permissions
 *     enforced *cryptographically* by the service — the wrapped
 *     data-encryption keys that exist for the user ARE the permission
 *     set, so a read-only user simply cannot decrypt for a write op;
 *   * `listUsers` / `deleteUser` let the root enumerate and revoke;
 *     after a delete the user's key stops working immediately.
 *
 * User keys resolve the index KEK server-side, so they only work
 * against **KMS-backed** indexes. The suite is therefore gated on both
 * the root key and a KMS registry slot:
 *
 *   - CYBORGDB_ROOT_API_KEY — the service's admin key (RBAC must be
 *     enabled).
 *   - CYBORGDB_KMS_NAME     — a kms.registry slot the service can use
 *     to wrap the per-index KEK (e.g. the same value used by the KMS
 *     BYOK suite).
 *
 * Run a service with both configured, point CYBORGDB_BASE_URL at it,
 * and these run live; otherwise they skip.
 */

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import * as dotenv from "dotenv";
import { Client, EncryptedIndex } from "../index";

dotenv.config({ path: ".env.local" });
jest.setTimeout(120000);

// The e2e nightly sets CYBORGDB_URL; the KMS BYOK suite uses
// CYBORGDB_BASE_URL. Accept either so this runs unchanged in both places.
const BASE_URL =
	process.env.CYBORGDB_URL ||
	process.env.CYBORGDB_BASE_URL ||
	"http://localhost:8000";
const ROOT_API_KEY = process.env.CYBORGDB_ROOT_API_KEY;
const KMS_NAME = process.env.CYBORGDB_KMS_NAME;

const DIMENSION = 4;

const seed = () => [
	{ id: "a", vector: [0.1, 0.2, 0.3, 0.4] },
	{ id: "b", vector: [0.9, 0.8, 0.7, 0.6] },
];

const describeIfRbac =
	ROOT_API_KEY && KMS_NAME ? describe : describe.skip;

describeIfRbac("CyborgDB RBAC — user management", () => {
	let root: Client;
	let index: EncryptedIndex;
	let indexName: string;

	const userIndex = async (apiKey: string): Promise<EncryptedIndex> => {
		// Load this index as a user (no indexKey — service resolves it).
		const userClient = new Client({
			baseUrl: BASE_URL,
			apiKey,
			verifySsl: false,
		});
		return await userClient.loadIndex({ indexName });
	};

	beforeAll(async () => {
		root = new Client({
			baseUrl: BASE_URL,
			apiKey: ROOT_API_KEY,
			verifySsl: false,
		});
		indexName = `rbac_users_test_${Date.now().toString(36)}`;
		// KMS-backed so user keys can resolve the index KEK server-side.
		index = (await root.createIndex({
			indexName,
			kmsName: KMS_NAME,
			dimension: DIMENSION,
		})) as EncryptedIndex;
		await index.upsert({ items: seed() });
	});

	afterAll(async () => {
		try {
			if (index) await index.deleteIndex();
		} catch {
			/* ignore */
		}
	});

	it("create returns key and id", async () => {
		const out = await index.createUser({ permissions: ["read"] });
		expect(out.apiKey).toBeDefined();
		expect(out.userId).toBeDefined();
		expect(out.apiKey.startsWith("cdbk_")).toBe(true);
		// Cleanup so list assertions elsewhere stay deterministic.
		await index.deleteUser({ userId: out.userId });
	});

	it("read-only user can query but not write", async () => {
		const out = await index.createUser({ permissions: ["read"] });
		try {
			const reader = await userIndex(out.apiKey);
			// read op succeeds
			const results = await reader.query({
				queryVectors: [0.1, 0.2, 0.3, 0.4],
				topK: 1,
			});
			expect(Array.isArray(results.results)).toBe(true);
			expect((results.results as unknown[]).length).toBeGreaterThanOrEqual(1);
			// write op is cryptographically denied
			await expect(
				reader.upsert({
					items: [{ id: "z", vector: [0.0, 0.0, 0.0, 1.0] }],
				}),
			).rejects.toThrow();
		} finally {
			await index.deleteUser({ userId: out.userId });
		}
	});

	it("read+write user can do both", async () => {
		const out = await index.createUser({ permissions: ["read", "write"] });
		try {
			const writer = await userIndex(out.apiKey);
			await writer.upsert({
				items: [{ id: "w", vector: [0.0, 0.0, 0.0, 1.0] }],
			});
			const results = await writer.query({
				queryVectors: [0.0, 0.0, 0.0, 1.0],
				topK: 1,
			});
			expect(Array.isArray(results.results)).toBe(true);
			expect((results.results as unknown[]).length).toBeGreaterThanOrEqual(1);
		} finally {
			await index.deleteUser({ userId: out.userId });
		}
	});

	it("list then revoke", async () => {
		const out = await index.createUser({ permissions: ["read", "write"] });

		const users = await index.listUsers();
		expect(users.map((u) => u.userId)).toContain(out.userId);
		const listed = users.find((u) => u.userId === out.userId);
		expect(listed).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: guarded by expect above
		expect([...listed!.permissions].sort()).toEqual(["read", "write"]);

		// Revoke; the key must stop working on the next request.
		await index.deleteUser({ userId: out.userId });
		const after = await index.listUsers();
		expect(after.map((u) => u.userId)).not.toContain(out.userId);

		const revoked = await userIndex(out.apiKey);
		await expect(
			revoked.query({ queryVectors: [0.1, 0.2, 0.3, 0.4], topK: 1 }),
		).rejects.toThrow();
	});
});
