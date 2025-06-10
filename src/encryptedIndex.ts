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

    constructor(indexName:string, indexKey: Uint8Array, indexConfig: IndexConfig, api:DefaultApi, embeddingModel?: string){
        this.indexName = indexName;
        this.indexKey = indexKey;
        this.indexConfig = indexConfig;
        this.embeddingModel = embeddingModel;
        this.api = api;
    }
    public getIndexName(): string {
        return this.indexName;
    }
    public getIndexType(): string|undefined {
        return this.indexConfig.indexType;
    }
    public isTrained(): boolean {
        return this.trained;
    }
    public getIndexConfig(): IndexConfig {
        return this.indexConfig;
    }
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
        
            console.log('Checking if index exists before deletion...', { indexName: this.indexName });
            
            // Call the getIndexInfo API first
            try {
            await this.api.getIndexInfoV1IndexesDescribePost(request);
            console.log(`Confirmed index ${this.indexName} exists.`);
            } catch (infoError: any) {
            // Check if the error is specifically about the index not existing
            if (infoError.response?.body?.detail?.includes('not exist')) {
                console.log(`Index ${this.indexName} does not exist, skipping deletion.`);
                return { status: 'success', message: `Index '${this.indexName}' was already deleted` };
            }
            // If it's another type of error, rethrow it
            throw infoError;
            }
        
            console.log('Sending delete index request...', {indexName: this.indexName });
            const response = await this.api.deleteIndexV1IndexesDeletePost(request);
            console.log(`Delete response:`, response.body);
        
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
          
          console.log('Sending get vectors request...', { 
            indexName: this.indexName, 
            hasKey: !!keyHex, 
            ids, 
            include: includeFields 
          });
          
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
            console.log("Get result item:", result);
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
      
      console.log('Sending train index request...', { 
        indexName: this.indexName, 
        batchSize, 
        maxIters 
      });
      
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
        
        console.log('Sending upsert request...');
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
  async query(
    queryVector: number[] | number[][],
    topK: number = 100,
    nProbes: number = 1,
    greedy: boolean = false,
    filters: any = {},
    include: string[] = ["distance", "metadata"]

  ): Promise<QueryResponse> {
    // Validate that only one query type is provided
    const keyHex = Buffer.from(this.indexKey).toString('hex');
    if (!queryVector) {
      throw new Error('You must provide at least one queryVector');
    }
    // For batch queries
    if (Array.isArray(queryVector[0])) {
      const batchRequest:BatchQueryRequest = new BatchQueryRequest();
      batchRequest.indexName = this.indexName;
      batchRequest.indexKey = keyHex;
      batchRequest.queryVectors = queryVector as number[][];
      
      // Optional parameters with defaults
      if (topK !== undefined) batchRequest.topK = topK;
      if (nProbes !== undefined) batchRequest.nProbes = nProbes;
      if (greedy !== undefined) batchRequest.greedy = greedy;
      if (filters) batchRequest.filters = filters;
      if (include) batchRequest.include = include;
      
      const response =  await this.api.queryVectorsV1VectorsQueryPost(batchRequest);
      return response.body;
    } 
    // For single vector or content-based queries
    else {
      const request = new QueryRequest();
      request.indexName = this.indexName;
      request.indexKey = keyHex;
      request.queryVector = queryVector as number[];

      
      // Optional parameters with defaults
      if (topK !== undefined) request.topK = topK;
      if (nProbes !== undefined) request.nProbes = nProbes;
      if (greedy !== undefined) request.greedy = greedy;
      if (filters) request.filters = filters;
      if (include) request.include = include;
      
      const response =  await this.api.queryVectorsV1VectorsQueryPost(request);
      return response.body;
    }
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
        
        console.log('Sending delete vectors request...', {
            indexName: this.indexName,
            idsCount: ids.length,
            firstId: ids[0]
        });
        
        const response = await this.api.deleteVectorsV1VectorsDeletePost(deleteRequest);
        return response.body;
        } catch (error: any) {
        this.handleApiError(error);
        }
    }
}