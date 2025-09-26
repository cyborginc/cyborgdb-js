/**
 * LangChain integration tests for CyborgDB JavaScript SDK.
 * 
 * This module tests the LangChain VectorStore implementation for CyborgDB.
 */

import { Document, Embeddings } from '../integrations/langchain/vectorstore';
import { CyborgVectorStore } from '../integrations/langchain';
import { CyborgDB } from '../client';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

/**
 * Mock embeddings for testing that generates semantically meaningful vectors.
 */
class MockEmbeddings implements Embeddings {
  private dimension: number;
  private vocab: Map<string, number>;
  private vocabSize: number;

  constructor(dimension = 384) {
    this.dimension = dimension;
    this.vocab = new Map();
    this.vocabSize = 0;
  }

  private textToVector(text: string): number[] {
    // Tokenize and normalize
    const words = text.toLowerCase().split(/\s+/);

    // Build vocabulary on the fly
    for (const word of words) {
      if (!this.vocab.has(word)) {
        this.vocab.set(word, this.vocabSize);
        this.vocabSize++;
      }
    }

    // Create a sparse vector representation
    const vector = new Array(this.dimension).fill(0);

    // Use TF representation with position encoding
    words.forEach((word, i) => {
      if (this.vocab.has(word)) {
        const wordIdx = this.vocab.get(word)!;
        // Spread the word representation across multiple dimensions
        const baseIdx = (wordIdx * 7) % this.dimension; // 7 is a prime number

        // Add term frequency
        vector[baseIdx] += 1.0;

        // Add position encoding to neighboring dimensions
        if (baseIdx + 1 < this.dimension) {
          vector[baseIdx + 1] += 0.5 / (i + 1); // Position weight
        }
        if (baseIdx + 2 < this.dimension) {
          vector[baseIdx + 2] += 0.3; // Word presence indicator
        }
      }
    });

    // Add some deterministic noise based on full text
    const seed = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const random = this.seededRandom(seed);
    for (let i = 0; i < this.dimension; i++) {
      vector[i] += (random() - 0.5) * 0.2; // Small noise
    }

    // Normalize to unit length (important for cosine similarity)
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      return vector.map(val => val / norm);
    }

    return vector;
  }

  private seededRandom(seed: number): () => number {
    return () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map(text => this.textToVector(text));
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.textToVector(text);
  }
}

describe('CyborgDB LangChain Integration', () => {
  let vectorStore: CyborgVectorStore;
  let client: CyborgDB;
  const testIndexName = `test_langchain_${Date.now()}`;
  const baseUrl = process.env.CYBORGDB_BASE_URL || 'http://localhost:8000';
  const apiKey = process.env.CYBORGDB_API_KEY || 'test-key';

  beforeAll(async () => {
    // Create a client instance
    client = new CyborgDB({
      baseUrl,
      apiKey,
      verifySsl: false
    });

    // Generate a key for the test index
    const indexKey = CyborgDB.generateKey();

    // Create the vector store
    vectorStore = new CyborgVectorStore(
      new MockEmbeddings(384),
      {
        indexName: testIndexName,
        indexKey,
        apiKey,
        baseUrl,
        embedding: new MockEmbeddings(384),
        indexType: 'ivfflat',
        dimension: 384,
        metric: 'cosine',
        verifySsl: false
      }
    );
  });

  afterAll(async () => {
    // Clean up: delete the test index
    try {
      // Access the index and delete it
      const index = (vectorStore as any).index;
      if (index) {
        await index.deleteIndex();
      }
    } catch (error) {
      console.error('Error cleaning up test index:', error);
    }
  });

  describe('Basic Operations', () => {
    test('should add texts to the vector store', async () => {
      const texts = [
        'The quick brown fox jumps over the lazy dog',
        'Machine learning is a subset of artificial intelligence',
        'CyborgDB provides encrypted vector storage'
      ];
      
      const ids = await vectorStore.addTexts(texts);
      
      expect(ids).toHaveLength(3);
      ids.forEach(id => {
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
      });
    });

    test('should add documents to the vector store', async () => {
      const documents: Document[] = [
        {
          pageContent: 'TypeScript is a typed superset of JavaScript',
          metadata: { source: 'docs', topic: 'programming' }
        },
        {
          pageContent: 'React is a JavaScript library for building user interfaces',
          metadata: { source: 'tutorial', topic: 'frontend' }
        }
      ];
      
      const ids = await vectorStore.addDocuments(documents);
      
      expect(ids).toHaveLength(2);
    });

    test('should add texts with custom IDs', async () => {
      const texts = ['Custom ID test 1', 'Custom ID test 2'];
      const customIds = ['custom-1', 'custom-2'];
      
      const ids = await vectorStore.addTexts(texts, undefined, { ids: customIds });
      
      expect(ids).toEqual(customIds);
    });

    test('should add texts with metadata', async () => {
      const texts = ['Text with metadata'];
      const metadatas = [{ category: 'test', priority: 'high' }];
      
      const ids = await vectorStore.addTexts(texts, metadatas);
      
      expect(ids).toHaveLength(1);
      
      // Retrieve and verify metadata
      const docs = await vectorStore.get(ids);
      expect(docs).toHaveLength(1);
      expect(docs[0].metadata).toMatchObject({ category: 'test', priority: 'high' });
    });
  });

  describe('Search Operations', () => {
    beforeAll(async () => {
      // Add some test documents for searching
      const documents: Document[] = [
        {
          pageContent: 'Python is a high-level programming language',
          metadata: { language: 'python', type: 'programming' }
        },
        {
          pageContent: 'JavaScript runs in browsers and Node.js',
          metadata: { language: 'javascript', type: 'programming' }
        },
        {
          pageContent: 'Machine learning models can process large datasets',
          metadata: { field: 'ml', type: 'ai' }
        },
        {
          pageContent: 'Deep learning uses neural networks',
          metadata: { field: 'dl', type: 'ai' }
        },
        {
          pageContent: 'Vector databases store high-dimensional data',
          metadata: { field: 'database', type: 'storage' }
        }
      ];
      
      await vectorStore.addDocuments(documents);
    });

    test('should perform similarity search', async () => {
      const query = 'programming languages';
      const results = await vectorStore.similaritySearch(query, 3);
      
      expect(results).toHaveLength(3);
      results.forEach((doc: Document) => {
        expect(doc).toHaveProperty('pageContent');
        expect(doc).toHaveProperty('metadata');
        expect(typeof doc.pageContent).toBe('string');
      });
    });

    test('should perform similarity search with scores', async () => {
      const query = 'neural networks and deep learning';
      const results = await vectorStore.similaritySearchWithScore(query, 2);
      
      expect(results).toHaveLength(2);
      results.forEach(([doc, score]: [Document, number]) => {
        expect(doc).toHaveProperty('pageContent');
        expect(doc).toHaveProperty('metadata');
        expect(typeof score).toBe('number');
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      });
    });

    test('should perform similarity search with metadata filter', async () => {
      const query = 'programming';
      const filter = { type: 'programming' };
      const results = await vectorStore.similaritySearch(query, 5, filter);
      
      results.forEach((doc: Document) => {
        expect(doc.metadata.type).toBe('programming');
      });
    });

    test('should perform vector similarity search', async () => {
      const embeddings = new MockEmbeddings(384);
      const queryVector = await embeddings.embedQuery('machine learning algorithms');
      
      const results = await vectorStore.similaritySearchVectorWithScore(queryVector, 3);
      
      expect(results).toHaveLength(3);
      results.forEach(([doc, score]: [Document, number]) => {
        expect(doc).toHaveProperty('pageContent');
        expect(doc).toHaveProperty('metadata');
        expect(typeof score).toBe('number');
      });
    });
  });

  describe('Document Management', () => {
    test('should retrieve documents by ID', async () => {
      const texts = ['Retrievable text 1', 'Retrievable text 2'];
      const ids = await vectorStore.addTexts(texts);
      
      const docs = await vectorStore.get(ids);
      
      expect(docs).toHaveLength(2);
      expect(docs[0].pageContent).toBe('Retrievable text 1');
      expect(docs[1].pageContent).toBe('Retrievable text 2');
    });

    test('should list all document IDs', async () => {
      const ids = await vectorStore.listIds();
      
      expect(Array.isArray(ids)).toBe(true);
      expect(ids.length).toBeGreaterThan(0);
      ids.forEach(id => {
        expect(typeof id).toBe('string');
      });
    });

    test('should delete documents by ID', async () => {
      const texts = ['Text to delete'];
      const ids = await vectorStore.addTexts(texts);
      
      await vectorStore.delete({ ids });
      
      const remainingIds = await vectorStore.listIds();
      expect(remainingIds).not.toContain(ids[0]);
    });
  });

  describe('Factory Methods', () => {
    test('should create vector store from texts', async () => {
      const texts = ['Factory text 1', 'Factory text 2'];
      const metadatas = [{ source: 'factory' }, { source: 'factory' }];
      
      const indexKey = CyborgDB.generateKey();
      const store = await CyborgVectorStore.fromTexts(
        texts,
        metadatas,
        new MockEmbeddings(384),
        {
          indexName: `factory_test_${Date.now()}`,
          indexKey,
          apiKey,
          baseUrl,
          embedding: new MockEmbeddings(384),
          verifySsl: false
        }
      );
      
      expect(store).toBeInstanceOf(CyborgVectorStore);
      
      const ids = await store.listIds();
      expect(ids.length).toBeGreaterThanOrEqual(2);
      
      // Clean up
      const index = (store as any).index;
      if (index) {
        await index.deleteIndex();
      }
    });

    test('should create vector store from documents', async () => {
      const documents: Document[] = [
        {
          pageContent: 'Document from factory',
          metadata: { created: 'factory' }
        }
      ];
      
      const indexKey = CyborgDB.generateKey();
      const store = await CyborgVectorStore.fromDocuments(
        documents,
        new MockEmbeddings(384),
        {
          indexName: `factory_docs_${Date.now()}`,
          indexKey,
          apiKey,
          baseUrl,
          embedding: new MockEmbeddings(384),
          verifySsl: false
        }
      );
      
      expect(store).toBeInstanceOf(CyborgVectorStore);
      
      // Clean up
      const index = (store as any).index;
      if (index) {
        await index.deleteIndex();
      }
    });

    test('should create vector store from existing index', async () => {
      const indexKey = vectorStore['indexKey'] as Uint8Array;
      const store = await CyborgVectorStore.fromExistingIndex(
        new MockEmbeddings(384),
        {
          indexName: testIndexName,
          indexKey,
          apiKey,
          baseUrl,
          embedding: new MockEmbeddings(384),
          verifySsl: false
        }
      );
      
      expect(store).toBeInstanceOf(CyborgVectorStore);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty text array', async () => {
      const ids = await vectorStore.addTexts([]);
      expect(ids).toEqual([]);
    });

    test('should handle retrieving non-existent documents', async () => {
      const docs = await vectorStore.get(['non-existent-id']);
      expect(docs).toEqual([]);
    });

    test('should handle search with no results', async () => {
      const results = await vectorStore.similaritySearch(
        'completely unrelated query that should not match anything xyz123',
        1
      );
      // Even with no good matches, similarity search typically returns results
      // but they should have low relevance
      expect(Array.isArray(results)).toBe(true);
    });
  });
});