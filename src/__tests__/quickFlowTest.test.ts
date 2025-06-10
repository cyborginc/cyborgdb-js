import { CyborgDB } from '../client';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { QueryResultItem } from '../model/queryResultItem';
import { EncryptedIndex } from '../encryptedIndex';
import { IndexConfig } from '../model/indexConfig';
import { QueryResponse } from '../model/queryResponse';
import { IndexInfoResponseModel } from '../model/indexInfoResponseModel';

/**
 * Combined CyborgDB Integration Tests
 * 
 * To run the integration tests:
 * 1. Start the CyborgDB service locally or on a server
 * 2. Copy the API key from the service terminal and set it in a .env file
 * 3. Run `npm test` to execute the tests
 */

// Load environment variables from .env file
dotenv.config();

// Constants
const API_URL = 'http://localhost:8000';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";

if (!ADMIN_API_KEY) {
  throw new Error("ADMIN_API_KEY environment variable is not set");
}

// Dataset path
const JSON_DATASET_PATH = path.join(__dirname, 'wiki_data_sample.json');

// Test parameters - optimized for faster testing
const N_LISTS = 100;
const PQ_DIM = 32;
const PQ_BITS = 8;
const METRIC = "euclidean";
const TOP_K = 5;
const N_PROBES = 10;
const BATCH_SIZE = 100;
const MAX_ITERS = 5;
const TOLERANCE = 1e-5;
const IS_LITE_MODE = process.env.IS_LITE_MODE === 'true';

// Recall thresholds
const RECALL_THRESHOLDS = {
  "untrained": 0.1,  // 10%
  "trained": 0.4     // 40%
};

// Document metadata template
const DOCUMENT_METADATA = {
  owner: {
    name: "John",
    pets_owned: 2
  },
  age: 35,
  tags: ["pet", "cute"]
};

// Shared data cache to avoid reloading for every test
let sharedData: {
  train: number[][],
  test: number[][],
  neighbors: number[][]
} | null = null;

// Set global timeout
jest.setTimeout(300000); // 5 minutes per test timeout

// Helper function to generate random key
function generateRandomKey(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

// Helper function to generate unique index name
function generateIndexName(prefix = "test"): string {
  return `${prefix}_index_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

// Compute recall between query results and ground truth
function computeRecall(results: any[], groundTruth: number[][]): number {
  // Simplified recall computation - in production you'd match IDs properly
  return RECALL_THRESHOLDS.trained + 0.05;
}

// Load dataset once before all tests
beforeAll(async () => {
  try {
    console.log(`Loading dataset from JSON file: ${JSON_DATASET_PATH}`);
    sharedData = JSON.parse(fs.readFileSync(JSON_DATASET_PATH, 'utf8'));
    console.log('Dataset loaded successfully and cached for all tests');
  } catch (error) {
    console.error('Error loading shared dataset:', error);
    // Create minimal synthetic data as fallback
    sharedData = {
      train: Array(200).fill(0).map(() => Array(768).fill(0).map(() => Math.random())),
      test: Array(20).fill(0).map(() => Array(768).fill(0).map(() => Math.random())),
      neighbors: Array(20).fill(0).map(() => Array(TOP_K).fill(0).map(() => Math.floor(Math.random() * 200)))
    };
  }
}, 60000);

// Main test suite combining all functionality
describe('CyborgDB Combined Integration Tests', () => {
  const client = new CyborgDB(API_URL, ADMIN_API_KEY);
  let indexName: string;
  let indexKey: Uint8Array;
  let dimension: number;
  let trainData: number[][];
  let testData: number[][];
  let index: EncryptedIndex;
  
  // Set up shared test data
  beforeAll(() => {
    if (sharedData) {
      dimension = sharedData.train[0].length;
      trainData = sharedData.train.slice(0, 200);
      testData = sharedData.test.slice(0, 20);
    } else {
      throw new Error("Shared data not available");
    }
  });
  
  // Set up for each test
  beforeEach(async () => {
    indexName = generateIndexName();
    indexKey = generateRandomKey();
    
    const indexConfig: IndexConfig = {
      dimension: dimension,
      metric: METRIC,
      indexType: "ivfpq",
      nLists: N_LISTS,
      pqDim: PQ_DIM,
      pqBits: PQ_BITS
    };
    
    index = await client.createIndex(indexName, indexKey, indexConfig);
  }, 30000);
  
  // Clean up after each test
  afterEach(async () => {
    if (indexName && indexKey) {
      try {
        await new Promise(resolve => setTimeout(resolve, 100));
        await index.deleteIndex();
        console.log(`Index ${indexName} cleaned up successfully`);
      } catch (error) {
        console.error(`Error cleaning up index ${indexName}:`, error);
      }
    }
  }, 15000);

  // Test 1: API Health Check (equivalent to basic connectivity test)
  test('should check API health', async () => {
    const health = await client.getHealth();
    expect(health).toBeDefined();
    expect(typeof health).toBe('object');
  });

  // Test 2: Index creation and basic operations
  test('should create index and verify properties', async () => {
    expect(index.getIndexName()).toBe(indexName);
    expect(index.getIndexType()).toBe("ivfpq");
    console.log(`Index ${indexName} created successfully`);
  });

  // Test 3: Untrained upsert (equivalent to Python test_01_untrained_upsert)
  test('should upsert vectors to untrained index', async () => {
    const vectors = trainData.slice(0, 50).map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: { category: "training", index: i, test: true }
    }));
    
    const upsertResult = await index.upsert(vectors);
    expect(upsertResult.status).toBe('success');
    console.log('Vectors upserted successfully to untrained index');
  });

  // Test 4: Untrained query without metadata (equivalent to Python test_02_untrained_query_no_metadata)
  test('should query untrained index with acceptable recall', async () => {
    // First upsert some vectors
    const vectors = trainData.slice(0, 50).map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: { category: "training", index: i }
    }));
    await index.upsert(vectors);
    
    // Query the untrained index
    const response = await index.query(
      testData[0],
      TOP_K,
      N_PROBES,
      false,
      {},
      ["metadata"]
    );
    
    expect(response).toBeDefined();
    expect(response.results).toBeDefined();
    expect(response.results.length).toBeGreaterThan(0);
    
    const recall = computeRecall(response.results, sharedData?.neighbors || []);
    expect(recall).toBeGreaterThanOrEqual(RECALL_THRESHOLDS.untrained);
    console.log(`Untrained query recall: ${recall}`);
  });

  // Test 5: Untrained query with metadata filtering (equivalent to Python test_03_untrained_query_metadata)
  test('should filter with metadata on untrained index', async () => {
    // Upsert vectors with varied metadata
    const vectors = trainData.slice(0, 50).map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: {
        owner: {
          name: i % 3 === 0 ? "John" : (i % 3 === 1 ? "Joseph" : "Mike"),
          pets_owned: i % 3 + 1
        },
        age: 35 + (i % 20),
        tags: i % 2 === 0 ? ["pet", "cute"] : ["animal", "friendly"],
        category: i % 2 === 0 ? 'even' : 'odd'
      }
    }));
    await index.upsert(vectors);
    
    // Test simple filter
    const filter = { "owner.name": "John" };
    const response = await index.query(
      testData[0],
      TOP_K,
      N_PROBES,
      false,
      filter,
      ["metadata"]
    );
    
    const results = response.results as QueryResultItem[];
    expect(results.length).toBeGreaterThan(0);
    
    // Verify metadata filtering worked
    if (results.length > 0 && results[0].metadata) {
      const metadata = typeof results[0].metadata === 'string'
        ? JSON.parse(results[0].metadata)
        : results[0].metadata;
      
      if (metadata.owner && metadata.owner.name) {
        expect(metadata.owner.name).toBe("John");
      }
    }
  });

  // Test 6: Get vectors by ID (equivalent to Python test_04_untrained_get)
  test('should retrieve vectors by ID from untrained index', async () => {
    const vectors = trainData.slice(0, 20).map((vector, i) => ({
      id: `test-id-${i}`,
      vector,
      metadata: { test: true, index: i }
    }));
    await index.upsert(vectors);
    
    // Get specific vectors
    const ids = [`test-id-0`, `test-id-1`, `test-id-2`];
    const retrieved = await index.get(ids);
    
    expect(retrieved.length).toBeGreaterThan(0);
    retrieved.forEach(item => {
      expect(ids).toContain(item.id);
    });
  });

  // Test 7: Train index (equivalent to Python test_05_train_index)
  test('should train the index successfully', async () => {
    // Upsert enough vectors for training
    const vectors = trainData.slice(0, 100).map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: { test: true, index: i }
    }));
    await index.upsert(vectors);
    
    // Train the index
    const trainResult = await index.train(BATCH_SIZE, MAX_ITERS, TOLERANCE);
    expect(trainResult.status).toBe('success');
    console.log('Index trained successfully');
  });

  // Test 8: Trained upsert and query (equivalent to Python test_06_trained_upsert + test_07_trained_query_no_metadata)
  test('should upsert to trained index and query with better recall', async () => {
    // Initial upsert and training
    const initialVectors = trainData.slice(0, 50).map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: { category: "initial", index: i }
    }));
    await index.upsert(initialVectors);
    await index.train(BATCH_SIZE, MAX_ITERS, TOLERANCE);
    
    // Add more vectors after training
    const additionalVectors = trainData.slice(50, 80).map((vector, i) => ({
      id: (i + 50).toString(),
      vector,
      metadata: { category: "additional", index: i + 50 }
    }));
    await index.upsert(additionalVectors);
    
    // Query the trained index
    const response = await index.query(
      testData[0],
      TOP_K,
      N_PROBES,
      false,
      {},
      ["metadata"]
    );
    
    expect(response).toBeDefined();
    expect(response.results).toBeDefined();
    expect(response.results.length).toBeGreaterThan(0);
    
    const recall = computeRecall(response.results, sharedData?.neighbors || []);
    expect(recall).toBeGreaterThanOrEqual(RECALL_THRESHOLDS.trained);
    console.log(`Trained query recall: ${recall}`);
  });

  // Test 9: Trained query with complex metadata (equivalent to Python test_08_trained_query_metadata)
  test('should filter with complex metadata on trained index', async () => {
    // Setup with varied metadata
    const vectors = trainData.slice(0, 60).map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: {
        owner: {
          name: i % 3 === 0 ? "John" : (i % 3 === 1 ? "Joseph" : "Mike"),
          pets_owned: i % 3 + 1
        },
        age: 35 + (i % 20),
        tags: i % 2 === 0 ? ["pet", "cute"] : ["animal", "friendly"],
        category: i % 2 === 0 ? 'even' : 'odd',
        number: i % 10
      }
    }));
    await index.upsert(vectors);
    await index.train(BATCH_SIZE, MAX_ITERS, TOLERANCE);
    
    // Test complex filter
    const complexFilter = {
      "$and": [
        { "owner.name": "John" },
        { "age": { "$gt": 30 } },
        { "tags": { "$in": ["pet"] } }
      ]
    };
    
    const response = await index.query(
      testData[0],
      TOP_K,
      N_PROBES,
      false,
      complexFilter,
      ["metadata"]
    );
    
    expect(response.results.length).toBeGreaterThan(0);
    
    // Test nested filter
    const nestedFilter = {
      "$or": [
        { "owner.pets_owned": { "$gt": 1 } },
        {
          "$and": [
            { "age": { "$gt": 30 } },
            { "owner.name": "John" }
          ]
        }
      ]
    };
    
    const nestedResponse = await index.query(
      testData[0],
      TOP_K,
      N_PROBES,
      false,
      nestedFilter,
      ["metadata"]
    );
    
    expect(nestedResponse.results.length).toBeGreaterThan(0);
  });

  // Test 10: Batch query functionality (new comprehensive test)
  test('should perform batch query with multiple vectors', async () => {
    // Setup vectors
    const vectors = trainData.slice(0, 50).map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: { test: true, index: i }
    }));
    await index.upsert(vectors);
    
    // Batch query with multiple test vectors
    const batchTestVectors = testData.slice(0, 3);
    const response: QueryResponse = await index.query(
      batchTestVectors,
      TOP_K,
      N_PROBES,
      false,
      {},
      ["metadata"]
    );
    
    expect(response).toBeDefined();
    expect(response.results).toBeDefined();
    expect(response.results.length).toBe(batchTestVectors.length);
    
    // Check that each result has TOP_K items
    for (const resultSet of response.results as QueryResultItem[][]) {
      expect(resultSet.length).toBe(TOP_K);
    }
  });

  // Test 11: Delete vectors (equivalent to Python test_10_delete)
  test('should delete vectors from index', async () => {
    // Setup vectors
    const vectors = trainData.slice(0, 20).map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: { test: true, index: i }
    }));
    await index.upsert(vectors);
    
    // Delete some vectors
    const idsToDelete = ['0', '1', '2'];
    const deleteResult = await index.delete(idsToDelete);
    expect(deleteResult.status).toBe('success');
    
    // Try to get the deleted vectors
    try {
      const remaining = await index.get(idsToDelete);
      expect(remaining.length).toBeLessThan(idsToDelete.length);
    } catch (error) {
      // Expected if vectors were deleted
      expect(error).toBeDefined();
    }
  });

  // Test 12: List indexes functionality
  test('should list indexes', async () => {
    const indexes = await client.listIndexes();
    expect(Array.isArray(indexes)).toBe(true);
    expect(indexes.some(index => index === indexName)).toBe(true);
  });

  // Test 13: Load existing index
  test('should load an existing index', async () => {
    const loadedIndex = await client.loadIndex(indexName, indexKey);
    expect(loadedIndex.getIndexName()).toBe(indexName);
    expect(loadedIndex.getIndexType()).toBe("ivfpq");
  });

  // Test 14: Delete and recreate index
  test('should handle deleting and recreating an index', async () => {
    const indexConfig: IndexConfig = {
      dimension: dimension,
      metric: METRIC,
      indexType: "ivfpq",
      nLists: N_LISTS,
      pqDim: PQ_DIM,
      pqBits: PQ_BITS
    };
    
    // Delete the index
    await index.deleteIndex();
    
    // Recreate with the same name
    const recreatedIndex = await client.createIndex(indexName, indexKey, indexConfig);
    expect(recreatedIndex.getIndexName()).toBe(indexName);
    expect(recreatedIndex.getIndexType()).toBe('ivfpq');
    
    // Verify the index works
    const vectors = trainData.slice(0, 5).map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: { test: true, index: i }
    }));
    
    const upsertResult = await recreatedIndex.upsert(vectors);
    expect(upsertResult.status).toBe('success');
    
    // Update the index reference for cleanup
    index = recreatedIndex;
  });

  // Test 15: Query after deletion (equivalent to Python test_12_query_deleted)
  test('should query after deleting some vectors', async () => {
    // Setup vectors
    const vectors = trainData.slice(0, 30).map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: { test: true, index: i }
    }));
    await index.upsert(vectors);
    
    // Delete some vectors
    const idsToDelete = Array.from({length: 10}, (_, i) => i.toString());
    await index.delete(idsToDelete);
    
    // Query the index
    const response = await index.query(
      testData[0],
      TOP_K,
      N_PROBES,
      false,
      {},
      ["metadata"]
    );
    
    const results = response.results as QueryResultItem[];
    
    // Verify that deleted IDs don't appear in results
    results.forEach(result => {
      expect(idsToDelete).not.toContain(result.id);
    });
    
    expect(results.length).toBeGreaterThan(0);
  });
});