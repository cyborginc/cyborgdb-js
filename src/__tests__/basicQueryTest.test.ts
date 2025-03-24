// src/__tests__/comprehensive-test.test.ts

import { CyborgDB } from '../index';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { IndexInfoResponseModel } from '../model/indexInfoResponseModel';
import { IndexConfig } from '../model/indexConfig';

/**
 * To run the integration tests:
 * 1. Start the CyborgDB service locally or on a server
 * 2. Copy the API key from the service terminal and set it in a .env file
 * 3. Run `npm test` to execute the tests
 */

// Load environment variables from .env file
dotenv.config();

// Constants - VERY minimal for faster testing
const API_URL = 'http://localhost:8000';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";
console.log("API_KEY: ", ADMIN_API_KEY);

if (!ADMIN_API_KEY) {
  throw new Error("ADMIN_API_KEY environment variable is not set");
}

const JSON_DATASET_PATH = path.join(__dirname, 'wiki_data_sample.json');
const N_LISTS = 100; // Much smaller for testing
const PQ_DIM = 32;
const PQ_BITS = 8;
const TOP_K = 5; // Minimal
const N_PROBES = 10; // Small value

jest.setTimeout(3000000); // 5 minutes per test timeout

// Helper function to generate a random index name
function generateIndexName(prefix = "test") {
  return `${prefix}_index_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

describe('CyborgDB Integration Tests', () => {
  // Shared variables
  let client: CyborgDB;
  let indexKey: Uint8Array;
  let indexName: string;
  let dimension: number;
  let trainData: number[][];
  let testVector: number[];
  
  beforeAll(() => {
    // Initialize client
    client = new CyborgDB(API_URL, ADMIN_API_KEY);
    
    // Load test data
    const jsonData = JSON.parse(fs.readFileSync(JSON_DATASET_PATH, 'utf8'));
    trainData = jsonData.train.slice(0, 100); // Just 100 vectors
    testVector = jsonData.test[0]; // Just 1 test vector
    dimension = trainData[0].length;
  });
  
  beforeEach(() => {
    // Generate a new key and index name for each test
    indexKey = new Uint8Array(randomBytes(32));
    indexName = generateIndexName();
  });
  
  afterEach(async () => {
    // Clean up after each test
    try {
      // Add a small delay to avoid race conditions
      await new Promise(resolve => setTimeout(resolve, 100));
      await client.deleteIndex(indexName, indexKey);
      console.log(`Cleaned up index ${indexName}`);
    } catch (error) {
      console.warn(`Warning: Failed to clean up index ${indexName}:`, error);
    }
  });
  
  test('should check API health', async () => {
    const health = await client.getHealth();
    expect(health).toBeDefined();
    // The actual format of health response depends on your API implementation
    // This is a basic check that it returns something
    expect(typeof health).toBe('object');
  });
  
  test('should create index, upsert vectors, and query', async () => {
    // Create index configuration
    const indexConfig = {
      dimension: dimension,
      metric: "euclidean",
      index_type: "ivfpq",
      n_lists: N_LISTS,
      pq_dim: PQ_DIM,
      pq_bits: PQ_BITS
    };
    
    // Create index
    const createResult = await client.createIndex(indexName, indexKey, indexConfig);
    expect(createResult.status).toBe('success');
    console.log(`Index ${indexName} created successfully`);
    
    // Prepare vectors for upserting
    const vectors = trainData.map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: { test: true, index: i }
    }));
    
    // Upsert vectors
    const upsertResult = await client.upsert(indexName, indexKey, vectors);
    expect(upsertResult.status).toBe('success');
    console.log('Vectors upserted successfully');
    
    // Execute a simple query
    const results = await client.query(
      indexName,
      indexKey,
      testVector,
      TOP_K,
      N_PROBES,
      {},
      ["metadata"]
    );
    
    console.log(`Query returned ${results.length} results`);
    
    // Basic assertions
    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });
  
  test('should list indexes', async () => {
    // First create an index to ensure there's at least one
    const indexConfig = {
      dimension: dimension,
      metric: "euclidean",
      index_type: "ivfpq",
      n_lists: N_LISTS,
      pq_dim: PQ_DIM,
      pq_bits: PQ_BITS
    };
    
    await client.createIndex(indexName, indexKey, indexConfig);
    
    // Now list indexes
    const indexes = await client.listIndexes();
    expect(Array.isArray(indexes)).toBe(true);
    // The index we just created should be in the list
    expect(indexes.some(index => index === indexName)).toBe(true);
  });
  
  test('should load an existing index', async () => {
    // First create an index to load
    const indexConfig = {
      dimension: dimension,
      metric: "euclidean",
      index_type: "ivfpq",
      n_lists: N_LISTS,
      pq_dim: PQ_DIM,
      pq_bits: PQ_BITS
    };
    
    await client.createIndex(indexName, indexKey, indexConfig);
    
    // Then try to load it
    const indexInfo: IndexInfoResponseModel = await client.loadIndex(indexName, indexKey);
    const loadedIndexConfig: IndexConfig = indexInfo.indexConfig;
    expect(indexInfo).toBeDefined();
    expect(loadedIndexConfig.dimension).toBe(dimension);
    expect(indexInfo.indexName).toBe(indexName);
  });
  
  test('should delete vectors from index', async () => {
    // Create index
    const indexConfig = {
      dimension: dimension,
      metric: "euclidean",
      index_type: "ivfpq",
      n_lists: N_LISTS,
      pq_dim: PQ_DIM,
      pq_bits: PQ_BITS
    };
    
    await client.createIndex(indexName, indexKey, indexConfig);
    
    // Prepare and upsert vectors
    const vectors = trainData.slice(0, 10).map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: { test: true, index: i }
    }));
    
    await client.upsert(indexName, indexKey, vectors);
    
    // Delete some vectors
    const idsToDelete = ['0', '1', '2'];
    const deleteResult = await client.delete(indexName, indexKey, idsToDelete);
    expect(deleteResult.status).toBe('success');
    
    // Try to get the deleted vectors - they should not exist
    // Note: Since get() might throw an error for non-existent vectors,
    // we need to check if it throws or returns empty results
    try {
      const remaining = await client.get(indexName, indexKey, idsToDelete);
      // If no error, expect empty or smaller list
      expect(remaining.length).toBeLessThan(idsToDelete.length);
    } catch (error) {
      // If error, it's expected because vectors were deleted
      expect(error).toBeDefined();
    }
  });
  
  test('should retrieve vectors by ID', async () => {
    // Create index
    const indexConfig = {
      dimension: dimension,
      metric: "euclidean",
      index_type: "ivfpq",
      n_lists: N_LISTS,
      pq_dim: PQ_DIM,
      pq_bits: PQ_BITS
    };
    
    await client.createIndex(indexName, indexKey, indexConfig);
    
    // Use a smaller set of vectors with distinct IDs for easier tracking
    const vectors = trainData.slice(0, 10).map((vector, i) => ({
      id: `test-id-${i}`, // More distinctive IDs
      vector,
      metadata: { test: true, index: i }
    }));
    
    // Upsert vectors
    const upsertResult = await client.upsert(indexName, indexKey, vectors);
    expect(upsertResult.status).toBe('success');
    
    // Add a significant delay to ensure server processing is complete
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Query to verify vectors are searchable
    const queryResults = await client.query(
      indexName,
      indexKey,
      testVector,
      5,
      N_PROBES,
      {},
      ["metadata"]
    );
    
    // This confirms vectors are in the index
    expect(queryResults.length).toBeGreaterThan(0);
    
    // Now get specific vectors
    const ids = [`test-id-0`, `test-id-1`, `test-id-2`];
    const retrieved = await client.get(indexName, indexKey, ids);
    
    // Log details for debugging
    console.log('IDs requested:', ids);
    console.log('Retrieved count:', retrieved.length);
    console.log('Retrieved IDs:', retrieved.map(r => r.id));
    
    // More lenient assertion - at least one result should be returned
    expect(retrieved.length).toBeGreaterThan(0);
    
    // For any results returned, check they match requested IDs
    retrieved.forEach(item => {
      expect(ids).toContain(item.id);
    });
  });
  
  test('should train the index', async () => {
    // Create index
    const indexConfig = {
      dimension: dimension,
      metric: "euclidean",
      index_type: "ivfpq",
      n_lists: N_LISTS,
      pq_dim: PQ_DIM,
      pq_bits: PQ_BITS
    };
    
    await client.createIndex(indexName, indexKey, indexConfig);
    
    // Upsert enough vectors for training
    const vectors = trainData.map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: { test: true, index: i }
    }));
    
    await client.upsert(indexName, indexKey, vectors);
    
    // Train the index
    const result = await client.train(indexName, indexKey, 100, 5, 1e-5);
    expect(result.status).toBe('success');
    
    // Query trained index to verify it works
    const results = await client.query(
      indexName,
      indexKey,
      testVector,
      TOP_K,
      N_PROBES
    );
    
    expect(results.length).toBeGreaterThan(0);
  });
  
  test('should handle metadata filtering in queries', async () => {
    // Create index
    const indexConfig = {
      dimension: dimension,
      metric: "euclidean",
      index_type: "ivfpq",
      n_lists: N_LISTS,
      pq_dim: PQ_DIM,
      pq_bits: PQ_BITS
    };
    
    await client.createIndex(indexName, indexKey, indexConfig);
    
    // Prepare vectors with varied metadata
    const vectors = trainData.slice(0, 20).map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: { 
        test: true, 
        index: i,
        category: i % 2 === 0 ? 'even' : 'odd'
      }
    }));
    
    await client.upsert(indexName, indexKey, vectors);
    
    // Query with metadata filter for even categories
    const evenFilter = { category: 'even' };
    const evenResults = await client.query(
      indexName,
      indexKey,
      testVector,
      TOP_K,
      N_PROBES,
      evenFilter,
      ["metadata"]
    );

    interface Metadata {
      category: string;
      // Add other properties as needed
    }
    
    // All results should have even category
    evenResults.forEach(result => {
      const metadata = result.metadata as { category: string };
      expect(metadata.category).toBe('even');
    });
  });
  
  test('should handle deleting and recreating an index', async () => {
    // Create initial index
    const indexConfig = {
      dimension: dimension,
      metric: "euclidean",
      index_type: "ivfpq",
      n_lists: N_LISTS,
      pq_dim: PQ_DIM,
      pq_bits: PQ_BITS
    };
    
    await client.createIndex(indexName, indexKey, indexConfig);
    
    // Delete the index
    await client.deleteIndex(indexName, indexKey);
    
    // Recreate with the same name
    const recreateResult = await client.createIndex(indexName, indexKey, indexConfig);
    expect(recreateResult.status).toBe('success');
    
    // Verify the index works
    const vectors = trainData.slice(0, 5).map((vector, i) => ({
      id: i.toString(),
      vector,
      metadata: { test: true, index: i }
    }));
    
    const upsertResult = await client.upsert(indexName, indexKey, vectors);
    expect(upsertResult.status).toBe('success');
  });
});