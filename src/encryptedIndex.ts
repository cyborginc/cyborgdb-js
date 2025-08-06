import { DefaultApi } from "./api/apis";
import { 
    UpsertRequest, 
    IndexOperationRequest,
    Request as QueryRequest,
    TrainRequest,
    DeleteRequest,
    GetRequest,
    VectorItem,
    BatchQueryRequest,
    GetResponseModel,
    QueryResponse,
    IndexConfig,
    ErrorResponseModel,
    HTTPValidationError,
    IndexIVFFlatModel,
    IndexIVFModel,
    IndexIVFPQModel,
    IndexInfoResponseModel,
  } from './model/models';

export class EncryptedIndex {
    private indexName: string = "";
    private indexKey: Uint8Array;
    private indexConfig: IndexConfig;
    private embeddingModel?: string = "";
    private trained: boolean = false;
    private api: DefaultApi;

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

    constructor(indexName: string, indexKey: Uint8Array, indexConfig: IndexConfig, api: DefaultApi, embeddingModel?: string) {
    this.indexName = indexName;
    this.indexKey = indexKey;
    this.embeddingModel = embeddingModel;
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
        this.indexConfig = response.indexConfig;
        // Return a copy to prevent external modification
        if (this.indexConfig.indexType === 'ivf_flat') {
            return { ...this.indexConfig } as IndexIVFFlatModel;
        } else if (this.indexConfig.indexType === 'ivf_pq') {
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
      async get(
        ids: string[],
        include: string[] = ["vector", "contents", "metadata"]
      ) {
        try {
          // Convert indexKey to hex string for transmission - matching other methods
          const keyHex = Buffer.from(this.indexKey).toString('hex');
          
          const includeFields: string[] = [];
          if (include.includes("vector")) includeFields.push("vector");
          if (include.includes("contents")) includeFields.push("contents");
          if (include.includes("metadata")) includeFields.push("metadata");
          
          const getRequest: GetRequest = {
            indexName: this.indexName,
            indexKey: keyHex, // Changed from base64 to hex
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
   * @returns Promise with the result of the operation
   */
  async train(
    batchSize: number = 2048,
    maxIters: number = 100,
    tolerance: number = 1e-6
  ) {
    try {
      // Convert indexKey to hex string to match other methods
      const keyHex = Buffer.from(this.indexKey).toString('hex');
      
      const trainRequest: TrainRequest = {
        indexName: this.indexName,
        indexKey: keyHex,
        batchSize: batchSize,
        maxIters: maxIters,
        tolerance: tolerance
      };
      
      const response = await this.api.trainIndexV1IndexesTrainPost(trainRequest);
      return response.body;
    } catch (error: any) {
      this.handleApiError(error);
    }
  }

  /**
     * Add or update vectors in the index
     * @param items Items to upsert (with id, vector, contents, metadata)
     * @returns Promise with the result of the operation
     */
    async upsert(items: VectorItem[]) {
      try {
        // Convert indexKey to hex string for transmission
        const keyHex = Buffer.from(this.indexKey).toString('hex');
        
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
          indexName: this.indexName,  // snake_case
          indexKey: keyHex,      // Hex format
          items: vectors
        };
        
        const response = await this.api.upsertVectorsV1VectorsUpsertPost(upsertRequest);
        return response.body;
      } catch (error: any) {
        this.handleApiError(error);
      }
    }

    /**
     * Search for nearest neighbors in the index
     * @param queryVector Either a single vector or an array of vectors to search for
     * @param topK Number of results to return
     * @param nProbes Number of probes for approximate search
     * @param greedy Use greedy search or not
     * @param filters Metadata filters
     * @param include Fields to include in results
     * @returns Promise with search results
     */
    async query(...args: [number[] | number[][], number?, number?, boolean?, object?, string[]?] | [QueryRequest]): Promise<QueryResponse> {
    const keyHex = Buffer.from(this.indexKey).toString('hex');

    let inputVectors: number[] | number[][] = [];
    let topK: number = 100;
    let nProbes: number = 1;
    let greedy: boolean = false;
    let filters: object = {};
    let include: string[] = ["distance", "metadata"];

    // Handle overloaded arguments
    if (args.length === 1 && typeof args[0] === 'object' && 'indexName' in args[0]) {
      const options = args[0] as QueryRequest;

      // Normalize to queryVectors always
      if (!options.queryVector && !options.queryVectors) {
        throw new Error("At least one of queryVector or queryVectors must be provided.");
      }

      inputVectors = options.queryVectors ?? [options.queryVector as number[]];
      topK = options.topK ?? topK;
      nProbes = options.nProbes ?? nProbes;
      greedy = options.greedy ?? greedy;
      filters = options.filters ?? filters;
      include = options.include ?? include;
    } else {
      [inputVectors, topK = 100, nProbes = 1, greedy = false, filters = {}, include = ["distance", "metadata"]] = args as [number[] | number[][], number?, number?, boolean?, object?, string[]?];
      if (!inputVectors) {
        throw new Error("Invalid query input: queryVector(s) is required.");
      }

      // Wrap single vector in array
      inputVectors = Array.isArray(inputVectors[0])
        ? inputVectors as number[][]
        : [inputVectors as number[]];
    }

    // Always send as BatchQueryRequest using queryVectors
    const batchRequest: BatchQueryRequest = new BatchQueryRequest();
    batchRequest.indexName = this.indexName;
    batchRequest.indexKey = keyHex;
    batchRequest.queryVectors = inputVectors as number[][];
    batchRequest.topK = topK;
    batchRequest.nProbes = nProbes;
    batchRequest.greedy = greedy;
    batchRequest.filters = filters;
    batchRequest.include = include;

    const response = await this.api.queryVectorsV1VectorsQueryPost(batchRequest);
    return response.body;
  }


    /**
     * Delete vectors from the index
     * @param ids IDs of vectors to delete
     * @returns Promise with the result of the operation
     */
    async delete(ids: string[]) {
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
}