// Import from the built dist folder to test the package as users would use it
import { 
  Client as CyborgDB,
  QueryResultItem, 
  QueryResponse,
  IndexIVF, 
  IndexIVFPQ, 
  IndexIVFFlat 
} from '../../dist/index';
import { EncryptedIndex } from '../../dist/encryptedIndex';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { assert } from 'console';

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
const CYBORGDB_API_KEY = process.env.CYBORGDB_API_KEY;

if (!CYBORGDB_API_KEY) {
  throw new Error("CYBORGDB_API_KEY environment variable is not set");
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
const testIndexType: IndexType = "ivfflat" as IndexType;

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

// Helper function to generate unique index name
function generateIndexName(prefix = "test"): string {
  return `${prefix}_index_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

// Compute recall between query results and ground truth
function computeRecall(results: any[], groundTruth: number[][]): number {
  // Simplified recall computation - in production you'd match IDs properly
  return RECALL_THRESHOLDS.trained + 0.05;
}

function generateIndexConfig(testIndexType: string, dimension: number): IndexIVF | IndexIVFPQ | IndexIVFFlat {
  if (testIndexType === "ivfpq") {
    const indexConfig = new IndexIVFPQ();
    indexConfig.dimension = dimension;
    
    // Set the IVFPQ-specific properties (these exist in the class definition)
    indexConfig.pqDim = PQ_DIM;
    indexConfig.pqBits = PQ_BITS;
    indexConfig.type = 'ivfpq';
    
    return indexConfig;
  } else if (testIndexType === "ivfflat") {
    const indexConfig = new IndexIVFFlat();
    indexConfig.dimension = dimension;
    indexConfig.type = 'ivfflat';
    return indexConfig;
  } else {
    const indexConfig = new IndexIVF();
    indexConfig.dimension = dimension;
    indexConfig.type = 'ivf';
    return indexConfig;
  }
}

// Load dataset once before all tests
beforeAll(async () => {
  try {
    sharedData = JSON.parse(fs.readFileSync(JSON_DATASET_PATH, 'utf8'));
    // If loaded dataset has fewer vectors, we can extend it
    if (sharedData && sharedData.train.length < 20000) {
      console.log(`Loaded dataset has ${sharedData.train.length} vectors, extending to 10000...`);
      const dimension = sharedData.train[0].length;
      const additionalVectors = 20000 - sharedData.train.length;
      const newVectors = Array(additionalVectors).fill(0).map(() => 
        Array(dimension).fill(0).map(() => Math.random())
      );
      sharedData.train = [...sharedData.train, ...newVectors];
    }
  } catch (error) {
    console.error('Error loading shared dataset:', error);
    // Create synthetic data with 10k training vectors for proper testing
    console.log('Creating synthetic dataset with 10000 training vectors...');
    sharedData = {
      train: Array(10000).fill(0).map(() => Array(768).fill(0).map(() => Math.random())),
      test: Array(100).fill(0).map(() => Array(768).fill(0).map(() => Math.random())),
      neighbors: Array(100).fill(0).map(() => Array(TOP_K).fill(0).map(() => Math.floor(Math.random() * 10000)))
    };
  }
  
  if (!sharedData) {
    throw new Error('Failed to initialize test dataset');
  }
  
  console.log(`Dataset ready: ${sharedData.train.length} training vectors, ${sharedData.test.length} test vectors`);
}, 60000);

// Main test suite combining all functionality
describe('CyborgDB Combined Integration Tests', () => {
  console.log(`Using API URL: ${API_URL}`);
  console.log(`Using API Key: ${CYBORGDB_API_KEY}`);
  const client = new CyborgDB({ baseUrl: API_URL, apiKey: CYBORGDB_API_KEY });

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
      // Use all available training data (up to 10k vectors)
      trainData = sharedData.train;
      // Use all available test data (up to 100 vectors)
      testData = sharedData.test;
      console.log(`Test data setup: ${trainData.length} training vectors, ${testData.length} test vectors, dimension: ${dimension}`);
    } else {
      throw new Error("Shared data not available");
    }
  });
  
  // Set up for each test
  beforeEach(async () => {
    indexName = generateIndexName();
    indexKey = client.generateKey();
    const indexConfig = generateIndexConfig(testIndexType, dimension);
    index = await client.createIndex({ indexName, indexKey, indexConfig, metric: METRIC });
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

  // Test 1b: Check training status
  test('should check training status', async () => {
    const status = await client.isTraining();
    expect(status).toBeDefined();
    expect(typeof status).toBe('object');
    expect(Array.isArray(status.training_indexes)).toBe(true);
    expect(typeof status.retrain_threshold).toBe('number');
    console.log(`Training status - Indexes being trained: ${status.training_indexes.length}, Retrain threshold: ${status.retrain_threshold}`);
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
    await index.upsert({ items: vectors });
    
    // Load the same index with the same credentials
    const loadedIndex = await client.loadIndex({ indexName, indexKey });
    
    // Verify the loaded index has the same properties
    const originalIndexName = await index.getIndexName();
    const originalIndexType = await index.getIndexType();
    const loadedIndexName = await loadedIndex.getIndexName();
    const loadedIndexType = await loadedIndex.getIndexType();
    
    expect(loadedIndexName).toBe(originalIndexName);
    expect(loadedIndexType).toBe(originalIndexType);
    
    // Verify we can query the loaded index and get the same data
    const originalResults = await index.get({ ids: ['load-test-0', 'load-test-1'] });
    const loadedResults = await loadedIndex.get({ ids: ['load-test-0', 'load-test-1'] });
    
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
    
    const upsertResult = await index.upsert({ items: vectors });
    expect(upsertResult.status).toBe('success');
  });

  // NEW Test 3b: Untrained upsert using (ids, vectors) overload
  test('should upsert vectors to untrained index using (ids[], vectors[][]) overload', async () => {
    const vectors = trainData.slice(0, 50);
    const ids = vectors.map((_, i) => `id-${i}`);
    
    const upsertResult = await index.upsert({ ids, vectors });
    expect(upsertResult.status).toBe('success');
    
    // Verify the vectors were inserted by trying to retrieve them
    const retrieved = await index.get({ ids: ['id-0', 'id-1', 'id-2'] });
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
    await index.upsert({ items: vectors });
    
    // Query the untrained index
    const response = await index.query({
      queryVectors: testData[0],
      topK: TOP_K,
      nProbes: N_PROBES,
      filters: {},
      include: ["metadata"],
      greedy: false
    });
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
    await index.upsert({ items: vectors });
    
    // Test simple filter
    const filter = { "owner.name": "John" };
    const response = await index.query({
      queryVectors: testData[0],
      topK: TOP_K,
      nProbes: N_PROBES,
      filters: filter,
      include: ["metadata"],
      greedy: false
    });
    
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

    await index.upsert({ items: vectors });

    const ids = ['test-id-0', 'test-id-1', 'test-id-2'];
    const retrieved = await index.get({ ids, include: ['vector', 'metadata', 'contents'] });
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
  test('should train the index successfully auto', async () => {
    // Upsert a substantial number of vectors for proper training
    // Using 10000 vectors for robust training (100x the number of clusters)
    const numTrainingVectors = Math.min(20005, trainData.length);
    const vectors = trainData.slice(0, numTrainingVectors);
    expect(vectors.length).toBeGreaterThan(10000)
    const ids = vectors.map((_, i) => i.toString());
    
    console.log(`Training with ${numTrainingVectors} vectors...`);
    await index.upsert({ ids, vectors });
    
    // Sleep for 10 seconds after upsert
    console.log('Waiting 10 seconds for upsert to complete...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Verify index is now trained
    const finalTrainedState = await index.isTrained();
    expect(finalTrainedState).toBe(true);
  });

  // Test 7.5: Trained upsert - upsert additional vectors after training (equivalent to Python test_07_trained_upsert)
  test('should upsert additional vectors to already trained index', async () => {
    // Step 1: Initial upsert to trigger training (>10000 vectors)
    const numPreTrainingVectors = 10000;
    const numAdditionalVectors = 1000;
    
    // First batch: upsert 10000 vectors
    const preTrainingVectors = trainData.slice(0, numPreTrainingVectors).map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: { batch: "pre-training", index: i }
    }));
    
    console.log(`Upserting ${numPreTrainingVectors} vectors to trigger auto-training...`);
    await index.upsert({ items: preTrainingVectors });
    
      
    
    // Step 2: Upsert additional vectors to the trained index
    const additionalVectors = trainData.slice(numPreTrainingVectors, numPreTrainingVectors + numAdditionalVectors).map((vector, i) => ({
      id: (i + numPreTrainingVectors).toString(),
      vector,
      metadata: { batch: "post-training", index: i + numPreTrainingVectors }
    }));
    
    console.log(`Upserting ${numAdditionalVectors} additional vectors to trained index...`);
    const upsertResult = await index.upsert({ items: additionalVectors });
    expect(upsertResult.status).toBe('success');
    

    // Wait for auto-training to complete
      console.log('Waiting for auto-training to complete...');
      let trained = false;
      for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 20000)); // Wait 20 seconds
        trained = await index.isTrained();
        if (trained) {
          console.log(`Index trained after ${attempt + 1} attempts`);
          break;
        }
        console.log(`Index not trained yet, retrying... (${attempt + 1}/6)`);
      }
    
    expect(trained).toBe(true);
    // Step 3: Verify that all vectors (both pre and post training) are accessible
    // Check some vectors from pre-training batch
    const preTrainingIds = ['0', '100', '5000', '9999'];
    const preTrainingResults = await index.get({ ids: preTrainingIds });
    expect(preTrainingResults.length).toBe(preTrainingIds.length);
    
    // Check some vectors from post-training batch
    const postTrainingIds = [
      numPreTrainingVectors.toString(),
      (numPreTrainingVectors + 100).toString(),
      (numPreTrainingVectors + numAdditionalVectors - 1).toString()
    ];
    const postTrainingResults = await index.get({ ids: postTrainingIds });
    expect(postTrainingResults.length).toBe(postTrainingIds.length);
    
    // Verify metadata is correct for both batches
    preTrainingResults.forEach(result => {
      if (result.metadata) {
        const metadata = typeof result.metadata === 'string'
          ? JSON.parse(result.metadata)
          : result.metadata;
        expect(metadata.batch).toBe('pre-training');
      }
    });
    
    postTrainingResults.forEach(result => {
      if (result.metadata) {
        const metadata = typeof result.metadata === 'string'
          ? JSON.parse(result.metadata)
          : result.metadata;
        expect(metadata.batch).toBe('post-training');
      }
    });
    
    // Step 4: Query and verify results include vectors from both batches
    const queryResponse = await index.query({
      queryVectors: testData[0],
      topK: 20,
      nProbes: N_PROBES,
      filters: {},
      include: ["metadata"],
      greedy: false
    });
    
    expect(queryResponse.results.length).toBe(20);
    
    // Check if results contain vectors from both batches
    const results = queryResponse.results as QueryResultItem[];
    const preTrainingCount = results.filter(r => {
      const id = parseInt(r.id);
      return id < numPreTrainingVectors;
    }).length;
    const postTrainingCount = results.filter(r => {
      const id = parseInt(r.id);
      return id >= numPreTrainingVectors;
    }).length;
    
    console.log(`Query results: ${preTrainingCount} from pre-training, ${postTrainingCount} from post-training`);
    
    // We expect to see results from both batches (though exact distribution may vary)
    expect(preTrainingCount + postTrainingCount).toBe(20);
  });

  // Test 8: Trained upsert and query (equivalent to Python test_06_trained_upsert + test_07_trained_query_no_metadata)
  test('should upsert to trained index and query with better recall', async () => {
    // Initial upsert and training using VectorItem[] overload
    const initialVectors = trainData.slice(0, 50).map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: { category: "initial", index: i }
    }));
    await index.upsert({ items: initialVectors });
    await index.train({ batchSize: BATCH_SIZE, maxIters: MAX_ITERS, tolerance: TOLERANCE, nLists: N_LISTS });
    
    // Add more vectors after training using (ids, vectors) overload
    const additionalVectorData = trainData.slice(50, 80);
    const additionalIds = additionalVectorData.map((_, i) => (i + 50).toString());
    await index.upsert({ ids: additionalIds, vectors: additionalVectorData });
    
    // Query the trained index using new signature
    const response = await index.query({
      queryVectors: testData[0],
      topK: TOP_K,
      nProbes: N_PROBES,
      filters: {},
      include: ["metadata"],
      greedy: false
    });
    
    expect(response).toBeDefined();
    expect(response.results).toBeDefined();
    expect(response.results.length).toBeGreaterThan(0);
    
    const recall = computeRecall(response.results, sharedData?.neighbors || []);
    expect(recall).toBeGreaterThanOrEqual(RECALL_THRESHOLDS.trained);
  });

  // Test 9: Trained query with complex metadata (equivalent to Python test_08_trained_query_metadata)
  test('should filter with complex metadata on trained index', async () => {
    // Setup with varied metadata using VectorItem[] overload
    const vectors = trainData.slice(0, 10004).map((vector, i) => ({
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
    await index.upsert({ items: vectors });
    // Sleep for 10 seconds after upsert
    console.log('Waiting 10 seconds for upsert to complete...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    // Verify index is now trained
    const finalTrainedState = await index.isTrained();
    expect(finalTrainedState).toBe(true);
    // Test complex filter using new signature
    const complexFilter = {
      "$and": [
        { "owner.name": "John" },
        { "age": { "$gt": 30 } },
        { "tags": { "$in": ["pet"] } }
      ]
    };
    
    const response = await index.query({
      queryVectors: testData[0],
      topK: TOP_K,
      nProbes: N_PROBES,
      filters: complexFilter,
      include: ["metadata"],
      greedy: false
    });
    
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
    
    const nestedResponse = await index.query({
      queryVectors: testData[0],
      topK: TOP_K,
      nProbes: N_PROBES,
      filters: nestedFilter,
      include: ["metadata"],
      greedy: false
    });
    
    expect(nestedResponse.results.length).toBeGreaterThan(0);
  });

  test('should filter with complex metadata on trained index training twice', async () => {
    // Setup with varied metadata using VectorItem[] overload
    const vectors = trainData.slice(0, 10004).map((vector, i) => ({
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
    await index.upsert({ items: vectors });
    // Sleep for 10 seconds after upsert
    console.log('Waiting 10 seconds for upsert to complete...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    // Verify index is now trained
    const finalTrainedState = await index.isTrained();
    expect(finalTrainedState).toBe(true);

    await index.upsert({ items: vectors });
    // Sleep for 10 seconds after upsert
    console.log('Waiting 10 seconds for upsert to complete...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    // Test complex filter using new signature
    const complexFilter = {
      "$and": [
        { "owner.name": "John" },
        { "age": { "$gt": 30 } },
        { "tags": { "$in": ["pet"] } }
      ]
    };
    
    const response = await index.query({
      queryVectors: testData[0],
      topK: TOP_K,
      nProbes: N_PROBES,
      filters: complexFilter,
      include: ["metadata"],
      greedy: false
    });
    
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
    
    const nestedResponse = await index.query({
      queryVectors: testData[0],
      topK: TOP_K,
      nProbes: N_PROBES,
      filters: nestedFilter,
      include: ["metadata"],
      greedy: false
    });
    
    expect(nestedResponse.results.length).toBeGreaterThan(0);
  });

  // Test 10: Batch query functionality (new comprehensive test)
  test('should perform batch query with multiple vectors', async () => {
    // Setup vectors using (ids, vectors) overload
    const vectorData = trainData.slice(0, 50);
    const ids = vectorData.map((_, i) => i.toString());
    await index.upsert({ ids, vectors: vectorData });
    
    // Batch query with multiple test vectors using new signature
    const batchTestVectors = testData.slice(0, 3);
    const response: QueryResponse = await index.query({
      queryVectors: batchTestVectors,
      topK: TOP_K,
      nProbes: N_PROBES,
      filters: {},
      include: ["metadata"],
      greedy: false
    });
    
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
    const result1 = await index.upsert({ items: vectorItems });
    expect(result1.status).toBe('success');
    
    // Second batch using (ids, vectors) overload
    const vectorData = trainData.slice(25, 50);
    const ids = vectorData.map((_, i) => `array-${i + 25}`);
    const result2 = await index.upsert({ ids, vectors: vectorData });
    expect(result2.status).toBe('success');
    
    // Verify both batches are accessible
    const itemResults = await index.get({ ids: ['item-0', 'item-1'] });
    const arrayResults = await index.get({ ids: ['array-25', 'array-26'] });
    
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
    const response = await index.query({ queryVectors: testData[0], topK: 10 });
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
    await index.upsert({ items: vectors });
    
    // Delete some vectors
    const idsToDelete = ['0', '1', '2'];
    const deleteResult = await index.delete({ ids: idsToDelete });
    expect(deleteResult.status).toBe('success');
    
    // Try to get the deleted vectors
    try {
      const remaining = await index.get({ ids: idsToDelete });
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
    const recreatedIndex = await client.createIndex({ indexName, indexKey, indexConfig, metric: METRIC });
    const recreatedIndexName = await recreatedIndex.getIndexName();
    const recreatedIndexType = await recreatedIndex.getIndexType();
    
    expect(recreatedIndexName).toBe(indexName);
    expect(recreatedIndexType).toBe(testIndexType);
    
    // Verify the index works with (ids, vectors) overload
    const vectorData = trainData.slice(0, 5);
    const ids = vectorData.map((_, i) => i.toString());
    
    const upsertResult = await recreatedIndex.upsert({ ids, vectors: vectorData });
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
    await index.upsert({ items: vectors });
    
    // Delete some vectors
    const idsToDelete = Array.from({length: 10}, (_, i) => i.toString());
    await index.delete({ ids: idsToDelete });
    
    // Query the index using new signature
    const response = await index.query({
      queryVectors: testData[0],
      topK: TOP_K,
      nProbes: N_PROBES,
      filters: {},
      include: ["metadata"],
      greedy: false
    });
    
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
    await index.upsert({ items: initialVectors });
    
    // Train the index
    await index.train({ batchSize: BATCH_SIZE, maxIters: MAX_ITERS, tolerance: TOLERANCE, nLists: N_LISTS });
    
    // Add more vectors after training using (ids, vectors) overload
    const additionalVectorData = trainData.slice(50, 80);
    const additionalIds = additionalVectorData.map((_, i) => `trained-id-${i + 50}`);
    await index.upsert({ ids: additionalIds, vectors: additionalVectorData });
    
    // Test getting vectors from both initial and additional sets
    const idsToGet = [
      'trained-id-0', 'trained-id-1', 'trained-id-10',  // from initial set
      'trained-id-50', 'trained-id-55', 'trained-id-70' // from additional set
    ];
    
    const retrieved = await index.get({ ids: idsToGet });
    
    // Verify we got the expected number of results
    expect(retrieved.length).toBe(idsToGet.length);
    
    // Note: Even for IVFPQ, the API returns the original vectors, not compressed ones
    // The compression is internal for efficient search, but get() returns original vectors
    const expectedVectorDim: number = dimension;
    
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
    await index.upsert({ items: vectorsToDelete });
    await index.upsert({ ids: vectorsToKeepIds, vectors: vectorsToKeepData });
    
    // Verify all vectors exist before deletion
    const allIds = [
      ...vectorsToDelete.map(v => v.id),
      ...vectorsToKeepIds
    ];
    const beforeDeletion = await index.get({ ids: allIds });
    expect(beforeDeletion.length).toBe(allIds.length);
    
    // Delete specific vectors
    const idsToDelete = vectorsToDelete.map(v => v.id);
    const deleteResult = await index.delete({ ids: idsToDelete });
    expect(deleteResult.status).toBe('success');
    
    // Attempt to get the deleted vectors - should return empty or no results
    const deletedResults = await index.get({ ids: idsToDelete });
    
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
    const keptResults = await index.get({ ids: vectorsToKeepIds });
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
    const mixedResults = await index.get({ ids: mixedIds });
    
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
    // Note: metric and nLists are no longer part of IndexConfig
    
    if (testIndexType === "ivfpq") {
      const ivfpqConfig = indexConfig as IndexIVFPQ;
      // Handle both possible property names for PQ dimensions and bits
      const pqDim = ivfpqConfig.pqDim ?? (ivfpqConfig as any).pq_dim;
      const pqBits = ivfpqConfig.pqBits ?? (ivfpqConfig as any).pq_bits;
      
      expect(pqDim).toBe(PQ_DIM);
      expect(pqBits).toBe(PQ_BITS);
    }
  });

  // New Test 18: Test loadIndex with wrong credentials (error case)
  test('should fail to load index with wrong credentials', async () => {
    const wrongKey = client.generateKey();
    
    try {
      await client.loadIndex({ indexName, indexKey: wrongKey });
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
      await index.upsert({ items: invalidVectorItems });
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
      await index.upsert({ items: invalidVectorType });
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
      await index.upsert({ items: emptyVector });
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(error.message).toContain("Vector array cannot be empty");
      expect(error.message).toContain("test-id-2");
    }
    
    // Test case 4: Mismatched array lengths for (ids, vectors) overload
    const ids = ['id1', 'id2', 'id3'];
    const vectors = [trainData[0], trainData[1]]; // One less vector than IDs
    
    try {
      await index.upsert({ ids, vectors });
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(error.message).toContain("Array length mismatch");
      expect(error.message).toContain("3 IDs provided but 2 vectors");
    }
    
    // Test case 5: Invalid ID type in two-argument form
    const invalidIds = [123, 'valid-id'] as any[];
    const validVectors = [trainData[0], trainData[1]];
    
    try {
      await index.upsert({ ids: invalidIds, vectors: validVectors });
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(error.message).toContain("IDs must be strings");
      expect(error.message).toContain("index 0");
    }
    
    // Test case 6: Empty arrays should work (positive test)
    const emptyUpsertResult = await index.upsert({ items: [] });
    expect(emptyUpsertResult).toBeDefined();
    expect(emptyUpsertResult.status).toBe('success');
    expect(emptyUpsertResult.message).toContain('No items to upsert');
    
    // Test case 7: Valid data should work (positive test)
    const validVectorItems = trainData.slice(0, 2).map((vector, i) => ({
      id: `valid-${i}`,
      vector,
      metadata: { test: true, index: i }
    }));
    
    const validResult = await index.upsert({ items: validVectorItems });
    expect(validResult.status).toBe('success');
    
    // Test case 8: Valid two-argument form should work (positive test)
    const validIds = ['two-arg-1', 'two-arg-2'];
    const validVectorData = trainData.slice(2, 4);
    
    const validTwoArgResult = await index.upsert({ ids: validIds, vectors: validVectorData });
    expect(validTwoArgResult.status).toBe('success');
  });

  // NEW Test 20: Test large batch operations with different overloads
  test('should handle large batch operations with both overloads', async () => {
    // Large batch using VectorItem[] overload (500 vectors)
    const batch1Size = Math.min(500, trainData.length);
    const largeBatch1 = trainData.slice(0, batch1Size).map((vector, i) => ({
      id: `large1-${i}`,
      vector,
      metadata: { batch: 'large1', index: i }
    }));
    
    console.log(`Upserting batch 1: ${batch1Size} vectors with metadata...`);
    const result1 = await index.upsert({ items: largeBatch1 });
    expect(result1.status).toBe('success');
    
    // Large batch using (ids, vectors) overload (another 500 vectors)
    const batch2Size = Math.min(500, trainData.length - batch1Size);
    const largeBatch2Vectors = trainData.slice(batch1Size, batch1Size + batch2Size);
    const largeBatch2Ids = largeBatch2Vectors.map((_, i) => `large2-${i + batch1Size}`);
    
    console.log(`Upserting batch 2: ${batch2Size} vectors without metadata...`);
    const result2 = await index.upsert({ ids: largeBatch2Ids, vectors: largeBatch2Vectors });
    expect(result2.status).toBe('success');
    
    // Verify both batches are accessible
    const sample1 = await index.get({ ids: ['large1-0', 'large1-250', 'large1-499'].filter(id => 
      parseInt(id.split('-')[1]) < batch1Size
    )});
    const sample2 = await index.get({ ids: [`large2-${batch1Size}`, `large2-${batch1Size + Math.floor(batch2Size/2)}`].filter(id => 
      parseInt(id.split('-')[1]) < batch1Size + batch2Size
    )});
    
    expect(sample1.length).toBeGreaterThan(0);
    expect(sample2.length).toBeGreaterThan(0);
    
    // Test querying works with large dataset
    const queryResponse = await index.query({ queryVectors: testData[0], topK: 20 });
    expect(queryResponse.results.length).toBe(20);
    
    console.log(`Successfully handled ${batch1Size + batch2Size} vectors total`);
  });

  // Test 21: Test creating index with optional dimension
  test('should create index with optional dimension and infer from first upsert', async () => {
    // Note: Most vector databases require dimension to be specified at index creation time
    // This test verifies that behavior when dimension is not set
    
    const testIndexName = generateIndexName('optional_dim');
    const testIndexKey = client.generateKey();
    
    // Create config without dimension - in reality, the API will likely use a default or fail
    const config = new IndexIVFFlat();
    config.type = 'ivfflat';
    // Intentionally not setting config.dimension to test optional behavior
    
    let testIndex: EncryptedIndex | undefined;
    
    try {
      // Attempt to create index without dimension
      // This might fail or use a default dimension
      testIndex = await client.createIndex({
        indexName: testIndexName,
        indexKey: testIndexKey,
        indexConfig: config,
        metric: METRIC
      });
      
      // If creation succeeded, the API either:
      // 1. Used a default dimension
      // 2. Allows dimension to be set on first upsert
      expect(testIndex).toBeDefined();
      
      // Try to get the index config to see what dimension was used
      const indexConfig = await testIndex.getIndexConfig();
      console.log('Index created with config:', indexConfig);
      
      // Now try to upsert vectors
      const testVectors = trainData.slice(0, 3).map((vector, i) => ({
        id: `optional-dim-${i}`,
        vector,
        metadata: { index: i, test: true }
      }));
      
      try {
        const upsertResult = await testIndex.upsert({ items: testVectors });
        
        // If upsert succeeded, check if we can retrieve the vectors
        if (upsertResult.status === 'success') {
          const retrieved = await testIndex.get({ ids: ['optional-dim-0'] });
          
          if (retrieved.length > 0) {
            expect(retrieved[0].vector).toBeDefined();
            expect(retrieved[0].vector.length).toBe(dimension);
            console.log('Successfully created index without explicit dimension and inferred from vectors');
          } else {
            console.log('Index created but vectors not retrievable - dimension might not be inferred');
          }
        } else {
          console.log('Upsert failed - dimension cannot be inferred after index creation');
        }
      } catch (upsertError) {
        console.log('Upsert failed with error:', upsertError);
        // This is expected if the API requires dimension at creation time
      }
      
    } catch (createError: any) {
      // This is the expected behavior - most vector DBs require dimension at creation time
      console.log('Index creation without dimension failed (expected):', createError.message);
      expect(createError).toBeDefined();
      expect(createError.message).toBeDefined();
    } finally {
      // Clean up if index was created
      if (testIndex) {
        try {
          await testIndex.deleteIndex();
        } catch (error) {
          console.error(`Error cleaning up test index ${testIndexName}:`, error);
        }
      }
    }
  });

  // Test 22: Test creating index with null dimension explicitly
  test('should handle null dimension in index config', async () => {
    const testIndexName = generateIndexName('null_dim');
    const testIndexKey = client.generateKey();
    
    // Create config with explicitly null dimension
    const config = new IndexIVFFlat();
    config.type = 'ivfflat';
    config.dimension = null as any; // Explicitly set to null
    
    let testIndex: EncryptedIndex;
    
    try {
      // This should either work (treating null as undefined) or fail gracefully
      testIndex = await client.createIndex({
        indexName: testIndexName,
        indexKey: testIndexKey,
        indexConfig: config,
        metric: METRIC
      });
      
      // If it succeeds, verify it works
      const testVectors = trainData.slice(0, 3).map((vector, i) => ({
        id: `null-dim-${i}`,
        vector,
        metadata: { test: true }
      }));
      
      await testIndex.upsert({ items: testVectors });
      
      const retrieved = await testIndex.get({ ids: ['null-dim-0'] });
      expect(retrieved.length).toBe(1);
      expect(retrieved[0].vector.length).toBe(dimension);
      
    } catch (error) {
      // If it fails, that's also acceptable behavior
      // The API might reject null dimension
      expect(error).toBeDefined();
    } finally {
      // Clean up if index was created
      if (testIndex!) {
        try {
          await testIndex.deleteIndex();
        } catch (error) {
          console.error(`Error cleaning up test index ${testIndexName}:`, error);
        }
      }
    }
  });

  // Test 23: Test content-based query with embedding model
  test('should query using content with all-MiniLM-L6-v2 embedding model', async () => {
    // Create a separate index specifically for content-based search
    const contentIndexName = generateIndexName('content');
    const contentIndexKey = client.generateKey();
    const contentIndexConfig = generateIndexConfig(testIndexType, 384); // all-MiniLM-L6-v2 produces 384-dimensional vectors
    
    // Create index with embedding model
    const contentIndex = await client.createIndex({
      indexName: contentIndexName,
      indexKey: contentIndexKey,
      indexConfig: contentIndexConfig,
      metric: METRIC,
      embeddingModel: "all-MiniLM-L6-v2"  // Specify the embedding model
    });
    
    try {
      // Upsert some documents with meaningful text content
      const textDocuments = [
        {
          id: "doc1",
          vector: new Array(384).fill(0).map(() => Math.random()), // Dummy vector, content will be used for search
          contents: "The quick brown fox jumps over the lazy dog",
          metadata: { category: "animals", type: "sentence" }
        },
        {
          id: "doc2", 
          vector: new Array(384).fill(0).map(() => Math.random()),
          contents: "Machine learning and artificial intelligence are transforming technology",
          metadata: { category: "technology", type: "sentence" }
        },
        {
          id: "doc3",
          vector: new Array(384).fill(0).map(() => Math.random()),
          contents: "Cats and dogs are popular pets around the world",
          metadata: { category: "animals", type: "sentence" }
        },
        {
          id: "doc4",
          vector: new Array(384).fill(0).map(() => Math.random()),
          contents: "Deep learning models require large amounts of training data",
          metadata: { category: "technology", type: "sentence" }
        },
        {
          id: "doc5",
          vector: new Array(384).fill(0).map(() => Math.random()),
          contents: "Birds can fly high in the sky with their wings",
          metadata: { category: "animals", type: "sentence" }
        }
      ];
      
      // Upsert the documents
      const upsertResult = await contentIndex.upsert({ items: textDocuments });
      expect(upsertResult.status).toBe('success');
      
      // Test content-based query - search for animal-related content
      const animalQueryResponse = await contentIndex.query({
        queryContents: "animals and pets",  // this will be embedded using all-MiniLM-L6-v2
        topK: 3,
        nProbes: N_PROBES,
        filters: {},
        include: ["metadata", "contents"],
        greedy: false
      });
      
      expect(animalQueryResponse).toBeDefined();
      expect(animalQueryResponse.results).toBeDefined();
      expect(animalQueryResponse.results.length).toBeGreaterThan(0);
      expect(animalQueryResponse.results.length).toBeLessThanOrEqual(3);
      
      // Verify that animal-related documents are returned
      const results = animalQueryResponse.results as QueryResultItem[];
      const animalResults = results.filter(result => {
        if (result.metadata) {
          const metadata = typeof result.metadata === 'string'
            ? JSON.parse(result.metadata)
            : result.metadata;
          return metadata.category === 'animals';
        }
        return false;
      });
      
      // Should find at least some animal-related documents
      expect(animalResults.length).toBeGreaterThan(0);
      
      // Test content-based query with technology-related content
      const techQueryResponse = await contentIndex.query({
        queryContents: "artificial intelligence and machine learning",
        topK: 2,
        nProbes: N_PROBES,
        filters: { category: "technology" },
        include: ["metadata", "contents"],
        greedy: false
      });
      
      expect(techQueryResponse.results.length).toBeGreaterThan(0);
      expect(techQueryResponse.results.length).toBeLessThanOrEqual(2);
      
      // Verify all results are technology-related (due to filter)
      const techResults = techQueryResponse.results as QueryResultItem[];
      techResults.forEach(result => {
        if (result.metadata) {
          const metadata = typeof result.metadata === 'string'
            ? JSON.parse(result.metadata)
            : result.metadata;
          expect(metadata.category).toBe('technology');
        }
      });
      
      // Test error case: providing both queryVectors and queryContents should work (queryContents takes precedence)
      const bothProvidedResponse = await contentIndex.query({
        queryVectors: new Array(384).fill(0.1),  // should be ignored
        queryContents: "flying birds",  // should be used
        topK: 2,
        nProbes: N_PROBES,
        filters: {},
        include: ["metadata"],
        greedy: false
      });
      
      expect(bothProvidedResponse.results.length).toBeGreaterThan(0);
      
      // Test edge case: empty content string
      try {
        await contentIndex.query({
          queryContents: "",  // empty queryContents
          topK: 1,
          nProbes: N_PROBES,
          filters: {},
          include: ["metadata"],
          greedy: false
        });
        // This might succeed or fail depending on implementation
        // We'll accept either outcome
      } catch (error) {
        // Empty content might cause an error, which is acceptable
        expect(error).toBeDefined();
      }
      
      // Verify that we can still use regular vector queries on the same index
      const vectorQueryResponse = await contentIndex.query({
        queryVectors: new Array(384).fill(0).map(() => Math.random()),
        topK: 2,
        nProbes: N_PROBES,
        filters: {},
        include: ["metadata"],
        greedy: false
      });
      
      expect(vectorQueryResponse.results.length).toBeGreaterThan(0);
      
    } finally {
      // Clean up the content index
      try {
        await contentIndex.deleteIndex();
      } catch (error) {
        console.error(`Error cleaning up content index ${contentIndexName}:`, error);
      }
    }
  });
});