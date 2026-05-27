import { DefaultApi } from './apis/DefaultApi';
import { Configuration } from './runtime';
import {
  CreateIndexRequest,
  CreateIndexRequestStoragePrecisionEnum,
  IndexOperationRequest,
  IndexInfoResponseModel
} from './models';
import { EncryptedIndex } from './encryptedIndex';
import { randomBytes } from 'crypto';
import { HealthResponse, TrainingStatus } from './types';
import { handleApiError } from './errors';

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
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
        const https = require('https');
        const agent = new https.Agent({
          rejectUnauthorized: false
        });

        fetchApi = (url: RequestInfo | URL, init?: RequestInit) => {
          return globalThis.fetch(url, { ...init, agent } as any);
        };

        console.warn('SSL verification disabled in Node.js environment');
      } catch {
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

  /**
   * List all available indexes
   * @returns Promise with the list of index names
   */
  async listIndexes(): Promise<string[]> {
    try {
      const response = await this.api.listIndexesV1IndexesListGet();
      return response.indexes || [];
    } catch (error: unknown) {
      handleApiError(error);
    }
  }

  /**
   * Validate an optional index key is exactly 32 bytes. No-op when undefined
   * (KMS-managed indexes supply no key). Mirrors py's `_validate_index_key`
   * and go's `keyBytesToHex` length check.
   */
  private validateKeyLength(indexKey?: Uint8Array): void {
    if (indexKey !== undefined && indexKey.length !== 32) {
      throw new Error(`indexKey must be 32 bytes, got ${indexKey.length}`);
    }
  }

  /**
   * Create a new encrypted DiskIVF index
   *
   * Three key-management modes:
   *   - SDK-managed (legacy): pass `indexKey`, omit `kmsName`. The SDK
   *     supplies the 32-byte DEK directly.
   *   - KMS-fully-managed: pass `kmsName` (referencing a real-provider
   *     registry entry), omit `indexKey`. The service generates and wraps
   *     the KEK internally; the SDK never holds a key.
   *   - `provider: none` + SDK KEK: pass both `indexKey` and `kmsName`
   *     (when the named registry entry uses `provider: none`).
   *
   * At least one of `indexKey` / `kmsName` is required.
   *
   * @param indexName Name of the index
   * @param indexKey 32-byte encryption key (required unless `kmsName` references a real KMS provider)
   * @param kmsName Optional name of a `kms.registry` entry in the service config
   * @param dimension Vector dimensionality (auto-detected from the first upsert if omitted)
   * @param metric Distance metric for the index (optional)
   * @param embeddingModel Optional name of embedding model
   * @param storagePrecision Optional on-disk rerank-vector precision ('float32' | 'float16')
   * @returns Promise with the created index
   */
  async createIndex({
    indexName,
    indexKey,
    kmsName,
    dimension,
    metric,
    embeddingModel,
    storagePrecision
  }: {
    indexName: string;
    indexKey?: Uint8Array;
    kmsName?: string;
    dimension?: number;
    metric?: 'euclidean' | 'squared_euclidean' | 'cosine';
    embeddingModel?: string;
    storagePrecision?: 'float32' | 'float16';
  }) {
    // Local guard mirrored from the py/go SDKs: at least one of the two.
    if (indexKey === undefined && kmsName === undefined) {
      throw new Error('createIndex requires indexKey, kmsName, or both');
    }
    // Validate the key only when present (still must be 32 bytes).
    this.validateKeyLength(indexKey);

    try {
      const keyHex = indexKey ? Buffer.from(indexKey).toString('hex') : undefined;

      const createRequest: CreateIndexRequest = {
        indexName: indexName,
        dimension: dimension,
        embeddingModel: embeddingModel,
        metric: metric,
        storagePrecision: storagePrecision as CreateIndexRequestStoragePrecisionEnum | undefined,
        ...(keyHex !== undefined && { indexKey: keyHex }),
        ...(kmsName !== undefined && { kmsName })
      };

      await this.api.createIndexV1IndexesCreatePost({ createIndexRequest: createRequest });
      return new EncryptedIndex(indexName, indexKey, this.api);
    } catch (error: unknown) {
      handleApiError(error);
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
   * - Index name and type (disk_ivf)
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
   * @param indexKey 32-byte encryption key (omit for fully-KMS-managed indexes)
   * @returns Promise resolving to complete index information and metadata
   * @throws Error if index doesn't exist, key is invalid, or server unreachable
   * @private Internal method - consider using loadIndex() for public access
   */
  private async describeIndex(
    indexName: string,
    indexKey?: Uint8Array
  ): Promise<IndexInfoResponseModel> {
    try {
      // Convert binary key to hex string format expected by API. Omit it
      // entirely for fully-KMS-managed indexes (server resolves the KEK).
      const keyHex = indexKey ? Buffer.from(indexKey).toString('hex') : undefined;

      // Prepare request with index identifier and (optional) authentication key
      const request: IndexOperationRequest = {
        indexName: indexName,
        ...(keyHex !== undefined && { indexKey: keyHex })
      }

      // Make API call to retrieve comprehensive index information
      const apiResponse = await this.api.getIndexInfoV1IndexesDescribePost({ indexOperationRequest: request });

      // Extract and return the structured response
      return apiResponse;
    } catch (error: unknown) {
      handleApiError(error);
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
   * Static method to generate a cryptographically secure 32-byte encryption key
   * 
   * Creates a random 32-byte (256-bit) key suitable for index encryption.
   * Each key is unique and provides strong security for your vector data.
   * 
   * @returns Uint8Array containing 32 cryptographically secure random bytes
   */
  static generateKey(): Uint8Array {
    // Generate 32 bytes of cryptographically secure random data
    // Uses Node.js crypto.randomBytes() which leverages OS entropy sources
    return new Uint8Array(randomBytes(32));
  }

  /**
   * Load and connect to an existing encrypted index
   *
   * Establishes a connection to a previously created index using its name and
   * (optionally) its encryption key. For fully-KMS-managed indexes the service
   * resolves the KEK from its own cache, so `indexKey` is optional. For legacy
   * (SDK-managed) indexes and `provider: none` KMS slots, `indexKey` is required.
   *
   * @param indexName Name of the existing index to load
   * @param indexKey 32-byte encryption key (omit for fully-KMS-managed indexes)
   * @returns Promise resolving to EncryptedIndex instance ready for vector operations
   * @throws Error if index doesn't exist, key is incorrect, or connection fails
   */
  async loadIndex({
    indexName,
    indexKey
  }: {
    indexName: string;
    indexKey?: Uint8Array;
  }) : Promise<EncryptedIndex> {
    // Validate the key only when present (KMS-backed indexes supply none).
    this.validateKeyLength(indexKey);
    try {
      // Validate that the index exists and the key is correct
      const response = await this.describeIndex(indexName, indexKey);

      const loadedIndex: EncryptedIndex = new EncryptedIndex(
        response.indexName,
        indexKey,
        this.api
      );

      return loadedIndex;
    } catch (error: unknown) {
      // Enhance error context with operation details
      handleApiError(error);
    }
  }

  /**
   * Check the health of the server
   * @returns Promise with the health status
   */
  async getHealth(): Promise<HealthResponse> {
    try {
      const response = await this.api.healthCheckV1HealthGet();
      return response as HealthResponse;
    } catch (error: unknown) {
      handleApiError(error);
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
  async isTraining(): Promise<TrainingStatus> {
    try {
      const response = await this.api.getTrainingStatusV1IndexesTrainingStatusGet();
      // Map the camelCase response to snake_case for consistency
      return {
        training_indexes: response.trainingIndexes || [],
        retrain_threshold: response.retrainThreshold || 0
      };
    } catch (error: unknown) {
      handleApiError(error);
    }
  }
}