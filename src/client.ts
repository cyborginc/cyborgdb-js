import { DefaultApi, DefaultApiApiKeys } from '../src/api/defaultApi';
import { 
  CreateIndexRequest,
  IndexIVFPQModel,
  IndexIVFFlatModel,
  IndexIVFModel,
  IndexOperationRequest,
  IndexInfoResponseModel,
} from './model/models';
import { ErrorResponseModel } from '../src/model/errorResponseModel';
import { HTTPValidationError } from '../src/model/hTTPValidationError';
import { EncryptedIndex } from './encryptedIndex';
import { randomBytes } from 'crypto';
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
    this.api = new DefaultApi(baseUrl);
    
    // Use the public setter method
    this.api.defaultHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    
    // Set API key if provided
    if (apiKey) {
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
      const response = await this.api.listIndexesV1IndexesListGet();
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
    indexConfig: IndexIVFPQModel | IndexIVFFlatModel | IndexIVFModel,
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
          dimension: indexConfig.dimension || undefined,
          metric: indexConfig.metric || undefined,
          indexType: indexConfig.type || undefined, // This is already snake_case
          nLists: indexConfig.nLists || undefined,       // This is already snake_case
          // For IVFPQ, add additional properties
          ...(indexConfig.type === 'ivfpq' ? {
            pqDim: (indexConfig as IndexIVFPQModel).pqDim || undefined,
            pqBits: (indexConfig as IndexIVFPQModel).pqBits ||undefined
          } : {})
        },
        embeddingModel: embeddingModel  // Use snake_case as expected by server
      };
      if (indexConfig.type === 'ivfpq') {
        (createRequest.indexConfig as any).pq_dim = (indexConfig as IndexIVFPQModel).pqDim;
        (createRequest.indexConfig as any).pq_bits = (indexConfig as IndexIVFPQModel).pqBits;
      }
      
      await this.api.createIndexV1IndexesCreatePost(createRequest);
      return new EncryptedIndex(
        indexName, indexKey, createRequest.indexConfig, this.api, embeddingModel)
    } catch (error: any) {
      this.handleApiError(error);
    }
  }

  private async describeIndex(
    indexName: string, 
    indexKey: Uint8Array
  ): Promise<IndexInfoResponseModel> {
    try {
      const keyHex = Buffer.from(indexKey).toString('hex');
      const request: IndexOperationRequest = {
        indexName: indexName,
        indexKey: keyHex
      }
      
      // Get the full response object
      const apiResponse = await this.api.getIndexInfoV1IndexesDescribePost(request);
      
      // Extract the body which contains the IndexInfoResponseModel
      return apiResponse.body;
    } catch (error: any) {
      this.handleApiError(error);
    }
  }

  generateRandomKey(): Uint8Array {
    return new Uint8Array(randomBytes(32));
  }

  async loadIndex(
    indexName: string,
    indexKey: Uint8Array
  ) : Promise<EncryptedIndex> {
    try {
      const response = await this.describeIndex(indexName, indexKey);
      const indexConfig = response.indexConfig;
      const loadedIndex: EncryptedIndex = new EncryptedIndex(
        response.indexName, indexKey, indexConfig, this.api);
      return loadedIndex;
    } catch (error: any) {
      this.handleApiError(error);
    }
  }

  /**
   * Check the health of the server
   * @returns Promise with the health status
   */

  async getHealth() {
    try {
      const response = await this.api.healthCheckV1HealthGet();
      return response.body;
    } catch (error: any) {
      this.handleApiError(error);
    }
  }
}