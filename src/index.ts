// Main SDK exports
export { CyborgDB as Client } from './client';

// Export commonly used types and interfaces
export type {
  CreateIndexRequest,
  IndexOperationRequest,
  UpsertRequest,
  QueryRequest,
  BatchQueryRequest,
  TrainRequest,
  DeleteRequest,
  GetRequest,
  VectorItem,
  GetResponseModel,
  QueryResponse,
  ErrorResponseModel,
  HTTPValidationError,
  IndexIVFFlat,
  IndexIVF,
  IndexIVFPQ,
  QueryResultItem
} from './model/models';

// Export API classes if users need direct access
export { DefaultApi, DefaultApiApiKeys } from './api/defaultApi';

// Version info
export const VERSION = '1.0.0';