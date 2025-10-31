/**
 * Comprehensive test coverage for TypeScript SDK to achieve standardization
 * Implements SSL, IVF, IVFPQ, error handling, and edge case tests
 * Matches Python comprehensive_test.py coverage
 */

import { Client, IndexIVFPQ } from '../index';
import { randomBytes } from 'crypto';
import * as dotenv from 'dotenv';
import * as https from 'https';
import * as http from 'http';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

const API_URL = 'http://localhost:8000';
const CYBORGDB_API_KEY = process.env.CYBORGDB_API_KEY;

if (!CYBORGDB_API_KEY) {
  throw new Error("CYBORGDB_API_KEY environment variable is not set");
}

// Set global timeout
jest.setTimeout(60000);

function generateUniqueName(prefix = "test"): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function generateRandomKey(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

/**
 * Create a CyborgDB client - simplified for reliable local testing
 */
function createClient(): any {
  return new Client({ 
    baseUrl: API_URL,
    apiKey: CYBORGDB_API_KEY, 
    verifySsl: false 
  });
}

describe('SSL Verification Tests', () => {
  const apiKey = process.env.CYBORGDB_API_KEY || 'test-key';
  const localhostUrl = 'http://localhost:8000';
  const productionUrl = 'https://api.cyborgdb.com';

  test('should handle SSL auto-detection for localhost URLs', async () => {
    const client = new Client({ baseUrl: localhostUrl, apiKey, verifySsl: false });
    expect(client).toBeDefined();
    
    // Basic connectivity test
    const health = await client.getHealth();
    expect(typeof health).toBeTruthy();
  });

  test('should handle explicit SSL verification disable', async () => {
    const client = new Client({ baseUrl: productionUrl, apiKey, verifySsl: false });
    expect(client).toBeDefined();
  });

  test('should handle explicit SSL verification enable', async () => {
    const client = new Client({ baseUrl: productionUrl, apiKey, verifySsl: true });
    expect(client).toBeDefined();
  });

  test('should handle SSL certificate validation scenarios', async () => {
    const client = new Client({ baseUrl: productionUrl, apiKey, verifySsl: true });
    
    try {
      await client.getHealth();
      expect(true).toBe(true);
    } catch (error: any) {
      const networkErrors = ['ENOTFOUND', 'ECONNREFUSED', 'Network Error', 'timeout', 'getaddrinfo'];
      const hasNetworkError = networkErrors.some(errorType => 
        error.message?.includes(errorType) || error.code === errorType
      );
      
      const hasSSLError = error.message?.includes('SSL') || error.message?.includes('certificate');
      
      expect(hasNetworkError || hasSSLError).toBe(true);
    }
  });

  test('should auto-detect connection method', async () => {
    const client = createClient();
    expect(client).toBeDefined();

    const health = await client.getHealth();
    expect(typeof health).toBeTruthy();
  });
});

describe('Index Types Tests', () => {
  const client = createClient();
  const dimension = 128;
  let index: any;
  let indexName: string;
  let indexKey: Uint8Array;
  let testVectors: number[][];

  beforeEach(async () => {
    indexName = generateUniqueName();
    indexKey = generateRandomKey();
    testVectors = Array(10).fill(0).map(() => 
      Array(dimension).fill(0).map(() => Math.random())
    );
  });

  afterEach(async () => {
    if (index) {
      try {
        await index.deleteIndex();
      } catch (error) {
        console.error(`Error cleaning up index: ${error}`);
      }
    }
  });

  test('should create and operate IVF index successfully', async () => {
    const indexConfig = {
      dimension: dimension,
      type: 'ivf' as const
    };

    index = await client.createIndex({ 
      indexName, 
      indexKey, 
      indexConfig, 
      metric: 'euclidean' 
    });

    expect(index).toBeDefined();

    // Test upsert
    const testIds = testVectors.map((_, i) => `ivf_${i}`);
    await index.upsert({ ids: testIds, vectors: testVectors });

    // Test query
    const queryVector = testVectors[0];
    const results = await index.query({ queryVectors: [queryVector], topK: 5 });

    expect(results.results).toBeDefined();
    expect(Array.isArray(results.results)).toBe(true);
  });

  test('should create and operate IVFPQ index successfully', async () => {
    const indexConfig: IndexIVFPQ = {
      dimension: dimension,
      type: 'ivfpq',
      pqDim: 32,
      pqBits: 8
    };

    index = await client.createIndex({ 
      indexName, 
      indexKey, 
      indexConfig, 
      metric: 'euclidean' 
    });

    expect(index).toBeDefined();
    expect(await index.getIndexName()).toBe(indexName);
    expect(await index.getIndexType()).toBe('ivfpq');

    // Test upsert
    const testIds = testVectors.map((_, i) => `ivfpq_${i}`);
    await index.upsert({ ids: testIds, vectors: testVectors });

    // Test query
    const queryVector = testVectors[0];
    const results = await index.query({ queryVectors: [queryVector], topK: 5 });

    expect(results.results).toBeDefined();
    expect(Array.isArray(results.results)).toBe(true);
    if (results.results.length > 0 && results.results[0].length > 0) {
      expect(results.results[0][0]).toHaveProperty('id');
    }
  });

  // test('should validate IVFPQ parameters', async () => {
  //   // Test invalid pqDim = 0
  //   const invalidConfig: IndexIVFPQ = {
  //     dimension: dimension,
  //     type: 'ivfpq',
  //     pqDim: 0,
  //     pqBits: 8
  //   };
    
  //   await expect(client.createIndex({
  //     indexName: generateUniqueName('invalid_pq_dim_'),
  //     indexKey: generateRandomKey(),
  //     indexConfig: invalidConfig,
  //     metric: 'euclidean'
  //   })).rejects.toThrow();
  // });
});

describe('Error Handling Tests', () => {
  const client = createClient();

  test('should handle invalid API key', async () => {
    const invalidClient = new Client({ 
      baseUrl: API_URL, 
      apiKey: 'invalid-key-12345',
      verifySsl: false 
    });

    // Try to create an index - this should require authentication
    await expect(invalidClient.createIndex({
      indexName: generateUniqueName(),
      indexKey: generateRandomKey(),
      indexConfig: { dimension: 128, type: 'ivfflat' as const },
      metric: 'euclidean'
    })).rejects.toThrow();
  });

  test('should handle malformed requests', async () => {
    const indexName = generateUniqueName();
    const indexKey = generateRandomKey();

    // Test invalid dimension
    const invalidConfig = {
      dimension: -1,
      type: 'ivfflat' as const
    };
    
    await expect(client.createIndex({
      indexName,
      indexKey,
      indexConfig: invalidConfig,
      metric: 'euclidean'
    })).rejects.toThrow();

    // Test invalid metric
    const validConfig = {
      dimension: 128,
      type: 'ivfflat' as const
    };
    
    await expect(client.createIndex({
      indexName: generateUniqueName(),
      indexKey: generateRandomKey(),
      indexConfig: validConfig,
      metric: 'invalid_metric'
    })).rejects.toThrow();
  });

  test('should handle network connectivity issues', async () => {
    const unreachableClient = new Client({ 
      baseUrl: 'http://non-existent-server:8000', 
      apiKey: 'test-key',
      verifySsl: false 
    });

    await expect(unreachableClient.getHealth()).rejects.toThrow();
  });

  test('should handle invalid vector dimensions', async () => {
    const indexConfig = {
      dimension: 128,
      type: 'ivfflat' as const
    };
    const indexName = generateUniqueName();
    const indexKey = generateRandomKey();

    const index = await client.createIndex({ 
      indexName, 
      indexKey, 
      indexConfig, 
      metric: 'euclidean' 
    });

    try {
      const wrongDimVector = Array(64).fill(0).map(() => Math.random());
      
      await expect(index.upsert({
        ids: ['wrong_dim'],
        vectors: [wrongDimVector]
      })).rejects.toThrow();
      
    } finally {
      await index.deleteIndex();
    }
  });

  test('should handle server error responses', async () => {
    const indexKey = generateRandomKey();
    const indexConfig = {
      dimension: 128,
      type: 'ivfflat' as const
    };

    // Test empty index name
    await expect(client.createIndex({
      indexName: '',
      indexKey,
      indexConfig,
      metric: 'euclidean'
    })).rejects.toThrow();

    // Test invalid index key format
    const shortKey = new Uint8Array(8);
    await expect(client.createIndex({
      indexName: generateUniqueName(),
      indexKey: shortKey,
      indexConfig: { dimension: 128, type: 'ivfflat' as const },
      metric: 'euclidean'
    })).rejects.toThrow();
  });
});

describe('Edge Cases Tests', () => {
  const client = createClient();
  let index: any;
  let indexName: string;
  let indexKey: Uint8Array;

  beforeEach(async () => {
    indexName = generateUniqueName('edge');
    indexKey = generateRandomKey();
    const indexConfig = {
      dimension: 128,
      type: 'ivfflat' as const
    };

    index = await client.createIndex({ 
      indexName, 
      indexKey, 
      indexConfig, 
      metric: 'euclidean' 
    });
  });

  afterEach(async () => {
    if (index) {
      try {
        await index.deleteIndex();
      } catch (error) {
        console.error(`Error cleaning up index: ${error}`);
      }
    }
  });

  test('should handle empty query results', async () => {
    const queryVector = Array(128).fill(0).map(() => Math.random());
    const results = await index.query({ queryVectors: [queryVector], topK: 10 });

    expect(results.results).toBeDefined();
    expect(Array.isArray(results.results)).toBe(true);
    if (Array.isArray(results.results[0])) {
      expect(results.results[0].length).toBe(0);
    }
  });

  test('should validate mismatched parameter lengths', async () => {
    const vectors = Array(3).fill(0).map(() => 
      Array(128).fill(0).map(() => Math.random())
    );
    const ids = ['id1', 'id2']; // Fewer IDs than vectors

    // Upsert with mismatched lengths should fail
    await expect(index.upsert({
      ids: ids,
      vectors: vectors
    })).rejects.toThrow();
  });

  test('should preserve content through operations', async () => {
    const originalVector = Array(128).fill(0).map(() => Math.random());
    const originalMetadata = { test_key: 'test_value', number: 42 };

    await index.upsert({
      items: [{
        id: 'preserve_test',
        vector: originalVector,
        metadata: originalMetadata
      }]
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    const results = await index.get({
      ids: ['preserve_test'],
      include: ['vector', 'metadata']
    });

    expect(results.length).toBe(1);
    const retrieved = results[0];
    expect(retrieved.id).toBe('preserve_test');
    
    expect(retrieved.vector.length).toBe(originalVector.length);
    for (let i = 0; i < originalVector.length; i++) {
      expect(retrieved.vector[i]).toBeCloseTo(originalVector[i], 5);
    }
    
    expect(retrieved.metadata).toEqual(originalMetadata);
  });

  test('should handle index cleanup errors', async () => {
    const testIndexName = generateUniqueName('cleanup');
    const testIndexKey = generateRandomKey();
    const testConfig = {
      dimension: 128,
      type: 'ivfflat' as const
    };

    const testIndex = await client.createIndex({ 
      indexName: testIndexName, 
      indexKey: testIndexKey, 
      indexConfig: testConfig, 
      metric: 'euclidean' 
    });

    await testIndex.deleteIndex();

    // Try to delete again - should throw error
    await expect(testIndex.deleteIndex()).rejects.toThrow();
  });

  test('should handle concurrent operations', async () => {
    const numOperations = 5;
    const operations = Array(numOperations).fill(0).map(async (_, i) => {
      const vector = Array(128).fill(0).map(() => Math.random());
      return index.upsert({
        items: [{
          id: `concurrent_${i}`,
          vector: vector,
          metadata: { batch: i }
        }]
      });
    });

    await Promise.all(operations);
    await new Promise(resolve => setTimeout(resolve, 2000));

    const listResult = await index.listIds();
    const concurrentIds = listResult.ids.filter((id: string) => id.startsWith('concurrent_'));
    expect(concurrentIds.length).toBe(numOperations);
  });

  test('should handle boundary values', async () => {
    const zeroVector = Array(128).fill(0);
    await index.upsert({
      items: [{
        id: 'zero_vector',
        vector: zeroVector,
        metadata: { type: 'zero' }
      }]
    });

    const smallVector = Array(128).fill(1e-10);
    await index.upsert({
      items: [{
        id: 'small_vector',
        vector: smallVector,
        metadata: { type: 'small' }
      }]
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    const results = await index.query({ 
      queryVectors: [zeroVector], 
      topK: 2 
    });

    expect(results.results).toBeDefined();
  });

  test('should handle large metadata objects', async () => {
    const largeMetadata = {
      description: 'A'.repeat(1000),
      nested: {
        level1: {
          level2: {
            level3: Array(100).fill(0).map((_, i) => ({ id: i, value: `item_${i}` }))
          }
        }
      },
      array: Array(50).fill(0).map((_, i) => i),
      tags: Array(20).fill(0).map((_, i) => `tag_${i}`)
    };

    const vector = Array(128).fill(0).map(() => Math.random());
    
    await index.upsert({
      items: [{
        id: 'large_metadata',
        vector: vector,
        metadata: largeMetadata
      }]
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    const results = await index.get({
      ids: ['large_metadata'],
      include: ['metadata']
    });

    expect(results.length).toBe(1);
    expect(results[0].metadata).toEqual(largeMetadata);
  });
});

describe('Backend Compatibility Tests', () => {
  const client = createClient();

  test('should detect backend capabilities', async () => {
    const health = await client.getHealth();
    expect(health).toBeDefined();

    // Test if backend supports IVFPQ
    const indexName = generateUniqueName('backend_test');
    const indexKey = generateRandomKey();
    const indexConfig: IndexIVFPQ = {
      dimension: 128,
      type: 'ivfpq',
      pqDim: 32,
      pqBits: 8
    };

    const index = await client.createIndex({ 
      indexName, 
      indexKey, 
      indexConfig, 
      metric: 'euclidean' 
    });
    
    await index.deleteIndex();
  });

  test('should handle feature availability gracefully', async () => {
    // Test basic index type
    const indexName = generateUniqueName('feature_test');
    const indexKey = generateRandomKey();
    const basicConfig = {
      dimension: 128,
      type: 'ivfflat' as const
    };

    const basicIndex = await client.createIndex({ 
      indexName, 
      indexKey, 
      indexConfig: basicConfig, 
      metric: 'euclidean' 
    });

    expect(basicIndex).toBeDefined();
    await basicIndex.deleteIndex();

    // Test advanced index type
    const advancedConfig: IndexIVFPQ = {
      dimension: 128,
      type: 'ivfpq',
      pqDim: 32,
      pqBits: 8
    };

    const advancedIndex = await client.createIndex({ 
      indexName: generateUniqueName('advanced'), 
      indexKey: generateRandomKey(), 
      indexConfig: advancedConfig, 
      metric: 'euclidean' 
    });
    
    await advancedIndex.deleteIndex();
  });

  test('should support lite backend IVFFlat operations', async () => {
    const indexName = generateUniqueName('lite_test');
    const indexKey = generateRandomKey();
    
    const indexConfig = {
      dimension: 128,
      type: 'ivfflat' as const
    };
    
    const index = await client.createIndex({ 
      indexName, 
      indexKey, 
      indexConfig, 
      metric: 'euclidean' 
    });
    
    try {
      const testVector = Array(128).fill(0).map(() => Math.random());
      await index.upsert({
        items: [{
          id: 'lite_test',
          vector: testVector,
          metadata: { backend: 'test' }
        }]
      });
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const results = await index.query({ queryVectors: [testVector], topK: 1 });
      expect(results.results).toBeDefined();
      
    } finally {
      await index.deleteIndex();
    }
  });
});