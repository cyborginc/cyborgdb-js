import { DefaultApi, DefaultApiApiKeys } from '../src/api/defaultApi';
import { 
  CreateIndexRequest, 
  IndexOperationRequest,
  IndexConfig,
} from '../src/model/models';
import { ErrorResponseModel } from '../src/model/errorResponseModel';
import { HTTPValidationError } from '../src/model/hTTPValidationError';
import { EncryptedIndex } from './EncryptedIndex';
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

  private handleApiError(error: any): never {
    if (error.response) {
      console.error("HTTP Status Code:", error.response.status);
      console.error("Response Headers:", JSON.stringify(error.response.headers, null, 2));
      console.error("Response Body:", JSON.stringify(error.response.body, null, 2));
    } else {
      console.error("No response from server");
    }
    if (error.response?.body) {
      try {
        const errBody = error.response.body;
        if ('detail' in errBody && ('status_code' in errBody || 'statusCode' in errBody)) {
          const err = errBody as ErrorResponseModel;
          throw new Error(`${err.statusCode} - ${err.detail}`);
        }
        if ('detail' in errBody && Array.isArray(errBody.detail)) {
          const err = errBody as HTTPValidationError;
          throw new Error(`Validation failed: ${JSON.stringify(err.detail)}`);
        }
      } catch (e) {
        throw new Error(`Unhandled error format: ${JSON.stringify(error.response.body)}`);
      }
    }
    throw new Error(`Unexpected error: ${error.message || 'Unknown error'}`);
  }

  /**
   * List all available indexes
   * @returns Promise with the list of index names
   */
  async listIndexes() {
    try {
      console.log('Attempting to list indexes...');
      const response = await this.api.listIndexesV1IndexesListGet();
      console.log('Response received:', response);
      return response.body.indexes || [];
    } catch (error: any) {
      this.handleApiError(error);
    }
  }

  

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
    indexConfig: IndexConfig,
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
          indexType: indexConfig.indexType, // This is already snake_case
          nLists: indexConfig.nLists,       // This is already snake_case
          pqDim: indexConfig.pqDim || 0,    // This is already snake_case
          pqBits: indexConfig.pqBits || 0,  // This is already snake_case
        },
        embeddingModel: embeddingModel  // Use snake_case as expected by server
      };
      
      console.log('Sending create index request...');
      await this.api.createIndexV1IndexesCreatePost(createRequest);
      return new EncryptedIndex(
        indexName, indexKey, indexConfig, this.api, embeddingModel)
    } catch (error: any) {
      this.handleApiError(error);
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
      const keyHex = Buffer.from(indexKey).toString('hex');
      const request: IndexOperationRequest = {
        indexName: indexName,
        indexKey: keyHex
      };
      
      const response = await this.api.getIndexInfoV1IndexesDescribePost(request);
      const config = response.body.indexConfig as any;
      const loadedIndexConfig: IndexConfig = {
        dimension: config.dimension,
        nLists: config.n_lists,
        metric: config.metric,
        indexType: config.index_type,
        pqDim: config.pq_dim,
        pqBits: config.pq_bits
      }
      return new EncryptedIndex(
        indexName, indexKey, loadedIndexConfig, this.api)
    } catch (error) {
      this.handleApiError(error);
    }
  }

  /**
   * Check the health of the server
   * @returns Promise with the health status
   */

  async getHealth() {
    try {
      console.log('Checking server health...');
      const response = await this.api.healthCheckV1HealthGet();
      return response.body;
    } catch (error: any) {
      this.handleApiError(error);
    }
  }
}