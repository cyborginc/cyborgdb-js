// Main SDK exports
export { CyborgDB } from './client';
export { EncryptedIndex } from './encryptedIndex';

// Export commonly used types and interfaces
export type {
  CreateIndexRequest,
  IndexOperationRequest,
  IndexConfig,
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
} from './model/models';

// Export API classes if users need direct access
export { DefaultApi, DefaultApiApiKeys } from './api/defaultApi';

// Version info
export const VERSION = '1.0.0';