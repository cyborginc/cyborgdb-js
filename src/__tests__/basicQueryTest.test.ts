// src/__tests__/basic-query.test.ts

import { CyborgDB } from '../index';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Constants - VERY minimal for faster testing
const API_URL = 'http://localhost:8000';

//copy and paste API key that's generated from Cyborgdb-service
const ADMIN_API_KEY = "N_uSHiTJrzq3hydWvvsoQrcq6Lv7m2WpS8-p5KewBIg";

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
    
    // Delete the index to clean up
    await client.deleteIndex(indexName, indexKey);
    console.log(`Index ${indexName} deleted`);
    
    // Basic assertions
    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    
  } catch (error) {
    console.error('Test failed:', error);
    throw error;
  }
});