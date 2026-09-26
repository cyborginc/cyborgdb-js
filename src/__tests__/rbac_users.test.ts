/**
 * RBAC user-management integration tests for the CyborgDB TypeScript SDK.
 *
 * These exercise the user-key lifecycle the service exposes when it runs
 * with `CYBORGDB_SERVICE_ROOT_KEY` set (RBAC enabled, see the service's
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
 *   - CYBORGDB_SERVICE_ROOT_KEY — the service's admin key (RBAC must be
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
import { Client, CyborgDBError, type EncryptedIndex } from "../index";

dotenv.config({ path: ".env.local" });
jest.setTimeout(120000);

// The e2e nightly sets CYBORGDB_URL; the KMS BYOK suite uses
// CYBORGDB_BASE_URL. Accept either so this runs unchanged in both places.
const BASE_URL =
	process.env.CYBORGDB_URL ||
	process.env.CYBORGDB_BASE_URL ||
	"http://localhost:8000";
const ROOT_API_KEY = process.env.CYBORGDB_SERVICE_ROOT_KEY;
// The e2e nightly's RBAC step exports the slot as CYBORGDB_KMS_NAME_REAL; accept
// the plain CYBORGDB_KMS_NAME too so this runs unchanged in either setup.
const KMS_NAME =
	process.env.CYBORGDB_KMS_NAME || process.env.CYBORGDB_KMS_NAME_REAL;

const DIMENSION = 4;

const seed = () => [
	{ id: "a", vector: [0.1, 0.2, 0.3, 0.4] },
	{ id: "b", vector: [0.9, 0.8, 0.7, 0.6] },
];

const describeIfRbac = ROOT_API_KEY && KMS_NAME ? describe : describe.skip;

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

		// Revoke; the key must stop working immediately. Revocation drops the
		// user's wrapped DEK, so even loading the index (which describes it,
		// gated by the user-wrap check) is denied — hence load or query may
		// throw. Matches test_list_then_revoke (py) / TestRBACListThenRevoke (go).
		await index.deleteUser({ userId: out.userId });
		const after = await index.listUsers();
		expect(after.map((u) => u.userId)).not.toContain(out.userId);

		await expect(
			(async () => {
				const revoked = await userIndex(out.apiKey);
				await revoked.query({ queryVectors: [0.1, 0.2, 0.3, 0.4], topK: 1 });
			})(),
		).rejects.toThrow();
	});

	it("read-only user is listed with read permission", async () => {
		const out = await index.createUser({ permissions: ["read"] });
		try {
			const users = await index.listUsers();
			const listed = users.find((u) => u.userId === out.userId);
			expect(listed).toBeDefined();
			// biome-ignore lint/style/noNonNullAssertion: guarded by expect above
			expect(listed!.permissions).toEqual(["read"]);
		} finally {
			await index.deleteUser({ userId: out.userId });
		}
	});

	it("write-only user can write but not query", async () => {
		const out = await index.createUser({ permissions: ["write"] });
		try {
			const writer = await userIndex(out.apiKey);
			// write op succeeds
			await writer.upsert({
				items: [{ id: "wo", vector: [0.0, 0.0, 1.0, 0.0] }],
			});
			// read op is cryptographically denied — no read DEK for this user
			await expect(
				writer.query({ queryVectors: [0.0, 0.0, 1.0, 0.0], topK: 1 }),
			).rejects.toThrow();
		} finally {
			await index.deleteUser({ userId: out.userId });
		}
	});

	it("invalid permissions rejected", async () => {
		// The grant must be a non-empty subset of {"read","write"}; the service
		// rejects an empty set and unknown permission names alike.
		await expect(index.createUser({ permissions: [] })).rejects.toThrow();
		await expect(
			index.createUser({ permissions: ["admin"] }),
		).rejects.toThrow();
	});

	it("non-root user cannot manage users", async () => {
		const out = await index.createUser({ permissions: ["read", "write"] });
		try {
			const userIdx = await userIndex(out.apiKey);
			// Minting, listing, and revoking users are root-only operations;
			// a user key is rejected on each.
			await expect(
				userIdx.createUser({ permissions: ["read"] }),
			).rejects.toThrow();
			await expect(userIdx.listUsers()).rejects.toThrow();
			await expect(
				userIdx.deleteUser({ userId: out.userId }),
			).rejects.toThrow();
		} finally {
			await index.deleteUser({ userId: out.userId });
		}
	});

	it("revoking one user leaves another working", async () => {
		const first = await index.createUser({ permissions: ["read"] });
		const second = await index.createUser({ permissions: ["read"] });
		try {
			// Revoking one user drops only that user's wrapped keys; the other
			// user's key keeps resolving the index.
			await index.deleteUser({ userId: first.userId });
			const survivor = await userIndex(second.apiKey);
			const results = await survivor.query({
				queryVectors: [0.1, 0.2, 0.3, 0.4],
				topK: 1,
			});
			expect(Array.isArray(results.results)).toBe(true);
			expect((results.results as unknown[]).length).toBeGreaterThanOrEqual(1);
		} finally {
			for (const u of [first, second]) {
				try {
					await index.deleteUser({ userId: u.userId });
				} catch {
					/* already revoked */
				}
			}
		}
	});
	it("denials are catchable with one clause", async () => {
		// Regression guard for cyborgdb-core#2398: the paths still raise
		// different types (query denies, loadIndex 404s), but both derive from
		// CyborgDBError so a caller needs only one catch.
		const out = await index.createUser({ permissions: ["read"] });
		const revoked = await userIndex(out.apiKey);
		await index.deleteUser({ userId: out.userId });

		await expect(
			revoked.query({ queryVectors: [0.1, 0.2, 0.3, 0.4], topK: 1 }),
		).rejects.toBeInstanceOf(CyborgDBError);
		await expect(
			(async () => {
				const reloaded = await userIndex(out.apiKey);
				return reloaded.query({ queryVectors: [0.1, 0.2, 0.3, 0.4], topK: 1 });
			})(),
		).rejects.toBeInstanceOf(CyborgDBError);
	});

	it("revoking after use denies a previously working key", async () => {
		// The other revocation tests revoke a key that was never used, which
		// passes trivially. This one uses the key first.
		const out = await index.createUser({ permissions: ["read"] });
		const userIdx = await userIndex(out.apiKey);

		const before = await userIdx.query({
			queryVectors: [0.1, 0.2, 0.3, 0.4],
			topK: 1,
		});
		expect((before.results as unknown[]).length).toBeGreaterThanOrEqual(1);

		await index.deleteUser({ userId: out.userId });

		// A server-side cache outliving the revocation would surface here.
		await expect(
			userIdx.query({ queryVectors: [0.1, 0.2, 0.3, 0.4], topK: 1 }),
		).rejects.toThrow();
		await expect(
			(async () => {
				const reloaded = await userIndex(out.apiKey);
				return reloaded.query({ queryVectors: [0.1, 0.2, 0.3, 0.4], topK: 1 });
			})(),
		).rejects.toThrow();
	});

	it("a user key cannot reach another index", async () => {
		const otherName = `rbac_other_${Date.now().toString(36)}`;
		const other = (await root.createIndex({
			indexName: otherName,
			kmsName: KMS_NAME,
			dimension: DIMENSION,
		})) as EncryptedIndex;
		await other.upsert({ items: seed() });
		const out = await index.createUser({ permissions: ["read", "write"] });
		try {
			const intruder = new Client({
				baseUrl: BASE_URL,
				apiKey: out.apiKey,
				verifySsl: false,
			});
			// Cross-tenant data access must be denied on every path.
			await expect(
				(async () => {
					const foreign = await intruder.loadIndex({ indexName: otherName });
					return foreign.query({ queryVectors: [0.1, 0.2, 0.3, 0.4], topK: 1 });
				})(),
			).rejects.toThrow();
			await expect(
				(async () => {
					const foreign = await intruder.loadIndex({ indexName: otherName });
					return foreign.upsert({
						items: [{ id: "x", vector: [0.0, 0.0, 0.0, 1.0] }],
					});
				})(),
			).rejects.toThrow();
			await expect(
				(async () => {
					const foreign = await intruder.loadIndex({ indexName: otherName });
					return foreign.get({ ids: ["a"] });
				})(),
			).rejects.toThrow();
		} finally {
			await index.deleteUser({ userId: out.userId });
			try {
				await other.deleteIndex();
			} catch {
				/* ignore */
			}
		}
	});

	it("listIndexes under a user key is scoped or denied", async () => {
		// SECURITY BUG — fails today. cyborgdb-core#2397: a tenant-scoped key
		// enumerates every index in the deployment. Data access is correctly
		// denied (see the test above), so this discloses index names rather
		// than contents.
		const otherName = `rbac_hidden_${Date.now().toString(36)}`;
		const other = (await root.createIndex({
			indexName: otherName,
			kmsName: KMS_NAME,
			dimension: DIMENSION,
		})) as EncryptedIndex;
		const out = await index.createUser({ permissions: ["read"] });
		try {
			const userClient = new Client({
				baseUrl: BASE_URL,
				apiKey: out.apiKey,
				verifySsl: false,
			});
			let listed: string[];
			try {
				listed = await userClient.listIndexes();
			} catch {
				return; // refusing outright is an acceptable contract
			}
			expect(listed).not.toContain(otherName);
			// Nothing beyond this tenant's own index may appear.
			expect(listed.filter((n) => n !== indexName)).toEqual([]);
		} finally {
			await index.deleteUser({ userId: out.userId });
			try {
				await other.deleteIndex();
			} catch {
				/* ignore */
			}
		}
	});
});
