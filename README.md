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

The **CyborgDB JavaScript/TypeScript SDK** is the JavaScript/TypeScript client for [CyborgDB](https://www.cyborg.co) — the vector database that stays encrypted even while it's searching. Run similarity search directly on encrypted data with client-side keys; only the result of a query is ever decrypted, never the index. Built with TypeScript, it ships full type definitions for modern JavaScript and TypeScript apps.

This SDK talks to [`cyborgdb-service`](https://hub.docker.com/r/cyborginc/cyborgdb-service), which you self-host in your own VPC or on-prem and run alongside your app. Install and start it separately. See our [docs](https://docs.cyborg.co) for more info.

## Key Features

- **Encryption-in-use**: Search runs directly on ciphertext — only the query result is decrypted, never the index or stored vectors
- **Encrypted ANN**: Disk-backed encrypted DiskIVF index with recall within 2% of a plaintext baseline ([read the benchmarks](https://www.cyborg.co/performance))
- **Filters on encrypted metadata**: Combine vector similarity with equality and range predicates in a single request
- **BYOK / HYOK**: Bring your own key via AWS, GCP, or Azure KMS, or keep the key client-side — you control the key material
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
import { Client } from 'cyborgdb';

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

// Add encrypted vector items
const items = [
  {
    id: 'doc1',
    vector: [0.1, 0.2, 0.3, /* ... 128 dimensions */],
    contents: 'Hello world!',
    metadata: { category: 'greeting', language: 'en' }
  },
  {
    id: 'doc2', 
    vector: [0.4, 0.5, 0.6, /* ... 128 dimensions */],
    contents: 'Bonjour le monde!',
    metadata: { category: 'greeting', language: 'fr' }
  }
];

await index.upsert({ items });

// Query the encrypted index
const queryVector = [0.1, 0.2, 0.3, /* ... 128 dimensions */];
const results = await index.query({
  queryVectors: queryVector,
  topK: 10,
  include: ['distance']
});

// Print the results
results.results.forEach(result => {
  console.log(`ID: ${result.id}, Distance: ${result.distance}`);
});
```

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

#### Metadata Filtering

```typescript
// Search with metadata filters
const results = await index.query({
  queryVectors: queryVector,
  topK: 10,
  nProbes: 1,
  greedy: false,
  filters: { category: 'greeting', language: 'en' },
  include: ['distance', 'metadata', 'contents']
});
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
