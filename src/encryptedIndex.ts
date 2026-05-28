import { DefaultApi } from "./apis/DefaultApi";
import {
    UpsertRequest,
    IndexOperationRequest,
    TrainRequest,
    DeleteRequest,
    GetRequest,
    VectorItem,
    GetResponseModel,
    QueryResponse,
    IndexInfoResponseModel,
    Request,
    ListIDsRequest,
    ListIDsResponse,
    BinaryUpsertRequest,
    BinaryQueryRequest,
    BinaryVectorBatch,
    BinaryQueryBatch,
  } from './models';
import {
  UpsertResponse,
  DeleteResponse,
  TrainResponse,
  GetResultItem,
  FilterExpression
} from './types';
import { handleApiError, extractErrorDetail } from './errors';

export class EncryptedIndex {
    private indexName: string = "";
    // Hex-encoded key, computed once in the constructor since the key never
    // changes (mirrors py's `_index_key_hex` / go's stored `indexKey *string`).
    // undefined when this index is fully KMS-managed (the server resolves the
    // KEK from its own KMSBlob snapshot).
    private readonly indexKeyHex?: string;
    private api: DefaultApi;

    // Permanently cached describe-derived metadata. `indexConfig` is
    // immutable for the life of an index, so it's fetched once and
    // reused (mirrors py's `_index_config`). Training status is NOT
    // cached — it changes server-side.
    private indexConfigCached?: Record<string, any>;

    // Spread into a request body to conditionally include indexKey.
    private withKey<T extends object>(body: T): T & { indexKey?: string } {
      return this.indexKeyHex !== undefined ? { ...body, indexKey: this.indexKeyHex } : body;
    }

    constructor(indexName: string, indexKey: Uint8Array | undefined, api: DefaultApi) {
    this.indexName = indexName;
    this.indexKeyHex = indexKey ? Buffer.from(indexKey).toString('hex') : undefined;
    this.api = api;
  }


  private async describeIndex(
      indexName: string
    ): Promise<IndexInfoResponseModel> {
      try {
        // Omit indexKey for fully-KMS-managed indexes (server resolves the KEK).
        const request: IndexOperationRequest = this.withKey({
          indexName: indexName
        });

        // Get the full response object
        const apiResponse = await this.api.getIndexInfoV1IndexesDescribePost({indexOperationRequest: request});

        // Extract the body which contains the IndexInfoResponseModel
        return apiResponse;
      } catch (error: unknown) {
        handleApiError(error);
      }
    }
    public async getIndexName(): Promise<string> {
        // Known at construction — no API call (matches py/go).
        return this.indexName;
    }
    public async isTrained(): Promise<boolean> {
        // Not cached — training status changes server-side (matches py/go).
        const response = await this.describeIndex(this.indexName);
        return response.isTrained;
    }
    public async getIndexConfig(): Promise<Record<string, any>> {
        // Immutable — fetch once, then serve a defensive copy from cache.
        if (this.indexConfigCached === undefined) {
            const response = await this.describeIndex(this.indexName);
            this.indexConfigCached = { ...response.indexConfig };
        }
        // Return a copy to prevent external modification
        return { ...this.indexConfigCached };
    }
    /**
     * Delete an index
     * @returns Promise with the result of the operation
     */
    async deleteIndex() {
        try {
            const request: IndexOperationRequest = this.withKey({
              indexName: this.indexName
            });

            // Call the getIndexInfo API first
            try {
            await this.api.getIndexInfoV1IndexesDescribePost({indexOperationRequest: request});
            } catch (infoError: unknown) {
            // Check if the error is specifically about the index not existing
            const errorDetail = extractErrorDetail(infoError);
            if (errorDetail?.includes('not exist')) {
                return { status: 'success', message: `Index '${this.indexName}' was already deleted` };
            }
            // If it's another type of error, rethrow it
            throw infoError;
            }

            const response = await this.api.deleteIndexV1IndexesDeletePost({indexOperationRequest: request});

            return response;
        } catch (error: unknown) {
            handleApiError(error);
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
      }): Promise<GetResultItem[]> {
        try {
          const includeFields: string[] = [];
          if (include.includes("vector")) includeFields.push("vector");
          if (include.includes("contents")) includeFields.push("contents");
          if (include.includes("metadata")) includeFields.push("metadata");

          const getRequest: GetRequest = this.withKey({
            indexName: this.indexName,
            ids: ids,
            include: includeFields
          });

          const response = await this.api.getVectorsV1VectorsGetPost({getRequest});

          // Process the results to match Python SDK format
          const responseBody: GetResponseModel = response;
          const items = responseBody.results || [];

          // Convert results to the expected format
          return items.map((item): GetResultItem => {
            const result: GetResultItem = { id: item.id };

            if (item.vector) result.vector = item.vector;
            if (item.contents) {
              try {
                result.contents = Buffer.from(item.contents, 'base64').toString('utf-8');
              } catch {
                result.contents = item.contents;
              }
            }
            if (item.metadata) result.metadata = item.metadata;
            return result;
          });
        } catch (error: unknown) {
          handleApiError(error);
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
    nLists,
    batchSize,
    maxIters,
    tolerance
  }: {
    nLists?: number;
    batchSize?: number;
    maxIters?: number;
    tolerance?: number;
  } = {}): Promise<TrainResponse> {
    try {
      const trainRequest: TrainRequest = this.withKey({
        indexName: this.indexName,
        batchSize: batchSize ?? undefined,
        maxIters: maxIters ?? undefined,
        tolerance: tolerance ?? undefined,
        nLists: nLists ?? undefined,
        maxMemory: undefined
      });

      const response = await this.api.trainIndexV1IndexesTrainPost({trainRequest});
      return response as TrainResponse;
    } catch (error: unknown) {
      handleApiError(error);
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
    vectors,
    metadata,
    contents
  }: {
    items?: VectorItem[];
    ids?: string[];
    vectors?: number[][] | Float32Array;
    metadata?: (Record<string, unknown> | null)[];
    contents?: (string | null)[];
  }): Promise<UpsertResponse> {
    // Route to binary endpoint if vectors is Float32Array
    if (vectors instanceof Float32Array) {
      if (!ids) {
        throw new Error("Invalid upsert call: 'ids' is required when using Float32Array vectors");
      }
      if (metadata !== undefined && metadata.length !== ids.length) {
        throw new Error(`Array length mismatch: ${ids.length} IDs provided but ${metadata.length} metadata entries provided`);
      }
      if (contents !== undefined && contents.length !== ids.length) {
        throw new Error(`Array length mismatch: ${ids.length} IDs provided but ${contents.length} contents entries provided`);
      }
      return this._upsertBinary({ ids, vectors, metadata, contents });
    }

    try {
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

          // Vector is required unless contents is provided (for auto-embedding)
          if (!item.vector && !item.contents) {
            throw new Error(`Invalid VectorItem at index ${i} (id: "${item.id}"): Must provide either 'vector' or 'contents' field`);
          }

          // Validate vector if provided
          if (item.vector) {
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

        if (metadata !== undefined && metadata.length !== ids.length) {
          throw new Error(`Array length mismatch: ${ids.length} IDs provided but ${metadata.length} metadata entries provided`);
        }

        if (contents !== undefined && contents.length !== ids.length) {
          throw new Error(`Array length mismatch: ${ids.length} IDs provided but ${contents.length} contents entries provided`);
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
          contents: contents?.[index] ?? undefined,
          metadata: metadata?.[index] ?? undefined
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

      const upsertRequest: UpsertRequest = this.withKey({
        indexName: this.indexName,
        items: processedItems
      });

      const response = await this.api.upsertVectorsV1VectorsUpsertPost({upsertRequest});
      return response as UpsertResponse;
    } catch (error: unknown) {
      // Type guard for error with message
      const hasMessage = (err: unknown): err is { message: string; stack?: string } => {
        return typeof err === 'object' && err !== null && 'message' in err &&
               typeof (err as { message: unknown }).message === 'string';
      };

      // Enhance error handling for API errors
      if (hasMessage(error) && !error.message.startsWith('Invalid')) {
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
   * @param topK Maximum number of results to return per query
   * @param nProbes Number of cluster centers to search
   * @param filters Metadata filters (MongoDB-style queries supported)
   * @param include Fields to include in results
   * @param greedy Use faster approximate search
   * @returns Promise resolving to QueryResponse
   * @throws Error if neither queryVectors nor queryContents provided
   */
  async query({
    queryVectors,
    queryContents,
    topK,
    nProbes,
    filters,
    include,
    greedy,
    dimension
  }: {
    queryVectors?: number[] | number[][] | Float32Array;
    queryContents?: string;
    topK?: number;
    nProbes?: number;
    filters?: FilterExpression;
    include?: string[];
    greedy?: boolean;
    dimension?: number;
  }): Promise<QueryResponse> {
    // Route to binary endpoint if queryVectors is Float32Array
    if (queryVectors instanceof Float32Array) {
      if (!dimension) {
        throw new Error("Invalid query call: 'dimension' is required when using Float32Array queryVectors");
      }
      return this._queryBinary({ queryVectors, topK, nProbes, filters, include, greedy, dimension });
    }

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
      const requestData: Request = this.withKey({
        indexName: this.indexName,
        topK: topK ?? undefined,
        nProbes: nProbes ?? undefined,
        greedy: greedy ?? undefined,
        filters: filters ?? undefined,
        include: include ?? undefined,
        queryVectors: vectors2D
          ? vectors2D.map(vector => vector.map(v => Number(v)))
          : [],
        queryContents: queryContents ?? undefined
      });

      const response = await this.api.queryVectorsV1VectorsQueryPost({request: requestData});

      if (!response) {
        throw new Error("No response received from query API");
      }

      const finalResponse = response;

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
    } catch (error: unknown) {
      handleApiError(error);
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
      }): Promise<DeleteResponse> {
          try {
          const deleteRequest: DeleteRequest = this.withKey({
              indexName: this.indexName,
              ids: ids
          });

          const response = await this.api.deleteVectorsV1VectorsDeletePost({deleteRequest});
          return response as DeleteResponse;
          } catch (error: unknown) {
          handleApiError(error);
          }
      }

      /**
       * List all vector IDs in the index
       * @returns Promise with object containing array of vector IDs and count
       */
      async listIds(): Promise<{ ids: string[]; count: number }> {
        try {
          const listIDsRequest: ListIDsRequest = this.withKey({
            indexName: this.indexName
          });

          const response = await this.api.listIdsV1VectorsListIdsPost({listIDsRequest});
          const responseBody: ListIDsResponse = response;

          return {
            ids: responseBody.ids,
            count: responseBody.count
          };
        } catch (error: unknown) {
          handleApiError(error);
        }
      }

  /**
   * Internal method: Add or update vectors using binary format for efficiency.
   * Called automatically by upsert() when Float32Array is passed.
   */
  private async _upsertBinary({
    ids,
    vectors,
    metadata,
    contents
  }: {
    ids: string[];
    vectors: number[][] | Float32Array;
    metadata?: (Record<string, unknown> | null)[];
    contents?: (string | null)[];
  }): Promise<UpsertResponse> {
    try {
      // Validate metadata and contents length if provided
      if (metadata !== undefined && metadata.length !== ids.length) {
        throw new Error(`Array length mismatch: ${ids.length} IDs provided but ${metadata.length} metadata entries provided`);
      }
      if (contents !== undefined && contents.length !== ids.length) {
        throw new Error(`Array length mismatch: ${ids.length} IDs provided but ${contents.length} contents entries provided`);
      }

      // Convert vectors to Float32Array if needed and get dimension
      let float32Vectors: Float32Array;
      let dimension: number;

      if (vectors instanceof Float32Array) {
        // Assume vectors is already flattened: n_vectors * dimension
        if (ids.length === 0) {
          return { status: 'success', message: 'No items to upsert' };
        }
        if (vectors.length % ids.length !== 0) {
          throw new Error(`Float32Array length (${vectors.length}) must be evenly divisible by number of ids (${ids.length})`);
        }
        dimension = vectors.length / ids.length;
        float32Vectors = vectors;
      } else {
        // vectors is number[][]
        if (vectors.length === 0 || ids.length === 0) {
          return { status: 'success', message: 'No items to upsert' };
        }

        if (ids.length !== vectors.length) {
          throw new Error(`Number of ids (${ids.length}) must match number of vectors (${vectors.length})`);
        }

        dimension = vectors[0].length;

        // Flatten to Float32Array
        float32Vectors = new Float32Array(vectors.length * dimension);
        for (let i = 0; i < vectors.length; i++) {
          if (vectors[i].length !== dimension) {
            throw new Error(`All vectors must have the same dimension. Vector at index ${i} has dimension ${vectors[i].length}, expected ${dimension}`);
          }
          for (let j = 0; j < dimension; j++) {
            float32Vectors[i * dimension + j] = vectors[i][j];
          }
        }
      }

      // Convert Float32Array to base64
      const vectorsB64 = Buffer.from(float32Vectors.buffer).toString('base64');

      // Build the batch
      const batch: BinaryVectorBatch = {
        ids,
        vectorsB64,
        dimension,
        metadata: metadata ?? undefined,
        // Cast contents to expected type - the API accepts string | null for each item
        contents: contents as BinaryVectorBatch['contents']
      };

      const binaryUpsertRequest: BinaryUpsertRequest = this.withKey({
        indexName: this.indexName,
        batch
      });

      const response = await this.api.upsertVectorsBinaryV1VectorsUpsertBinaryPost({binaryUpsertRequest});
      return response as UpsertResponse;
    } catch (error: unknown) {
      handleApiError(error);
    }
  }

  /**
   * Internal method: Query vectors using binary format for efficiency.
   * Called automatically by query() when Float32Array is passed.
   */
  private async _queryBinary({
    queryVectors,
    topK,
    nProbes,
    filters,
    include,
    greedy,
    dimension: providedDimension
  }: {
    queryVectors: number[][] | Float32Array;
    topK?: number;
    nProbes?: number;
    filters?: FilterExpression;
    include?: string[];
    greedy?: boolean;
    dimension?: number;
  }): Promise<QueryResponse> {
    try {
      // Convert vectors to Float32Array if needed and get dimension
      let float32Vectors: Float32Array;
      let dimension: number;

      if (queryVectors instanceof Float32Array) {
        if (!providedDimension) {
          throw new Error('dimension is required when using Float32Array for queryVectors');
        }
        float32Vectors = queryVectors;
        dimension = providedDimension;
      } else {
        // queryVectors is number[][]
        if (queryVectors.length === 0) {
          throw new Error('queryVectors cannot be empty');
        }

        const numQueries = queryVectors.length;
        dimension = queryVectors[0].length;

        // Flatten to Float32Array
        float32Vectors = new Float32Array(numQueries * dimension);
        for (let i = 0; i < numQueries; i++) {
          if (queryVectors[i].length !== dimension) {
            throw new Error(`All query vectors must have the same dimension. Vector at index ${i} has dimension ${queryVectors[i].length}, expected ${dimension}`);
          }
          for (let j = 0; j < dimension; j++) {
            float32Vectors[i * dimension + j] = queryVectors[i][j];
          }
        }
      }

      // Convert Float32Array to base64
      const vectorsB64 = Buffer.from(float32Vectors.buffer).toString('base64');

      // Build the batch
      const batch: BinaryQueryBatch = {
        vectorsB64,
        dimension
      };

      const binaryQueryRequest: BinaryQueryRequest = this.withKey({
        indexName: this.indexName,
        batch,
        topK: topK ?? undefined,
        nProbes: nProbes ?? undefined,
        greedy: greedy ?? undefined,
        filters: filters ?? undefined,
        include: include ?? undefined
      });

      const response = await this.api.queryVectorsBinaryV1VectorsQueryBinaryPost({binaryQueryRequest});
      return response;
    } catch (error: unknown) {
      handleApiError(error);
    }
  }
  }
