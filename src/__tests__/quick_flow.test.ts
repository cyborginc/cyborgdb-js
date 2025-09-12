import { Client, IndexIVFFlat, EncryptedIndex, QueryResultItem, QueryResponse } from '../index';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { randomBytes, randomUUID, createHash } from 'crypto';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

function generateUniqueName(prefix: string = 'test_'): string {
    return `${prefix}${randomUUID()}`;
}

function checkQueryResults(results: QueryResultItem[][], neighbors: number[][], numQueries: number): number {
    // Parse results to extract IDs from the returned dictionaries
    const resultIds: number[][] = results.map(queryResults => 
        queryResults.map(res => parseInt(res.id))
    );

    if (neighbors.length !== resultIds.length || neighbors[0].length !== resultIds[0].length) {
        throw new Error(
            `The shapes of the neighbors and results do not match: [${neighbors.length},${neighbors[0]?.length}] != [${resultIds.length},${resultIds[0]?.length}]`
        );
    }

    // Compute the recall using the neighbors
    const recall: number[] = new Array(numQueries).fill(0);
    for (let i = 0; i < numQueries; i++) {
        const intersection = neighbors[i].filter(n => resultIds[i].includes(n));
        recall[i] = intersection.length / neighbors[i].length;
    }

    // Return mean recall
    return recall.reduce((a, b) => a + b, 0) / recall.length;
}

function checkMetadataResults(
    results: QueryResultItem[][] | QueryResultItem[][][],
    metadataNeighbors: number[][][],
    metadataCandidates: number[][],
    numQueries: number
): number[] {
    function safeInt(val: any): number {
        try {
            return parseInt(val);
        } catch {
            return -1;
        }
    }

    // Handle both formats: array of arrays (batch) or array of array of arrays (multiple metadata queries)
    let normalizedResults: QueryResultItem[][][] = [];
    
    if (results.length > 0 && results[0].length > 0 && !Array.isArray(results[0][0])) {
        // Single metadata query result: QueryResultItem[][]
        normalizedResults = [results as QueryResultItem[][]];
    } else {
        // Multiple metadata query results: QueryResultItem[][][]
        normalizedResults = results as QueryResultItem[][][];
    }
    
    const resultIds: number[][][] = normalizedResults.map(result =>
        result.map(queryResults =>
            queryResults.map(res => safeInt(res.id))
        )
    );

    const recalls: number[] = [];

    for (let idx = 0; idx < resultIds.length; idx++) {
        // Get candidates for this query
        const candidates = metadataCandidates[idx];

        // Get groundtruth neighbors for this metadata query (should be shape (numQueries, 100))
        const metadataNeighborsIndices = metadataNeighbors[idx];

        const recall: number[] = new Array(numQueries).fill(0);
        let numReturned = 0;
        let numExpected = 0;

        // Iterate over the queries
        for (let i = 0; i < numQueries; i++) {
            // Get the groundtruth neighbors for this query
            const groundtruthIndices = metadataNeighborsIndices[i];
            
            const groundtruthIds: number[] = groundtruthIndices
                .filter((idx: number) => idx !== -1 && idx >= 0 && idx < candidates.length)
                .map((idx: number) => candidates[idx]);
            
            // Get the returned neighbors for this query
            const returned = resultIds[idx][i];

            // Update the number of returned neighbors
            numReturned += returned.length;
            const localExpected = groundtruthIds.filter(id => id !== -1).length;
            numExpected += localExpected;

            // If we expect no results and got no results, recall is 100%
            if (returned.length === 0 && localExpected === 0) {
                recall[i] = 1;
                continue;
            }

            // Check if the number of returned neighbors is correct
            if (returned.length > 100) {
                throw new Error(
                    `More than 100 results returned: got ${returned.length} instead of 100`
                );
            }

            // Compute the recall for this query
            const intersection = groundtruthIds.filter(id => returned.includes(id));
            recall[i] = intersection.length / Math.min(localExpected, 100);
        }

        // Get the number of groundtruth results (non -1 values)
        numExpected = numExpected / numQueries;
        numReturned = numReturned / numQueries;
        recalls.push(recall.reduce((a, b) => a + b, 0) / recall.length);
    }

    return recalls;
}

interface TestData {
    vectors: number[][];
    queries: number[][];
    untrained_neighbors: number[][];
    trained_neighbors: number[][];
    metadata: any[];
    metadata_queries: any[];
    metadata_query_names: string[];  // Present in JSON but not used in tests
    untrained_metadata_matches: number[][];
    trained_metadata_matches: number[][];
    untrained_metadata_neighbors: number[][][];
    trained_metadata_neighbors: number[][][];
    untrained_recall: number;
    trained_recall: number;
    num_untrained_vectors: number;
    num_trained_vectors: number;
}

describe('TestUnitFlow', () => {
    let data: TestData;
    let vectors: number[][];
    let queries: number[][];
    let untrainedNeighbors: number[][];
    let trainedNeighbors: number[][];
    let metadata: any[];
    let metadataQueries: any[];
    // let metadataQueryNames: string[];  // Not used in tests
    let untrainedMetadataMatches: number[][];
    let trainedMetadataMatches: number[][];
    let untrainedMetadataNeighbors: number[][][];
    let trainedMetadataNeighbors: number[][][];
    let untrainedRecall: number;
    let trainedRecall: number;
    let numUntrainedVectors: number;
    let numTrainedVectors: number;
    let totalNumVectors: number;
    let numQueries: number;
    let dimension: number;
    let nLists: number;
    let indexConfig: IndexIVFFlat;
    let client: Client;
    let indexName: string;
    let indexKey: Uint8Array;
    let index: EncryptedIndex;

    beforeAll(async () => {
        // Construct the path to the JSON file
        const testDir = path.dirname(path.resolve(__filename));
        const jsonPath = path.join(testDir, 'unit_test_flow_data.json');
        const jsonData = fs.readFileSync(jsonPath, 'utf8');

        // Compute & validate checksum
        const expectedChecksum = "a2989692cb12e8667b22bee4177acb295b72a23be82458ce7dd06e4a901cb04d";
        const checksum = createHash('sha256').update(jsonData, 'utf8').digest('hex');
        if (checksum !== expectedChecksum) {
            throw new Error(`Data integrity check failed: expected checksum ${expectedChecksum}, got ${checksum}`);
        }

        // Parse the JSON data
        data = JSON.parse(jsonData);

        // Load vectors and neighbors as arrays
        vectors = data.vectors;
        queries = data.queries;
        untrainedNeighbors = data.untrained_neighbors;
        trainedNeighbors = data.trained_neighbors;
        metadata = data.metadata;
        metadataQueries = data.metadata_queries;
        // metadataQueryNames = data.metadata_query_names;  // Not used in tests
        untrainedMetadataMatches = data.untrained_metadata_matches;
        trainedMetadataMatches = data.trained_metadata_matches;
        untrainedMetadataNeighbors = data.untrained_metadata_neighbors;
        trainedMetadataNeighbors = data.trained_metadata_neighbors;

        // Load expected recall values
        untrainedRecall = data.untrained_recall;
        trainedRecall = data.trained_recall;

        // Set counts and dimension
        numUntrainedVectors = data.num_untrained_vectors;
        numTrainedVectors = data.num_trained_vectors;
        totalNumVectors = numUntrainedVectors + numTrainedVectors;
        numQueries = queries.length;
        dimension = vectors[0].length;
        nLists = 100;

        // CYBORGDB SETUP: Create the index once (shared state)
        indexConfig = {
            dimension: dimension,
            type: 'ivfflat'
        };
        client = new Client({
            baseUrl: 'http://localhost:8000',
            apiKey: process.env.CYBORGDB_API_KEY || ''
        });
        indexName = generateUniqueName();
        indexKey = new Uint8Array(randomBytes(32));
        index = await client.createIndex({
            indexName,
            indexKey,
            indexConfig,
            metric: 'euclidean'
        });
    }, 60000);

    afterAll(async () => {
        // Clean up the index after all tests are done
        try {
            if (index) {
                await index.deleteIndex();
            }
        } catch (error) {
            console.error(`Error during index cleanup: ${error}`);
        }
    });

    test('test_00_get_health', async () => {
        // Check if the API is healthy
        const health = await client.getHealth();
        expect(health).toBeDefined();
        expect(health).toHaveProperty('status');
        expect(health.status).toBe('healthy');
    });

    test('test_01_untrained_upsert', async () => {
        // UNTRAINED UPSERT: upsert untrained items
        const items: any[] = [];
        for (let i = 0; i < numUntrainedVectors; i++) {
            items.push({
                id: String(i),
                vector: vectors[i],
                metadata: metadata[i]
            });
        }
        await index.upsert({ items });

        // Wait for 1 second to ensure upsert is processed
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check if the index has all IDs
        const results = await index.listIds();
        const expectedIds = Array.from({ length: numUntrainedVectors }, (_, i) => String(i));
        expect(results.ids.sort()).toEqual(expectedIds.sort());
    });

    test('test_02_untrained_query_no_metadata', async () => {
        // UNTRAINED QUERY (NO METADATA)
        const response = await index.query({
            queryVectors: queries,
            topK: 100,
            nProbes: 1
        });

        const results = response.results as QueryResultItem[][];
        const recall = checkQueryResults(results, untrainedNeighbors, numQueries);
        console.log(`Untrained Query (No Metadata). Expected recall: ${untrainedRecall}, got ${recall}`);

        expect(Math.abs(recall - untrainedRecall)).toBeLessThan(0.02);

        // Check if index is still untrained
        const trainedStatus = await index.isTrained();
        expect(trainedStatus).toBe(false);
    });

    test('test_03_untrained_query_metadata', async () => {
        // UNTRAINED QUERY (METADATA)
        const results: QueryResultItem[][][] = [];
        for (const metadataQuery of metadataQueries) {
            const response = await index.query({
                queryVectors: queries,
                topK: 100,
                nProbes: 1,
                filters: metadataQuery
            });
            results.push(response.results as QueryResultItem[][]);
        }

        const recalls = checkMetadataResults(
            results,
            untrainedMetadataNeighbors,
            untrainedMetadataMatches,
            numQueries
        );

        for (let idx = 0; idx < recalls.length; idx++) {
            console.log();
            console.log(`Metadata Query #${idx + 1}`);
            console.log(`Metadata filters: ${JSON.stringify(metadataQueries[idx])}`);
            console.log(
                `Number of candidates: ${untrainedMetadataNeighbors[idx].length} / ${numUntrainedVectors}`
            );
            console.log(`Mean recall: ${(recalls[idx] * 100).toFixed(2)}%`);

            expect(Math.abs(recalls[idx] - untrainedRecall)).toBeLessThan(0.02);
        }

        // Check if index is still untrained
        const trainedStatus = await index.isTrained();
        expect(trainedStatus).toBe(false);
    });

    test('test_04_untrained_get', async () => {
        // UNTRAINED GET
        const numGet = 1000;
        const getIndices: number[] = [];
        const usedIndices = new Set<number>();
        
        while (getIndices.length < numGet) {
            const idx = Math.floor(Math.random() * numUntrainedVectors);
            if (!usedIndices.has(idx)) {
                usedIndices.add(idx);
                getIndices.push(idx);
            }
        }
        
        const getIndicesStr = getIndices.map(i => String(i));
        const getResults = await index.get({
            ids: getIndicesStr,
            include: ['vector', 'contents', 'metadata']
        });

        for (let i = 0; i < getResults.length; i++) {
            const getResult = getResults[i];
            expect(getResult.id).toBe(getIndicesStr[i]);
            
            // Check vector equality
            const expectedVector = vectors[getIndices[i]];
            expect(getResult.vector).toEqual(expectedVector);
            
            // Check metadata equality
            const metadataStr = JSON.stringify(getResult.metadata, Object.keys(getResult.metadata).sort());
            const expectedMetadataStr = JSON.stringify(metadata[getIndices[i]], Object.keys(metadata[getIndices[i]]).sort());
            expect(metadataStr).toBe(expectedMetadataStr);
        }

        // Check if index is still untrained
        const trainedStatus = await index.isTrained();
        expect(trainedStatus).toBe(false);
    });

    test('test_05_untrained_list_ids', async () => {
        // UNTRAINED LIST IDS
        const results = await index.listIds();
        const expectedIds = Array.from({ length: numUntrainedVectors }, (_, i) => String(i));
        expect(results.ids.sort()).toEqual(expectedIds.sort());

        // Check if index is still untrained
        const trainedStatus = await index.isTrained();
        expect(trainedStatus).toBe(false);
    });

    test('test_06_upsert_for_train', async () => {
        // TRAINED UPSERT: upsert training vectors
        const items: any[] = [];
        for (let i = numUntrainedVectors; i < totalNumVectors; i++) {
            items.push({
                id: String(i),
                vector: vectors[i],
                metadata: metadata[i]
            });
        }
        await index.upsert({ items });

        // Wait for 1 second to ensure upsert is processed
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check if the index has all IDs
        const results = await index.listIds();
        const expectedIds = Array.from({ length: totalNumVectors }, (_, i) => String(i));
        expect(results.ids.sort()).toEqual(expectedIds.sort());
    });

    test('test_07_wait_for_initial_training', async () => {
        // WAIT FOR INITIAL TRAINING TO COMPLETE
        const numRetries = 60;
        let trained = false;
        
        for (let attempt = 0; attempt < numRetries; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Check if trained directly (no isTraining method in TS SDK)
            trained = await index.isTrained();
            if (trained) {
                console.log('Index is now trained.');
                break;
            } else {
                console.log(`Index not trained yet, retrying... (${attempt + 1}/${numRetries})`);
            }
        }

        expect(trained).toBe(true);
    }, 130000);

    test('test_08_trained_query_should_get_perfect_recall', async () => {
        // TRAINED QUERY WHERE N_PROBES == N_LISTS
        const response = await index.query({
            queryVectors: queries,
            topK: 100,
            nProbes: nLists
        });

        const results = response.results as QueryResultItem[][];
        const recall = checkQueryResults(results, trainedNeighbors, numQueries);
        const expectedRecall = 1.0;
        console.log(`Trained Query (N_PROBES == N_LISTS). Expected recall: ${expectedRecall}, got ${recall}`);

        expect(recall).toBe(expectedRecall);
    });

    test('test_09_trained_query_no_metadata', async () => {
        // TRAINED QUERY (NO METADATA)
        const response = await index.query({
            queryVectors: queries,
            topK: 100,
            nProbes: 24
        });

        const results = response.results as QueryResultItem[][];
        const recall = checkQueryResults(results, trainedNeighbors, numQueries);
        console.log(`Trained Query (No Metadata). Expected recall: ${trainedRecall}, got ${recall}`);

        expect(Math.abs(recall - trainedRecall)).toBeLessThan(0.08);
    });

    test('test_10_trained_query_no_metadata_auto_n_probes', async () => {
        // TRAINED QUERY (NO METADATA) with Auto n_probes
        const response = await index.query({
            queryVectors: queries,
            topK: 100
        });

        const results = response.results as QueryResultItem[][];
        const recall = checkQueryResults(results, trainedNeighbors, numQueries);
        console.log(`Trained Query (No Metadata, Auto n_probes). Expected recall: ${trainedRecall}, got ${recall}`);

        // recall should be ~90% give or take 2%
        expect(recall).toBeGreaterThanOrEqual(0.9 - 0.02);
    });

    test('test_11_trained_query_metadata', async () => {
        // TRAINED QUERY (METADATA)
        const results: QueryResultItem[][][] = [];
        for (const metadataQuery of metadataQueries) {
            const response = await index.query({
                queryVectors: queries,
                topK: 100,
                nProbes: 24,
                filters: metadataQuery
            });
            results.push(response.results as QueryResultItem[][]);
        }
        metadataQueries[6] = { number: 0 };

        const recalls = checkMetadataResults(
            results,
            trainedMetadataNeighbors,
            trainedMetadataMatches,
            numQueries
        );

        console.log(`Number of recall values: ${recalls.length}`);

        const baseThresholds = [
            94.04,  // Query #1
            100.00, // Query #2
            91.05,  // Query #3
            88.24,  // Query #4
            100.00, // Query #5
            78.88,  // Query #6
            100.00, // Query #7
            92.35,  // Query #8
            91.66,  // Query #9
            88.38,  // Query #10
            88.26,  // Query #11
            94.04,  // Query #12
            90.05,  // Query #13
            74.09,  // Query #14
            9.00,   // Query #15
        ];

        // For the additional recalls, we'll use a default threshold of 70%
        for (let i = baseThresholds.length; i < recalls.length; i++) {
            baseThresholds.push(70.00);
        }

        const expectedThresholds = baseThresholds.map(threshold => threshold * 0.95);

        expect(recalls.length).toBe(expectedThresholds.length);

        // Check each recall against its threshold
        const failingRecalls: Array<[number, number, number]> = [];

        for (let idx = 0; idx < recalls.length; idx++) {
            const recallPercentage = recalls[idx] * 100;
            const threshold = expectedThresholds[idx];

            if (idx < 15) {
                console.log();
                console.log(`Metadata Query #${idx + 1}`);
                console.log(`Metadata filters: ${JSON.stringify(metadataQueries[idx])}`);
                console.log(
                    `Number of candidates: ${trainedMetadataNeighbors[idx].length} / ${totalNumVectors}`
                );
                console.log(`Mean recall: ${recallPercentage.toFixed(2)}%`);
                console.log(`Expected threshold: ${threshold.toFixed(2)}%`);
            } else {
                console.log();
                console.log(`Additional Query #${idx + 1}`);
                console.log(`Mean recall: ${recallPercentage.toFixed(2)}%`);
                console.log(`Expected threshold: ${threshold.toFixed(2)}%`);
            }

            if (recallPercentage < threshold) {
                failingRecalls.push([idx + 1, recallPercentage, threshold]);
            }
        }

        if (failingRecalls.length > 0) {
            const failMessage = failingRecalls
                .map(([idx, actual, expected]) => 
                    `Query #${idx}: recall ${actual.toFixed(2)}% < threshold ${expected.toFixed(2)}%`
                )
                .join('\n');
            expect(failingRecalls.length).toBe(0);
            throw new Error(`Some recalls are below their thresholds:\n${failMessage}`);
        }
    });

    test('test_12_trained_query_metadata_auto_n_probes', async () => {
        // TRAINED QUERY (METADATA)
        const results: QueryResultItem[][][] = [];
        for (const metadataQuery of metadataQueries) {
            const response = await index.query({
                queryVectors: queries,
                topK: 100,
                filters: metadataQuery
            });
            results.push(response.results as QueryResultItem[][]);
        }
        metadataQueries[6] = { number: 0 };

        const recalls = checkMetadataResults(
            results,
            trainedMetadataNeighbors,
            trainedMetadataMatches,
            numQueries
        );

        console.log(`Number of recall values: ${recalls.length}`);

        const baseThresholds = [
            94.04,  // Query #1
            100.00, // Query #2
            91.05,  // Query #3
            88.24,  // Query #4
            100.00, // Query #5
            78.88,  // Query #6
            100.00, // Query #7
            92.35,  // Query #8
            91.66,  // Query #9
            88.38,  // Query #10
            88.26,  // Query #11
            94.04,  // Query #12
            90.05,  // Query #13
            74.09,  // Query #14
            9.00,   // Query #15
        ];

        // For the additional recalls, we'll use a default threshold of 70%
        for (let i = baseThresholds.length; i < recalls.length; i++) {
            baseThresholds.push(70.00);
        }

        // Apply a 10% reduction to the base thresholds
        const expectedThresholds = baseThresholds.map(threshold => threshold * 0.90);

        expect(recalls.length).toBe(expectedThresholds.length);

        // Check each recall against its threshold
        const failingRecalls: Array<[number, number, number]> = [];

        for (let idx = 0; idx < recalls.length; idx++) {
            const recallPercentage = recalls[idx] * 100;
            const threshold = expectedThresholds[idx];

            if (idx < 15) {
                console.log();
                console.log(`Metadata Query #${idx + 1}`);
                console.log(`Metadata filters: ${JSON.stringify(metadataQueries[idx])}`);
                console.log(`Number of candidates: ${trainedMetadataNeighbors[idx].length} / ${totalNumVectors}`);
                console.log(`Mean recall: ${recallPercentage.toFixed(2)}%`);
                console.log(`Expected threshold: ${threshold.toFixed(2)}%`);
            } else {
                console.log();
                console.log(`Additional Query #${idx + 1}`);
                console.log(`Mean recall: ${recallPercentage.toFixed(2)}%`);
                console.log(`Expected threshold: ${threshold.toFixed(2)}%`);
            }

            if (recallPercentage < threshold) {
                failingRecalls.push([idx + 1, recallPercentage, threshold]);
            }
        }

        if (failingRecalls.length > 0) {
            const failMessage = failingRecalls
                .map(([idx, actual, expected]) => 
                    `Query #${idx}: recall ${actual.toFixed(2)}% < threshold ${expected.toFixed(2)}%`
                )
                .join('\n');
            expect(failingRecalls.length).toBe(0);
            throw new Error(`Some recalls are below their thresholds:\n${failMessage}`);
        }
    });

    test('test_13_trained_get', async () => {
        // TRAINED GET (using untrained indices as an example)
        const numGet = 1000;
        const getIndices: number[] = [];
        const usedIndices = new Set<number>();
        
        while (getIndices.length < numGet) {
            const idx = Math.floor(Math.random() * numUntrainedVectors);
            if (!usedIndices.has(idx)) {
                usedIndices.add(idx);
                getIndices.push(idx);
            }
        }
        
        const getIndicesStr = getIndices.map(i => String(i));
        const getResults = await index.get({
            ids: getIndicesStr,
            include: ['vector', 'contents', 'metadata']
        });

        for (let i = 0; i < getResults.length; i++) {
            const getResult = getResults[i];
            expect(getResult.id).toBe(getIndicesStr[i]);
            
            // Check vector equality
            const expectedVector = vectors[getIndices[i]];
            expect(getResult.vector).toEqual(expectedVector);
            
            // Check metadata equality
            const metadataStr = JSON.stringify(getResult.metadata, Object.keys(getResult.metadata).sort());
            const expectedMetadataStr = JSON.stringify(metadata[getIndices[i]], Object.keys(metadata[getIndices[i]]).sort());
            expect(metadataStr).toBe(expectedMetadataStr);
        }
    });

    test('test_14_delete', async () => {
        // DELETE ITEMS (using untrained indices as an example)
        const idsToDelete = Array.from({ length: numUntrainedVectors }, (_, i) => String(i));
        await index.delete({ ids: idsToDelete });

        // Wait for 1 second to ensure delete is processed
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check if the index has deleted the IDs
        const results = await index.listIds();
        for (const deletedId of idsToDelete) {
            expect(results.ids).not.toContain(deletedId);
        }

        expect(true).toBe(true);
    });

    test('test_15_get_deleted', async () => {
        // GET DELETED ITEMS
        const numGet = 1000;
        const getIndices: number[] = [];
        const usedIndices = new Set<number>();
        
        while (getIndices.length < numGet) {
            const idx = Math.floor(Math.random() * numUntrainedVectors);
            if (!usedIndices.has(idx)) {
                usedIndices.add(idx);
                getIndices.push(idx);
            }
        }
        
        const getIndicesStr = getIndices.map(i => String(i));
        const getResults = await index.get({
            ids: getIndicesStr,
            include: ['vector', 'contents', 'metadata']
        });

        expect(getResults.length).toBe(0);
        for (let i = 0; i < getResults.length; i++) {
            expect(getResults[i]).toBeUndefined();
        }
    });

    test('test_16_query_deleted', async () => {
        // QUERY DELETED ITEMS
        const response = await index.query({
            queryVectors: queries,
            topK: 100,
            nProbes: 24
        });

        const results = response.results as QueryResultItem[][];
        for (const result of results) {
            for (const queryResult of result) {
                const id = parseInt(queryResult.id);
                expect(id).toBeGreaterThanOrEqual(numUntrainedVectors);
            }
        }

        expect(true).toBe(true);
    });

    test('test_17_list_indexes', async () => {
        // LIST INDEXES
        const indexes = await client.listIndexes();
        expect(Array.isArray(indexes)).toBe(true);
        expect(indexes.length).toBeGreaterThan(0);

        // Check if the created index is in the list
        expect(indexes).toContain(indexName);
    });

    test('test_18_index_properties', async () => {
        // Check if the index has the expected properties
        expect(await index.getIndexName()).toBe(indexName);
        
        const config = await index.getIndexConfig();
        expect(config).toBeDefined();
        expect(typeof config).toBe('object');
        
        expect(await index.getIndexType()).toBe('ivfflat');
    });

    test('test_19_load_index', async () => {
        // Test loading an existing index
        const loadedIndex = await client.loadIndex({ indexName, indexKey });
        expect(loadedIndex).toBeDefined();
        expect(await loadedIndex.getIndexName()).toBe(indexName);
    });
});

// Set Jest timeout for all tests
jest.setTimeout(60000);