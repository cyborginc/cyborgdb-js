# CyborgDB JavaScript/TypeScript SDK

![NPM Version](https://img.shields.io/npm/v/cyborgdb)
![NPM License](https://img.shields.io/npm/l/cyborgdb)
![Node Current](https://img.shields.io/node/v/cyborgdb)

The **CyborgDB JavaScript/TypeScript SDK** provides a comprehensive client library for interacting with [CyborgDB](https://docs.cyborg.co), the first Confidential Vector Database. This SDK enables you to perform encrypted vector operations including ingestion, search, and retrieval while maintaining end-to-end encryption of your vector embeddings. Built with TypeScript, it offers full type safety and seamless integration into modern JavaScript and TypeScript applications.

This SDK provides an interface to [`cyborgdb-service`](https://pypi.org/project/cyborgdb-service/) which you will need to separately install and run in order to use the SDK. For more info, please see our [docs](https://docs.cyborg.co).

## Key Features

- **End-to-End Encryption**: All vector operations maintain encryption with client-side keys
- **Zero-Trust Design**: Novel architecture keeps confidential inference data secure
- **Full TypeScript Support**: Complete type definitions and IntelliSense support
- **Batch Operations**: Efficient batch queries and upserts for high-throughput applications
- **DiskIVF Indexing**: Two-stage inverted-file index with float32 reranking for high-recall search

## Getting Started

To get started in minutes, check out our [Quickstart Guide](https://docs.cyborg.co/quickstart).

### Installation

1. Install `cyborgdb-service`

```bash
# Install the CyborgDB Service
pip install cyborgdb-service

# Or via Docker
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

// Generate a 256-bit encryption key
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

#### Bring Your Own KMS (BYOK) & Multi-Tenancy

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
