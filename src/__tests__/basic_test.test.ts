import { Client, EncryptedIndex, QueryResponse } from '../index';

import { randomBytes } from 'crypto';
import * as dotenv from 'dotenv';

/**
 * Basic Integration Tests for the DiskIVF index type.
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
const CYBORGDB_API_KEY = process.env.CYBORGDB_API_KEY

if (!CYBORGDB_API_KEY) {
  throw new Error("CYBORGDB_API_KEY environment variable is not set");
}

// Test parameters - conservative for basic testing
const N_LISTS = 100;
const METRIC = "euclidean";
const TOP_K = 5;

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
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

beforeAll(async () => {
  const dimension = 128;
  sharedData = {
    train: Array(200).fill(0).map(() => Array(dimension).fill(0).map(() => Math.random())),
    test: Array(20).fill(0).map(() => Array(dimension).fill(0).map(() => Math.random())),
    neighbors: Array(20).fill(0).map(() => Array(TOP_K).fill(0).map(() => Math.floor(Math.random() * 200)))
  };
}, 60000);

describe('DiskIVFBasicIntegrationTest', () => {
  const client = new Client({ baseUrl: API_URL, apiKey: CYBORGDB_API_KEY, verifySsl: false });
  let indexName: string;
  let indexKey: Uint8Array;
  let dimension: number;
  let trainData: number[][];
  let index: EncryptedIndex;

  // Set up shared test data
  beforeAll(() => {
    if (sharedData) {
      dimension = sharedData.train[0].length;
      trainData = sharedData.train.slice(0, 100);
    } else {
      throw new Error("Shared data not available");
    }
  });

  // Set up for each test
  beforeEach(async () => {
    indexName = generateIndexName();
    indexKey = generateRandomKey();

    console.log(`Creating DiskIVF index with dimension ${dimension}`);
    console.log(`DiskIVF config: metric=${METRIC}, nLists=${N_LISTS}`);

    index = await client.createIndex({ indexName, indexKey, dimension, metric: METRIC });
    console.log(`✓ DiskIVF index created successfully: ${indexName}`);
  }, 30000);

  // Clean up after each test
  afterEach(async () => {
    if (index) {
      try {
        await index.deleteIndex();
        console.log(`✓ Cleaned up DiskIVF index: ${indexName}`);
      } catch (error) {
        console.error(`Error cleaning up DiskIVF index: ${error}`);
      }
    }
  }, 15000);

  test('should create DiskIVF index successfully', async () => {
    expect(index).toBeDefined();
    expect(await index.getIndexName()).toBe(indexName);
  });

  test('should list IDs from the index', async () => {
    const testIds = ['vec1', 'vec2', 'vec3', 'vec4', 'vec5'];
    const vectors = trainData.slice(0, 5);

    await index.upsert({
      ids: testIds,
      vectors: vectors
    });

    console.log('✓ Added 5 vectors to the index');

    const result = await index.listIds();

    expect(result).toBeDefined();
    expect(result.ids).toBeDefined();
    expect(result.count).toBeDefined();
    expect(Array.isArray(result.ids)).toBe(true);
    expect(result.count).toBe(5);
    expect(result.ids.length).toBe(5);

    for (const id of testIds) {
      expect(result.ids).toContain(id);
    }

    console.log(`✓ listIds returned ${result.count} IDs: ${result.ids.join(', ')}`);
  });

  test('should return empty list for empty index', async () => {
    const result = await index.listIds();

    expect(result).toBeDefined();
    expect(result.ids).toBeDefined();
    expect(result.count).toBeDefined();
    expect(Array.isArray(result.ids)).toBe(true);
    expect(result.count).toBe(0);
    expect(result.ids.length).toBe(0);

    console.log('✓ listIds correctly returned empty list for empty index');
  });

  test('should update list after deletions', async () => {
    const testIds = ['del1', 'del2', 'del3', 'keep1', 'keep2'];
    const vectors = trainData.slice(0, 5);

    await index.upsert({
      ids: testIds,
      vectors: vectors
    });

    let result = await index.listIds();
    expect(result.count).toBe(5);

    await index.delete({ ids: ['del1', 'del2', 'del3'] });
    console.log('✓ Deleted 3 vectors from the index');

    result = await index.listIds();

    expect(result.count).toBe(2);
    expect(result.ids.length).toBe(2);
    expect(result.ids).toContain('keep1');
    expect(result.ids).toContain('keep2');
    expect(result.ids).not.toContain('del1');
    expect(result.ids).not.toContain('del2');
    expect(result.ids).not.toContain('del3');

    console.log(`✓ listIds correctly updated after deletion: ${result.ids.join(', ')}`);
  });
});
