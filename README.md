# CyborgDB TypeScript SDK

**Project Description**

**CyborgDB TypeScript SDK**

The **CyborgDB TypeScript SDK** provides a comprehensive client library for interacting with CyborgDB, the first Confidential Vector Database. This SDK enables you to perform encrypted vector operations including ingestion, search, and retrieval while maintaining end-to-end encryption of your vector embeddings. Built with TypeScript, it offers full type safety and seamless integration into modern JavaScript and TypeScript applications.

**Why Use the TypeScript SDK?**

Vector Search powers critical AI applications like RAG systems, recommendation engines, and semantic search. The CyborgDB TypeScript SDK brings confidential computing to your web applications and Node.js services, ensuring your vector embeddings remain encrypted throughout their entire lifecycle while providing fast, accurate search capabilities.

**Key Features**

* **End-to-End Encryption**: All vector operations maintain encryption with client-side keys
* **Full TypeScript Support**: Complete type definitions and IntelliSense support
* **Batch Operations**: Efficient batch queries and upserts for high-throughput applications
* **Flexible Indexing**: Support for multiple index types (Flat, IVF, IVFPQ) with customizable parameters
* **Advanced Search**: Configurable approximate nearest neighbor search with metadata filtering
* **Robust Error Handling**: Comprehensive error handling with detailed error messages
* **Zero Dependencies on Crypto Libraries**: Uses built-in browser and Node.js crypto APIs

**Installation**

```bash
# Install the CyborgDB TypeScript SDK
npm install cyborgdb-sdk

# Or using yarn
yarn add cyborgdb-sdk

# Or using pnpm
pnpm add cyborgdb-sdk
```

**Quickstart**

```typescript
import { CyborgDB, IndexConfig } from 'cyborgdb-sdk';

// Initialize the client
const client = new CyborgDB('https://api.cyborgdb.com', 'your-api-key');

// Generate a 32-byte encryption key
const indexKey = new Uint8Array(32);
crypto.getRandomValues(indexKey);

// Create an IVF index configuration
const indexConfig: IndexConfig = {
  dimension: 1536,
  metric: 'cosine',
  indexType: 'IVF',
  nLists: 100
};

// Create an encrypted index
const index = await client.createIndex('my-index', indexKey, indexConfig);

// Add encrypted vector items
const items = [
  {
    id: 'doc1',
    vector: [0.1, 0.2, 0.3, /* ... 1536 dimensions */],
    contents: 'Hello world!',
    metadata: { category: 'greeting', language: 'en' }
  },
  {
    id: 'doc2', 
    vector: [0.4, 0.5, 0.6, /* ... 1536 dimensions */],
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
// Train the index for better performance (recommended for IVF indexes)
await index.train(2048, 100, 1e-6);
```

**Index Configuration Options**

**Index Types**
* **Flat**: Exact search, highest accuracy but slower for large datasets
* **IVF**: Inverted file index, balanced speed and accuracy
* **IVFPQ**: IVF with product quantization, fastest search with compression

**Distance Metrics**
* **cosine**: Cosine similarity (recommended for normalized embeddings)
* **l2**: Euclidean distance
* **ip**: Inner product

**Loading Existing Indexes**

```typescript
// Load an existing encrypted index
const existingIndex = await client.loadIndex('my-existing-index', indexKey);

// Check if index is trained
if (!existingIndex.isTrained()) {
  await existingIndex.train();
}
```

**Error Handling**

```typescript
try {
  const results = await index.query(queryVector);
} catch (error) {
  console.error('Query failed:', error.message);
  // Handle specific error types
  if (error.message.includes('404')) {
    console.log('Index not found');
  }
}
```

**API Reference**

**CyborgDB Class**
* `listIndexes()` - List all available indexes
* `createIndex(name, key, config, model?)` - Create a new encrypted index
* `loadIndex(name, key)` - Load an existing encrypted index
* `getHealth()` - Check server health status

**EncryptedIndex Class**
* `upsert(items)` - Add or update vectors
* `query(vector, topK?, nProbes?, greedy?, filters?, include?)` - Search vectors
* `get(ids, include?)` - Retrieve vectors by ID
* `delete(ids)` - Delete vectors
* `train(batchSize?, maxIters?, tolerance?)` - Train the index
* `deleteIndex()` - Delete the entire index

**System Requirements**

* **Node.js**: Version 16 or higher
* **TypeScript**: Version 4.5 or higher (optional, but recommended)
* **Browsers**: Modern browsers with Web Crypto API support
* **Memory**: Sufficient RAM for vector operations (depends on dataset size)

**Security Considerations**

* **Key Management**: Store encryption keys securely using environment variables or key management services
* **Client-Side Encryption**: All encryption happens client-side; keys never leave your application
* **HTTPS Required**: Always use HTTPS endpoints for API communication
* **Key Rotation**: Implement key rotation strategies for production deployments

**TypeScript Integration**

```typescript
import type { 
  VectorItem, 
  QueryResponse, 
  IndexConfig,
  GetResponseModel 
} from 'cyborgdb-sdk';

// Fully typed vector items
const typedItem: VectorItem = {
  id: 'doc1',
  vector: [0.1, 0.2, 0.3],
  contents: 'Document content',
  metadata: { category: 'science' }
};

// Type-safe query responses
const response: QueryResponse = await index.query(queryVector);
```

**Performance Tips**

* Use batch operations for multiple vectors
* Train IVF indexes after initial data loading
* Choose appropriate `nLists` values (√n where n is number of vectors)
* Use metadata filtering to reduce search space
* Consider IVFPQ for very large datasets where some accuracy trade-off is acceptable

**Documentation**

For more detailed documentation, visit:
* [CyborgDB Documentation](https://docs.cyborgdb.com)
* [TypeScript API Reference](https://docs.cyborgdb.com/typescript)
* [Examples Repository](https://github.com/cyborgdb/examples)

**License**

This project is licensed under the MIT License - see the LICENSE file for details.

**About CyborgDB**

CyborgDB is dedicated to making AI safe and secure through confidential computing. We develop solutions that enable organizations to leverage AI while maintaining the confidentiality and privacy of their data.

[Visit our website](https://cyborgdb.com) | [Contact Us](mailto:support@cyborgdb.com)