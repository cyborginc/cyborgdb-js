# LangChain Integration for CyborgDB

The CyborgDB JavaScript SDK provides seamless integration with LangChain, enabling you to use CyborgDB as a vector store in your LangChain applications while maintaining end-to-end encryption of your vector embeddings.

## Installation

First, ensure you have the required dependencies:

```bash
npm install cyborgdb
```

Note: The LangChain integration is built into the CyborgDB SDK. If you need the official LangChain libraries for other components, install them separately:

```bash
npm install @langchain/core  # Optional, for other LangChain components
```

## Quick Start

```typescript
import { CyborgVectorStore } from 'cyborgdb/integrations/langchain';
import { CyborgDB } from 'cyborgdb';

// Initialize the client
const client = new CyborgDB({
  baseUrl: 'http://localhost:8000',
  apiKey: 'your-api-key',
  verifySsl: false
});

// Generate an encryption key for your index
const indexKey = CyborgVectorStore.generateKey();

// Create a vector store with your embedding model
const vectorStore = new CyborgVectorStore(
  yourEmbeddingModel, // Your LangChain-compatible embedding model
  {
    indexName: 'my-encrypted-index',
    indexKey: indexKey,
    apiKey: 'your-api-key',
    baseUrl: 'http://localhost:8000',
    embedding: yourEmbeddingModel,
    indexType: 'ivfflat',
    dimension: 384, // Your embedding dimension
    metric: 'cosine',
    verifySsl: false
  }
);
```

## Core Features

### Adding Documents

```typescript
// Add texts with metadata
const texts = [
  'The quick brown fox jumps over the lazy dog',
  'Machine learning is a subset of artificial intelligence'
];

const metadatas = [
  { source: 'document1', page: 1 },
  { source: 'document2', page: 5 }
];

const ids = await vectorStore.addTexts(texts, metadatas);

// Add LangChain documents
const documents = [
  {
    pageContent: 'TypeScript is a typed superset of JavaScript',
    metadata: { source: 'docs', topic: 'programming' }
  },
  {
    pageContent: 'React is a JavaScript library for UI',
    metadata: { source: 'tutorial', topic: 'frontend' }
  }
];

await vectorStore.addDocuments(documents);
```

### Similarity Search

```typescript
// Basic similarity search
const results = await vectorStore.similaritySearch(
  'programming languages',
  5 // Return top 5 results
);

// Search with scores
const resultsWithScores = await vectorStore.similaritySearchWithScore(
  'neural networks',
  3
);

resultsWithScores.forEach(([doc, score]) => {
  console.log(`Score: ${score}, Content: ${doc.pageContent}`);
});

// Search with metadata filters
const filteredResults = await vectorStore.similaritySearch(
  'typescript',
  5,
  { topic: 'programming' } // Filter by metadata
);
```

### Vector Search

```typescript
// Search using pre-computed embeddings
const queryVector = await yourEmbeddingModel.embedQuery('your query');
const vectorResults = await vectorStore.similaritySearchVectorWithScore(
  queryVector,
  10
);
```

### Document Management

```typescript
// Retrieve documents by ID
const docIds = ['doc1', 'doc2'];
const docs = await vectorStore.get(docIds);

// List all document IDs
const allIds = await vectorStore.listIds();

// Delete documents
await vectorStore.delete({ ids: ['doc1', 'doc2'] });
```

## Factory Methods

### Create from Texts

```typescript
const vectorStore = await CyborgVectorStore.fromTexts(
  texts,
  metadatas,
  embeddings,
  {
    indexName: 'text-index',
    indexKey: CyborgVectorStore.generateKey(),
    apiKey: 'your-api-key',
    baseUrl: 'http://localhost:8000',
    embedding: embeddings
  }
);
```

### Create from Documents

```typescript
const vectorStore = await CyborgVectorStore.fromDocuments(
  documents,
  embeddings,
  {
    indexName: 'doc-index',
    indexKey: CyborgVectorStore.generateKey(),
    apiKey: 'your-api-key',
    baseUrl: 'http://localhost:8000',
    embedding: embeddings
  }
);
```

### Load Existing Index

```typescript
const vectorStore = await CyborgVectorStore.fromExistingIndex(
  embeddings,
  {
    indexName: 'existing-index',
    indexKey: yourStoredKey, // Use the same key that created the index
    apiKey: 'your-api-key',
    baseUrl: 'http://localhost:8000',
    embedding: embeddings
  }
);
```

## Configuration Options

### Index Types

- `ivfflat`: IVF with flat quantization (default)
- `ivf`: Standard IVF index
- `ivfpq`: IVF with product quantization

### Distance Metrics

- `cosine`: Cosine similarity (default)
- `euclidean`: Euclidean distance
- `squared_euclidean`: Squared Euclidean distance

### Index Configuration Parameters

```typescript
const config = {
  indexName: 'advanced-index',
  indexKey: indexKey,
  apiKey: 'your-api-key',
  baseUrl: 'http://localhost:8000',
  embedding: embeddings,
  indexType: 'ivfpq',
  indexConfigParams: {
    pq_dim: 8,  // For IVFPQ: number of sub-quantizers
    pq_bits: 8  // For IVFPQ: bits per sub-quantizer
  },
  dimension: 768,
  metric: 'cosine',
  verifySsl: true
};
```

## Embedding Models

The integration works with any LangChain-compatible embedding model that implements the `Embeddings` interface:

```typescript
interface Embeddings {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}
```

Example with a custom embedding model:

```typescript
class CustomEmbeddings implements Embeddings {
  async embedDocuments(texts: string[]): Promise<number[][]> {
    // Your embedding logic here
    return texts.map(text => this.embed(text));
  }
  
  async embedQuery(text: string): Promise<number[]> {
    // Your embedding logic here
    return this.embed(text);
  }
  
  private embed(text: string): number[] {
    // Generate embedding vector
    return Array(384).fill(0).map(() => Math.random());
  }
}
```

## Best Practices

1. **Key Management**: Store your encryption keys securely. The same key must be used to access an encrypted index.

2. **Batch Operations**: When adding multiple documents, use batch operations for better performance:
   ```typescript
   await vectorStore.addDocuments(largeBatchOfDocuments);
   ```

3. **Metadata Filtering**: Use metadata filters to narrow search scope and improve relevance:
   ```typescript
   const results = await vectorStore.similaritySearch(query, k, {
     category: 'technical',
     language: 'en'
   });
   ```

4. **Index Configuration**: Choose the appropriate index type based on your use case:
   - Use `ivfflat` for smaller datasets or when accuracy is critical
   - Use `ivfpq` for larger datasets where memory efficiency is important

## Error Handling

```typescript
try {
  const results = await vectorStore.similaritySearch('query');
} catch (error) {
  if (error.message.includes('Index not initialized')) {
    // Handle initialization errors
  } else if (error.message.includes('not found')) {
    // Handle missing documents
  } else {
    // Handle other errors
  }
}
```

## Migration from Python

The JavaScript/TypeScript integration follows the same patterns as the Python implementation, making migration straightforward:

```typescript
// Python: vector_store = CyborgVectorStore(...)
// JavaScript:
const vectorStore = new CyborgVectorStore(...);

// Python: vector_store.add_texts(texts, metadatas)
// JavaScript:
await vectorStore.addTexts(texts, metadatas);

// Python: vector_store.similarity_search(query, k=5)
// JavaScript:
await vectorStore.similaritySearch(query, 5);
```

## Support

For more information about CyborgDB, visit the [official documentation](https://docs.cyborg.co).

For issues or questions about the LangChain integration, please open an issue on the [GitHub repository](https://github.com/cyborginc/cyborgdb-js).