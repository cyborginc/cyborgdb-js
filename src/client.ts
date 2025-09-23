import { DefaultApi } from './apis/DefaultApi';
import { Configuration } from './runtime';
import {
  CreateIndexRequest,
  IndexIVFPQModel as IndexIVFPQ,
  IndexIVFFlatModel as IndexIVFFlat,
  IndexIVFModel as IndexIVF,
  IndexOperationRequest,
  ErrorResponseModel,
  HTTPValidationError,
  IndexConfig,
  IndexInfoResponseModel
} from './models';
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

    // Configure fetch API based on environment and SSL settings
    let fetchApi: typeof fetch | undefined;

    // Only configure custom fetch in Node.js when SSL verification is disabled
    if (!verifySsl && typeof process !== 'undefined' && process.versions && process.versions.node) {
      // Browser environments can't disable SSL verification (security restriction)
      // Node.js 18+ has built-in fetch but needs a custom agent for SSL options
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const https = require('https');
        const agent = new https.Agent({
          rejectUnauthorized: false
        });

        fetchApi = (url: RequestInfo | URL, init?: RequestInit) => {
          return globalThis.fetch(url, { ...init, agent } as any);
        };

        console.warn('SSL verification disabled in Node.js environment');
      } catch (e) {
        // Fallback: warn that SSL verification can't be disabled
        console.warn('Could not configure SSL verification - using default fetch');
      }
    }

    // Create configuration
    const config = new Configuration({
      basePath: baseUrl,
      apiKey: apiKey ? () => apiKey : undefined,
      ...(fetchApi && { fetchApi }),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    this.api = new DefaultApi(config);
  }

  private handleApiError(error: any): never {
    console.error("Full error object:", JSON.stringify(error, null, 2));

    // Handle different error formats from typescript-fetch generator
    if (error.response) {
      console.error("HTTP Status Code:", error.response.statusCode || error.response.status);
      console.error("Response Headers:", JSON.stringify(error.response.headers, null, 2));
      console.error("Response Body:", error.body || error.response.body || error.response.data);
    } else if (error.body) {
      console.error("Error Body:", error.body);
    } else {
      console.error("No response from server");
      console.error("Error message:", error.message);
      // Log additional error details if available
      if (error.cause) {
        console.error("Error cause:", error.cause);
      }
      if (error.code) {
        console.error("Error code:", error.code);
      }
    }

    // Try to extract error details from different possible locations
    let errorBody = error.body || error.response?.body || error.response?.data;
    if (typeof errorBody === 'string') {
      try {
        errorBody = JSON.parse(errorBody);
      } catch (e) {
        // Keep as string if not valid JSON
      }
    }

    if (errorBody) {
      try {
        if (typeof errorBody === 'object' && 'detail' in errorBody) {
          if (Array.isArray(errorBody.detail)) {
            const err = errorBody as HTTPValidationError;
            throw new Error(`Validation failed: ${JSON.stringify(err.detail)}`);
          } else {
            const err = errorBody as ErrorResponseModel;
            throw new Error(`${err.statusCode || error.response?.statusCode || 'Unknown status'} - ${err.detail}`);
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('Validation failed')) {
          throw e;
        }
        throw new Error(`Unhandled error format: ${JSON.stringify(errorBody)}`);
      }
    }

    // Provide more detailed error message for fetch failures
    const statusCode = error.response?.statusCode || error.response?.status || 'Unknown';
    let errorMessage = error.message || 'Unknown error';

    // Enhance error message with additional context if available
    if (error.message === 'fetch failed' && error.cause) {
      errorMessage = `Network request failed: ${error.cause.message || error.cause}`;
    } else if (error.code) {
      errorMessage = `${errorMessage} (code: ${error.code})`;
    }

    throw new Error(`HTTP error ${statusCode}: ${errorMessage}`);
  }

  /**
   * List all available indexes
   * @returns Promise with the list of index names
   */
  async listIndexes() {
    try {
      const response = await this.api.listIndexesV1IndexesListGet();
      return response.indexes || [];
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
      const finalConfig: IndexIVFFlat | IndexIVFPQ | IndexIVF = indexConfig || {
        type: 'ivfflat',
        dimension: undefined
      };
      
      // Create proper IndexConfig object
      const baseConfig = {
        dimension: finalConfig.dimension || undefined,
        type: finalConfig.type || 'ivfflat',
        ...(metric && { metric })
      };

      const indexConfigObj: IndexConfig = finalConfig.type === 'ivfpq'
        ? {
            ...baseConfig,
            pqDim: (finalConfig as IndexIVFPQ).pqDim ?? 32,
            pqBits: (finalConfig as IndexIVFPQ).pqBits ?? 8
          }
        : baseConfig as IndexConfig;
      
      const createRequest: CreateIndexRequest = {
        indexName: indexName,
        indexKey: keyHex,
        indexConfig: indexConfigObj,
        embeddingModel: embeddingModel,
        metric: metric
      };
      
      await this.api.createIndexV1IndexesCreatePost({ createIndexRequest: createRequest });
      return new EncryptedIndex(
        indexName, indexKey, createRequest.indexConfig!, this.api, embeddingModel)
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
      const apiResponse = await this.api.getIndexInfoV1IndexesDescribePost({ indexOperationRequest: request });

      // Extract and return the structured response
      return apiResponse;
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
      const indexConfig = response.indexConfig as any as IndexConfig;
      
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
      return response;
    } catch (error: any) {
      this.handleApiError(error);
    }
  }

  /**
   * Check if any indexes are currently being trained
   * 
   * Retrieves information about which indexes are currently being trained
   * and the retrain threshold configuration.
   * 
   * @returns Promise resolving to training status information including:
   *   - training_indexes: Array of index names currently being trained
   *   - retrain_threshold: The multiplier used for the retraining threshold
   */
  async isTraining(): Promise<{
    training_indexes: string[];
    retrain_threshold: number;
  }> {
    try {
      const response = await this.api.getTrainingStatusV1IndexesTrainingStatusGet();
      // Map the camelCase response to snake_case for consistency
      return {
        training_indexes: response.trainingIndexes || [],
        retrain_threshold: response.retrainThreshold || 0
      };
    } catch (error: any) {
      this.handleApiError(error);
    }
  }
}