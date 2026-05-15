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
 *   - CYBORGDB_KMS_NAME_REAL — name of a registry entry with a real provider
 *     (e.g. aws-kms, gcp-kms). Exercises mode 3.
 *   - CYBORGDB_KMS_NAME_NONE — name of a registry entry with `provider: none`.
 *     Exercises mode 2.
 *
 * Without either env var, the whole suite is skipped (not failed).
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from '../index';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
jest.setTimeout(120000);

const BASE_URL = process.env.CYBORGDB_BASE_URL || 'http://localhost:8000';
const API_KEY = process.env.CYBORGDB_API_KEY;
const KMS_REAL = process.env.CYBORGDB_KMS_NAME_REAL;
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

describeIfConfigured('CyborgDB KMS — mode 3 (fully KMS-managed)', () => {
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
