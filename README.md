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
- **Flexible Indexing**: Support for multiple index types (IVFFlat, IVFPQ, etc.) with customizable parameters

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
  topK: 10
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

## Documentation

For more information on CyborgDB, see the [Cyborg Docs](https://docs.cyborg.co).

## License

The CyborgDB JavaScript/TypeScript SDK is licensed under the MIT License.
