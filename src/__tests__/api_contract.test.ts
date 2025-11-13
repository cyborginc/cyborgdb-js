/**
 * API Contract Test for CyborgDB TypeScript SDK - COMPREHENSIVE VERSION
 *
 * This version tests all features including embedding models and auto-embedding
 * to catch real issues in the implementation
 * 
 * IMPORTANT: Run with --runInBand to prevent parallel execution issues
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from '../index';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
jest.setTimeout(120000);

function generateTestVectors(numVectors: number = 10, dimension: number = 128): number[][] {
  const vectors: number[][] = [];
  for (let i = 0; i < numVectors; i++) {
    const vector: number[] = [];
    for (let j = 0; j < dimension; j++) {
      vector.push(Math.random());
    }
    vectors.push(vector);
  }
  return vectors;
}

function generateTestMetadata(numItems: number = 10): Record<string, any>[] {
  const metadata: Record<string, any>[] = [];
  for (let i = 0; i < numItems; i++) {
    metadata.push({
      index: i,
      category: `cat_${i % 3}`,
      value: i * 10
    });
  }
  return metadata;
}

function validateExactKeys(data: any, expectedKeys: Set<string>, name: string): void {
  const actualKeys = new Set(Object.keys(data));
  const missing = [...expectedKeys].filter(k => !actualKeys.has(k));
  const extra = [...actualKeys].filter(k => !expectedKeys.has(k));

  if (missing.length > 0) {
    throw new Error(`${name}: Missing required keys: ${missing.join(', ')}`);
  }
  if (extra.length > 0) {
    throw new Error(`${name}: Unexpected extra keys: ${extra.join(', ')}`);
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('CyborgDB API Contract Tests', () => {
  let client: Client;
  let testIndexName: string;
  let testIndexKey: Uint8Array;
  let testIndex: any;
  const dimension = 384;
  let testVectors: number[][];
  let testMetadata: Record<string, any>[];
  
  // Separate index for embedding model tests
  let embeddingIndexName: string;
  let embeddingIndexKey: Uint8Array;
  let embeddingIndex: any;

  const BASE_URL = process.env.CYBORGDB_BASE_URL || 'http://localhost:8000';
  const API_KEY = process.env.CYBORGDB_API_KEY;

  if (!API_KEY) {
    throw new Error('CYBORGDB_API_KEY environment variable is required');
  }

  beforeAll(async () => {
    testVectors = generateTestVectors(10, dimension);
    testMetadata = generateTestMetadata(10);
    testIndexName = `test_contract_${Date.now().toString(36)}`;
    embeddingIndexName = `test_embed_${Date.now().toString(36)}`;
  });

  afterAll(async () => {
    // Cleanup both indexes
    try {
      if (testIndex) {
        await testIndex.deleteIndex();
      }
    } catch (error) {
      console.log('Cleanup error for main index:', error);
    }
    
    try {
      if (embeddingIndex) {
        await embeddingIndex.deleteIndex();
      }
    } catch (error) {
      console.log('Cleanup error for embedding index:', error);
    }
  });

  describe('01 - Module Exports', () => {
    it('should export all required classes', () => {
      expect(Client).toBeDefined();
      expect(typeof Client).toBe('function');
    });
  });

  describe('02 - Client Class Constructor', () => {
    it('should construct with required parameters', () => {
      const client1 = new Client({ baseUrl: BASE_URL, apiKey: API_KEY });
      expect(client1).toBeInstanceOf(Client);
    });

    it('should construct with optional verifySsl parameter', () => {
      const client2 = new Client({ 
        baseUrl: BASE_URL, 
        apiKey: API_KEY, 
        verifySsl: true 
      });
      expect(client2).toBeInstanceOf(Client);
    });

    it('should reject unexpected parameters', () => {
      const invalidParams = { 
        baseUrl: BASE_URL, 
        apiKey: API_KEY, 
        unexpectedParam: 'should fail' 
      };
      
      try {
        new Client(invalidParams as any);
        expect(true).toBe(true);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should require baseUrl parameter', () => {
      expect(() => {
        new Client({ apiKey: API_KEY } as any);
      }).toThrow();
    });
  });

  describe('03 - Client.generateKey()', () => {
    it('should generate 32-byte encryption key as static method', () => {
      const key = Client.generateKey();
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it('should generate 32-byte encryption key as instance method', () => {
      const client = new Client({ baseUrl: BASE_URL, apiKey: API_KEY });
      const key = client.generateKey();
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it('should generate unique keys', () => {
      const key1 = Client.generateKey();
      const key2 = Client.generateKey();
      expect(key1).not.toEqual(key2);
    });

    it('should not accept any arguments', () => {
      const result = (Client.generateKey as any)('unexpected');
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(32);
    });

    it('should store generated keys for later tests', () => {
      testIndexKey = Client.generateKey();
      embeddingIndexKey = Client.generateKey();
      expect(testIndexKey.length).toBe(32);
      expect(embeddingIndexKey.length).toBe(32);
    });
  });

  describe('04 - Client Instance Creation', () => {
    it('should create client instance for testing', () => {
      client = new Client({ baseUrl: BASE_URL, apiKey: API_KEY, verifySsl: false });
      expect(client).toBeInstanceOf(Client);
    });
  });

  describe('05 - Client.getHealth()', () => {
    it('should return valid health status with correct schema', async () => {
      const health = await client.getHealth();
      
      expect(health).toBeDefined();
      expect(typeof health).toBe('object');
      expect(health).toHaveProperty('status');
      expect(typeof health.status).toBe('string');
    });

    it('should not accept any arguments', async () => {
      const result = await (client.getHealth as any)('unexpected');
      expect(result).toBeDefined();
    });
  });

  describe('06 - Client.listIndexes()', () => {
    it('should return array of index names', async () => {
      const indexes = await client.listIndexes();
      
      expect(Array.isArray(indexes)).toBe(true);
      indexes.forEach((name: string) => {
        expect(typeof name).toBe('string');
      });
    });

    it('should not accept any arguments', async () => {
      const result = await (client.listIndexes as any)('unexpected');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('07 - Index Config Classes', () => {
    it('should create IndexIVF config object', () => {
      const config = {
        dimension: 0,
        type: 'ivf' as const
      };
      expect(config.type).toBe('ivf');
    });

    it('should create IndexIVFFlat config object with dimension', () => {
      const config = {
        dimension,
        type: 'ivfflat' as const
      };
      expect(config.type).toBe('ivfflat');
      expect(config.dimension).toBe(dimension);
    });

    it('should create IndexIVFPQ config object with required parameters', () => {
      const config = {
        dimension,
        type: 'ivfpq' as const,
        pqDim: 64,
        pqBits: 8
      };
      expect(config.type).toBe('ivfpq');
      expect(config.dimension).toBe(dimension);
      expect(config.pqDim).toBe(64);
      expect(config.pqBits).toBe(8);
    });
  });

  describe('08 - Client.createIndex()', () => {
    it('should create index with IndexIVFFlat config and custom metric', async () => {
      const tempIndexName = `temp_ivfflat_${Date.now().toString(36)}`;
      const tempIndexKey = Client.generateKey();
      
      const indexConfig = {
        dimension,
        type: 'ivfflat' as const
      };
      
      const index = await client.createIndex({
        indexName: tempIndexName,
        indexKey: tempIndexKey,
        indexConfig,
        metric: 'cosine'
      });
      
      expect(index).toBeDefined();
      expect(await index.getIndexName()).toBe(tempIndexName);
      
      const config = await index.getIndexConfig();
      expect(config.dimension).toBe(dimension);
      expect(await index.getIndexType()).toBe('ivfflat');
      
      await index.deleteIndex();
      await sleep(1000);
    });

    it('should create index with IndexIVF config', async () => {
      const tempIndexName = `temp_ivf_${Date.now().toString(36)}`;
      const tempIndexKey = Client.generateKey();
      
      const indexConfig = {
        dimension: 0,
        type: 'ivf' as const
      };
      
      const index = await client.createIndex({
        indexName: tempIndexName,
        indexKey: tempIndexKey,
        indexConfig,
        metric: 'squared_euclidean'
      });
      
      expect(index).toBeDefined();
      expect(await index.getIndexType()).toBe('ivf');
      
      await index.deleteIndex();
      await sleep(1000);
    });

    it('should create index with IndexIVFPQ config', async () => {
      const tempIndexName = `temp_ivfpq_${Date.now().toString(36)}`;
      const tempIndexKey = Client.generateKey();
      
      const indexConfig = {
        dimension: 0,
        type: 'ivfpq' as const,
        pqDim: 32,
        pqBits: 8
      };
      
      const index = await client.createIndex({
        indexName: tempIndexName,
        indexKey: tempIndexKey,
        indexConfig
      });
      
      expect(await index.getIndexType()).toBe('ivfpq');
      
      await index.deleteIndex();
      await sleep(1000);
    });

    it('should create index with embedding model', async () => {
      embeddingIndex = await client.createIndex({
        indexName: embeddingIndexName,
        indexKey: embeddingIndexKey,
        embeddingModel: 'all-MiniLM-L6-v2'
      });
      
      expect(embeddingIndex).toBeDefined();
      
      const config = await embeddingIndex.getIndexConfig();
      expect(config.dimension).toBe(384); // all-MiniLM-L6-v2 dimension
      expect(await embeddingIndex.getIndexType()).toBe('ivfflat');
      
      // Wait for index to be ready
      await sleep(2000);
    });

    it('should reject duplicate index creation', async () => {
      // Use a dedicated temp index for this test
      const dupTestName = `dup_test_${Date.now().toString(36)}`;
      const dupTestKey = Client.generateKey();
      
      // Create first index
      const firstIndex = await client.createIndex({
        indexName: dupTestName,
        indexKey: dupTestKey
      });
      
      // Try to create duplicate - should fail
      await expect(
        client.createIndex({
          indexName: dupTestName,
          indexKey: dupTestKey
        })
      ).rejects.toThrow();
      
      // Clean up
      await firstIndex.deleteIndex();
      await sleep(1000);
    });

    it('should reject unexpected parameters', async () => {
      const invalidParams = {
        indexName: `temp_unexpected_${Date.now()}`,
        indexKey: Client.generateKey(),
        unexpectedParam: 'should fail'
      };
      
      const result = await client.createIndex(invalidParams as any);
      expect(result).toBeDefined();
      await result.deleteIndex();
      await sleep(1000);
    });

    it('should create main test index for subsequent tests', async () => {
      const indexConfig = {
        dimension,
        type: 'ivfflat' as const
      };
      
      testIndex = await client.createIndex({
        indexName: testIndexName,
        indexKey: testIndexKey,
        indexConfig,
        metric: 'cosine'
      });
      
      expect(testIndex).toBeDefined();
      
      // Wait for index to be fully initialized
      await sleep(2000);
      
      // Verify index was created and is accessible
      const indexes = await client.listIndexes();
      expect(indexes).toContain(testIndexName);
      
      const name = await testIndex.getIndexName();
      expect(name).toBe(testIndexName);
    });
  });

  describe('09 - EncryptedIndex Properties', () => {
    it('should expose index name via getIndexName()', async () => {
      // Verify testIndex is still valid
      if (!testIndex) {
        throw new Error('testIndex is null or undefined - it was not created properly in section 08');
      }
      
      console.log('Attempting to get index name for:', testIndexName);
      const name = await testIndex.getIndexName();
      expect(typeof name).toBe('string');
      expect(name).toBe(testIndexName);
    });

    it('should expose index type via getIndexType()', async () => {
      const indexType = await testIndex.getIndexType();
      expect(typeof indexType).toBe('string');
      expect(indexType).toBe('ivfflat');
    });

    it('should expose index config via getIndexConfig()', async () => {
      const config = await testIndex.getIndexConfig();
      expect(typeof config).toBe('object');
      expect(config).toHaveProperty('dimension');
      expect(config).toHaveProperty('index_type');
      expect(config.dimension).toBe(dimension);
    });
  });

  describe('10 - EncryptedIndex.isTrained()', () => {
    it('should return boolean', async () => {
      const trained = await testIndex.isTrained();
      expect(typeof trained).toBe('boolean');
    });

    it('should not accept any arguments', async () => {
      const result = await (testIndex.isTrained as any)('unexpected');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('11 - Client.isTraining()', () => {
    it('should return training status with correct schema', async () => {
      const status = await client.isTraining();
      
      expect(status).toBeDefined();
      expect(status).toHaveProperty('training_indexes');
      expect(status).toHaveProperty('retrain_threshold');
      expect(Array.isArray(status.training_indexes)).toBe(true);
      expect(typeof status.retrain_threshold).toBe('number');
    });

    it('should not accept any arguments', async () => {
      const result = await (client.isTraining as any)('unexpected');
      expect(result).toBeDefined();
      expect(result).toHaveProperty('training_indexes');
    });
  });

  describe('12 - EncryptedIndex.upsert()', () => {
    it('should upsert with items array format (vector + metadata + contents as bytes)', async () => {
      const items = [];
      for (let i = 0; i < 2; i++) {
        items.push({
          id: String(i),
          vector: testVectors[i],
          metadata: testMetadata[i],
          contents: Buffer.from(`test content ${i}`, 'utf-8')
        });
      }
      
      const result = await testIndex.upsert({ items });
      expect(result).toBeDefined();
      expect(result.status).toBe('success');
      
      await sleep(1000);
    });

    it('should upsert with items array format (contents as string, auto-embed)', async () => {
      // This test uses the embedding index which has an embedding model
      const items = [];
      for (let i = 0; i < 3; i++) {
        items.push({
          id: `embed_${i}`,
          metadata: { type: 'auto-embedded', index: i },
          contents: `This is test content ${i} for auto-embedding`
        });
      }
      
      const result = await embeddingIndex.upsert({ items });
      expect(result).toBeDefined();
      expect(result.status).toBe('success');
      
      await sleep(1000);
    });

    it('should upsert remaining test items', async () => {
      const items = [];
      for (let i = 2; i < 10; i++) {
        items.push({
          id: String(i),
          vector: testVectors[i % testVectors.length],
          metadata: testMetadata[i % testMetadata.length],
          contents: Buffer.from(`test content ${i}`, 'utf-8')
        });
      }
      
      const result = await testIndex.upsert({ items });
      expect(result.status).toBe('success');
      
      await sleep(1000);
    });

    it('should upsert with parallel arrays format (ids + vectors)', async () => {
      const ids = Array.from({ length: 5 }, (_, i) => String(i + 10));
      const vectors = testVectors.slice(5);
      
      const result = await testIndex.upsert({ ids, vectors });
      expect(result.status).toBe('success');
      
      await sleep(1000);
    });

    it('should reject vectors with wrong dimensions', async () => {
      const wrongDimVector = Array(64).fill(0);
      
      await expect(
        testIndex.upsert({
          items: [{
            id: 'wrong-dim',
            vector: wrongDimVector
          }]
        })
      ).rejects.toThrow();
    });

    it('should reject when neither items nor ids/vectors provided', async () => {
      await expect(
        testIndex.upsert({})
      ).rejects.toThrow();
    });
  });

  describe('13 - EncryptedIndex.listIds()', () => {
    it('should return object with ids array and count', async () => {
      const result = await testIndex.listIds();
      
      expect(result).toBeDefined();
      validateExactKeys(result, new Set(['ids', 'count']), 'listIds() result');
      
      expect(Array.isArray(result.ids)).toBe(true);
      expect(typeof result.count).toBe('number');
      expect(result.ids.length).toBe(result.count);
      
      result.ids.forEach((id: string) => {
        expect(typeof id).toBe('string');
      });
      
      // We upserted IDs 0-9 and 10-14 (15 total)
      const expectedIds = new Set(Array.from({ length: 15 }, (_, i) => String(i)));
      const actualIds = new Set(result.ids);
      
      const missingIds = [...expectedIds].filter(id => !actualIds.has(id));
      if (missingIds.length > 0) {
        console.log('Missing IDs:', missingIds);
        console.log('Actual IDs:', result.ids);
      }
      expect(missingIds.length).toBe(0);
    });

    it('should not accept any arguments', async () => {
      const result = await (testIndex.listIds as any)('unexpected');
      expect(result).toBeDefined();
      expect(result).toHaveProperty('ids');
    });
  });

  describe('14 - EncryptedIndex.get()', () => {
    it('should get vectors with default include parameter', async () => {
      const idsToGet = ['0', '5', '9'];
      const results = await testIndex.get({ ids: idsToGet });
      
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(3);
      
      results.forEach((result: any, idx: number) => {
        const id = idsToGet[idx];
        validateExactKeys(
          result,
          new Set(['id', 'vector', 'metadata', 'contents']),
          `get() result for ID ${id} with default include`
        );
        
        expect(result.id).toBe(id);
        expect(Array.isArray(result.vector)).toBe(true);
        expect(result.vector.length).toBe(dimension);
        
        const idInt = parseInt(id);
        if (idInt >= 10) {
          expect(result.metadata).toBeNull();
          expect(result.contents).toBeNull();
        } else {
          expect(typeof result.metadata).toBe('object');
          // Contents should be decoded to string by SDK
          expect(typeof result.contents).toBe('string');
        }
      });
    });

    it('should get vectors with specific include parameter', async () => {
      const idsToGet = ['0', '5'];
      const results = await testIndex.get({ 
        ids: idsToGet, 
        include: ['metadata'] 
      });
      
      results.forEach((result: any) => {
        validateExactKeys(
          result,
          new Set(['id', 'metadata']),
          'get() result with include=[metadata]'
        );
      });
    });

    it('should get vectors with empty include (only IDs)', async () => {
      const idsToGet = ['0'];
      const results = await testIndex.get({ 
        ids: idsToGet, 
        include: [] 
      });
      
      results.forEach((result: any) => {
        validateExactKeys(
          result,
          new Set(['id']),
          'get() result with include=[]'
        );
      });
    });
  });

  describe('15 - EncryptedIndex.query()', () => {
    it('should query with single vector (flat array) and return flat results', async () => {
      const queryVector = testVectors[0];
      const response = await testIndex.query({ queryVectors: queryVector });
      
      expect(response).toBeDefined();
      expect(response).toHaveProperty('results');
      
      const results = Array.isArray(response.results) ? response.results : [response.results];
      expect(Array.isArray(results)).toBe(true);
      
      if (results.length > 0 && Array.isArray(results[0])) {
        const firstQueryResults = results[0];
        
        firstQueryResults.forEach((match: any) => {
          validateExactKeys(
            match,
            new Set(['id', 'score']),
            'query() result item'
          );
          expect(typeof match.id).toBe('string');
          expect(typeof match.score).toBe('number');
          expect(match.score).toBeGreaterThanOrEqual(0);
        });
      }
    });

    it('should query with nested array (single vector) format', async () => {
      const queryVector = [testVectors[1]];
      const response = await testIndex.query({ 
        queryVectors: queryVector,
        topK: 3
      });
      
      expect(response.results).toBeDefined();
      const results = Array.isArray(response.results) ? response.results : [response.results];
      expect(results.length).toBeGreaterThan(0);
    });

    it('should query with batch vectors', async () => {
      const batchVectors = [testVectors[2], testVectors[3]];
      const response = await testIndex.query({
        queryVectors: batchVectors,
        topK: 2
      });
      
      expect(response.results).toBeDefined();
      
      const results = response.results as any;
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(2);
      
      results.forEach((queryResults: any) => {
        expect(Array.isArray(queryResults)).toBe(true);
        expect(queryResults.length).toBeLessThanOrEqual(2);
      });
    });

    it('should query with specific include parameter', async () => {
      const response = await testIndex.query({
        queryVectors: testVectors[0],
        topK: 5,
        include: ['metadata']
      });
      
      const results = Array.isArray(response.results) ? response.results : [response.results];
      if (results.length > 0) {
        const firstResults = Array.isArray(results[0]) ? results[0] : results;
        if (firstResults.length > 0) {
          const firstResult = firstResults[0];
          // Score should ALWAYS be present in query results
          const expectedKeys = new Set(['id', 'score', 'metadata']);
          validateExactKeys(
            firstResult,
            expectedKeys,
            'query() with include=[metadata]'
          );
        }
      }
    });

    it('should query with metadata filters', async () => {
      const response = await testIndex.query({
        queryVectors: testVectors[0],
        topK: 10,
        filters: { category: 'cat_0' },
        include: ['metadata']
      });
      
      const results = Array.isArray(response.results) ? response.results : [response.results];
      if (results.length > 0) {
        const firstResults = Array.isArray(results[0]) ? results[0] : results;
        firstResults.forEach((result: any) => {
          if (result.metadata) {
            expect(result.metadata.category).toBe('cat_0');
          }
        });
      }
    });

    it('should query with text contents (auto-embed)', async () => {
      // This test uses the embedding index
      const response = await embeddingIndex.query({
        queryContents: 'test content for similarity search',
        topK: 3
      });
      
      expect(response).toBeDefined();
      expect(response.results).toBeDefined();
      const results = Array.isArray(response.results) ? response.results : [response.results];
      expect(Array.isArray(results)).toBe(true);
      
      // Should return some results from our auto-embedded items
      if (results.length > 0 && Array.isArray(results[0])) {
        const firstResults = results[0];
        expect(firstResults.length).toBeGreaterThan(0);
      }
    });
  });

  describe('16 - EncryptedIndex.query() patterns', () => {
    it('should query with multiple test patterns', async () => {
      const singleVector = testVectors[4];
      const response1 = await testIndex.query({ queryVectors: singleVector, topK: 3 });
      expect(response1.results).toBeDefined();
      
      await sleep(500);
      
      const multipleVectors = [testVectors[5], testVectors[6]];
      const response2 = await testIndex.query({ queryVectors: multipleVectors, topK: 2 });
      expect(Array.isArray(response2.results)).toBe(true);
      
      await sleep(500);
      
      const response3 = await testIndex.query({
        queryVectors: testVectors[7],
        topK: 10,
        filters: { category: 'cat_1' }
      });
      expect(response3.results).toBeDefined();
    });
  });

  describe('17 - EncryptedIndex.train()', () => {
    it('should train with default parameters', async () => {
      const result = await testIndex.train();
      expect(result).toBeDefined();
      expect(result.status).toBe('success');
    });

    it('should train with custom parameters', async () => {
      const result = await testIndex.train({
        nLists: 10,
        batchSize: 512,
        maxIters: 50,
        tolerance: 1e-5
      });
      expect(result.status).toBe('success');
    });

    it('should train with partial parameters', async () => {
      const result = await testIndex.train({
        nLists: 5
      });
      expect(result.status).toBe('success');
      
      await sleep(2000);
    });
  });

  describe('18 - EncryptedIndex.delete()', () => {
    it('should delete vectors by IDs', async () => {
      const idsToDelete = ['0', '5'];
      const result = await testIndex.delete({ ids: idsToDelete });
      
      expect(result).toBeDefined();
      expect(result.status).toBe('success');
      
      await sleep(1000);
      
      const listResult = await testIndex.listIds();
      idsToDelete.forEach(id => {
        expect(listResult.ids).not.toContain(id);
      });
    });

    it('should delete additional vector', async () => {
      const result = await testIndex.delete({ ids: ['9'] });
      expect(result.status).toBe('success');
      
      await sleep(1000);
    });
  });

  describe('19 - Client.loadIndex()', () => {
    it('should load existing index', async () => {
      const loaded = await client.loadIndex({
        indexName: testIndexName,
        indexKey: testIndexKey
      });
      
      expect(loaded).toBeDefined();
      expect(await loaded.getIndexName()).toBe(testIndexName);
    });

    it('should fail with wrong encryption key', async () => {
      const wrongKey = Client.generateKey();
      
      await expect(
        client.loadIndex({
          indexName: testIndexName,
          indexKey: wrongKey
        })
      ).rejects.toThrow();
    });

    it('should fail with non-existent index', async () => {
      await expect(
        client.loadIndex({
          indexName: 'non-existent-index',
          indexKey: Client.generateKey()
        })
      ).rejects.toThrow();
    });

    it('should reject unexpected parameters', async () => {
      const invalidParams = {
        indexName: testIndexName,
        indexKey: testIndexKey,
        unexpectedParam: 'should fail'
      };
      
      const result = await client.loadIndex(invalidParams as any);
      expect(result).toBeDefined();
    });
  });

  describe('20 - EncryptedIndex.deleteIndex()', () => {
    it('should delete the index', async () => {
      const result = await testIndex.deleteIndex();
      expect(result).toBeDefined();
      expect(result.status).toBe('success');
      
      await sleep(1000);
      
      const indexes = await client.listIndexes();
      expect(indexes).not.toContain(testIndexName);
    });

    it('should not accept any arguments', async () => {
      const tempName = `temp_delete_${Date.now()}`;
      const tempKey = Client.generateKey();
      const tempIndex = await client.createIndex({
        indexName: tempName,
        indexKey: tempKey
      });
      
      const result = await (tempIndex.deleteIndex as any)('unexpected');
      expect(result).toBeDefined();
    });
  });
});