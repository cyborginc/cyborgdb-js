import { DefaultApi, DefaultApiApiKeys } from './api/defaultApi';
import { 
  UpsertRequest, 
  CreateIndexRequest, 
  IndexOperationRequest,
  Request as QueryRequest,
  TrainRequest,
  DeleteRequest,
  GetRequest,
  VectorItem
} from './model/models';

/**
 * CyborgDB TypeScript SDK
 * Provides an interface to interact with CyborgDB vector database service
 */
export class CyborgDB {
  private api: DefaultApi;

  /**
   * Create a new CyborgDB client
   * @param baseUrl Base URL of the CyborgDB service
   * @param apiKey API key for authentication
   */
  // constructor(baseUrl: string, apiKey?: string) {
  //   this.api = new DefaultApi(baseUrl);
    
  //   // Set API key if provided
  //   if (apiKey) {
  //     this.api.setApiKey(DefaultApiApiKeys.APIKeyHeader, apiKey);
  //   }
  // }
  constructor(baseUrl: string, apiKey?: string) {
    console.log('Initializing CyborgDB client with URL:', baseUrl);
    this.api = new DefaultApi(baseUrl);
    
    // Use the public setter method
    this.api.defaultHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    
    // Set API key if provided
    if (apiKey) {
      console.log('Using API key authentication');
      this.api.setApiKey(DefaultApiApiKeys.APIKeyHeader, apiKey);
    }
  }

  /**
   * List all available indexes
   * @returns Promise with the list of index names
   */
  // async listIndexes() {
  //   try {
  //     const response = await this.api.listIndexesV1IndexesListGet();
  //     return response.body.indexes || [];
  //   } catch (error) {
  //     throw new Error(`Failed to list indexes: ${(error as Error).message}`);
  //   }
  // }
  // async listIndexes() {
  //   try {
  //     console.log('Attempting to list indexes...');
  //     const response = await this.api.listIndexesV1IndexesListGet();
  //     console.log('Response received:', response);
  //     return response.body.indexes || [];
  //   } catch (error: any) {
  //     console.error('Error in listIndexes:', error);
  //     if (error.statusCode) {
  //       console.error(`Status code: ${error.statusCode}`);
  //     }
  //     if (error.response) {
  //       console.error(`Response data: ${JSON.stringify(error.response.body)}`);
  //     }
  //     throw new Error(`Failed to list indexes: ${error.message || 'Unknown error'}`);
  //   }
  // }

  /**
   * Create a new encrypted index
   * @param indexName Name of the index
   * @param indexKey 32-byte encryption key
   * @param indexConfig Configuration for the index
   * @param embeddingModel Optional name of embedding model
   * @returns Promise with the created index
   */
  async createIndex(
    indexName: string, 
    indexKey: Uint8Array, 
    indexConfig: any,
    embeddingModel?: string
  ) {
    try {
      // Convert indexKey to hex string for transmission
      const keyHex = Buffer.from(indexKey).toString('hex');
      
      // Create the request using the proper snake_case property names
      const createRequest: CreateIndexRequest = {
        indexName: indexName,  // Use snake_case as expected by server
        indexKey: keyHex,     // Hex string format
        indexConfig: {
          // Convert from your camelCase properties to snake_case expected by server
          dimension: indexConfig.dimension,
          metric: indexConfig.metric,
          indexType: indexConfig.index_type, // This is already snake_case
          nLists: indexConfig.n_lists,       // This is already snake_case
          pqDim: indexConfig.pq_dim || 0,    // This is already snake_case
          pqBits: indexConfig.pq_bits || 0,  // This is already snake_case
        },
        embeddingModel: embeddingModel  // Use snake_case as expected by server
      };
      
      console.log('Sending create index request...');
      const response = await this.api.createIndexV1IndexesCreatePost(createRequest);
      return response.body;
    } catch (error: any) {
      console.error('Error details:', error.body || error);
      if (error.statusCode) {
        console.error(`Status code: ${error.statusCode}`);
      }
      if (error.response && error.response.body) {
        console.error(`Response data: ${JSON.stringify(error.response.body)}`);
      }
      throw new Error(`Failed to create index: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Load an existing encrypted index
   * @param indexName Name of the index to load
   * @param indexKey 32-byte encryption key
   * @returns Promise with the loaded index
   */
  async loadIndex(indexName: string, indexKey: Uint8Array) {
    try {
      // First describe the index to get its configuration
      const keyBase64 = Buffer.from(indexKey).toString('base64');
      const request: IndexOperationRequest = {
        indexName: indexName,
        indexKey: keyBase64
      };
      
      const response = await this.api.getIndexInfoV1IndexesDescribePost(request);
      return response.body;
    } catch (error) {
      throw new Error(`Failed to load index: ${(error as Error).message}`);
    }
  }

  /**
   * Add or update vectors in the index
   * @param indexName Name of the index
   * @param indexKey 32-byte encryption key
   * @param items Items to upsert (with id, vector, contents, metadata)
   * @returns Promise with the result of the operation
   */
  async upsert(indexName: string, indexKey: Uint8Array, items: VectorItem[]) {
    try {
      // Convert indexKey to hex string for transmission
      const keyHex = Buffer.from(indexKey).toString('hex');
      
      // Convert items to the format expected by the API
      const vectors: VectorItem[] = items.map(item => {
        let contentValue: string | undefined = undefined;
        
        if (item.contents) {
          if (typeof item.contents === 'string') {
            contentValue = item.contents;
          } else {
            contentValue = Buffer.from(item.contents).toString('base64');
          }
        }
        
        return {
          id: item.id,
          vector: item.vector,
          contents: contentValue,
          metadata: item.metadata || undefined
        };
      });
      
      // Use snake_case property names for the request
      const upsertRequest: UpsertRequest = {
        indexName: indexName,  // snake_case
        indexKey: keyHex,      // Hex format
        items: vectors
      };
      
      console.log('Sending upsert request...');
      const response = await this.api.upsertVectorsV1VectorsUpsertPost(upsertRequest);
      return response.body;
    } catch (error: any) {
      console.error('Error details:', error.body || error);
      if (error.statusCode) {
        console.error(`Status code: ${error.statusCode}`);
      }
      if (error.response && error.response.body) {
        console.error(`Response data: ${JSON.stringify(error.response.body)}`);
      }
      throw new Error(`Failed to upsert vectors: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Search for nearest neighbors in the index
   * @param indexName Name of the index
   * @param indexKey 32-byte encryption key
   * @param queryVectors Query vectors to search for
   * @param topK Number of results to return
   * @param nProbes Number of probes for approximate search
   * @param filters Metadata filters
   * @param include Fields to include in results
   * @returns Promise with search results
   */
  async query(
    indexName: string, 
    indexKey: Uint8Array, 
    queryVectors: number[][], 
    topK: number = 100,
    nProbes: number = 1,
    filters: any = {},
    include: string[] = ["distance", "metadata"]
  ) {
    try {
      const keyBase64 = Buffer.from(indexKey).toString('base64');
      
      const includeFields: string[] = [];
      if (include.includes("distance")) includeFields.push("distance");
      if (include.includes("metadata")) includeFields.push("metadata");
      
      const queryRequest: QueryRequest = {
        indexName: indexName,
        indexKey: keyBase64,
        queryVectors: queryVectors,
        topK: topK,
        nProbes: nProbes,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
        include: includeFields
      };
      
      const response = await this.api.queryVectorsV1VectorsQueryPost(queryRequest);
      
      // Process the results to match Python SDK format
      const results = response.body.results || [];
      
      // Convert results to the expected format
      return results.map(item => ({
        id: item.id,
        distance: item.distance,
        metadata: item.metadata || {}
      }));
    } catch (error) {
      throw new Error(`Failed to query vectors: ${(error as Error).message}`);
    }
  }
  
  /**
   * Train the index for efficient querying
   * @param indexName Name of the index
   * @param indexKey 32-byte encryption key
   * @param batchSize Size of batches for training
   * @param maxIters Maximum number of iterations
   * @param tolerance Convergence tolerance
   * @returns Promise with the result of the operation
   */
  async train(
    indexName: string, 
    indexKey: Uint8Array,
    batchSize: number = 2048,
    maxIters: number = 100,
    tolerance: number = 1e-6
  ) {
    try {
      const keyBase64 = Buffer.from(indexKey).toString('base64');
      
      const trainRequest: TrainRequest = {
        indexName: indexName,
        indexKey: keyBase64,
        batchSize: batchSize,
        maxIters: maxIters,
        tolerance: tolerance
      };
      
      const response = await this.api.trainIndexV1IndexesTrainPost(trainRequest);
      return response.body;
    } catch (error) {
      throw new Error(`Failed to train index: ${(error as Error).message}`);
    }
  }
  
  /**
   * Delete vectors from the index
   * @param indexName Name of the index
   * @param indexKey 32-byte encryption key
   * @param ids IDs of vectors to delete
   * @returns Promise with the result of the operation
   */
  async delete(indexName: string, indexKey: Uint8Array, ids: string[]) {
    try {
      const keyBase64 = Buffer.from(indexKey).toString('base64');
      
      const deleteRequest: DeleteRequest = {
        indexName: indexName,
        indexKey: keyBase64,
        ids: ids
      };
      
      const response = await this.api.deleteVectorsV1VectorsDeletePost(deleteRequest);
      return response.body;
    } catch (error) {
      throw new Error(`Failed to delete vectors: ${(error as Error).message}`);
    }
  }
  
  /**
   * Retrieve vectors by their IDs
   * @param indexName Name of the index
   * @param indexKey 32-byte encryption key
   * @param ids IDs of vectors to retrieve
   * @param include Fields to include in results
   * @returns Promise with the retrieved vectors
   */
  async get(
    indexName: string, 
    indexKey: Uint8Array, 
    ids: string[],
    include: string[] = ["vector", "contents", "metadata"]
  ) {
    try {
      const keyBase64 = Buffer.from(indexKey).toString('base64');
      
      const includeFields: string[] = [];
      if (include.includes("vector")) includeFields.push("vector");
      if (include.includes("contents")) includeFields.push("contents");
      if (include.includes("metadata")) includeFields.push("metadata");
      
      const getRequest: GetRequest = {
        indexName: indexName,
        indexKey: keyBase64,
        ids: ids,
        include: includeFields
      };
      
      const response = await this.api.getVectorsV1VectorsGetPost(getRequest);
      
      // Process the results to match Python SDK format
      const items = response.body.results || [];
      
      // Convert results to the expected format
      return items.map(item => {
        const result: any = { id: item.id };
        
        if (item.vector) result.vector = item.vector;
        if (item.contents) {
            // Check the type of contents and handle accordingly
            if (typeof item.contents === 'string') {
              result.contents = Buffer.from(item.contents, 'base64');
            } else if (item.contents instanceof Buffer) {
              // If it's already a Buffer, use it directly
              result.contents = item.contents;
            } else {
              // For RequestFile or other object types, you might need custom handling
              // or just store it as-is if that makes sense for your application
              result.contents = item.contents;
            }
          }
        if (item.metadata) result.metadata = item.metadata;
        
        return result;
      });
    } catch (error) {
      throw new Error(`Failed to get vectors: ${(error as Error).message}`);
    }
  }
  
  /**
   * Delete an index
   * @param indexName Name of the index
   * @param indexKey 32-byte encryption key
   * @returns Promise with the result of the operation
   */
  async deleteIndex(indexName: string, indexKey: Uint8Array) {
    try {
      const keyBase64 = Buffer.from(indexKey).toString('base64');
      
      const request: IndexOperationRequest = {
        indexName: indexName,
        indexKey: keyBase64
      };
      
      const response = await this.api.deleteIndexV1IndexesDeletePost(request);
      return response.body;
    } catch (error) {
      throw new Error(`Failed to delete index: ${(error as Error).message}`);
    }
  }
}