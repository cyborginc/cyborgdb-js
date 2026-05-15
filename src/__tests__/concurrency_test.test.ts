/**
 * Concurrency and Multi-Index Tests for CyborgDB JS SDK
 *
 * Tests thread safety, data integrity under concurrent load, and index isolation.
 * All tests hit a real backend — no mocking. Each test is fully isolated: creates
 * its own client, indexes, and data, then cleans up.
 *
 * Test inventory and what each catches:
 *
 *   - ConcurrentUpsertsNoDataLoss: Dropped writes / request body corruption
 *     in shared HTTP client under concurrent Promise.all.
 *
 *   - ConcurrentUpsertsOverlappingIDs: Byte-level vector corruption from
 *     interleaved writes to the same keys.
 *
 *   - QueriesDuringUpserts: Malformed responses or crashes from concurrent
 *     read/write HTTP access through shared connection pool.
 *
 *   - DeletesDuringQueries: Server-side race between delete and read paths
 *     causing crashes or garbled results.
 *
 *   - ConcurrentUpsertsAndDeletesOnSameIDs: Ghost entries or partial state
 *     from write-delete races on identical keys.
 *
 *   - BadWorkerDoesntBreakGoodWorkers: Error responses poisoning shared
 *     HTTP connection pool state.
 *
 *   - NoDataLeakageBetweenIndexes: Cross-index contamination from incorrect
 *     index_name routing in query requests.
 *
 *   - DeleteInOneIndexDoesntAffectOthers: Cross-index contamination from
 *     incorrect index_name routing in delete requests (write-path isolation).
 *
 *   - ConcurrentWritesToDifferentIndexes: index_name mix-up in request
 *     serialization when concurrent workers target different indexes through
 *     the same shared Client.
 *
 *   - Stress20Workers200VectorsEach: Connection pool exhaustion, deadlocks,
 *     and performance cliffs under high concurrency (20 workers, 4,000 vectors).
 */

import { Client, EncryptedIndex } from '../index';
import { flattenResults } from './test-helpers';
import { randomBytes, randomUUID } from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const DIMENSION = 128;
const NUM_VECTORS = 50;
const BASE_URL = process.env.CYBORGDB_BASE_URL || 'http://localhost:8000';
const API_KEY = process.env.CYBORGDB_API_KEY || '';

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(): Client {
  return new Client({ baseUrl: BASE_URL, apiKey: API_KEY, verifySsl: false });
}

function generateUniqueName(prefix = 'conc'): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

function generateRandomKey(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

function generateRandomVectors(count: number, dimension: number): number[][] {
  return Array.from({ length: count }, () =>
    Array.from({ length: dimension }, () => Math.random())
  );
}

async function makeIndex(
  client: Client,
  prefix = 'conc'
): Promise<{ index: EncryptedIndex; name: string; key: Uint8Array }> {
  const name = generateUniqueName(prefix);
  const key = generateRandomKey();
  const index = await client.createIndex({
    indexName: name,
    indexKey: key,
    dimension: DIMENSION,
    metric: 'euclidean',
  });
  return { index, name, key };
}

async function upsertBatch(
  index: EncryptedIndex,
  idPrefix: string,
  count = NUM_VECTORS
): Promise<{ ids: string[]; vectors: number[][] }> {
  const vectors = generateRandomVectors(count, DIMENSION);
  const ids = Array.from({ length: count }, (_, i) => `${idPrefix}_${i}`);
  await index.upsert({
    ids,
    vectors,
  });
  return { ids, vectors };
}

/**
 * Check whether two vectors are element-wise equal within a relative tolerance.
 * @param a - First vector.
 * @param b - Second vector (must be same length as `a`).
 * @param rtol - Maximum allowed relative difference per element (default 1e-5).
 * @returns `true` if every pair of elements satisfies |a[i] - b[i]| <= rtol * max(|a[i]|, |b[i]|) + 1e-8.
 */
function vectorsApproxEqual(a: number[], b: number[], rtol = 1e-5): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const diff = Math.abs(a[i] - b[i]);
    const limit = rtol * Math.max(Math.abs(a[i]), Math.abs(b[i]));
    if (diff > limit + 1e-8) return false;
  }
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll `condition` every `intervalMs` until it returns true or `timeoutMs` elapses. */
async function waitUntil(
  condition: () => Promise<boolean>,
  timeoutMs = 10_000,
  intervalMs = 250,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await sleep(intervalMs);
  }
  throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Concurrent Operations — Single Index
// ---------------------------------------------------------------------------

describe('ConcurrentUpserts', () => {
  let client: Client;
  let index: EncryptedIndex;

  beforeAll(async () => {
    client = makeClient();
    ({ index } = await makeIndex(client, 'conc_upsert'));
  });

  afterAll(async () => {
    try { await index.deleteIndex(); } catch { /* cleanup */ }
  });

  test('concurrent upserts no data loss', async () => {
    // 10 workers each upsert 50 vectors (500 total) through one shared
    // EncryptedIndex. After all finish, every single ID must be present.
    const numWorkers = 10;
    const allIds: string[] = [];
    const errors: Error[] = [];

    const workers = Array.from({ length: numWorkers }, async (_, i) => {
      try {
        const { ids } = await upsertBatch(index, `t${i}`);
        allIds.push(...ids);
      } catch (e: any) {
        errors.push(e);
      }
    });

    await Promise.all(workers);
    expect(errors).toEqual([]);

    await waitUntil(async () => {
      const { ids } = await index.listIds();
      return ids.length >= allIds.length;
    });

    const { ids: storedIds } = await index.listIds();
    const storedSet = new Set(storedIds);
    const missing = allIds.filter((id) => !storedSet.has(id));
    expect(missing.length).toBe(0);
  });

  test('concurrent upserts overlapping IDs', async () => {
    // 5 workers upsert different vectors to the SAME 20 IDs.
    // After completion: each ID must exist, and the stored vector must
    // exactly match one of the 5 written vectors (no corruption).
    const numIDs = 20;
    const numWorkers = 5;
    const sharedIDs = Array.from({ length: numIDs }, (_, i) => `overlap_${i}`);
    const writtenVectors: Record<string, number[][]> = {};
    for (const id of sharedIDs) writtenVectors[id] = [];
    const errors: Error[] = [];

    const workers = Array.from({ length: numWorkers }, async () => {
      try {
        const vectors = generateRandomVectors(numIDs, DIMENSION);
        for (let i = 0; i < numIDs; i++) {
          writtenVectors[sharedIDs[i]].push([...vectors[i]]);
        }
        await index.upsert({ ids: sharedIDs, vectors });
      } catch (e: any) {
        errors.push(e);
      }
    });

    await Promise.all(workers);
    expect(errors).toEqual([]);

    await waitUntil(async () => {
      const { ids } = await index.listIds();
      return sharedIDs.every((id) => ids.includes(id));
    });

    const items = await index.get({ ids: sharedIDs, include: ['vector'] });
    expect(items.length).toBe(numIDs);
    for (const item of items) {
      const candidates = writtenVectors[item.id];
      const storedVec = item.vector as number[];
      const matched = candidates.some((c) => vectorsApproxEqual(storedVec, c));
      expect(matched).toBe(true);
    }
  });

});

// ---------------------------------------------------------------------------
// Concurrent Reads and Writes
// ---------------------------------------------------------------------------

describe('ConcurrentReadsAndWrites', () => {
  let client: Client;
  let index: EncryptedIndex;

  beforeAll(async () => {
    client = makeClient();
    ({ index } = await makeIndex(client, 'conc_rw'));
    await upsertBatch(index, 'seed', 100);
    await waitUntil(async () => {
      const { ids } = await index.listIds();
      return ids.length >= 100;
    });
  });

  afterAll(async () => {
    try { await index.deleteIndex(); } catch { /* cleanup */ }
  });

  test('queries during upserts', async () => {
    // 3 writer workers upsert while 5 reader workers query concurrently.
    // Readers must get well-formed results with valid distances.
    const numWriters = 3;
    const numReaders = 5;
    const queryCount = 10;
    const errors: Array<[string, number, Error]> = [];

    const writers = Array.from({ length: numWriters }, async (_, w) => {
      try {
        for (let batch = 0; batch < 3; batch++) {
          await upsertBatch(index, `w${w}_b${batch}`, 20);
        }
      } catch (e: any) {
        errors.push(['writer', w, e]);
      }
    });

    const readers = Array.from({ length: numReaders }, async (_, r) => {
      try {
        for (let q = 0; q < queryCount; q++) {
          const qv = generateRandomVectors(1, DIMENSION)[0];
          const response = await index.query({ queryVectors: qv, topK: 5, include: ['distance'] });
          const items = flattenResults(response.results);
          for (const item of items) {
            expect(item.id).toBeTruthy();
            expect(typeof item.distance === 'number').toBe(true);
            expect(item.distance!).toBeGreaterThanOrEqual(0);
          }
        }
      } catch (e: any) {
        errors.push(['reader', r, e]);
      }
    });

    await Promise.all([...writers, ...readers]);
    expect(errors).toEqual([]);
  });

  test('deletes during queries', async () => {
    // One worker deletes vectors in batches while 4 workers query.
    // Queries must never crash or return malformed results.
    const deleteCount = 30;
    const deleteIDs = Array.from({ length: deleteCount }, (_, i) => `del_${i}`);
    const deleteVectors = generateRandomVectors(deleteCount, DIMENSION);
    await index.upsert({ ids: deleteIDs, vectors: deleteVectors });
    await waitUntil(async () => {
      const { ids } = await index.listIds();
      return deleteIDs.every((id) => ids.includes(id));
    });

    const errors: Array<[string, any, Error]> = [];

    const deleter = (async () => {
      try {
        for (let i = 0; i < deleteCount; i += 5) {
          const batch = deleteIDs.slice(i, i + 5);
          await index.delete({ ids: batch });
          await sleep(100);
        }
      } catch (e: any) {
        errors.push(['deleter', 0, e]);
      }
    })();

    const queriers = Array.from({ length: 4 }, async (_, q) => {
      try {
        for (let i = 0; i < 15; i++) {
          const qv = generateRandomVectors(1, DIMENSION)[0];
          const response = await index.query({ queryVectors: qv, topK: 10, include: ['distance'] });
          const items = flattenResults(response.results);
          for (const item of items) {
            expect(item.id).toBeTruthy();
            expect(typeof item.distance === 'number').toBe(true);
            expect(item.distance!).toBeGreaterThanOrEqual(0);
          }
        }
      } catch (e: any) {
        errors.push(['querier', q, e]);
      }
    });

    await Promise.all([deleter, ...queriers]);
    expect(errors).toEqual([]);
  });

  test('concurrent upserts and deletes on same IDs', async () => {
    // 2 workers upsert a set of IDs while 2 other workers delete from
    // the same set. After all finish, every surviving ID must have a valid
    // vector — no ghost entries or truncated state.
    const targetCount = 40;
    const targetIDs = Array.from({ length: targetCount }, (_, i) => `race_${i}`);
    const vectors = generateRandomVectors(targetCount, DIMENSION);
    await index.upsert({ ids: targetIDs, vectors });
    await waitUntil(async () => {
      const { ids } = await index.listIds();
      return targetIDs.every((id) => ids.includes(id));
    });

    const errors: Array<[string, number, Error]> = [];

    const upserters = Array.from({ length: 2 }, async (_, u) => {
      try {
        for (let round = 0; round < 5; round++) {
          const newVecs = generateRandomVectors(targetCount, DIMENSION);
          await index.upsert({ ids: targetIDs, vectors: newVecs });
        }
      } catch (e: any) {
        errors.push(['upserter', u, e]);
      }
    });

    const deleters = Array.from({ length: 2 }, async (_, d) => {
      try {
        for (let round = 0; round < 5; round++) {
          const batch = targetIDs.slice(d * 10, (d + 1) * 10);
          await index.delete({ ids: batch });
          await sleep(50);
        }
      } catch (e: any) {
        errors.push(['deleter', d, e]);
      }
    });

    await Promise.all([...upserters, ...deleters]);
    expect(errors).toEqual([]);

    await waitUntil(async () => {
      const { ids } = await index.listIds();
      return ids.length > 0;
    });

    const { ids: storedIds } = await index.listIds();
    expect(storedIds.length).toBeGreaterThan(0);

    // Every surviving ID must have a valid, retrievable vector
    const getResp = await index.get({ ids: storedIds, include: ['vector'] });
    for (const item of getResp) {
      const vec = item.vector as number[] | undefined;
      expect(vec).toBeDefined();
      expect(vec!.length).toBe(DIMENSION);
    }
  });
});

// ---------------------------------------------------------------------------
// Error Isolation Under Load
// ---------------------------------------------------------------------------

describe('ErrorIsolationUnderLoad', () => {
  let client: Client;
  let index: EncryptedIndex;

  beforeAll(async () => {
    client = makeClient();
    ({ index } = await makeIndex(client, 'conc_errisolation'));
    await upsertBatch(index, 'base', 50);
    await waitUntil(async () => {
      const { ids } = await index.listIds();
      return ids.length >= 50;
    });
  });

  afterAll(async () => {
    try { await index.deleteIndex(); } catch { /* cleanup */ }
  });

  test('bad worker doesnt break good workers', async () => {
    // One worker sends wrong-dimension vectors (expects errors).
    // 4 other workers do valid queries through the same shared client.
    // Good workers must succeed — proving error handling doesn't poison
    // shared HTTP connection pool state.
    const goodResults: number[] = [];
    const badErrors: Error[] = [];
    const goodErrors: Error[] = [];

    const badWorker = (async () => {
      for (let i = 0; i < 5; i++) {
        try {
          const wrongDimVecs = generateRandomVectors(10, 64); // Wrong dimension
          const ids = Array.from({ length: 10 }, (_, j) => `bad_${i}_${j}`);
          await index.upsert({ ids, vectors: wrongDimVecs });
        } catch (e: any) {
          badErrors.push(e);
        }
      }
    })();

    const goodWorkers = Array.from({ length: 4 }, async (_, g) => {
      try {
        for (let q = 0; q < 10; q++) {
          const qv = generateRandomVectors(1, DIMENSION)[0];
          const response = await index.query({ queryVectors: qv, topK: 3 });
          const items = flattenResults(response.results);
          goodResults.push(items.length);
        }
      } catch (e: any) {
        goodErrors.push(e);
      }
    });

    await Promise.all([badWorker, ...goodWorkers]);

    expect(badErrors.length).toBeGreaterThan(0);
    expect(goodErrors).toEqual([]);
    expect(goodResults.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Multi-Index Tests
// ---------------------------------------------------------------------------

describe('MultiIndexIsolation', () => {
  let client: Client;
  let indexes: Array<{ index: EncryptedIndex; name: string; key: Uint8Array }>;
  let indexData: Record<string, Set<string>>;

  beforeAll(async () => {
    client = makeClient();
    indexes = [];
    indexData = {};

    for (let i = 0; i < 3; i++) {
      const { index, name, key } = await makeIndex(client, `iso_${i}`);
      const ids = Array.from({ length: 30 }, (_, j) => `idx${i}_vec${j}`);
      const vectors = generateRandomVectors(30, DIMENSION);
      await index.upsert({ ids, vectors });
      indexes.push({ index, name, key });
      indexData[name] = new Set(ids);
    }

    await waitUntil(async () => {
      for (const { index } of indexes) {
        const { ids } = await index.listIds();
        if (ids.length < 30) return false;
      }
      return true;
    });
  });

  afterAll(async () => {
    for (const { index } of indexes) {
      try { await index.deleteIndex(); } catch { /* cleanup */ }
    }
  });

  test('no data leakage between indexes', async () => {
    // Query each index and verify every returned ID belongs ONLY to that index.
    for (const { index, name } of indexes) {
      const myIds = indexData[name];
      const otherIds = new Set<string>();
      for (const [otherName, otherIdSet] of Object.entries(indexData)) {
        if (otherName !== name) {
          Array.from(otherIdSet).forEach((id) => otherIds.add(id));
        }
      }

      for (let q = 0; q < 5; q++) {
        const qv = generateRandomVectors(1, DIMENSION)[0];
        const response = await index.query({ queryVectors: qv, topK: 10 });
        const items = flattenResults(response.results);
        expect(items.length).toBeGreaterThan(0);
        for (const item of items) {
          expect(myIds.has(item.id)).toBe(true);
          expect(otherIds.has(item.id)).toBe(false);
        }
      }
    }
  });

  test('delete in one index doesnt affect others', async () => {
    // Deleting from index 0 must not remove anything from indexes 1 or 2.
    const otherSnapshots: Record<number, Set<string>> = {};
    for (let i = 1; i < indexes.length; i++) {
      const { ids } = await indexes[i].index.listIds();
      otherSnapshots[i] = new Set(ids);
    }

    const { ids: targetIds } = await indexes[0].index.listIds();
    expect(targetIds.length).toBeGreaterThan(0);
    const toDelete = targetIds.slice(0, Math.min(15, targetIds.length));
    await indexes[0].index.delete({ ids: toDelete });
    await waitUntil(async () => {
      const { ids } = await indexes[0].index.listIds();
      return toDelete.every((id) => !ids.includes(id));
    });

    for (let i = 1; i < indexes.length; i++) {
      const { ids: currentIds } = await indexes[i].index.listIds();
      const currentSet = new Set(currentIds);
      const snapshot = otherSnapshots[i];

      Array.from(snapshot).forEach((id) => {
        expect(currentSet.has(id)).toBe(true);
      });
      Array.from(currentSet).forEach((id) => {
        expect(snapshot.has(id)).toBe(true);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Concurrent Multi-Index Writes
// ---------------------------------------------------------------------------

describe('ConcurrentMultiIndexWrites', () => {
  let client: Client;
  let indexes: Array<{ index: EncryptedIndex; name: string; key: Uint8Array }>;
  const numIndexes = 5;

  beforeAll(async () => {
    client = makeClient();
    indexes = [];
    for (let i = 0; i < numIndexes; i++) {
      const info = await makeIndex(client, `cw_${i}`);
      indexes.push(info);
    }
  });

  afterAll(async () => {
    for (const { index } of indexes) {
      try { await index.deleteIndex(); } catch { /* cleanup */ }
    }
  });

  test('concurrent writes to different indexes', async () => {
    // 5 workers, each writing to its own pre-existing index via the same
    // shared Client. Then verify each index has ONLY its own data with
    // correct vectors.
    const errors: Array<[number, Error]> = [];
    const perWorkerData: Record<number, { ids: string[]; vectors: number[][]; name: string }> = {};

    const workers = Array.from({ length: numIndexes }, async (_, i) => {
      try {
        const { index, name } = indexes[i];
        const vectors = generateRandomVectors(20, DIMENSION);
        const ids = Array.from({ length: 20 }, (_, j) => `cw${i}_${j}`);
        await index.upsert({ ids, vectors });
        perWorkerData[i] = { ids, vectors, name };
      } catch (e: any) {
        errors.push([i, e]);
      }
    });

    await Promise.all(workers);
    expect(errors).toEqual([]);

    await waitUntil(async () => {
      for (let i = 0; i < numIndexes; i++) {
        const { ids } = await indexes[i].index.listIds();
        if (ids.length < 20) return false;
      }
      return true;
    });

    // Verify: each index has ONLY its own data, and vectors are intact
    for (const [gIDStr, data] of Object.entries(perWorkerData)) {
      const gID = Number(gIDStr);
      const { index } = indexes[gID];
      const { ids: storedIds } = await index.listIds();
      const storedSet = new Set(storedIds);
      const expectedPrefix = `cw${gID}_`;

      for (const id of storedIds) {
        expect(id.startsWith(expectedPrefix)).toBe(true);
      }
      for (const id of data.ids) {
        expect(storedSet.has(id)).toBe(true);
      }

      // Spot-check vector integrity: first and last vector
      for (const checkIdx of [0, data.ids.length - 1]) {
        const retrieved = await index.get({ ids: [data.ids[checkIdx]], include: ['vector'] });
        expect(retrieved.length).toBe(1);
        const retrievedVec = retrieved[0].vector as number[];
        expect(vectorsApproxEqual(retrievedVec, data.vectors[checkIdx])).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Scale & Stress
// ---------------------------------------------------------------------------

describe('StressHighConcurrency', () => {
  let client: Client;
  let index: EncryptedIndex;

  beforeAll(async () => {
    client = makeClient();
    ({ index } = await makeIndex(client, 'stress'));
  });

  afterAll(async () => {
    try { await index.deleteIndex(); } catch { /* cleanup */ }
  });

  test('20 workers 200 vectors each', async () => {
    // 20 workers each upsert 200 vectors (4,000 total) then query.
    // All queries must return well-formed results, all IDs must be stored.
    const numWorkers = 20;
    const vectorsPerWorker = 200;
    const allIds: string[] = [];
    const errors: Error[] = [];

    const workers = Array.from({ length: numWorkers }, async (_, g) => {
      try {
        const { ids } = await upsertBatch(index, `stress_${g}`, vectorsPerWorker);
        allIds.push(...ids);

        // Each worker also queries to validate responses under load
        for (let q = 0; q < 5; q++) {
          const qv = generateRandomVectors(1, DIMENSION)[0];
          const response = await index.query({ queryVectors: qv, topK: 10, include: ['distance'] });
          const items = flattenResults(response.results);
          for (const item of items) {
            expect(item.id).toBeTruthy();
            expect(typeof item.distance === 'number').toBe(true);
            expect(item.distance!).toBeGreaterThanOrEqual(0);
          }
        }
      } catch (e: any) {
        errors.push(e);
      }
    });

    await Promise.all(workers);
    expect(errors).toEqual([]);

    await waitUntil(async () => {
      const { ids } = await index.listIds();
      return ids.length >= allIds.length;
    }, 15_000);

    const { ids: storedIds } = await index.listIds();
    const storedSet = new Set(storedIds);
    const missing = allIds.filter((id) => !storedSet.has(id));
    expect(missing.length).toBe(0);
  });
});
