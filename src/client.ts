import { DefaultApi, DefaultApiApiKeys } from '../src/api/defaultApi';
import { 
  CreateIndexRequest,
  IndexIVFPQ,
  IndexIVFFlat,
  IndexIVF,
  IndexOperationRequest,
} from './index';
import { ErrorResponseModel } from '../src/model/errorResponseModel';
import { HTTPValidationError } from '../src/model/hTTPValidationError';
import { EncryptedIndex } from './encryptedIndex';
import { randomBytes } from 'crypto';
import { IndexInfoResponseModel } from './model/indexInfoResponseModel';

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
   * @param verifySsl Optional SSL verification setting. If not provided, auto-detects based on URL
   */
  constructor({
    baseUrl,
    apiKey,
    verifySsl
  }: {
    baseUrl: string;
    apiKey?: string;
    verifySsl?: boolean;
  }) {
    // If baseUrl is http, disable SSL verification
    if (baseUrl.startsWith('http://')) {
      verifySsl = false;
    }

    // Auto-detect SSL verification if not explicitly set
    if (verifySsl === undefined) {
      // Auto-detect: disable SSL verification for localhost/127.0.0.1 (development)
      if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
        verifySsl = false;
        console.info('SSL verification disabled for localhost (development mode)');
      } else {
        verifySsl = true;
      }
    } else if (!verifySsl) {
      console.warn('SSL verification is disabled. Not recommended for production.');
    }

    this.api = new DefaultApi(baseUrl);
    
    // Configure SSL verification for Axios in Node.js environments
    if (!verifySsl && typeof process !== 'undefined' && process.versions && process.versions.node) {
      // In Node.js, configure axios defaults to disable SSL verification
      const https = require('https');
      const axiosDefaults = require('axios').defaults;
      
      axiosDefaults.httpsAgent = new https.Agent({
        rejectUnauthorized: false
      });
      
      console.warn('SSL verification disabled in Node.js environment');
    }
    
    // Set default headers
    this.api.defaultHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    
    // Set API key if provided
    if (apiKey) {
      this.api.setApiKey(DefaultApiApiKeys.APIKeyHeader, apiKey);
    }
  }

  /**
   * Clean up interceptors when done
   */
  public cleanup() {
    // Interceptor cleanup not currently needed
    // This method is kept for API compatibility
  }

  private handleApiError(error: any): never {
    if (error.response) {
      console.error("HTTP Status Code:", error.response.status);
      console.error("Response Headers:", JSON.stringify(error.response.headers, null, 2));
      console.error("Response Data:", JSON.stringify(error.response.data, null, 2)); // CHANGED: .body to .data
    } else {
      console.error("No response from server");
      console.error("Error message:", error.message);
    }
    
    // Check error.response.data instead of error.response.body
    if (error.response?.data) { // CHANGED: .body to .data
      try {
        const errBody = error.response.data; // CHANGED: .body to .data
        if ('detail' in errBody && ('status_code' in errBody || 'statusCode' in errBody)) {
          const err = errBody as ErrorResponseModel;
          throw new Error(`${err.statusCode} - ${err.detail}`);
        }
        if ('detail' in errBody && Array.isArray(errBody.detail)) {
          const err = errBody as HTTPValidationError;
          throw new Error(`Validation failed: ${JSON.stringify(err.detail)}`);
        }
      } catch (e) {
        throw new Error(`Unhandled error format: ${JSON.stringify(error.response.data)}`); // CHANGED: .body to .data
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
   * @param indexConfig Configuration for the index (optional)
   * @param metric Distance metric for the index (optional)
   * @param embeddingModel Optional name of embedding model
   * @returns Promise with the created index
   */
  async createIndex({
    indexName,
    indexKey,
    indexConfig,
    metric,
    embeddingModel
  }: {
    indexName: string;
    indexKey: Uint8Array;
    indexConfig?: IndexIVFPQ | IndexIVFFlat | IndexIVF;
    metric?: 'euclidean' | 'squared_euclidean' | 'cosine';
    embeddingModel?: string;
  }) {
    try {
      // Convert indexKey to hex string for transmission
      const keyHex = Buffer.from(indexKey).toString('hex');

      // Create the request using the proper snake_case property names
      // Use default IndexIVFFlat if no config provided
      const finalConfig = indexConfig || new IndexIVFFlat();
      
      const createRequest: CreateIndexRequest = {
        indexName: indexName,
        indexKey: keyHex,
        indexConfig: {
          dimension: finalConfig.dimension || undefined,
          indexType: finalConfig.type || undefined,
          // For IVFPQ, add additional properties
          ...(finalConfig.type === 'ivfpq' ? {
            pqDim: (finalConfig as IndexIVFPQ).pqDim || undefined,
            pqBits: (finalConfig as IndexIVFPQ).pqBits ||undefined
          } : {})
        },
        embeddingModel: embeddingModel
      };

      // Add metric to the config if provided
      if (metric) {
        (createRequest.indexConfig as any).metric = metric;
      }
      
      if (finalConfig.type === 'ivfpq') {
        (createRequest.indexConfig as any).pq_dim = (finalConfig as IndexIVFPQ).pqDim;
        (createRequest.indexConfig as any).pq_bits = (finalConfig as IndexIVFPQ).pqBits;
      }
      
      await this.api.createIndexV1IndexesCreatePost(createRequest);
      return new EncryptedIndex(
        indexName, indexKey, createRequest.indexConfig, this.api, embeddingModel)
    } catch (error: any) {
      this.handleApiError(error);
    }
  }

  /**
   * Retrieve detailed information about an existing index
   * 
   * This is a low-level method used internally by other operations. It fetches
   * comprehensive index metadata including configuration, training status, and
   * operational parameters.
   * 
   * **Information Retrieved:**
   * - Index name and type (ivfflat, ivfpq, ivf)
   * - Current training status (trained/untrained)
   * - Index configuration (dimensions, metrics, clustering parameters)
   * - Vector count and other operational statistics
   * 
   * **Security Note:**
   * Requires the correct encryption key - invalid keys will result in authentication errors.
   * The key must be the same 32-byte key used when the index was created.
   * 
   * **Usage Examples:**
   * ```typescript
   * // Typically used internally, but can be called directly
   * const indexInfo = await client.describeIndex("my-index", indexKey);
   * console.log(`Index type: ${indexInfo.indexType}`);
   * console.log(`Is trained: ${indexInfo.isTrained}`);
   * console.log(`Dimensions: ${indexInfo.indexConfig.dimension}`);
   * ```
   * 
   * @param indexName Name of the index to describe
   * @param indexKey 32-byte encryption key used when index was created
   * @returns Promise resolving to complete index information and metadata
   * @throws Error if index doesn't exist, key is invalid, or server unreachable
   * @private Internal method - consider using loadIndex() for public access
   */
  private async describeIndex(
    indexName: string, 
    indexKey: Uint8Array
  ): Promise<IndexInfoResponseModel> {
    try {
      // Convert binary key to hex string format expected by API
      const keyHex = Buffer.from(indexKey).toString('hex');
      
      // Prepare request with index identifier and authentication key
      const request: IndexOperationRequest = {
        indexName: indexName,
        indexKey: keyHex
      }
      
      // Make API call to retrieve comprehensive index information
      const apiResponse = await this.api.getIndexInfoV1IndexesDescribePost(request);
      
      // Extract and return the structured response body
      return apiResponse.body;
    } catch (error: any) {
      this.handleApiError(error);
    }
  }

  /**
   * Generate a cryptographically secure 32-byte encryption key
   * 
   * Creates a random 32-byte (256-bit) key suitable for index encryption.
   * Each key is unique and provides strong security for your vector data.
   * 
   * @returns Uint8Array containing 32 cryptographically secure random bytes
   */
  generateKey(): Uint8Array {
    // Generate 32 bytes of cryptographically secure random data
    // Uses Node.js crypto.randomBytes() which leverages OS entropy sources
    return new Uint8Array(randomBytes(32));
  }

  /**
   * Load and connect to an existing encrypted index
   * 
   * Establishes a connection to a previously created index using its name and encryption key.
   * This is the primary method for accessing existing indexes and their data.
   * 
   * @param indexName Name of the existing index to load
   * @param indexKey The exact 32-byte encryption key used when creating the index  
   * @returns Promise resolving to EncryptedIndex instance ready for vector operations
   * @throws Error if index doesn't exist, key is incorrect, or connection fails
   */
  async loadIndex({
    indexName,
    indexKey
  }: {
    indexName: string;
    indexKey: Uint8Array;
  }) : Promise<EncryptedIndex> {
    try {
      // Retrieve comprehensive index information and validate access
      const response = await this.describeIndex(indexName, indexKey);
      
      // Extract index configuration for initialization
      const indexConfig = response.indexConfig;
      
      // Create and return fully initialized EncryptedIndex instance
      // This object provides all vector database operations (query, upsert, delete, etc.)
      const loadedIndex: EncryptedIndex = new EncryptedIndex(
        response.indexName,  // Use server-confirmed index name
        indexKey,           // Keep original binary key for future operations
        indexConfig,        // Configuration metadata for validation and optimization
        this.api           // Shared API client for server communication
      );
      
      return loadedIndex;
    } catch (error: any) {
      // Enhance error context with operation details
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