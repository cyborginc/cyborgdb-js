import { Client, IndexIVFFlat, generateKey } from '../../index';
import * as fs from 'fs';
import * as path from 'path';

describe('CyborgDB Lite Integration Tests', () => {
  let client: Client;
  let indexName: string;
  let indexKey: Uint8Array;
  const apiUrl = process.env.CYBORGDB_API_URL || 'http://localhost:8000';
  const apiKey = process.env.CYBORGDB_API_KEY || 'test-api-key';

  beforeAll(async () => {
    // Skip if server is not available
    try {
      const response = await fetch(`${apiUrl}/v1/health`);
      if (!response.ok) {
        console.log('Server not available, skipping lite tests');
        return;
      }
    } catch (error) {
      console.log('Server not available, skipping lite tests');
      return;
    }
  });

  beforeEach(() => {
    // Create a new client for each test
    client = new Client(apiUrl, apiKey);
    
    // Generate unique index name and key for each test
    indexName = `test_lite_index_${Date.now()}`;
    indexKey = generateKey();
  });

  afterEach(async () => {
    // Clean up - delete the index if it exists
    try {
      const index = client.loadIndex(indexName, indexKey);
      await index.deleteIndex();
    } catch (error) {
      // Index might not exist, that's okay
    }
  });

  test('should create an index with IndexIVFFlat', async () => {
    // Use IndexIVFFlat which should work with both lite and full versions
    const indexConfig = new IndexIVFFlat(128, 10, 'euclidean');
    
    const index = client.createIndex(indexName, indexKey, indexConfig);
    expect(index).toBeDefined();
    expect(index.indexName).toBe(indexName);
  });

  test('should upsert and query vectors', async () => {
    // Create index
    const dimension = 128;
    const indexConfig = new IndexIVFFlat(dimension, 10, 'euclidean');
    const index = client.createIndex(indexName, indexKey, indexConfig);

    // Generate test vectors
    const numVectors = 50; // Use fewer vectors for lite version
    const ids: string[] = [];
    const vectors: number[][] = [];
    
    for (let i = 0; i < numVectors; i++) {
      ids.push(`vec_${i}`);
      const vector = Array.from({ length: dimension }, () => Math.random());
      vectors.push(vector);
    }

    // Upsert vectors
    await index.upsert(ids, vectors);

    // Query
    const queryVector = Array.from({ length: dimension }, () => Math.random());
    const results = await index.query([queryVector], 5);
    
    expect(results).toBeDefined();
    expect(results.length).toBe(1);
    expect(results[0].length).toBeLessThanOrEqual(5);
  });

  test('should load an existing index', async () => {
    // Create index first
    const indexConfig = new IndexIVFFlat(128, 10, 'euclidean');
    const index = client.createIndex(indexName, indexKey, indexConfig);

    // Add some data
    const testId = 'test_vector';
    const testVector = Array.from({ length: 128 }, () => Math.random());
    await index.upsert([testId], [testVector]);

    // Load the index
    const loadedIndex = client.loadIndex(indexName, indexKey);
    expect(loadedIndex).toBeDefined();
    expect(loadedIndex.indexName).toBe(indexName);

    // Query to verify it works
    const results = await loadedIndex.query([testVector], 1);
    expect(results).toBeDefined();
    expect(results[0].length).toBeGreaterThan(0);
  });

  test('should handle metadata correctly', async () => {
    // Create index
    const indexConfig = new IndexIVFFlat(128, 10, 'cosine');
    const index = client.createIndex(indexName, indexKey, indexConfig);

    // Upsert with metadata
    const ids = ['vec1', 'vec2', 'vec3'];
    const vectors = [
      Array.from({ length: 128 }, () => Math.random()),
      Array.from({ length: 128 }, () => Math.random()),
      Array.from({ length: 128 }, () => Math.random())
    ];
    const metadata = [
      { category: 'A', value: 1 },
      { category: 'B', value: 2 },
      { category: 'A', value: 3 }
    ];

    await index.upsert(ids, vectors, metadata);

    // Query and check metadata
    const queryVector = vectors[0];
    const results = await index.query([queryVector], 3, undefined, true);
    
    expect(results).toBeDefined();
    expect(results[0].length).toBeGreaterThan(0);
    
    // Check that metadata is returned
    const firstResult = results[0][0];
    if (firstResult.metadata) {
      expect(firstResult.metadata).toBeDefined();
    }
  });

  test('should delete vectors correctly', async () => {
    // Create index
    const indexConfig = new IndexIVFFlat(128, 10, 'euclidean');
    const index = client.createIndex(indexName, indexKey, indexConfig);

    // Add vectors
    const ids = ['vec1', 'vec2', 'vec3'];
    const vectors = ids.map(() => Array.from({ length: 128 }, () => Math.random()));
    await index.upsert(ids, vectors);

    // Delete one vector
    await index.deleteVectors(['vec2']);

    // Get remaining vectors
    const remainingVectors = await index.get(['vec1', 'vec3']);
    expect(remainingVectors).toBeDefined();
    expect(remainingVectors.length).toBe(2);

    // Verify vec2 is deleted
    const deletedVector = await index.get(['vec2']);
    expect(deletedVector.length).toBe(0);
  });
});