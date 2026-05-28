/**
 * KMS-backed key management tests.
 *
 * The service supports two wire encodings for index encryption keys, and
 * `kms_name` + `index_key` are strictly mutually exclusive on the create
 * request (the server returns 400 regardless of which slot `kms_name`
 * resolves to):
 *
 *   1. **SDK-supplied KEK** — request carries `indexKey` and no
 *      `kmsName`. The server uses the SDK-supplied bytes as the KEK and
 *      records the envelope as `provider="none"`; the SDK must re-supply
 *      the same `indexKey` on every subsequent request for that index.
 *      No KMS registry slot is referenced.
 *   2. **KMS-managed KEK** — request carries `kmsName` and no
 *      `indexKey`. The server generates a random KEK, wraps it via the
 *      referenced registry slot's provider (`aws-kms` or `aws`), and
 *      persists the wrapped form. Subsequent requests resolve the KEK
 *      server-side via the cache or the KMS provider; the SDK never
 *      sees it.
 *
 * The "offline contract" suite at the top runs with no service — it
 * asserts the SDK's local guard and the request shape (which fields hit
 * the wire). The live suites below are opt-in via env vars because they
 * require the cyborgdb-service to be configured with specific
 * kms.registry entries:
 *   - CYBORGDB_KMS_NAME_REAL — registry entry with provider `aws-kms`
 *     (HSM-backed). Exercises mode 2 against the AWS KMS path.
 *   - CYBORGDB_KMS_NAME_SM   — registry entry with provider `aws`
 *     (Secrets Manager). Exercises mode 2 against the Secrets Manager
 *     path.
 *
 * The SDK-supplied-KEK path (mode 1) is exercised live whenever
 * CYBORGDB_API_KEY is set; it needs no registry slot and historically
 * the test file gated it on a `provider: none` slot that has since been
 * removed from the registry — strict mutex made that slot unreachable
 * from the SDK anyway.
 *
 * Each live suite is gated independently; missing env vars skip just
 * their suite.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client, EncryptedIndex } from '../index';
import { CreateIndexRequestToJSON } from '../models/CreateIndexRequest';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
jest.setTimeout(120000);

const BASE_URL = process.env.CYBORGDB_BASE_URL || 'http://localhost:8000';
const API_KEY = process.env.CYBORGDB_API_KEY;
const KMS_REAL = process.env.CYBORGDB_KMS_NAME_REAL;
const KMS_SM = process.env.CYBORGDB_KMS_NAME_SM;

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

// ---------------------------------------------------------------------------
// Offline contract — no running service. Asserts the SDK plumbing for the
// three modes before any live integration: the local create guard, the
// CreateIndexRequest wire shape, and that a keyless EncryptedIndex omits
// `index_key` on every data-plane request (server resolves the KEK).
// ---------------------------------------------------------------------------

/** A DefaultApi stand-in that records the request body passed to each method. */
function captureApi() {
  const calls: Record<string, any> = {};
  // Each generated method takes a single object like { getRequest } / { request };
  // record its sole value so callers can inspect the request body.
  const rec = (name: string, resp: any) => (arg: any) => {
    calls[name] = arg ? Object.values(arg)[0] : undefined;
    return Promise.resolve(resp);
  };
  const api: any = {
    getIndexInfoV1IndexesDescribePost: rec('describe', { indexName: 'idx', isTrained: false, indexConfig: {} }),
    deleteIndexV1IndexesDeletePost: rec('deleteIndex', { status: 'success' }),
    getVectorsV1VectorsGetPost: rec('get', { results: [] }),
    trainIndexV1IndexesTrainPost: rec('train', { status: 'success' }),
    upsertVectorsV1VectorsUpsertPost: rec('upsert', { status: 'success' }),
    queryVectorsV1VectorsQueryPost: rec('query', { results: [] }),
    deleteVectorsV1VectorsDeletePost: rec('delete', { status: 'success' }),
    listIdsV1VectorsListIdsPost: rec('listIds', { ids: [], count: 0 }),
    upsertVectorsBinaryV1VectorsUpsertBinaryPost: rec('upsertBinary', { status: 'success' }),
    queryVectorsBinaryV1VectorsQueryBinaryPost: rec('queryBinary', { results: [] }),
  };
  return { api, calls };
}

describe('CyborgDB KMS — offline contract (no service)', () => {
  const offlineClient = () => new Client({ baseUrl: 'http://localhost:9', apiKey: 'offline' });

  it('createIndex rejects when neither indexKey nor kmsName is provided', async () => {
    await expect(offlineClient().createIndex({ indexName: 'idx' }))
      .rejects.toThrow(/indexKey, kmsName, or both/);
  });

  it('createIndex rejects a non-32-byte indexKey', async () => {
    await expect(offlineClient().createIndex({ indexName: 'idx', indexKey: new Uint8Array(10) }))
      .rejects.toThrow(/32 bytes/);
  });

  it('loadIndex rejects a non-32-byte indexKey', async () => {
    await expect(offlineClient().loadIndex({ indexName: 'idx', indexKey: new Uint8Array(10) }))
      .rejects.toThrow(/32 bytes/);
  });

  it('loadIndex without a key builds a keyless describe request', async () => {
    const { api, calls } = captureApi();
    const client = offlineClient();
    (client as any).api = api;

    await client.loadIndex({ indexName: 'idx' });
    expect(calls['describe']).toBeDefined();
    expect(calls['describe'].indexKey).toBeUndefined();
  });

  it('loadIndex with a key includes the hex key on the describe request', async () => {
    const { api, calls } = captureApi();
    const client = offlineClient();
    (client as any).api = api;
    const key = Client.generateKey();

    await client.loadIndex({ indexName: 'idx', indexKey: key });
    expect(calls['describe'].indexKey).toBe(Buffer.from(key).toString('hex'));
  });

  it('CreateIndexRequest with only kmsName omits index_key on the wire', () => {
    const wire = JSON.parse(JSON.stringify(CreateIndexRequestToJSON({ indexName: 'idx', kmsName: 'slot' })));
    expect(wire.kms_name).toBe('slot');
    expect('index_key' in wire).toBe(false);
  });

  it('CreateIndexRequest preserves both fields on the wire even though the server rejects the combo', () => {
    // Strict mutex lives in the server, not the SDK. Verify the
    // generated model forwards both fields untouched so the rejection
    // is the server's call — the SDK doesn't silently strip one and
    // mask the operator's misconfiguration.
    const wire = JSON.parse(JSON.stringify(CreateIndexRequestToJSON({ indexName: 'idx', indexKey: 'ff', kmsName: 'slot' })));
    expect(wire.index_key).toBe('ff');
    expect(wire.kms_name).toBe('slot');
  });

  it('a keyless EncryptedIndex omits indexKey on every data-plane request', async () => {
    const { api, calls } = captureApi();
    const index = new EncryptedIndex('idx', undefined, api);

    await index.get({ ids: ['a'] });
    await index.listIds();
    await index.delete({ ids: ['a'] });
    await index.train();
    await index.upsert({ items: [{ id: 'a', vector: [0.1, 0.2, 0.3] }] });
    await index.query({ queryVectors: [0.1, 0.2, 0.3] });

    for (const op of ['get', 'listIds', 'delete', 'train', 'upsert', 'query']) {
      expect(calls[op]).toBeDefined();
      expect(calls[op].indexKey).toBeUndefined();
    }
  });

  it('a keyed EncryptedIndex includes the hex indexKey on requests', async () => {
    const { api, calls } = captureApi();
    const key = Client.generateKey();
    const index = new EncryptedIndex('idx', key, api);

    await index.listIds();
    expect(calls['listIds'].indexKey).toBe(Buffer.from(key).toString('hex'));
  });

  it('binary upsert/query honor the key contract (Float32Array path)', async () => {
    // Float32Array inputs route through _upsertBinary / _queryBinary, which
    // build their requests via the same withKey() helper. Two vectors, dim 2.
    const upsertVecs = () => new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const queryVec = () => new Float32Array([0.1, 0.2]);

    // Keyless → binary endpoints must omit indexKey.
    const keyless = captureApi();
    const keylessIndex = new EncryptedIndex('idx', undefined, keyless.api);
    await keylessIndex.upsert({ ids: ['a', 'b'], vectors: upsertVecs() });
    await keylessIndex.query({ queryVectors: queryVec(), dimension: 2 });
    expect(keyless.calls['upsertBinary']).toBeDefined();
    expect(keyless.calls['upsertBinary'].indexKey).toBeUndefined();
    expect(keyless.calls['queryBinary']).toBeDefined();
    expect(keyless.calls['queryBinary'].indexKey).toBeUndefined();

    // Keyed → binary endpoints must include the hex key.
    const key = Client.generateKey();
    const keyed = captureApi();
    const keyedIndex = new EncryptedIndex('idx', key, keyed.api);
    await keyedIndex.upsert({ ids: ['a', 'b'], vectors: upsertVecs() });
    await keyedIndex.query({ queryVectors: queryVec(), dimension: 2 });
    const hex = Buffer.from(key).toString('hex');
    expect(keyed.calls['upsertBinary'].indexKey).toBe(hex);
    expect(keyed.calls['queryBinary'].indexKey).toBe(hex);
  });

  it('getIndexName is callable on a keyless index', async () => {
    const { api } = captureApi();
    const index = new EncryptedIndex('idx', undefined, api);
    expect(await index.getIndexName()).toBe('idx');
  });
});

// ---------------------------------------------------------------------------
// Live suites — require a running cyborgdb-service with configured registry
// slots. Gated on CYBORGDB_API_KEY plus the relevant CYBORGDB_KMS_NAME_*.
// ---------------------------------------------------------------------------

const describeIfConfigured = API_KEY ? describe : describe.skip;

describeIfConfigured('CyborgDB KMS — mode 2 (fully KMS-managed via aws-kms / HSM)', () => {
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
      dimension
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

describeIfConfigured('CyborgDB KMS — mode 2 (fully KMS-managed via aws / Secrets Manager)', () => {
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
      dimension
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

describeIfConfigured('CyborgDB KMS — mode 1 (SDK-supplied KEK, no kmsName)', () => {
  // No KMS slot dependency — the SDK supplies the KEK on every request
  // and the server records the envelope as `provider="none"`. Gated on
  // CYBORGDB_API_KEY alone.
  let client: Client;
  let indexName: string;
  let indexKey: Uint8Array;
  let index: any;

  beforeAll(() => {
    client = new Client({ baseUrl: BASE_URL, apiKey: API_KEY!, verifySsl: false });
    indexName = `kms_sdk_${Date.now().toString(36)}`;
    indexKey = Client.generateKey();
  });

  afterAll(async () => {
    try { if (index) await index.deleteIndex(); } catch (e) { /* ignore */ }
  });

  it('creates an index with indexKey and no kmsName', async () => {
    index = await client.createIndex({
      indexName,
      indexKey,
      dimension
    });
    expect(index).toBeDefined();
    expect(await index.getIndexName()).toBe(indexName);
  });

  it('upserts and queries with the SDK-supplied KEK', async () => {
    const vectors = makeVectors(5, dimension);
    const items = vectors.map((v, i) => ({ id: `sdk_${i}`, vector: v }));

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
      dimension
    })).rejects.toThrow();
  });

  it('rejects createIndex when neither kmsName nor indexKey is supplied (server-side)', async () => {
    // The SDK has a local guard that catches this offline (covered by
    // the offline-contract suite). To exercise the server-side guard
    // we bypass the SDK helper and send the raw request — the server
    // must produce its own 400 even if a future SDK change drops the
    // client-side check.
    const res = await fetch(`${BASE_URL}/v1/indexes/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY! },
      body: JSON.stringify({ index_name: `neg_empty_${Date.now().toString(36)}`, dimension }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects createIndex with kmsName + indexKey even when kmsName is unknown', async () => {
    // The strict-mutex check fires BEFORE the registry lookup, so the
    // server returns 400 with the mutex message rather than an
    // unknown-slot message. This pins down "mutex first, slot
    // resolution second" so a future server refactor can't silently
    // swap the ordering and let the combination through for an
    // as-yet-unknown slot.
    //
    // Use raw fetch instead of the SDK helper because the
    // typescript-fetch generator's error shape doesn't surface the
    // server's `detail` field in the thrown Error.message — the
    // distinction we care about ("mutex 400" vs "unknown-slot 400")
    // is invisible through the SDK layer today.
    const indexKeyHex = Buffer.from(Client.generateKey()).toString('hex');
    const res = await fetch(`${BASE_URL}/v1/indexes/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY! },
      body: JSON.stringify({
        index_name: `neg_mutex_unknown_${Date.now().toString(36)}`,
        index_key: indexKeyHex,
        kms_name: 'definitely-not-a-registered-slot',
        dimension,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.detail).toBe('string');
    expect(body.detail).toMatch(/index_key must not be supplied alongside/);
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

  // For a real-provider slot the service generates the KEK itself, so a
  // caller-supplied index_key is contradictory and the service rejects it
  // with a 400 ("index_key must not be supplied alongside kms_name=...").
  // The SDK forwards both fields untouched; the rejection is the server's.
  it('rejects createIndex when kmsName (real) and indexKey are both supplied', async () => {
    const indexName = `neg_both_${Date.now().toString(36)}`;
    const extraneous = Client.generateKey();
    await expect(client.createIndex({
      indexName,
      indexKey: extraneous,
      kmsName: KMS_REAL,
      dimension
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
      dimension
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
      dimension
    });
    await index.deleteIndex();

    index = await client.createIndex({
      indexName,
      kmsName: KMS_REAL,
      dimension
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

describeIfConfigured('CyborgDB KMS — negative paths (SDK-supplied KEK contract)', () => {
  // Counterparts to the SDK-supplied-KEK positive suite — same wire
  // encoding (indexKey alone), but exercising the failure modes:
  // forgetting the key on reload, and supplying a wrong key.
  let client: Client;

  beforeAll(() => {
    client = new Client({ baseUrl: BASE_URL, apiKey: API_KEY!, verifySsl: false });
  });

  it('rejects loadIndex without indexKey on an SDK-supplied-KEK index', async () => {
    const indexName = `neg_sdk_loadnokey_${Date.now().toString(36)}`;
    const indexKey = Client.generateKey();
    const index = await client.createIndex({ indexName, indexKey, dimension });
    try {
      // The persisted envelope records `provider="none"`, so the server
      // has no way to resolve the KEK without the SDK re-supplying it.
      await expect(client.loadIndex({ indexName })).rejects.toThrow();
    } finally {
      try { await index.deleteIndex(); } catch (e) { /* ignore */ }
    }
  });

  // The SDK may or may not validate the key on loadIndex; either way,
  // an operation that requires decryption should fail.  Probe by trying
  // to query after a wrong-key load.
  it('fails to query after loadIndex with wrong indexKey on an SDK-supplied-KEK index', async () => {
    const indexName = `neg_sdk_wrongkey_${Date.now().toString(36)}`;
    const realKey = Client.generateKey();
    const wrongKey = Client.generateKey();

    const index = await client.createIndex({ indexName, indexKey: realKey, dimension });
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

// ---------------------------------------------------------------------------
// Tier 2 — mixed-mode concurrency.  Fires createIndex against all three
// providers in parallel and checks each request lands on the right slot
// without cross-contamination.  Exercises the service's registry handle
// lookup, KEK cache, and (for `none`) the SDK-supplied-key fast path
// under concurrent load — the kind of race a sequential test would miss.
// ---------------------------------------------------------------------------

describeIfConfigured('CyborgDB KMS — mixed-mode concurrency', () => {
  if (!KMS_REAL || !KMS_SM) {
    it.skip('skipped: requires both CYBORGDB_KMS_NAME_REAL and CYBORGDB_KMS_NAME_SM', () => undefined);
    return;
  }

  // Three legs: aws-kms slot, aws/SM slot, SDK-supplied KEK (no slot).
  // The SDK-supplied leg used to reference a `provider: none` registry
  // slot; with strict mutex it carries `indexKey` alone and the server
  // records the envelope as `provider="none"` itself.
  let client: Client;
  const createdNames: string[] = [];

  beforeAll(() => {
    client = new Client({ baseUrl: BASE_URL, apiKey: API_KEY!, verifySsl: false });
  });

  // Backstop cleanup in case an assertion failure short-circuits the
  // inline cleanup inside each test.  Best-effort — ignore errors.
  afterAll(async () => {
    for (const name of createdNames) {
      try {
        const idx = await client.loadIndex({ indexName: name });
        await idx.deleteIndex();
      } catch (e) { /* ignore */ }
    }
  });

  it('creates indexes against aws-kms, aws/SM, and SDK-supplied paths in parallel', async () => {
    const stamp = Date.now().toString(36);
    const kmsKmsName = `cc_kms_${stamp}`;
    const kmsSmName  = `cc_sm_${stamp}`;
    const sdkName    = `cc_sdk_${stamp}`;
    const sdkKey = Client.generateKey();

    createdNames.push(kmsKmsName, kmsSmName, sdkName);

    // Fire all three in parallel — Promise.all rejects on the first error,
    // which is what we want: any provider mishandling a concurrent request
    // surfaces as a thrown promise here.
    const [kmsIdx, smIdx, sdkIdx] = await Promise.all([
      client.createIndex({
        indexName: kmsKmsName,
        kmsName: KMS_REAL,
        dimension
      }),
      client.createIndex({
        indexName: kmsSmName,
        kmsName: KMS_SM,
        dimension
      }),
      client.createIndex({
        indexName: sdkName,
        indexKey: sdkKey,
        dimension
      }),
    ]);

    // Each returned index should bear the name we asked for — proves no
    // cross-talk in the service's request handling.
    expect(await kmsIdx.getIndexName()).toBe(kmsKmsName);
    expect(await smIdx.getIndexName()).toBe(kmsSmName);
    expect(await sdkIdx.getIndexName()).toBe(sdkName);

    // Confirm all three landed in the catalog.
    const listed = await client.listIndexes();
    expect(listed).toEqual(expect.arrayContaining([kmsKmsName, kmsSmName, sdkName]));

    // Inline cleanup so afterAll has less to do.  In parallel, since
    // delete is provider-independent.
    await Promise.all([kmsIdx.deleteIndex(), smIdx.deleteIndex(), sdkIdx.deleteIndex()]);
  });

  it('loads pre-existing indexes across all three paths in parallel', async () => {
    const stamp = Date.now().toString(36);
    const kmsKmsName = `cc_load_kms_${stamp}`;
    const kmsSmName  = `cc_load_sm_${stamp}`;
    const sdkName    = `cc_load_sdk_${stamp}`;
    const sdkKey = Client.generateKey();

    createdNames.push(kmsKmsName, kmsSmName, sdkName);

    // Setup phase — concurrent create (sequencing of create is covered above).
    const created = await Promise.all([
      client.createIndex({ indexName: kmsKmsName, kmsName: KMS_REAL, dimension }),
      client.createIndex({ indexName: kmsSmName, kmsName: KMS_SM, dimension }),
      client.createIndex({ indexName: sdkName, indexKey: sdkKey, dimension }),
    ]);

    try {
      // Concurrent loads — exercises the KEK cache (hits for the first
      // two, SDK-supplied-key fast path for the third).
      const [kmsLoaded, smLoaded, sdkLoaded] = await Promise.all([
        client.loadIndex({ indexName: kmsKmsName }),
        client.loadIndex({ indexName: kmsSmName }),
        client.loadIndex({ indexName: sdkName, indexKey: sdkKey }),
      ]);

      expect(await kmsLoaded.getIndexName()).toBe(kmsKmsName);
      expect(await smLoaded.getIndexName()).toBe(kmsSmName);
      expect(await sdkLoaded.getIndexName()).toBe(sdkName);
    } finally {
      await Promise.all(created.map(idx => idx.deleteIndex().catch(() => undefined)));
    }
  });
});
