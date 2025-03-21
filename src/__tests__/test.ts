import { CyborgDB } from '../index';
import { randomBytes } from 'crypto';

// Your local server
const API_URL = 'http://localhost:8000';

//copy and paste API key that's generated from Cyborgdb-service
const ADMIN_API_KEY = "u6O7zh2Qbosad_7_XReisyElimVm29w6rmPJ1rvx1kA";

// Generate a 32-byte key for index encryption
function generateRandomKey(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

async function testCyborgDB() {
  console.log('Testing CyborgDB SDK against your local server...');
  
  // Create client
  const client = new CyborgDB(API_URL, ADMIN_API_KEY);
  
  try {
    // Check server health
    console.log('Checking CyborgDB server health...');
    const health = await client.getHealth();
    console.log('Server health response:', health);

    // List existing indexes
    console.log('Listing indexes...');
    const indexes = await client.listIndexes();
    console.log('Available indexes:', indexes);

    // Generate a key for a new index
    const indexKey = generateRandomKey();
    const indexName = `test-index-${Date.now()}`;
    
    // Create a new index
    console.log(`Creating index '${indexName}'...`);

    const indexConfig = {
      dimension: 128,
      metric: 'euclidean',
      index_type: 'ivfpq',
      n_lists: 100,
      pq_dim: 16,
      pq_bits: 8
    };
    
    await client.createIndex(indexName, indexKey, indexConfig);
    console.log('Index created successfully!');
    // Insert some vectors
    console.log('Upserting vectors...');

    const items = Array.from({ length: 5000 }, (_, i) => ({
      id: (i + 1).toString(),
      vector: Array(128).fill(0).map(() => Math.random()),
      contents: `item ${i + 1} content`,
      metadata: { category: 'test', tag: i % 2 === 0 ? 'even' : 'odd' }
    }));
     
    await client.upsert(indexName, indexKey, items);
    console.log('Vectors upserted successfully!');

    // Using smaller batch size and fewer iterations for quick testing
    const trainResult = await client.train(indexName, indexKey, 1024, 50, 1e-6);
    console.log('Training completed successfully!');
    console.log('Training result:', trainResult);
    
    // Test single vector query
    console.log('\n--- Testing single vector query ---');
    const singleQueryVector = Array(128).fill(0).map(() => Math.random());
    console.log('Sending single vector query...');
    const singleResults = await client.query(indexName, indexKey, singleQueryVector);
    console.log('Single query results count:', singleResults.length);
    console.log('First result:', singleResults[0]);
    
    // Test batch query with multiple vectors
    console.log('\n--- Testing batch vector query ---');
    const batchQueryVectors = [
      Array(128).fill(0).map(() => Math.random()),
      Array(128).fill(0).map(() => Math.random())
    ];
    console.log('Sending batch query with', batchQueryVectors.length, 'vectors...');
    const batchResults = await client.query(indexName, indexKey, batchQueryVectors);
    
    // Check if batchResults is an array of arrays (one result set per query vector)
    if (Array.isArray(batchResults) && Array.isArray(batchResults[0])) {
      console.log('Batch query returned', batchResults.length, 'result sets');
      console.log('Results for first query vector count:', batchResults[0].length);
      console.log('First result from first query vector:', batchResults[0][0]);
    } else {
      // If we just get a flat array of results, it's treating the first vector only
      console.log('Batch query returned', batchResults.length, 'results (using only first query vector)');
      console.log('First result:', batchResults[0]);
    }
    
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