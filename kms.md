# KMS + Multi-Tenancy Implementation Guide (cyborgdb-js)

A step-by-step guide for adding per-index KMS routing and BYOK multi-tenancy
to the TypeScript SDK, on a fresh branch (`multi-tenancy-2`) off current
`main`. Mirrors the Python (`cyborgdb-py`) and Go (`cyborgdb-go`) SDK PRs
one-for-one. **Parity with those SDKs is the goal; backwards compatibility
is not.**

Companion docs (service side, for context only — we implement none of this):
`cyborgdb-service/per-index-kms.md` (full design) and
`cyborgdb-service/BYOK.md` (operator/customer setup).

---

## 1. What this PR does, in one paragraph

Track `cyborgdb-service`'s per-index KMS slice. Regenerate the OpenAPI client
against the new spec where `index_key` is **optional** on every request and
`CreateIndexRequest` gains a `kms_name` field referencing a `kms.registry`
entry. Make `indexKey` optional on `createIndex` / `loadIndex`, add a
`kmsName` parameter to `createIndex`, allow the `EncryptedIndex` to operate
without a client-side key (the server resolves the KEK from its stored
`KMSBlob`), and add offline + live BYOK tests. The SDK gains **no KMS
management surface** — registry entries are configured server-side in YAML
and referenced by name only.

### The three key-management modes (the whole feature, from the SDK's view)

| Mode | `createIndex` args | `loadIndex` args | Who holds the key |
| --- | --- | --- | --- |
| **1. SDK-managed (legacy)** | `indexKey` only | `indexKey` | SDK supplies the 32-byte DEK directly; no envelope server-side. |
| **2. KMS-fully-managed** | `kmsName` only (real provider: `aws-kms` / `aws`) | *(no key)* | Service generates + wraps the KEK; SDK never sees a key. |
| **3. `provider: none` + SDK KEK** | both `indexKey` **and** `kmsName` | `indexKey` | Registry slot tracks the index but SDK supplies the KEK each call. |

Rule the SDK enforces locally: **at least one of `indexKey` / `kmsName` must
be present** on `createIndex`. Everything else (whether a real-provider slot
rejects a stray `indexKey`, whether `provider: none` requires one) is enforced
server-side and surfaces as an HTTP error.

---

## 2. Current state of this repo (read before starting)

- We are on branch **`multi-tenancy-2`**, clean, off current `main`.
- Current `main` already uses the **flat** `CreateIndexRequest` shape
  (`dimension` / `metric` / `storage_precision` — no `index_config` union),
  at spec version **0.16.0**. This is good: the flat-field migration is
  already done, so our delta is purely the KMS layer.
- A **prior** `multi-tenancy` branch exists with a full attempt, but it was
  built on an *older* `main` that still had the `index_config` union (its
  `openapi.json` is a divergent 0.16.1 with an `IndexConfig` schema). **Do
  not reuse its `openapi.json` or generated `src/models`** — they will
  reintroduce the union and break parity. We *do* salvage two things from it:
  the `withKey()` helper pattern in `encryptedIndex.ts` (§5.2) and the
  `kms.test.ts` test suite (§6), both adapted to flat fields.

---

## 3. Source-of-truth spec

The canonical spec is **`cyborgdb-py/openapi.json`** (its multi-tenancy HEAD),
`info.version` = **`0.16.1`**. py and go share identical spec bytes; JS should
too. Copy it verbatim:

```bash
cp ../cyborgdb-py/openapi.json ./openapi.json
```

Sanity-check it has the expected shape (flat fields, optional key, `kms_name`,
**no** `IndexConfig` schema):

```bash
python3 -c "
import json
d = json.load(open('openapi.json'))
print('version:', d['info']['version'])                          # 0.16.1
c = d['components']['schemas']['CreateIndexRequest']
print('CreateIndexRequest props:', list(c['properties'].keys()))
# ['index_name','kms_name','index_key','dimension','embedding_model','metric','storage_precision']
print('CreateIndexRequest required:', c.get('required'))         # ['index_name']
print('IndexOperationRequest required:',
      d['components']['schemas']['IndexOperationRequest'].get('required'))  # ['index_name']
print('has IndexConfig schema?', 'IndexConfig' in d['components']['schemas'])  # False
"
```

Across the spec, `index_key` is dropped from every `required:` list and
becomes optional on: `CreateIndexRequest`, `IndexOperationRequest`,
`QueryRequest` (`Request`), `UpsertRequest`, `GetRequest`, `DeleteRequest`,
`TrainRequest`, `ListIDsRequest`, `BinaryQueryRequest`, `BinaryUpsertRequest`.

---

## 4. Regenerate `src/models` + `src/apis`

The regeneration tooling is already in place — `update-openapi-client.sh`
(typescript-fetch generator, OpenAPI Generator 7.12.0) and
`openapitools.json`. Just run it:

```bash
./update-openapi-client.sh
```

This wipes and regenerates `src/models` and `src/apis`, then runs
`npm run build` to typecheck. Expected outcomes:

- `CreateIndexRequest.ts` gains `kmsName?: string | null` and `indexKey`
  becomes optional (`indexKey?: string | null`); its `ToJSON`/`FromJSON`
  map `kms_name` ↔ `kmsName`. `instanceOfCreateIndexRequest` should require
  only `indexName`.
- Every data-plane request model (`Request`/`QueryRequest`, `UpsertRequest`,
  `GetRequest`, `DeleteRequest`, `TrainRequest`, `ListIDsRequest`,
  `IndexOperationRequest`, `BinaryQueryRequest`, `BinaryUpsertRequest`) has
  `indexKey?: string | null` and no longer requires it in
  `instanceOf*`.
- No `IndexConfig` / `IndexIVF*Model` models reappear (they're already gone
  on `main`; confirm the regen doesn't resurrect them).

The build will fail on the hand-written files (`client.ts`,
`encryptedIndex.ts`) until §5 is done — that's expected and is the signal for
what to fix.

---

## 5. Hand-written SDK changes (outside generated code)

### 5.1 `src/client.ts`

**`createIndex`** — add `kmsName`, make `indexKey` optional, require at least
one, conditionally include each on the wire:

```ts
async createIndex({
  indexName,
  indexKey,
  kmsName,
  dimension,
  metric,
  embeddingModel,
  storagePrecision
}: {
  indexName: string;
  indexKey?: Uint8Array;
  kmsName?: string;
  dimension?: number;
  metric?: 'euclidean' | 'squared_euclidean' | 'cosine';
  embeddingModel?: string;
  storagePrecision?: 'float32' | 'float16';
}) {
  // Local guard mirrored from py/go: ErrMissingKeyOrKMS.
  if (indexKey === undefined && kmsName === undefined) {
    throw new Error('createIndex requires indexKey, kmsName, or both');
  }
  // Validate the key only when present (still must be 32 bytes).
  if (indexKey !== undefined && indexKey.length !== 32) {
    throw new Error(`indexKey must be 32 bytes, got ${indexKey.length}`);
  }

  try {
    const keyHex = indexKey ? Buffer.from(indexKey).toString('hex') : undefined;

    const createRequest: CreateIndexRequest = {
      indexName,
      dimension,
      embeddingModel,
      metric,
      storagePrecision: storagePrecision as CreateIndexRequestStoragePrecisionEnum | undefined,
      ...(keyHex !== undefined && { indexKey: keyHex }),
      ...(kmsName !== undefined && { kmsName }),
    };

    await this.api.createIndexV1IndexesCreatePost({ createIndexRequest: createRequest });
    // Pass the (possibly undefined) key through to the index object.
    return new EncryptedIndex(indexName, indexKey, this.api, embeddingModel);
  } catch (error: unknown) {
    this.handleApiError(error);
  }
}
```

**`describeIndex` (private)** and **`loadIndex`** — make `indexKey` optional;
omit it from the request when absent:

```ts
private async describeIndex(
  indexName: string,
  indexKey?: Uint8Array
): Promise<IndexInfoResponseModel> {
  const keyHex = indexKey ? Buffer.from(indexKey).toString('hex') : undefined;
  const request: IndexOperationRequest = {
    indexName,
    ...(keyHex !== undefined && { indexKey: keyHex }),
  };
  // ... unchanged
}

async loadIndex({
  indexName,
  indexKey
}: {
  indexName: string;
  indexKey?: Uint8Array;       // omit for fully-KMS-managed indexes
}): Promise<EncryptedIndex> {
  const response = await this.describeIndex(indexName, indexKey);
  return new EncryptedIndex(response.indexName, indexKey, this.api);
}
```

`generateKey()` (instance + static) is unchanged.

### 5.2 `src/encryptedIndex.ts`

Make the stored key optional and route every data-plane request through one
helper (salvaged from the prior `multi-tenancy` branch):

```ts
export class EncryptedIndex {
  private indexName: string = "";
  private indexKey?: Uint8Array;            // undefined => fully KMS-managed
  private api: DefaultApi;

  // Hex-encoded key, or undefined when the server resolves the KEK itself.
  private keyHex(): string | undefined {
    return this.indexKey ? Buffer.from(this.indexKey).toString('hex') : undefined;
  }

  // Spread into a request body to conditionally include indexKey.
  private withKey<T extends object>(body: T): T & { indexKey?: string } {
    const hex = this.keyHex();
    return hex !== undefined ? { ...body, indexKey: hex } : body;
  }

  constructor(indexName: string, indexKey: Uint8Array | undefined, api: DefaultApi, _embeddingModel?: string) {
    this.indexName = indexName;
    this.indexKey = indexKey;
    this.api = api;
  }
  // ...
}
```

Then replace every `const keyHex = Buffer.from(this.indexKey).toString('hex')`
+ literal `{ indexName, indexKey: keyHex, ... }` with `this.withKey({ indexName, ... })`.
Methods to convert: `describeIndex`, `deleteIndex`, `get`, `train`, `upsert`,
`query`, `delete`, `listIds`, `_upsertBinary`, `_queryBinary`. After this,
`this.indexKey` is referenced **only** through `keyHex()`/`withKey()` — no
unguarded `Buffer.from(this.indexKey)` should remain (it would throw on
KMS-managed indexes).

### 5.3 `src/integrations/langchain/vectorstore.ts`

The langchain wrapper calls `createIndex` / `loadIndex`. Thread an optional
`kmsName` through its options and make its `indexKey` optional so a vector
store can be backed by a KMS-managed index. Mirror whatever py/go's
integration layer does; keep the change minimal (pass-through).

### 5.4 `src/types.ts` / `src/index.ts`

Export any new option types if the public surface adds them. No new public
types are strictly required (the `kmsName` param is inline), but re-export
`CreateIndexRequest`'s enum if consumers reference it.

---

## 6. Tests

The prior `multi-tenancy` branch already wrote a thorough
`src/__tests__/kms.test.ts` covering all three modes + negative paths +
mixed-mode concurrency. **Reuse it, adapting the API calls from the old
`indexConfig: { dimension, type: 'ivfflat' }` form to the flat `dimension`
parameter** (current `main`'s shape).

### 6.1 Live BYOK suite — `src/__tests__/kms.test.ts`

Gated by env vars (suite `it.skip`s itself when unset), matching py/go:

- `CYBORGDB_KMS_NAME_REAL` — a registry entry with provider `aws-kms`.
- `CYBORGDB_KMS_NAME_SM`   — a registry entry with provider `aws` (Secrets Manager).
- `CYBORGDB_KMS_NAME_NONE` — a registry entry with `provider: none`.

Coverage (already drafted on the prior branch — port verbatim, fix the
create-args shape):

- **Mode 1 (`aws-kms`)** and **Mode 1 (`aws`/SM)**: create with `kmsName`
  and no `indexKey`; assert it lists; upsert + query with no SDK key;
  `loadIndex` with no key resolves the KEK from the service cache.
- **Mode 2 (`provider:none`)**: create with **both** `kmsName` and
  `indexKey`; upsert/query with the SDK key; `loadIndex` still requires the key.
- **Negative paths**: unknown `kmsName` rejected; real-provider slot rejects a
  stray `indexKey` (create and load); `provider:none` rejects a missing key;
  wrong key on a `provider:none` index fails at query; delete-and-recreate
  with the same name + `kmsName`.
- **Mixed-mode concurrency**: create/load across all three providers in
  parallel to shake out cross-slot bleed.

### 6.2 Offline contract tests — `src/__tests__/api_contract.test.ts`

These need **no running service** — they assert the request *shape*. Mirror
py's `TestSDKConstructionOffline`:

- `createIndex` with neither `indexKey` nor `kmsName` throws locally.
- `CreateIndexRequest` serialization omits `index_key` when only `kmsName` is
  given (KMS-managed), and includes **both** when both are given (mixed).
- `EncryptedIndex` constructed with `undefined` key produces request bodies
  with **no** `index_key` field for every data-plane method (`get`, `query`,
  `upsert`, `delete`, `listIds`, `train`, describe/delete-index).
- `getIndexName()` etc. are callable on a keyless index.

Use `CreateIndexRequestToJSON` / the request `ToJSON` helpers (or a mocked
`DefaultApi` capturing the request arg) to inspect the wire payload.

### 6.3 Existing suites

`basic_test`, `comprehensive_test`, `concurrency_test` already pass an
`indexKey` — they exercise Mode 1 and should keep working unchanged once the
flat-field create signature is in place. Run the full suite to confirm no
regression from the optional-key change.

---

## 7. README / docs

Add a **BYOK / KMS** section to `README.md` mirroring py/go: the three modes,
a `createIndex({ indexName, kmsName })` example (no key), a
`loadIndex({ indexName })` example (no key), and a note that registry slots
are configured server-side (point at `cyborgdb-service/BYOK.md`). Update any
`createIndex` examples that imply `indexKey` is required.

---

## 8. Verification checklist

- [ ] `openapi.json` is byte-identical to `cyborgdb-py`'s, version `0.16.1`.
- [ ] `./update-openapi-client.sh` regenerates cleanly; no `IndexConfig` model.
- [ ] `npm run build` (tsc + bundle) passes.
- [ ] `npm run lint` passes.
- [ ] No unguarded `Buffer.from(this.indexKey)` remains in `encryptedIndex.ts`.
- [ ] Offline contract tests pass with no service running.
- [ ] Existing keyed suites (`basic`, `comprehensive`, `concurrency`) pass.
- [ ] Live `kms.test.ts` passes against a service configured with the three
      registry slots (set the three `CYBORGDB_KMS_NAME_*` env vars).
- [ ] `README.md` documents the three modes.

---

## 9. Open questions / decisions

1. **Spec provenance.** This guide assumes `cyborgdb-py/openapi.json` (0.16.1)
   is the authoritative spec and copies it verbatim, rather than re-exporting
   from the running service. Confirm py's spec is current; if the service has
   moved on, regenerate from py first.
2. **langchain integration depth.** §5.3 proposes a minimal pass-through of
   `kmsName`. Confirm whether the langchain vector store should expose KMS
   modes at all, or stay key-only for now.
3. **`generateKey` ergonomics.** No change proposed. If we want a "KMS-managed,
   no key" convenience constructor on the vector store, that's additive and
   can come later.
