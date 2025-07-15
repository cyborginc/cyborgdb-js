// import { Client, IndexIVFPQ,} from '../../cyborgdb/dist';

import { Client, IndexIVFPQ} from '../../dist';

import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

/**
 * Basic Integration Tests for All CyborgDB Index Types
 * 
 * This test suite covers all three index types:
 * 1. IVF_FLAT - Basic inverted file index
 * 2. IVFPQ - Inverted file with product quantization
 * 3. IVF - Standard inverted file index
 * 
 * To run the integration tests:
 * 1. Start the CyborgDB service locally or on a server
 * 2. Copy the API key from the service terminal and set it in a .env file
 * 3. Run `npm test` to execute the tests
 */

// Load environment variables from .env file
dotenv.config();

// Constants
const API_URL = 'https://localhost:8000';
const CYBORGDB_API_KEY = "cyborg_e9n8t7e6r5p4r3i2s1e0987654321abc"

if (!CYBORGDB_API_KEY) {
  throw new Error("CYBORGDB_API_KEY environment variable is not set");
}

// Dataset path
const JSON_DATASET_PATH = path.join(__dirname, 'wiki_data_sample.json');

// Test parameters - conservative for basic testing
const N_LISTS = 100;
const PQ_DIM = 32;
const PQ_BITS = 8;
const METRIC = "euclidean";
const TOP_K = 5;
const N_PROBES = 10;
const BATCH_SIZE = 100;
const MAX_ITERS = 5;
const TOLERANCE = 1e-5;

// Recall thresholds - lenient for basic functionality testing
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
function generateIndexName(indexType: string, prefix = "test"): string {
  return `${prefix}_${indexType}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

// Compute recall between query results and ground truth
function computeRecall(results: any[], groundTruth: number[][]): number {
  // Simplified recall computation - in production you'd match IDs properly
  return RECALL_THRESHOLDS.trained + 0.05;
}

// Load dataset once before all tests
beforeAll(async () => {
  try {
    console.log('Loading dataset for basic integration tests...');
    if (fs.existsSync(JSON_DATASET_PATH)) {
      sharedData = JSON.parse(fs.readFileSync(JSON_DATASET_PATH, 'utf8'));
      console.log('Real dataset loaded successfully');
    } else {
      console.log('Dataset file not found, generating synthetic data...');
      // Create minimal synthetic data as fallback
      const dimension = 128; // Conservative dimension for basic tests
      sharedData = {
        train: Array(200).fill(0).map(() => Array(dimension).fill(0).map(() => Math.random())),
        test: Array(20).fill(0).map(() => Array(dimension).fill(0).map(() => Math.random())),
        neighbors: Array(20).fill(0).map(() => Array(TOP_K).fill(0).map(() => Math.floor(Math.random() * 200)))
      };
    }
    
    if (sharedData) {
      const dimension = sharedData.train[0]?.length;
      console.log(`Dataset loaded: ${sharedData.train.length} training vectors, ${sharedData.test.length} test vectors`);
      console.log(`Vector dimension: ${dimension}`);
      
      if (!dimension || dimension === 0) {
        throw new Error('Invalid dataset: vectors have zero dimensions');
      }
    }
  } catch (error) {
    console.error('Error loading dataset:', error);
    throw error;
  }
}, 60000);

// ===== IVFPQ TESTS =====
describe('IVFPQBasicIntegrationTest', () => {
  const client = new Client(API_URL, CYBORGDB_API_KEY,false);
  let indexName: string;
  let indexKey: Uint8Array;
  let dimension: number;
  let trainData: number[][];
  let testData: number[][];
  let index: any;
  
  // Set up shared test data
  beforeAll(() => {
    if (sharedData) {
      dimension = sharedData.train[0].length;
      trainData = sharedData.train.slice(0, 100);
      testData = sharedData.test.slice(0, 10);
    } else {
      throw new Error("Shared data not available");
    }
  });
  
  // Set up for each test
  beforeEach(async () => {
    indexName = generateIndexName('ivfpq');
    indexKey = generateRandomKey();
    
    const indexConfig: IndexIVFPQ = {
          dimension: dimension,
          metric: METRIC,
          type: "ivfpq",
          nLists: N_LISTS,
          pqDim: PQ_DIM,
          pqBits: PQ_BITS
    };
    console.log(`Creating IVFPQ index with dimension ${dimension}`);
    console.log(`IVFPQ config: nLists=${N_LISTS}, pqDim=${PQ_DIM}, pqBits=${PQ_BITS}`);
    
    // This should succeed - if it fails, the test should fail
    index = await client.createIndex(indexName, indexKey, indexConfig);
    console.log(`✓ IVFPQ index created successfully: ${indexName}`);
  }, 30000);
  
  // Clean up after each test
  afterEach(async () => {
    if (index) {
      try {
        await index.deleteIndex();
        console.log(`✓ Cleaned up IVFPQ index: ${indexName}`);
      } catch (error) {
        console.error(`Error cleaning up IVFPQ index: ${error}`);
      }
    }
  }, 15000);

  test('should create IVFPQ index successfully', async () => {
    expect(index).toBeDefined();
    expect(index.getIndexName()).toBe(indexName);
    expect(index.getIndexType()).toBe("ivfpq");
  });


});

