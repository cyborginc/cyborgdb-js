import { DefaultApi, DefaultApiApiKeys } from '../src/api/defaultApi';
import { 
  CreateIndexRequest,
  IndexIVFPQModel,
  IndexIVFFlatModel,
  IndexIVFModel,
} from './model/models';
import { ErrorResponseModel } from '../src/model/errorResponseModel';
import { HTTPValidationError } from '../src/model/hTTPValidationError';
import { EncryptedIndex } from './encryptedIndex';
import https from 'https';
import axios, { InternalAxiosRequestConfig } from 'axios';

/**
 * CyborgDB TypeScript SDK
 * Provides an interface to interact with CyborgDB vector database service
 */
export class CyborgDB {
  private api: DefaultApi;
  private interceptorId?: number;

  /**
   * Create a new CyborgDB client
   * @param baseUrl Base URL of the CyborgDB service  
   * @param apiKey API key for authentication
   * @param verifySsl Whether to verify SSL certificates (auto-detected if not specified)
   */
  constructor(
    baseUrl: string, 
    apiKey?: string, 
    verifySsl?: boolean
  ) {

    // Configure SSL verification 
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

    // Configure axios interceptor for SSL (Node.js only)
    if (typeof window === 'undefined') {
      // Create HTTPS agent
      const httpsAgent = new https.Agent({
        rejectUnauthorized: verifySsl
      });

      // Add request interceptor to inject HTTPS agent
      this.interceptorId = axios.interceptors.request.use(
        (config: InternalAxiosRequestConfig) => {
          // Only add agent for HTTPS requests
          if (config.url?.startsWith('https://') || 
              (config.baseURL?.startsWith('https://') && !config.url?.startsWith('http'))) {
            config.httpsAgent = httpsAgent;
          }
          return config;
        },
        (error) => {
          return Promise.reject(error);
        }
      );
    }

    // Create the API instance (after interceptor is set up)
    this.api = new DefaultApi(baseUrl);
    
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
    if (this.interceptorId !== undefined) {
      axios.interceptors.request.eject(this.interceptorId);
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
        indexName: indexName,
        indexKey: keyHex,
        indexConfig: {
          dimension: indexConfig.dimension || undefined,
          metric: indexConfig.metric || undefined,
          indexType: indexConfig.type || undefined,
          nLists: indexConfig.nLists || undefined,
          // For IVFPQ, add additional properties
          ...(indexConfig.type === 'ivfpq' ? {
            pqDim: (indexConfig as IndexIVFPQModel).pqDim || undefined,
            pqBits: (indexConfig as IndexIVFPQModel).pqBits || undefined
          } : {})
        },
        embeddingModel: embeddingModel
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