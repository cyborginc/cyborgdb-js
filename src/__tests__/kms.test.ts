/**
 * KMS-backed key management tests.
 *
 * The service supports three modes for index encryption keys:
 *   1. Legacy / SDK-managed: client provides `indexKey`. Covered by api_contract.test.ts.
 *   2. KMS-tracked + SDK-supplied KEK: `kmsName` references a registry entry
 *      whose provider is `none`; client also supplies `indexKey`.
 *   3. KMS-fully-managed: `kmsName` references a real KMS provider; service
 *      generates and wraps the KEK internally. Client does NOT supply `indexKey`.
 *
 * These tests are opt-in via env vars because they require the cyborgdb-service
 * to be configured with specific kms.registry entries:
 *   - CYBORGDB_KMS_NAME_REAL — name of a registry entry with provider `aws-kms`
 *     (HSM-backed). Exercises mode 3 against the AWS KMS path.
 *   - CYBORGDB_KMS_NAME_SM   — name of a registry entry with provider `aws`
 *     (Secrets Manager). Exercises mode 3 against the Secrets Manager path.
 *   - CYBORGDB_KMS_NAME_NONE — name of a registry entry with `provider: none`.
 *     Exercises mode 2.
 *
 * Each suite is gated independently; missing env vars skip just their suite.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from '../index';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
jest.setTimeout(120000);

const BASE_URL = process.env.CYBORGDB_BASE_URL || 'http://localhost:8000';
const API_KEY = process.env.CYBORGDB_API_KEY;
const KMS_REAL = process.env.CYBORGDB_KMS_NAME_REAL;
const KMS_SM = process.env.CYBORGDB_KMS_NAME_SM;
const KMS_NONE = process.env.CYBORGDB_KMS_NAME_NONE;

const dimension = 128;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function makeVectors(n: number, d: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const v: number[] = [];
    for (let j = 0; j < d; j++) v.push(Math.random());
    out.push(v);
  }
  return out;
}

const describeIfConfigured = API_KEY ? describe : describe.skip;

describeIfConfigured('CyborgDB KMS — mode 3 (fully KMS-managed via aws-kms / HSM)', () => {
  if (!KMS_REAL) {
    it.skip('skipped: CYBORGDB_KMS_NAME_REAL not set', () => undefined);
    return;
  }

  let client: Client;
  let indexName: string;
  let index: any;

  beforeAll(() => {
    client = new Client({ baseUrl: BASE_URL, apiKey: API_KEY!, verifySsl: false });
    indexName = `kms_real_${Date.now().toString(36)}`;
  });

  afterAll(async () => {
    try { if (index) await index.deleteIndex(); } catch (e) { /* ignore */ }
  });

  it('creates an index with kmsName and no indexKey', async () => {
    index = await client.createIndex({
      indexName,
      kmsName: KMS_REAL,
      indexConfig: { dimension, type: 'ivfflat' }
    });
    expect(index).toBeDefined();
    expect(await index.getIndexName()).toBe(indexName);
  });

  it('appears in listIndexes', async () => {
    const names = await client.listIndexes();
    expect(names).toContain(indexName);
  });

  it('upserts and queries without an SDK-side key', async () => {
    const vectors = makeVectors(5, dimension);
    const items = vectors.map((v, i) => ({ id: `kms_${i}`, vector: v }));

    const upsertResult = await index.upsert({ items });
    expect(upsertResult.status).toBe('success');
    await sleep(1000);

    const response = await index.query({ queryVectors: vectors[0], topK: 3 });
    expect(response).toBeDefined();
    expect(response.results).toBeDefined();
  });

  it('loadIndex resolves the KEK from the KMS cache (no indexKey needed)', async () => {
    const reloaded = await client.loadIndex({ indexName });
    expect(await reloaded.getIndexName()).toBe(indexName);
  });
});

describeIfConfigured('CyborgDB KMS — mode 3 (fully KMS-managed via aws / Secrets Manager)', () => {
  if (!KMS_SM) {
    it.skip('skipped: CYBORGDB_KMS_NAME_SM not set', () => undefined);
    return;
  }

  let client: Client;
  let indexName: string;
  let index: any;

  beforeAll(() => {
    client = new Client({ baseUrl: BASE_URL, apiKey: API_KEY!, verifySsl: false });
    indexName = `kms_sm_${Date.now().toString(36)}`;
  });

  afterAll(async () => {
    try { if (index) await index.deleteIndex(); } catch (e) { /* ignore */ }
  });

  it('creates an index with kmsName and no indexKey', async () => {
    index = await client.createIndex({
      indexName,
      kmsName: KMS_SM,
      indexConfig: { dimension, type: 'ivfflat' }
    });
    expect(index).toBeDefined();
    expect(await index.getIndexName()).toBe(indexName);
  });

  it('appears in listIndexes', async () => {
    const names = await client.listIndexes();
    expect(names).toContain(indexName);
  });

  it('upserts and queries without an SDK-side key', async () => {
    const vectors = makeVectors(5, dimension);
    const items = vectors.map((v, i) => ({ id: `sm_${i}`, vector: v }));

    const upsertResult = await index.upsert({ items });
    expect(upsertResult.status).toBe('success');
    await sleep(1000);

    const response = await index.query({ queryVectors: vectors[0], topK: 3 });
    expect(response).toBeDefined();
    expect(response.results).toBeDefined();
  });

  it('loadIndex resolves the KEK from the KMS cache (no indexKey needed)', async () => {
    const reloaded = await client.loadIndex({ indexName });
    expect(await reloaded.getIndexName()).toBe(indexName);
  });
});

describeIfConfigured('CyborgDB KMS — mode 2 (provider:none + SDK-supplied KEK)', () => {
  if (!KMS_NONE) {
    it.skip('skipped: CYBORGDB_KMS_NAME_NONE not set', () => undefined);
    return;
  }

  let client: Client;
  let indexName: string;
  let indexKey: Uint8Array;
  let index: any;

  beforeAll(() => {
    client = new Client({ baseUrl: BASE_URL, apiKey: API_KEY!, verifySsl: false });
    indexName = `kms_none_${Date.now().toString(36)}`;
    indexKey = Client.generateKey();
  });

  afterAll(async () => {
    try { if (index) await index.deleteIndex(); } catch (e) { /* ignore */ }
  });

  it('creates an index with both kmsName and indexKey', async () => {
    index = await client.createIndex({
      indexName,
      indexKey,
      kmsName: KMS_NONE,
      indexConfig: { dimension, type: 'ivfflat' }
    });
    expect(index).toBeDefined();
    expect(await index.getIndexName()).toBe(indexName);
  });

  it('upserts and queries with the SDK-supplied KEK', async () => {
    const vectors = makeVectors(5, dimension);
    const items = vectors.map((v, i) => ({ id: `none_${i}`, vector: v }));

    const upsertResult = await index.upsert({ items });
    expect(upsertResult.status).toBe('success');
    await sleep(1000);

    const response = await index.query({ queryVectors: vectors[0], topK: 3 });
    expect(response).toBeDefined();
    expect(response.results).toBeDefined();
  });

  it('loadIndex still requires the SDK-supplied key', async () => {
    const reloaded = await client.loadIndex({ indexName, indexKey });
    expect(await reloaded.getIndexName()).toBe(indexName);
  });
});

// ---------------------------------------------------------------------------
// Negative paths — operator/SDK contract violations that should fail loudly
// rather than silently succeed.  Each block is gated on the same env vars
// as the matching positive-path suite above so missing slots skip cleanly.
// ---------------------------------------------------------------------------

describeIfConfigured('CyborgDB KMS — negative paths (config-agnostic)', () => {
  let client: Client;

  beforeAll(() => {
    client = new Client({ baseUrl: BASE_URL, apiKey: API_KEY!, verifySsl: false });
  });

  it('rejects createIndex with an unknown kmsName', async () => {
    const indexName = `neg_unknown_${Date.now().toString(36)}`;
    await expect(client.createIndex({
      indexName,
      kmsName: 'definitely-not-a-registered-slot',
      indexConfig: { dimension, type: 'ivfflat' }
    })).rejects.toThrow();
  });
});

describeIfConfigured('CyborgDB KMS — negative paths (real-provider contract)', () => {
  if (!KMS_REAL) {
    it.skip('skipped: CYBORGDB_KMS_NAME_REAL not set', () => undefined);
    return;
  }

  let client: Client;

  beforeAll(() => {
    client = new Client({ baseUrl: BASE_URL, apiKey: API_KEY!, verifySsl: false });
  });

  // Strict rejection is the target contract (in-flight cyborgdb-service
  // change).  Today's accept-and-warn behaviour at indexes.py:104-113
  // will be replaced with a hard error so ambiguous signals can't pass
  // silently.  This test will be red until that change lands.
  it('rejects createIndex when kmsName (real) and indexKey are both supplied', async () => {
    const indexName = `neg_both_${Date.now().toString(36)}`;
    const extraneous = Client.generateKey();
    await expect(client.createIndex({
      indexName,
      indexKey: extraneous,
      kmsName: KMS_REAL,
      indexConfig: { dimension, type: 'ivfflat' }
    })).rejects.toThrow();
  });

  // Same "no ambiguous signals" contract as the createIndex case above:
  // once an index is KMS-managed, the SDK must not supply an indexKey on
  // load.  Today the rejection surfaces via the cache hash invariant in
  // db/client.py:184-197 (401, _KMS_RESOLVED sentinel ≠ user hash); after
  // the in-flight strict-mode change the same path will reject explicitly
  // at the route level.  Assertion is intentionally generic across both.
  it('rejects loadIndex with an extraneous indexKey on a real-provider index', async () => {
    const indexName = `neg_extra_${Date.now().toString(36)}`;
    const index = await client.createIndex({
      indexName,
      kmsName: KMS_REAL,
      indexConfig: { dimension, type: 'ivfflat' }
    });
    try {
      const extraneous = Client.generateKey();
      await expect(client.loadIndex({ indexName, indexKey: extraneous })).rejects.toThrow();
    } finally {
      try { await index.deleteIndex(); } catch (e) { /* ignore */ }
    }
  });

  it('deletes and recreates an index with the same name and kmsName', async () => {
    const indexName = `neg_recreate_${Date.now().toString(36)}`;
    let index = await client.createIndex({
      indexName,
      kmsName: KMS_REAL,
      indexConfig: { dimension, type: 'ivfflat' }
    });
    await index.deleteIndex();

    index = await client.createIndex({
      indexName,
      kmsName: KMS_REAL,
      indexConfig: { dimension, type: 'ivfflat' }
    });
    try {
      expect(await index.getIndexName()).toBe(indexName);
      const names = await client.listIndexes();
      expect(names).toContain(indexName);
    } finally {
      try { await index.deleteIndex(); } catch (e) { /* ignore */ }
    }
  });
});

describeIfConfigured('CyborgDB KMS — negative paths (provider:none contract)', () => {
  if (!KMS_NONE) {
    it.skip('skipped: CYBORGDB_KMS_NAME_NONE not set', () => undefined);
    return;
  }

  let client: Client;

  beforeAll(() => {
    client = new Client({ baseUrl: BASE_URL, apiKey: API_KEY!, verifySsl: false });
  });

  it('rejects createIndex when kmsName references provider:none and indexKey is omitted', async () => {
    const indexName = `neg_none_nokey_${Date.now().toString(36)}`;
    await expect(client.createIndex({
      indexName,
      kmsName: KMS_NONE,
      indexConfig: { dimension, type: 'ivfflat' }
    })).rejects.toThrow();
  });

  it('rejects loadIndex without indexKey on a provider:none index', async () => {
    const indexName = `neg_none_loadnokey_${Date.now().toString(36)}`;
    const indexKey = Client.generateKey();
    const index = await client.createIndex({
      indexName,
      indexKey,
      kmsName: KMS_NONE,
      indexConfig: { dimension, type: 'ivfflat' }
    });
    try {
      await expect(client.loadIndex({ indexName })).rejects.toThrow();
    } finally {
      try { await index.deleteIndex(); } catch (e) { /* ignore */ }
    }
  });

  // The SDK may or may not validate the key on loadIndex; either way,
  // an operation that requires decryption should fail.  Probe by trying
  // to query after a wrong-key load.
  it('fails to query after loadIndex with wrong indexKey on a provider:none index', async () => {
    const indexName = `neg_none_wrongkey_${Date.now().toString(36)}`;
    const realKey = Client.generateKey();
    const wrongKey = Client.generateKey();

    const index = await client.createIndex({
      indexName,
      indexKey: realKey,
      kmsName: KMS_NONE,
      indexConfig: { dimension, type: 'ivfflat' }
    });
    try {
      const vectors = makeVectors(3, dimension);
      const items = vectors.map((v, i) => ({ id: `wk_${i}`, vector: v }));
      await index.upsert({ items });
      await sleep(1000);

      await expect((async () => {
        const reloaded = await client.loadIndex({ indexName, indexKey: wrongKey });
        await reloaded.query({ queryVectors: vectors[0], topK: 1 });
      })()).rejects.toThrow();
    } finally {
      try { await index.deleteIndex(); } catch (e) { /* ignore */ }
    }
  });
});
