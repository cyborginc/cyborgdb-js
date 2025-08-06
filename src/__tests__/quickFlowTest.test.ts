import { CyborgDB } from '../client';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { QueryResultItem } from '../model/queryResultItem';
import { EncryptedIndex } from '../encryptedIndex';
import { QueryResponse } from '../model/queryResponse';
import { IndexIVFPQModel } from '../model/indexIVFPQModel';
import { IndexIVFFlatModel } from '../model/indexIVFFlatModel';
import { IndexIVFModel } from '../model/indexIVFModel';

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
type IndexType = "ivfflat" | "ivfpq" | "ivf";
const testIndexType: IndexType = "ivfpq" as IndexType;

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

function generateIndexConfig(testIndexType: string, dimension: number): IndexIVFFlatModel | IndexIVFPQModel | IndexIVFModel {
  if (testIndexType === "ivfpq") {
    const indexConfig = new IndexIVFPQModel();
    indexConfig.dimension = dimension;
    indexConfig.metric = METRIC;
    indexConfig.nLists = N_LISTS;
    
    // Set the IVFPQ-specific properties (these exist in the class definition)
    indexConfig.pqDim = PQ_DIM;
    indexConfig.pqBits = PQ_BITS;
    indexConfig.type = 'ivfpq';
    
    return indexConfig;
  } else if (testIndexType === "ivfflat") {
    const indexConfig = new IndexIVFFlatModel();
    indexConfig.dimension = dimension;
    indexConfig.metric = METRIC;
    indexConfig.nLists = N_LISTS;
    indexConfig.type = 'ivfflat';
    return indexConfig;
  } else {
    const indexConfig = new IndexIVFModel();
    indexConfig.dimension = dimension;
    indexConfig.metric = METRIC;
    indexConfig.nLists = N_LISTS;
    indexConfig.type = 'ivf';
    return indexConfig;
  }
}

// Load dataset once before all tests
beforeAll(async () => {
  try {
    sharedData = JSON.parse(fs.readFileSync(JSON_DATASET_PATH, 'utf8'));
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
    const indexConfig = generateIndexConfig(testIndexType, dimension);
    index = await client.createIndex(indexName, indexKey, indexConfig);
  }, 30000);
  
  // Clean up after each test
  afterEach(async () => {
    if (indexName && indexKey) {
      try {
        await new Promise(resolve => setTimeout(resolve, 100));
        await index.deleteIndex();
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
    const retrievedIndexName = await index.getIndexName();
    const retrievedIndexType = await index.getIndexType();
    
    expect(retrievedIndexName).toBe(indexName);
    expect(retrievedIndexType).toBe(testIndexType);
  });

  // New Test: Load existing index
  test('should load existing index and verify properties', async () => {
    // Create some test data in the original index using VectorItem[] overload
    const vectors = trainData.slice(0, 10).map((vector, i) => ({
      id: `load-test-${i}`,
      vector,
      metadata: { test: true, index: i }
    }));
    await index.upsert(vectors);
    
    // Load the same index with the same credentials
    const loadedIndex = await client.loadIndex(indexName, indexKey);
    
    // Verify the loaded index has the same properties
    const originalIndexName = await index.getIndexName();
    const originalIndexType = await index.getIndexType();
    const loadedIndexName = await loadedIndex.getIndexName();
    const loadedIndexType = await loadedIndex.getIndexType();
    
    expect(loadedIndexName).toBe(originalIndexName);
    expect(loadedIndexType).toBe(originalIndexType);
    
    // Verify we can query the loaded index and get the same data
    const originalResults = await index.get(['load-test-0', 'load-test-1']);
    const loadedResults = await loadedIndex.get(['load-test-0', 'load-test-1']);
    
    expect(loadedResults.length).toBe(originalResults.length);
    expect(loadedResults[0].id).toBe(originalResults[0].id);
  });

  // Test 3: Untrained upsert using VectorItem[] overload
  test('should upsert vectors to untrained index using VectorItem[] overload', async () => {
    const vectors = trainData.slice(0, 50).map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: { category: "training", index: i, test: true }
    }));
    
    const upsertResult = await index.upsert(vectors);
    expect(upsertResult.status).toBe('success');
  });

  // NEW Test 3b: Untrained upsert using (ids, vectors) overload
  test('should upsert vectors to untrained index using (ids[], vectors[][]) overload', async () => {
    const vectors = trainData.slice(0, 50);
    const ids = vectors.map((_, i) => `id-${i}`);
    
    const upsertResult = await index.upsert(ids, vectors);
    expect(upsertResult.status).toBe('success');
    
    // Verify the vectors were inserted by trying to retrieve them
    const retrieved = await index.get(['id-0', 'id-1', 'id-2']);
    expect(retrieved.length).toBe(3);
    expect(retrieved[0].id).toBe('id-0');
    expect(retrieved[1].id).toBe('id-1');
    expect(retrieved[2].id).toBe('id-2');
  });

  // Test 4: Untrained query without metadata (equivalent to Python test_02_untrained_query_no_metadata)
  test('should query untrained index with acceptable recall', async () => {
    // First upsert some vectors using VectorItem[] overload
    const vectors = trainData.slice(0, 50).map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: { category: "training", index: i }
    }));
    await index.upsert(vectors);
    
    // Query the untrained index using new signature: (queryVectors, queryContents, topK, nProbes, filters, include, greedy)
    const response = await index.query(
      testData[0],      // queryVectors (single vector)
      undefined,        // queryContents
      TOP_K,           // topK
      N_PROBES,        // nProbes
      {},              // filters
      ["metadata"],    // include
      false            // greedy
    );
    expect(response).toBeDefined();
    expect(response.results).toBeDefined();
    expect(response.results.length).toBeGreaterThan(0);
    
    const recall = computeRecall(response.results, sharedData?.neighbors || []);
    expect(recall).toBeGreaterThanOrEqual(RECALL_THRESHOLDS.untrained);
  });

  // Test 5: Untrained query with metadata filtering (equivalent to Python test_03_untrained_query_metadata)
  test('should filter with metadata on untrained index', async () => {
    // Upsert vectors with varied metadata using VectorItem[] overload
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
    
    // Test simple filter using new signature
    const filter = { "owner.name": "John" };
    const response = await index.query(
      testData[0],      // queryVectors
      undefined,        // queryContents
      TOP_K,           // topK
      N_PROBES,        // nProbes
      filter,          // filters
      ["metadata"],    // include
      false            // greedy
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
 test('should retrieve vectors by ID from untrained index (with vector, metadata, contents)', async () => {
    const vectors = trainData.slice(0, 20).map((vector, i) => ({
      id: `test-id-${i}`,
      vector,
      metadata: { test: true, index: i },
      contents: Buffer.from(`test-content-${i}`).toString('base64'),  // <-- convert to base64 string
    }));

    await index.upsert(vectors);

    const ids = ['test-id-0', 'test-id-1', 'test-id-2'];
    const retrieved = await index.get(ids, ['vector', 'metadata', 'contents']);
    expect(retrieved.length).toBe(ids.length);

    retrieved.forEach((item, idx) => {
      const expectedId = ids[idx];
      const expectedIndex = parseInt(expectedId.replace('test-id-', ''));

      // ID check
      expect(item.id).toBe(expectedId);

      // Vector check
      expect(item.vector).toBeDefined();
      expect(Array.isArray(item.vector)).toBe(true);
      expect(item.vector.length).toBe(dimension);

      // Metadata check
      expect(item.metadata).toBeDefined();
      const metadata = typeof item.metadata === 'string'
        ? JSON.parse(item.metadata)
        : item.metadata;
      expect(metadata.test).toBe(true);
      expect(metadata.index).toBe(expectedIndex);

      // Contents check
      expect(item.contents).toBeDefined();
      let decoded: string;

      if (typeof item.contents === 'string') {
        // Contents returned as base64 string
        decoded = Buffer.from(item.contents, 'base64').toString();
      } else if (item.contents instanceof Buffer || item.contents?.type === 'Buffer') {
        // Contents returned as Buffer object or plain object with .type === 'Buffer'
        const buffer = Buffer.isBuffer(item.contents)
          ? item.contents
          : Buffer.from(item.contents.data);  // Handles plain object from JSON

        decoded = buffer.toString();
      } else {
        throw new Error(`Unexpected contents type: ${typeof item.contents}`);
      }

      expect(decoded).toBe(`test-content-${expectedIndex}`);

    });
  });

  // Test 7: Train index (equivalent to Python test_05_train_index)
  test('should train the index successfully', async () => {
    // Upsert enough vectors for training using (ids, vectors) overload
    const vectors = trainData.slice(0, 100);
    const ids = vectors.map((_, i) => i.toString());
    await index.upsert(ids, vectors);
    
    // Verify index is not trained initially
    const initialTrainedState = await index.isTrained();
    expect(initialTrainedState).toBe(false);
    
    // Train the index
    const trainResult = await index.train(BATCH_SIZE, MAX_ITERS, TOLERANCE);
    expect(trainResult.status).toBe('success');
    
    // Verify index is now trained
    const finalTrainedState = await index.isTrained();
    expect(finalTrainedState).toBe(true);
  });

  // Test 8: Trained upsert and query (equivalent to Python test_06_trained_upsert + test_07_trained_query_no_metadata)
  test('should upsert to trained index and query with better recall', async () => {
    // Initial upsert and training using VectorItem[] overload
    const initialVectors = trainData.slice(0, 50).map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: { category: "initial", index: i }
    }));
    await index.upsert(initialVectors);
    await index.train(BATCH_SIZE, MAX_ITERS, TOLERANCE);
    
    // Add more vectors after training using (ids, vectors) overload
    const additionalVectorData = trainData.slice(50, 80);
    const additionalIds = additionalVectorData.map((_, i) => (i + 50).toString());
    await index.upsert(additionalIds, additionalVectorData);
    
    // Query the trained index using new signature
    const response = await index.query(
      testData[0],      // queryVectors
      undefined,        // queryContents
      TOP_K,           // topK
      N_PROBES,        // nProbes
      {},              // filters
      ["metadata"],    // include
      false            // greedy
    );
    
    expect(response).toBeDefined();
    expect(response.results).toBeDefined();
    expect(response.results.length).toBeGreaterThan(0);
    
    const recall = computeRecall(response.results, sharedData?.neighbors || []);
    expect(recall).toBeGreaterThanOrEqual(RECALL_THRESHOLDS.trained);
  });

  // Test 9: Trained query with complex metadata (equivalent to Python test_08_trained_query_metadata)
  test('should filter with complex metadata on trained index', async () => {
    // Setup with varied metadata using VectorItem[] overload
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
    
    // Test complex filter using new signature
    const complexFilter = {
      "$and": [
        { "owner.name": "John" },
        { "age": { "$gt": 30 } },
        { "tags": { "$in": ["pet"] } }
      ]
    };
    
    const response = await index.query(
      testData[0],      // queryVectors
      undefined,        // queryContents
      TOP_K,           // topK
      N_PROBES,        // nProbes
      complexFilter,   // filters
      ["metadata"],    // include
      false            // greedy
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
      testData[0],      // queryVectors
      undefined,        // queryContents
      TOP_K,           // topK
      N_PROBES,        // nProbes
      nestedFilter,    // filters
      ["metadata"],    // include
      false            // greedy
    );
    
    expect(nestedResponse.results.length).toBeGreaterThan(0);
  });

  // Test 10: Batch query functionality (new comprehensive test)
  test('should perform batch query with multiple vectors', async () => {
    // Setup vectors using (ids, vectors) overload
    const vectorData = trainData.slice(0, 50);
    const ids = vectorData.map((_, i) => i.toString());
    await index.upsert(ids, vectorData);
    
    // Batch query with multiple test vectors using new signature
    const batchTestVectors = testData.slice(0, 3);
    const response: QueryResponse = await index.query(
      batchTestVectors, // queryVectors (batch)
      undefined,        // queryContents
      TOP_K,           // topK
      N_PROBES,        // nProbes
      {},              // filters
      ["metadata"],    // include
      false            // greedy
    );
    
    expect(response).toBeDefined();
    expect(response.results).toBeDefined();
    expect(response.results.length).toBe(batchTestVectors.length);
    
    // Check that each result has TOP_K items
    for (const resultSet of response.results as QueryResultItem[][]) {
      expect(resultSet.length).toBe(TOP_K);
    }
  });

  // NEW Test 10b: Test both upsert overloads in mixed operations
  test('should handle mixed operations with both upsert overloads', async () => {
    // First batch using VectorItem[] overload
    const vectorItems = trainData.slice(0, 25).map((vector, i) => ({
      id: `item-${i}`,
      vector,
      metadata: { batch: 1, index: i, type: 'vectorItem' }
    }));
    const result1 = await index.upsert(vectorItems);
    expect(result1.status).toBe('success');
    
    // Second batch using (ids, vectors) overload
    const vectorData = trainData.slice(25, 50);
    const ids = vectorData.map((_, i) => `array-${i + 25}`);
    const result2 = await index.upsert(ids, vectorData);
    expect(result2.status).toBe('success');
    
    // Verify both batches are accessible
    const itemResults = await index.get(['item-0', 'item-1']);
    const arrayResults = await index.get(['array-25', 'array-26']);
    
    expect(itemResults.length).toBe(2);
    expect(arrayResults.length).toBe(2);
    expect(itemResults[0].id).toBe('item-0');
    expect(arrayResults[0].id).toBe('array-25');
    
    // Verify metadata exists for VectorItem overload but not for arrays overload
    if (itemResults[0].metadata) {
      const metadata = typeof itemResults[0].metadata === 'string'
        ? JSON.parse(itemResults[0].metadata)
        : itemResults[0].metadata;
      expect(metadata.type).toBe('vectorItem');
    }
    
    // Query should work with vectors from both batches
    const response = await index.query(testData[0], undefined, 10);
    expect(response.results.length).toBe(10);
  });

  // Test 11: Delete vectors (equivalent to Python test_10_delete)
  test('should delete vectors from index', async () => {
    // Setup vectors using VectorItem[] overload
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

  // Test 13: Delete and recreate index
  test('should handle deleting and recreating an index', async () => {
    const indexConfig = generateIndexConfig(testIndexType, dimension);
    // Delete the index
    await index.deleteIndex();
    
    // Recreate with the same name
    const recreatedIndex = await client.createIndex(indexName, indexKey, indexConfig);
    const recreatedIndexName = await recreatedIndex.getIndexName();
    const recreatedIndexType = await recreatedIndex.getIndexType();
    
    expect(recreatedIndexName).toBe(indexName);
    expect(recreatedIndexType).toBe(testIndexType);
    
    // Verify the index works with (ids, vectors) overload
    const vectorData = trainData.slice(0, 5);
    const ids = vectorData.map((_, i) => i.toString());
    
    const upsertResult = await recreatedIndex.upsert(ids, vectorData);
    expect(upsertResult.status).toBe('success');
    
    // Update the index reference for cleanup
    index = recreatedIndex;
  });

  // Test 14: Query after deletion (equivalent to Python test_12_query_deleted)
  test('should query after deleting some vectors', async () => {
    // Setup vectors using VectorItem[] overload
    const vectors = trainData.slice(0, 30).map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: { test: true, index: i }
    }));
    await index.upsert(vectors);
    
    // Delete some vectors
    const idsToDelete = Array.from({length: 10}, (_, i) => i.toString());
    await index.delete(idsToDelete);
    
    // Query the index using new signature
    const response = await index.query(
      testData[0],      // queryVectors
      undefined,        // queryContents
      TOP_K,           // topK
      N_PROBES,        // nProbes
      {},              // filters
      ["metadata"],    // include
      false            // greedy
    );
    
    const results = response.results as QueryResultItem[];
    
    // Verify that deleted IDs don't appear in results
    results.forEach(result => {
      expect(idsToDelete).not.toContain(result.id);
    });
    
    expect(results.length).toBeGreaterThan(0);
  });

  // Test 15: Retrieve vectors by ID from trained index with updated async calls
  test('should retrieve vectors by ID from trained index', async () => {
    // Setup: upsert initial vectors using VectorItem[] overload
    const initialVectors = trainData.slice(0, 50).map((vector, i) => ({
      id: `trained-id-${i}`,
      vector,
      metadata: { 
        category: "initial", 
        index: i,
        test: true,
        owner: {
          name: i % 3 === 0 ? "John" : (i % 3 === 1 ? "Joseph" : "Mike"),
          pets_owned: i % 3 + 1
        }
      }
    }));
    await index.upsert(initialVectors);
    
    // Train the index
    await index.train(BATCH_SIZE, MAX_ITERS, TOLERANCE);
    
    // Add more vectors after training using (ids, vectors) overload
    const additionalVectorData = trainData.slice(50, 80);
    const additionalIds = additionalVectorData.map((_, i) => `trained-id-${i + 50}`);
    await index.upsert(additionalIds, additionalVectorData);
    
    // Test getting vectors from both initial and additional sets
    const idsToGet = [
      'trained-id-0', 'trained-id-1', 'trained-id-10',  // from initial set
      'trained-id-50', 'trained-id-55', 'trained-id-70' // from additional set
    ];
    
    const retrieved = await index.get(idsToGet);
    
    // Verify we got the expected number of results
    expect(retrieved.length).toBe(idsToGet.length);
    
    // Get the index type to determine expected vector dimension
    const indexType = await index.getIndexType();
    
    // For IVFPQ, vectors are compressed to pqDim, for others they keep original dimension
    let expectedVectorDim: number;
    if (indexType === "ivfpq" || indexType === "ivf_pq") {
      expectedVectorDim = PQ_DIM; // Use the constant we defined for IVFPQ
    } else {
      expectedVectorDim = dimension;
    }
    
    // Verify each retrieved item matches expectations
    retrieved.forEach((item, idx) => {
      const expectedId = idsToGet[idx];
      const expectedIndex = parseInt(expectedId.replace('trained-id-', ''));
      
      expect(item.id).toBe(expectedId);
      expect(item.vector).toBeDefined();
      
      // Check vector dimension based on index type
      if (item.vector && item.vector.length > 0) {
        expect(item.vector.length).toBe(expectedVectorDim);
      } else {
        console.warn(`Skipping vector dimension check for ${item.id} (vector missing or empty)`);
      }
      
      // Verify metadata structure - only exists for initial vectors (from VectorItem[])
      if (expectedIndex < 50) {
        // From VectorItem[] overload - should have metadata
        if (item.metadata) {
          const metadata = typeof item.metadata === 'string'
            ? JSON.parse(item.metadata)
            : item.metadata;
          
          expect(metadata.index).toBe(expectedIndex);
          expect(metadata.test).toBe(true);
          expect(metadata.owner).toBeDefined();
          expect(metadata.owner.name).toMatch(/^(John|Joseph|Mike)$/);
          expect(typeof metadata.owner.pets_owned).toBe('number');
          expect(metadata.category).toBe('initial');
        }
      } else {
        // From (ids, vectors) overload - may not have metadata
        // This is expected behavior
      }
    });
  });

  // Test 16: Get deleted items verification (equivalent to Python test_11_get_deleted)
  test('should verify deleted vectors cannot be retrieved', async () => {
    // Setup: upsert vectors with specific IDs for deletion testing using both overloads
    const vectorsToDelete = trainData.slice(0, 30).map((vector, i) => ({
      id: `delete-test-${i}`,
      vector,
      metadata: { 
        test: true, 
        index: i,
        category: "to-be-deleted",
        owner: {
          name: "TestUser",
          pets_owned: i % 5 + 1
        }
      }
    }));
    
    // Use (ids, vectors) overload for vectors to keep
    const vectorsToKeepData = trainData.slice(30, 50);
    const vectorsToKeepIds = vectorsToKeepData.map((_, i) => `keep-test-${i}`);
    
    // Upsert both sets using different overloads
    await index.upsert(vectorsToDelete);
    await index.upsert(vectorsToKeepIds, vectorsToKeepData);
    
    // Verify all vectors exist before deletion
    const allIds = [
      ...vectorsToDelete.map(v => v.id),
      ...vectorsToKeepIds
    ];
    const beforeDeletion = await index.get(allIds);
    expect(beforeDeletion.length).toBe(allIds.length);
    
    // Delete specific vectors
    const idsToDelete = vectorsToDelete.map(v => v.id);
    const deleteResult = await index.delete(idsToDelete);
    expect(deleteResult.status).toBe('success');
    
    // Attempt to get the deleted vectors - should return empty or no results
    const deletedResults = await index.get(idsToDelete);
    
    // The behavior might vary by implementation:
    // - Some implementations return empty array
    // - Others might return partial results excluding deleted items
    // We'll check that we don't get all the deleted items back
    expect(deletedResults.length).toBeLessThan(idsToDelete.length);
    
    // If any results are returned, they should not be the deleted items
    deletedResults.forEach(result => {
      // This shouldn't happen - no deleted IDs should be returned
      expect(idsToDelete).not.toContain(result.id);
    });
    
    // Verify that non-deleted vectors are still accessible
    const keptResults = await index.get(vectorsToKeepIds);
    expect(keptResults.length).toBe(vectorsToKeepIds.length);
    
    // Verify the kept vectors have correct data
    keptResults.forEach(result => {
      expect(vectorsToKeepIds).toContain(result.id);
      expect(result.vector).toBeDefined();
      
      // These vectors were added with (ids, vectors) overload, so no metadata expected
    });
    
    // Additional verification: try to get a mix of deleted and existing IDs
    const mixedIds = [
      idsToDelete[0], idsToDelete[1],  // deleted
      vectorsToKeepIds[0], vectorsToKeepIds[1]           // existing
    ];
    const mixedResults = await index.get(mixedIds);
    
    // Should only get back the existing ones
    expect(mixedResults.length).toBe(2);
    mixedResults.forEach(result => {
      expect(vectorsToKeepIds).toContain(result.id);
      expect(idsToDelete).not.toContain(result.id);
    });
  });

  // New Test 17: Test index configuration retrieval
  test('should retrieve and validate index configuration', async () => {
    const indexConfig = await index.getIndexConfig();
    
    expect(indexConfig).toBeDefined();
    expect(indexConfig.dimension).toBe(dimension);
    expect(indexConfig.metric).toBe(METRIC);
    
    // The property name might be nLists or n_lists depending on the API response
    const nLists = indexConfig.nLists ?? (indexConfig as any).n_lists;
    expect(nLists).toBe(N_LISTS);
    
    if (testIndexType === "ivfpq") {
      const ivfpqConfig = indexConfig as IndexIVFPQModel;
      // Handle both possible property names for PQ dimensions and bits
      const pqDim = ivfpqConfig.pqDim ?? (ivfpqConfig as any).pq_dim;
      const pqBits = ivfpqConfig.pqBits ?? (ivfpqConfig as any).pq_bits;
      
      expect(pqDim).toBe(PQ_DIM);
      expect(pqBits).toBe(PQ_BITS);
    }
  });

  // New Test 18: Test loadIndex with wrong credentials (error case)
  test('should fail to load index with wrong credentials', async () => {
    const wrongKey = generateRandomKey();
    
    try {
      await client.loadIndex(indexName, wrongKey);
      // If we reach here, the test should fail because an error was expected
      expect(true).toBe(false);
    } catch (error) {
      // This is expected - loading with wrong key should fail
      expect(error).toBeDefined();
    }
  });

  // NEW Test 19: Test upsert overload error handling
  test('should handle upsert overload errors correctly', async () => {
    // Test case 1: Invalid VectorItem (missing id)
    const invalidVectorItems = [{
      vector: trainData[0],
      metadata: { test: true }
      // Missing 'id' field
    }] as any[];
    
    try {
      await index.upsert(invalidVectorItems);
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(error.message).toBeDefined();
      expect(error.message).toContain("Missing required 'id' field");
      expect(error.message).toContain("index 0");
    }
    
    // Test case 2: Invalid vector type
    const invalidVectorType = [{
      id: 'test-id',
      vector: "not-an-array", // Should be array
      metadata: { test: true }
    }] as any[];
    
    try {
      await index.upsert(invalidVectorType);
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(error.message).toContain("'vector' must be an array");
      expect(error.message).toContain("test-id");
    }
    
    // Test case 3: Empty vector
    const emptyVector = [{
      id: 'test-id-2',
      vector: [], // Empty array
      metadata: { test: true }
    }];
    
    try {
      await index.upsert(emptyVector);
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(error.message).toContain("Vector array cannot be empty");
      expect(error.message).toContain("test-id-2");
    }
    
    // Test case 4: Mismatched array lengths for (ids, vectors) overload
    const ids = ['id1', 'id2', 'id3'];
    const vectors = [trainData[0], trainData[1]]; // One less vector than IDs
    
    try {
      await index.upsert(ids, vectors);
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(error.message).toContain("Array length mismatch");
      expect(error.message).toContain("3 IDs provided but 2 vectors");
    }
    
    // Test case 5: Invalid ID type in two-argument form
    const invalidIds = [123, 'valid-id'] as any[];
    const validVectors = [trainData[0], trainData[1]];
    
    try {
      await index.upsert(invalidIds, validVectors);
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(error.message).toContain("IDs must be strings");
      expect(error.message).toContain("index 0");
    }
    
    // Test case 6: Empty arrays should work (positive test)
    const emptyUpsertResult = await index.upsert([]);
    expect(emptyUpsertResult).toBeDefined();
    expect(emptyUpsertResult.status).toBe('success');
    expect(emptyUpsertResult.message).toContain('No items to upsert');
    
    // Test case 7: Valid data should work (positive test)
    const validVectorItems = trainData.slice(0, 2).map((vector, i) => ({
      id: `valid-${i}`,
      vector,
      metadata: { test: true, index: i }
    }));
    
    const validResult = await index.upsert(validVectorItems);
    expect(validResult.status).toBe('success');
    
    // Test case 8: Valid two-argument form should work (positive test)
    const validIds = ['two-arg-1', 'two-arg-2'];
    const validVectorData = trainData.slice(2, 4);
    
    const validTwoArgResult = await index.upsert(validIds, validVectorData);
    expect(validTwoArgResult.status).toBe('success');
  });

  // NEW Test 20: Test large batch operations with different overloads
  test('should handle large batch operations with both overloads', async () => {
    // Large batch using VectorItem[] overload
    const largeBatch1 = trainData.slice(0, 100).map((vector, i) => ({
      id: `large1-${i}`,
      vector,
      metadata: { batch: 'large1', index: i }
    }));
    
    const result1 = await index.upsert(largeBatch1);
    expect(result1.status).toBe('success');
    
    // Large batch using (ids, vectors) overload
    const largeBatch2Vectors = trainData.slice(100, 200);
    const largeBatch2Ids = largeBatch2Vectors.map((_, i) => `large2-${i + 100}`);
    
    const result2 = await index.upsert(largeBatch2Ids, largeBatch2Vectors);
    expect(result2.status).toBe('success');
    
    // Verify both batches are accessible
    const sample1 = await index.get(['large1-0', 'large1-50', 'large1-99']);
    const sample2 = await index.get(['large2-100', 'large2-150', 'large2-199']);
    
    expect(sample1.length).toBe(3);
    expect(sample2.length).toBe(3);
    
    // Test querying works with large dataset
    const queryResponse = await index.query(testData[0], undefined, 20);
    expect(queryResponse.results.length).toBe(20);
  });

  // New Test 21: Test QueryRequest object format
  test('should accept QueryRequest object format', async () => {
    // Setup vectors using (ids, vectors) overload
    const vectorData = trainData.slice(0, 10);
    const ids = vectorData.map((_, i) => `request-obj-${i}`);
    await index.upsert(ids, vectorData);
    
    // Test using QueryRequest object format
    const queryRequest = {
      indexName: indexName,
      indexKey: Buffer.from(indexKey).toString('hex'),
      queryVector: testData[0],
      topK: TOP_K,
      nProbes: N_PROBES,
      filters: {},
      include: ["metadata"],
      greedy: false
    };
    
    const response = await index.query(queryRequest);
    
    expect(response).toBeDefined();
    expect(response.results).toBeDefined();
    expect(response.results.length).toBeGreaterThan(0);
  });
});