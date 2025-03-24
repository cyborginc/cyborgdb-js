// src/__tests__/basic-query.test.ts

import { CyborgDB } from '../index';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Constants - VERY minimal for faster testing
const API_URL = 'http://localhost:8000';

//copy and paste API key that's generated from Cyborgdb-service
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";
console.log("API_KEY: ", ADMIN_API_KEY);
const JSON_DATASET_PATH = path.join(__dirname, 'wiki_data_sample.json');
const N_LISTS = 100; // Much smaller for testing
const PQ_DIM = 32;
const PQ_BITS = 8;
const TOP_K = 5; // Minimal
const N_PROBES = 10; // Small value

jest.setTimeout(3000000); // 5 minutes per test timeout

test('should create index, upsert vectors, and query', async () => {
  // Create client
  const client = new CyborgDB(API_URL, ADMIN_API_KEY);
  
  // Load a SMALL sample of data
  const jsonData = JSON.parse(fs.readFileSync(JSON_DATASET_PATH, 'utf8'));
  const trainData = jsonData.train.slice(0, 100); // Just 100 vectors
  const testVector = jsonData.test[0]; // Just 1 test vector
  const dimension = trainData[0].length;
  
  // Generate key and create index name
  const indexKey = new Uint8Array(randomBytes(32));
  const indexName = `test_simple_index_${Date.now()}`;
  
  try {
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
    await client.createIndex(indexName, indexKey, indexConfig);
    console.log(`Index ${indexName} created successfully`);
    
    // Prepare vectors for upserting
    const vectors = trainData.map((vector: any, i: number) => ({
      id: i.toString(),
      vector,
      metadata: { test: true, index: i }
    }));
    
    // Upsert vectors
    await client.upsert(indexName, indexKey, vectors);
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
    
    // Basic assertions BEFORE deleting the index
    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    
    // Delete the index to clean up - AFTER assertions
    await client.deleteIndex(indexName, indexKey);
    console.log(`Index ${indexName} deleted`);
    
  } catch (error) {
    // Clean up even if test fails
    try {
      await client.deleteIndex(indexName, indexKey);
      console.log(`Index ${indexName} deleted during error cleanup`);
    } catch (cleanupError) {
      if (cleanupError instanceof Error) {
        console.warn(`Failed to delete index during cleanup: ${cleanupError.message}`);
      } else {
        console.warn('Failed to delete index during cleanup: Unknown error');
      }
    }
    
    console.error('Test failed:', error);
    throw error;
  }
});