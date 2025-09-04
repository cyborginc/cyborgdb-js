import { DefaultApi } from "./api/apis";
import { 
    UpsertRequest, 
    IndexOperationRequest,
    TrainRequest,
    DeleteRequest,
    GetRequest,
    VectorItem,
    GetResponseModel,
    QueryResponse,
    IndexConfig,
    ErrorResponseModel,
    HTTPValidationError,
    IndexIVFFlatModel,
    IndexIVFModel,
    IndexIVFPQModel,
    IndexInfoResponseModel,
    Request,
    ListIDsRequest,
    ListIDsResponse,
  } from './model/models';

export class EncryptedIndex {
    private indexName: string = "";
    private indexKey: Uint8Array;
    private indexConfig: IndexConfig;
    private api: DefaultApi;

    private handleApiError(error: any): never {
      console.error("Full error object:", JSON.stringify(error, null, 2));
      
      // Handle different error formats from typescript-node generator
      if (error.response) {
        console.error("HTTP Status Code:", error.response.statusCode || error.response.status);
        console.error("Response Headers:", JSON.stringify(error.response.headers, null, 2));
        console.error("Response Body:", error.body || error.response.body || error.response.data);
      } else if (error.body) {
        console.error("Error Body:", error.body);
      } else {
        console.error("No response from server");
        console.error("Error message:", error.message);
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
      
      const statusCode = error.response?.statusCode || error.response?.status || 'Unknown';
      throw new Error(`HTTP error ${statusCode}: ${error.message || 'Unknown error'}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
    constructor(indexName: string, indexKey: Uint8Array, indexConfig: IndexConfig, api: DefaultApi, _embeddingModel?: string) {
    this.indexName = indexName;
    this.indexKey = indexKey;
    this.api = api;

    // Normalize camelCase keys from potential snake_case input
    this.indexConfig = {
      ...indexConfig,
      pqDim: indexConfig.pqDim ?? (indexConfig as any).pq_dim,
      pqBits: indexConfig.pqBits ?? (indexConfig as any).pq_bits
    };

    delete (this.indexConfig as any).pq_dim;
    delete (this.indexConfig as any).pq_bits;
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
    public async getIndexName(): Promise<string> {
        const response = await this.describeIndex(this.indexName, this.indexKey);
        return response.indexName;
    }
    public async getIndexType(): Promise<string|undefined> {
        const response = await this.describeIndex(this.indexName, this.indexKey);
        return response.indexType;
    }
    public async isTrained(): Promise<boolean> {
        const response = await this.describeIndex(this.indexName, this.indexKey);
        return response.isTrained;
    }
    public async getIndexConfig(): Promise<IndexIVFFlatModel | IndexIVFModel | IndexIVFPQModel> {
        const response = await this.describeIndex(this.indexName, this.indexKey);
        this.indexConfig = response.indexConfig as any as IndexConfig;
        // Return a copy to prevent external modification
        if (this.indexConfig.type === 'ivf_flat') {
            return { ...this.indexConfig } as IndexIVFFlatModel;
        } else if (this.indexConfig.type === 'ivf_pq') {
            return { ...this.indexConfig } as IndexIVFPQModel;
        } else {
            return { ...this.indexConfig } as IndexIVFModel;
    }}
    /**
     * Delete an index
     * @returns Promise with the result of the operation
     */
    async deleteIndex() {
        try {
            const keyHex = Buffer.from(this.indexKey).toString('hex');
            const request: IndexOperationRequest = {
            indexName: this.indexName,
            indexKey: keyHex
            };
                    
            // Call the getIndexInfo API first
            try {
            await this.api.getIndexInfoV1IndexesDescribePost(request);
            } catch (infoError: any) {
            // Check if the error is specifically about the index not existing
            if (infoError.response?.body?.detail?.includes('not exist')) {
                return { status: 'success', message: `Index '${this.indexName}' was already deleted` };
            }
            // If it's another type of error, rethrow it
            throw infoError;
            }
        
            const response = await this.api.deleteIndexV1IndexesDeletePost(request);
        
            return response.body;
        } catch (error: any) {
            this.handleApiError(error);
        }
    }

    /**
       * Retrieve vectors by their IDs
       * @param ids IDs of vectors to retrieve
       * @param include Fields to include in results
       * @returns Promise with the retrieved vectors
       */
      async get({
        ids,
        include = ["vector", "contents", "metadata"]
      }: {
        ids: string[];
        include?: string[];
      }) {
        try {
          // Convert indexKey to hex string for transmission - matching other methods
          const keyHex = Buffer.from(this.indexKey).toString('hex');
          
          const includeFields: string[] = [];
          if (include.includes("vector")) includeFields.push("vector");
          if (include.includes("contents")) includeFields.push("contents");
          if (include.includes("metadata")) includeFields.push("metadata");
          
          const getRequest: GetRequest = {
            indexName: this.indexName,
            indexKey: keyHex,
            ids: ids,
            include: includeFields
          };
          
          const response = await this.api.getVectorsV1VectorsGetPost(getRequest);
          // Process the results to match Python SDK format
          const responseBody: GetResponseModel = response.body;
          const items = responseBody.results || [];
          
          // Convert results to the expected format
          return items.map(item => {
            const result: any = { id: item.id };
            
            if (item.vector) result.vector = item.vector;
            if (item.contents) {
              // Check if it's a string that looks like base64
              if (typeof item.contents === 'string') {
                try {
                  // Try to decode as base64, but be prepared for it not to be base64
                  result.contents = Buffer.from(item.contents, 'base64');
                } catch (e) {
                  // If decoding fails, use it as is
                  result.contents = item.contents;
                }
              } else if (item.contents instanceof Buffer) {
                result.contents = item.contents;
              } else {
                result.contents = item.contents;
              }
            }
            if (item.metadata) result.metadata = item.metadata;
            return result;
          });
        } catch (error: any) {
          this.handleApiError(error);
        }
      }

      /**
   * Train the index for efficient querying
   * @param batchSize Size of batches for training
   * @param maxIters Maximum number of iterations
   * @param tolerance Convergence tolerance
   * @param nLists Number of Voronoi cells/clusters for IVF indexes
   * @returns Promise with the result of the operation
   */
  async train({
    batchSize = 2048,
    maxIters = 100,
    tolerance = 1e-6,
    nLists
  }: {
    batchSize?: number;
    maxIters?: number;
    tolerance?: number;
    nLists?: number;
  } = {}) {
    try {
      // Convert indexKey to hex string to match other methods
      const keyHex = Buffer.from(this.indexKey).toString('hex');
      
      const trainRequest: TrainRequest = {
        indexName: this.indexName,
        indexKey: keyHex,
        batchSize: batchSize,
        maxIters: maxIters,
        tolerance: tolerance,
        nLists: nLists || undefined,
        maxMemory: 0  // Set to 0 (no limit) instead of undefined/null
      };
      
      const response = await this.api.trainIndexV1IndexesTrainPost(trainRequest);
      return response.body;
    } catch (error: any) {
      this.handleApiError(error);
    }
  }

  /**
   * Add or update vectors in the index
   * 
   * This method accepts either items (VectorItem[]) or parallel arrays (ids + vectors)
   * 
   * @param items Array of VectorItems containing id, vector, and optional metadata/contents
   * @param ids Array of ID strings for each vector (used with vectors parameter)
   * @param vectors Array of vector embeddings corresponding to each ID (used with ids parameter)
   * @returns Promise resolving to operation result with status and details
   * @throws Error with detailed validation information for invalid inputs
   */
  async upsert({
    items,
    ids,
    vectors
  }: {
    items?: VectorItem[];
    ids?: string[];
    vectors?: number[][];
  }): Promise<any> {
    try {
      // Convert indexKey to hex string for transmission
      const keyHex = Buffer.from(this.indexKey).toString('hex');
      
      let finalItems: VectorItem[] = [];

      // Case 1: items provided
      if (items !== undefined) {
        if (!Array.isArray(items)) {
          throw new Error("Invalid upsert call: items must be an array");
        }

        if (items.length === 0) {
          // Empty array is valid - just return early success
          return { status: 'success', message: 'No items to upsert' };
        }

        // Validate each VectorItem in detail
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          
          if (!item || typeof item !== 'object') {
            throw new Error(`Invalid VectorItem at index ${i}: Item must be an object, got ${typeof item}`);
          }
          
          if (!item.id) {
            throw new Error(`Invalid VectorItem at index ${i}: Missing required 'id' field. Each VectorItem must have an 'id' property.`);
          }
          
          if (typeof item.id !== 'string') {
            throw new Error(`Invalid VectorItem at index ${i}: Field 'id' must be a string, got ${typeof item.id}`);
          }
          
          if (!item.vector) {
            throw new Error(`Invalid VectorItem at index ${i} (id: "${item.id}"): Missing required 'vector' field`);
          }
          
          if (!Array.isArray(item.vector)) {
            throw new Error(`Invalid VectorItem at index ${i} (id: "${item.id}"): Field 'vector' must be an array, got ${typeof item.vector}`);
          }
          
          if (item.vector.length === 0) {
            throw new Error(`Invalid VectorItem at index ${i} (id: "${item.id}"): Vector array cannot be empty`);
          }
          
          // Validate vector contains only numbers
          for (let j = 0; j < item.vector.length; j++) {
            if (typeof item.vector[j] !== 'number' || !isFinite(item.vector[j])) {
              throw new Error(`Invalid VectorItem at index ${i} (id: "${item.id}"): Vector element at position ${j} must be a finite number, got ${typeof item.vector[j]}`);
            }
          }
          
          // Optional: validate metadata if present
          if (item.metadata !== undefined && item.metadata !== null && typeof item.metadata !== 'object') {
            throw new Error(`Invalid VectorItem at index ${i} (id: "${item.id}"): Field 'metadata' must be an object or null, got ${typeof item.metadata}`);
          }
        }

        finalItems = items;
      }
      
      // Case 2: ids and vectors provided
      else if (ids !== undefined && vectors !== undefined) {
        if (!Array.isArray(ids)) {
          throw new Error("Invalid upsert call: ids must be an array of strings");
        }
        
        if (!Array.isArray(vectors)) {
          throw new Error("Invalid upsert call: vectors must be an array of number arrays");
        }

        if (ids.length !== vectors.length) {
          throw new Error(`Array length mismatch: ${ids.length} IDs provided but ${vectors.length} vectors provided. The number of IDs must match the number of vectors.`);
        }
        
        if (ids.length === 0) {
          // Empty arrays are valid - just return early success
          return { status: 'success', message: 'No items to upsert' };
        }

        // Validate IDs
        for (let i = 0; i < ids.length; i++) {
          if (typeof ids[i] !== 'string') {
            throw new Error(`Invalid ID at index ${i}: IDs must be strings, got ${typeof ids[i]}`);
          }
          if (ids[i].trim() === '') {
            throw new Error(`Invalid ID at index ${i}: IDs cannot be empty strings`);
          }
        }

        // Validate vectors
        for (let i = 0; i < vectors.length; i++) {
          const vector = vectors[i];
          if (!Array.isArray(vector)) {
            throw new Error(`Invalid vector at index ${i} (id: "${ids[i]}"): Vector must be an array, got ${typeof vector}`);
          }
          if (vector.length === 0) {
            throw new Error(`Invalid vector at index ${i} (id: "${ids[i]}"): Vector array cannot be empty`);
          }
          
          // Validate vector contains only numbers
          for (let j = 0; j < vector.length; j++) {
            if (typeof vector[j] !== 'number' || !isFinite(vector[j])) {
              throw new Error(`Invalid vector at index ${i} (id: "${ids[i]}"): Vector element at position ${j} must be a finite number, got ${typeof vector[j]}`);
            }
          }
        }

        // Create VectorItems from IDs and vectors
        finalItems = ids.map((id, index) => ({
          id: id.toString(),
          vector: vectors[index],
          contents: undefined,
          metadata: undefined
        }));
      } else {
        throw new Error("Invalid upsert call: Must provide either 'items' or both 'ids' and 'vectors'");
      }
      
      // Convert items to the format expected by the API
      const processedItems: VectorItem[] = finalItems.map((item, index) => {
        let contentValue: string | undefined = undefined;
        
        if (item.contents) {
          try {
            if (typeof item.contents === 'string') {
              contentValue = item.contents;
            } else {
              contentValue = Buffer.from(item.contents as any).toString('base64');
            }
          } catch (error) {
            throw new Error(`Failed to process contents for item at index ${index} (id: "${item.id}"): ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
        
        return {
          id: item.id,
          vector: item.vector,
          contents: contentValue,
          metadata: item.metadata || undefined
        };
      });
      
      const upsertRequest: UpsertRequest = {
        indexName: this.indexName,
        indexKey: keyHex,
        items: processedItems
      };
      
      const response = await this.api.upsertVectorsV1VectorsUpsertPost(upsertRequest);
      return response.body;
    } catch (error: any) {
      // Enhance error handling for API errors
      if (error.message && !error.message.startsWith('Invalid')) {
        // This is likely an API error, enhance it with context
        const enhancedMessage = `Upsert operation failed: ${error.message}`;
        const enhancedError = new Error(enhancedMessage);
        enhancedError.stack = error.stack;
        throw enhancedError;
      }
      
      // Re-throw validation errors as-is since they're already detailed
      throw error;
    }
  }

  /**
   * Search for semantically similar vectors in the index.
   * Supports single vector, batch vectors, or content-based queries.
   *
   * @param queryVectors Single vector [0.1, 0.2] or batch [[0.1, 0.2], [0.3, 0.4]]
   * @param queryContents Optional text content to embed and search (alternative to queryVectors)
   * @param topK Maximum number of results to return per query (default: 100)
   * @param nProbes Number of cluster centers to search (default: 0 for auto)
   * @param filters Metadata filters (MongoDB-style queries supported)
   * @param include Fields to include in results (default: ["distance", "metadata"])
   * @param greedy Use faster approximate search (default: false)
   * @returns Promise resolving to QueryResponse
   * @throws Error if neither queryVectors nor queryContents provided
   */
  async query({
    queryVectors,
    queryContents,
    topK = 100,
    nProbes = 0,
    filters = {},
    include = ["distance", "metadata"],
    greedy = false
  }: {
    queryVectors?: number[] | number[][];
    queryContents?: string;
    topK?: number;
    nProbes?: number;
    filters?: object;
    include?: string[];
    greedy?: boolean;
  }): Promise<QueryResponse> {
    const keyHex = Buffer.from(this.indexKey).toString('hex');
    let isSingleQuery = false;

    let vectors2D: number[][] | undefined;

    if (queryVectors) {
      if (Array.isArray(queryVectors) && queryVectors.length > 0 && Array.isArray(queryVectors[0])) {
        vectors2D = queryVectors as number[][];
      } else {
        vectors2D = [queryVectors as number[]];
        isSingleQuery = true;
      }
    }

    if (!vectors2D && !queryContents) {
      throw new Error("You must provide queryVectors or queryContents.");
    }

    try {
      const requestData: Request = {
        indexName: this.indexName,
        indexKey: keyHex,
        topK,
        nProbes,
        greedy,
        filters,
        include,
        queryVectors: vectors2D
          ? vectors2D.map(vector => vector.map(v => Number(v)))
          : [],
        queryContents: queryContents ?? undefined
      };

      const response = await this.api.queryVectorsV1VectorsQueryPost(requestData as Request);

      if (!response) {
        throw new Error("No response received from query API");
      }

      let finalResponse = response.body;

      if (
        isSingleQuery &&
        finalResponse.results &&
        Array.isArray(finalResponse.results) &&
        finalResponse.results.length === 1 &&
        Array.isArray(finalResponse.results[0])
      ) {
        finalResponse.results = finalResponse.results[0];
      }

      return finalResponse;
    } catch (error: any) {
      console.error("Query error:", error.response?.data || error.message);
      this.handleApiError(error);
    }
  }

      /**
       * Delete vectors from the index
       * @param ids IDs of vectors to delete
       * @returns Promise with the result of the operation
       */
      async delete({
        ids
      }: {
        ids: string[];
      }) {
          try {
          // Convert indexKey to hex string to match other methods
          const keyHex = Buffer.from(this.indexKey).toString('hex');
          
          const deleteRequest: DeleteRequest = {
              indexName: this.indexName,
              indexKey: keyHex,
              ids: ids
          };
          
          const response = await this.api.deleteVectorsV1VectorsDeletePost(deleteRequest);
          return response.body;
          } catch (error: any) {
          this.handleApiError(error);
          }
      }

      /**
       * List all vector IDs in the index
       * @returns Promise with object containing array of vector IDs and count
       */
      async listIds(): Promise<{ ids: string[]; count: number }> {
        try {
          // Convert indexKey to hex string for transmission
          const keyHex = Buffer.from(this.indexKey).toString('hex');
          
          const listIDsRequest: ListIDsRequest = {
            indexName: this.indexName,
            indexKey: keyHex
          };
          
          const response = await this.api.listIdsV1VectorsListIdsPost(listIDsRequest);
          const responseBody: ListIDsResponse = response.body;
          
          return {
            ids: responseBody.ids,
            count: responseBody.count
          };
        } catch (error: any) {
          this.handleApiError(error);
        }
      }
  }