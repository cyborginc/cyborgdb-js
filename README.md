# CyborgDB JavaScript/TypeScript SDK

The **CyborgDB JavaScript/TypeScript SDK** provides a comprehensive client library for interacting with [CyborgDB](https://www.cyborg.co), the first Confidential Vector Database. This SDK enables you to perform encrypted vector operations including ingestion, search, and retrieval while maintaining end-to-end encryption of your vector embeddings. Built with TypeScript, it offers full type safety and seamless integration into modern JavaScript and TypeScript applications.

This SDK provides an interface to `cyborgdb-service` which you will need to separately install and run in order to use the SDK. For more info, please see our [docs](https://docs.cyborg.co)

**Why CyborgDB?**

Vector Search powers critical AI applications like RAG systems, recommendation engines, and semantic search. The CyborgDB JS/TS SDK brings confidential computing to your web applications and Node.js services, ensuring vector embeddings remain encrypted throughout their entire lifecycle while providing fast, accurate search capabilities.

**Key Features**

* **End-to-End Encryption**: All vector operations maintain encryption with client-side keys
* **Full TypeScript Support**: Complete type definitions and IntelliSense support
* **Batch Operations**: Efficient batch queries and upserts for high-throughput applications
* **Flexible Indexing**: Support for multiple index types (IVFFlat, IVFPQ, etc.) with customizable parameters

**Installation**

1. Install `cyborgdb-service`

2. Install `cyborgdb` SDK:

```bash
# Install the CyborgDB TypeScript SDK
npm install cyborgdb
```

**Usage**

```typescript
import { Client, IndexIVFFlat } from 'cyborgdb';

// Initialize the client
const client = new Client('https://localhost:8000', 'your-api-key');

// Generate a 32-byte encryption key
const indexKey = new Uint8Array(32);
crypto.getRandomValues(indexKey);

// Create an encrypted index
const index = await client.createIndex('my-index', indexKey, IndexIVFFlat(128, 1024));

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

await index.upsert(items);

// Query the encrypted index
const queryVector = [0.1, 0.2, 0.3, /* ... 1536 dimensions */];
const results = await index.query(queryVector, 10);

// Print the results
results.results.forEach(result => {
  console.log(`ID: ${result.id}, Distance: ${result.distance}`);
});
```

**Advanced Usage**

**Batch Queries**

```typescript
// Search with multiple query vectors simultaneously
const queryVectors = [
  [0.1, 0.2, 0.3, /* ... */],
  [0.4, 0.5, 0.6, /* ... */]
];

const batchResults = await index.query(queryVectors, 5);
```

**Metadata Filtering**

```typescript
// Search with metadata filters
const results = await index.query(
  queryVector,
  10,      // topK
  1,       // nProbes
  false,   // greedy
  { category: 'greeting', language: 'en' }, // filters
  ['distance', 'metadata', 'contents']      // include
);
```

**Index Training**

```typescript
// Train the index for better query performance (recommended for IVF indexes)
await index.train(2048, 100, 1e-6);
```

**Documentation**

For more detailed documentation, visit:
* [CyborgDB Documentation](https://docs.cyborg.co/)

**License**

The CyborgDB JavaScript/TypeScript SDK is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

**About CyborgDB**

CyborgDB is dedicated to making AI safe and secure through confidential computing. We develop solutions that enable organizations to leverage AI while maintaining the confidentiality and privacy of their data.

[Visit our website](https://www.cyborg.co/) | [Contact Us](mailto:hello@cyborg.co)