<p align="center">
  <a href="https://www.cyborg.co">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/cyborginc/cyborgdb-js/main/assets/cyborgdb-logo-dark.svg">
      <img src="https://raw.githubusercontent.com/cyborginc/cyborgdb-js/main/assets/cyborgdb-logo-light.svg" alt="CyborgDB" width="320">
    </picture>
  </a>
</p>

# CyborgDB JavaScript/TypeScript SDK

![NPM Version](https://img.shields.io/npm/v/cyborgdb)
![NPM License](https://img.shields.io/npm/l/cyborgdb)
![Node Current](https://img.shields.io/node/v/cyborgdb)

The **CyborgDB JavaScript/TypeScript SDK** is the JavaScript/TypeScript client for [CyborgDB](https://www.cyborg.co) — the vector database that stays encrypted even while it's searching. Run similarity search directly on encrypted data with client-side keys; only the result of a query is ever decrypted, never the index. Built with TypeScript, it ships full type definitions for JavaScript and TypeScript apps.

This SDK talks to [`cyborgdb-service`](https://hub.docker.com/r/cyborginc/cyborgdb-service), which you self-host in your own VPC or on-prem and run alongside your app. Install and start it separately. See our [docs](https://docs.cyborg.co) for more info.

## Key Features

- **Encryption-in-use**: Search runs directly on ciphertext — only the query result is decrypted, never the index or stored vectors
- **Encrypted ANN**: Disk-backed encrypted DiskIVF index with recall within 2% of a plaintext baseline ([read the benchmarks](https://www.cyborg.co/performance))
- **Filters on encrypted metadata**: Combine vector similarity with equality and range predicates in a single request
- **BYOK / HYOK**: Wrap per-index keys with AWS KMS or AWS Secrets Manager, or hold the key client-side — you control the key material
- **Per-tenant key isolation**: Per-index, per-user keys with cryptographic RBAC; revoke a user and their keys are erased
- **TypeScript-first API**: Complete type definitions and IntelliSense for JavaScript and TypeScript apps

## Getting Started

To get started in minutes, check out our [Quickstart Guide](https://docs.cyborg.co/quickstart).

### Installation

1. Install `cyborgdb-service`

```bash
# Pull the CyborgDB Service image
docker pull cyborginc/cyborgdb-service
```

2. Install `cyborgdb` SDK:

```bash
# Install the CyborgDB TypeScript SDK
npm install cyborgdb
```

### Usage

```typescript
import { Client, loadSampleDataset } from 'cyborgdb';

// Initialize the client
const client = new Client({ 
  baseUrl: 'https://localhost:8000', 
  apiKey: 'your-api-key' 
});

// Generate a 32-byte encryption key
const indexKey = client.generateKey();

// Create an encrypted index
const index = await client.createIndex({
  indexName: 'my-index',
  indexKey: indexKey,
});

// Load the hosted sample dataset (fetched from S3 on first use, cached locally)
const dataset = await loadSampleDataset(); // 75k 128-dim vectors with metadata

// Add the encrypted vector items
await index.upsert({ items: dataset.items });

// Query the encrypted index with a sample query vector
const results = await index.query({
  queryVectors: dataset.sampleQueries[0],
  topK: 10,
  include: ['distance']
});

// Print the results (guaranteed non-empty against the sample dataset)
results.results.forEach(result => {
  console.log(`ID: ${result.id}, Distance: ${result.distance}`);
});
```

> **Sample dataset:** `loadSampleDataset()` pulls a small reference dataset from
> S3 on demand and caches it locally — it is not bundled into the SDK. Each item
> has an explicit `id`, a 128-dim `vector`, and `metadata` with both string
> (`string`) and numeric (`number`) fields, so the same dataset drives ANN
> similarity search, metadata filter queries, and numeric range queries. The
> dataset also ships `sampleQueries` (query vectors) and `exampleFilters`
> (curated, guaranteed-to-match filters).

> **Encryption model:** the index is encrypted at rest, but an encrypted DB does
> **not** mean vectors are auto-hidden from you. You must pass your index key on
> `loadIndex` / `get` / `query` to retrieve **decrypted** vectors and metadata —
> without the key, only encrypted ciphertext is ever readable. HYOK-level
> security is not implied unless you manage the key material yourself (see BYOK
> below).

### Advanced Usage

#### Batch Queries

```typescript
// Search with multiple query vectors simultaneously
const queryVectors = [
  [0.1, 0.2, 0.3, /* ... */],
  [0.4, 0.5, 0.6, /* ... */]
];

const batchResults = await index.query({
  queryVectors: queryVectors,
  topK: 5
});
```

#### Metadata Filtering & Range Queries

```typescript
const dataset = await loadSampleDataset();
const queryVector = dataset.sampleQueries[0];

// Equality filter on a string field
const filtered = await index.query({
  queryVectors: queryVector,
  topK: 10,
  filters: { string: 'string_0' },
  include: ['distance', 'metadata']
});

// Numeric range query (bounded) — combine similarity with a range predicate
const ranged = await index.query({
  queryVectors: queryVector,
  topK: 10,
  filters: { number: { $gte: 1250, $lte: 2500 } },
  include: ['distance', 'metadata']
});

// The dataset also ships curated, guaranteed-to-match filters:
for (const { name, filter } of dataset.exampleFilters) {
  const res = await index.query({ queryVectors: queryVector, topK: 5, filters: filter });
  console.log(`${name}: ${res.results.length} results`);
}
```

#### Bring Your Own Key (BYOK) via KMS

Indexes can be encrypted under a key managed by a KMS instead of one held by
the SDK. The KMS entries (`kms.registry`) are configured **server-side** in the
cyborgdb-service YAML and referenced by name via `kmsName`. The SDK has no KMS
management surface — see [`BYOK.md`](https://github.com/cyborginc/cyborgdb-service/blob/main/BYOK.md)
for operator/customer setup.

There are two key-management modes — supply **exactly one** of `indexKey` /
`kmsName`:

```typescript
// Mode 1 — SDK-managed (default): the SDK supplies the 32-byte key.
const indexKey = client.generateKey();
const index = await client.createIndex({
  indexName: 'my-index',
  indexKey,
});
// Loading requires the same key:
await client.loadIndex({ indexName: 'my-index', indexKey });

// Mode 2 — KMS-managed: the service generates and wraps the key.
// Pass a `kmsName` that references a registry entry (`aws-kms` or
// `aws`/Secrets Manager) and omit `indexKey`.
const kmsIndex = await client.createIndex({
  indexName: 'tenant-acme',
  kmsName: 'customer-acme',
});
// No key needed to load — the service resolves it from its KMS:
await client.loadIndex({ indexName: 'tenant-acme' });
```

At least one of `indexKey` / `kmsName` is required on `createIndex`, and you
must not supply both — the service rejects that with a 400 (the named slot
already determines the key source). Mode 1 is recorded server-side as
`provider: none`; `none` is not a registry slot you reference by name. The
LangChain integration accepts the same `kmsName` option in its store config.

## Documentation

For more information on CyborgDB, see the [Cyborg Docs](https://docs.cyborg.co).

## License

The CyborgDB JavaScript/TypeScript SDK is licensed under the MIT License.
