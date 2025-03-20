import { CyborgDB } from './index';
import { randomBytes } from 'crypto';

// Your local server
const API_URL = 'http://localhost:8000';
const ADMIN_API_KEY = "tUdsaeJLRMcAqt7KIvDh7U_ENwk3J_9o15z7_243060";
// Generate a 32-byte key for index encryption
function generateRandomKey(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

async function testCyborgDB() {
  console.log('Testing CyborgDB SDK against your local server...');
  
  // Create client
  const client = new CyborgDB(API_URL, ADMIN_API_KEY);
  
  try {
    // List existing indexes
    // console.log('Listing indexes...');
    // const indexes = await client.listIndexes();
    // console.log('Available indexes:', indexes);

    // Generate a key for a new index
    const indexKey = generateRandomKey();
    const indexName = `test-index-${Date.now()}`;
    
    // Create a new index
    console.log(`Creating index '${indexName}'...`);
    const indexConfig = {
      dimension: 128,
      metric: 'euclidean',
      index_type: 'ivfflat',
      n_lists: 100
    };
    
    await client.createIndex(indexName, indexKey, indexConfig);
    console.log('Index created successfully!');
    // Insert some vectors
    console.log('Upserting vectors...');
    const items = [
        {
          id: '1',
          vector: Array(128).fill(0).map(() => Math.random()),
          contents: 'item 1 content', // String instead of Buffer
          metadata: { category: 'test', tag: 'example' }
        },
        {
          id: '2',
          vector: Array(128).fill(0).map(() => Math.random()),
          contents: 'item 2 content', // String instead of Buffer
          metadata: { category: 'test', tag: 'demo' }
        }
      ];
      
      
    
    await client.upsert(indexName, indexKey, items);
    console.log('Vectors upserted successfully!');
    
    // Query the index
    console.log('Querying index...');
    const queryVector = Array(128).fill(0).map(() => Math.random());
    const results = await client.query(indexName, indexKey, [queryVector]);
    console.log('Query results:', results);
    
    // Get vectors by ID
    console.log('Getting vectors by ID...');
    const getResults = await client.get(indexName, indexKey, ['1', '2']);
    console.log('Get results:', getResults);
    
    // Delete vectors
    console.log('Deleting vectors...');
    await client.delete(indexName, indexKey, ['1']);
    console.log('Vector deleted successfully!');
    
    // Delete the index
    console.log('Deleting index...');
    await client.deleteIndex(indexName, indexKey);
    console.log('Index deleted successfully!');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the test
testCyborgDB().catch(console.error);