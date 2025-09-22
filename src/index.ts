export const VERSION = require('../package.json').version;

// Main SDK exports
export { CyborgDB as Client } from './client';
export { EncryptedIndex } from './encryptedIndex';

// Export commonly used types and interfaces
export {
  CreateIndexRequest,
  IndexOperationRequest,
  UpsertRequest,
  BatchQueryRequest,
  TrainRequest,
  DeleteRequest,
  GetRequest,
  VectorItem,
  GetResponseModel,
  QueryResponse,
  ErrorResponseModel,
  HTTPValidationError,
  IndexIVFFlatModel as IndexIVFFlat,
  IndexIVFModel as IndexIVF,
  IndexIVFPQModel as IndexIVFPQ,
  QueryResultItem
} from './models';