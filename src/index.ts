// eslint-disable-next-line @typescript-eslint/no-require-imports
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
  QueryResultItem
} from './models';

// Export custom strongly-typed interfaces
export {
  JsonValue,
  JsonObject,
  JsonArray,
  JsonPrimitive,
  VectorMetadata,
  FilterExpression,
  FilterValue,
  FilterOperator,
  UpsertResponse,
  DeleteResponse,
  TrainResponse,
  HealthResponse,
  TrainingStatus,
  GetResultItem,
  isJsonValue,
  isError,
  getErrorMessage
} from './types';

// Export integrations
export * from './integrations';

// Export demo utilities
export { getDemoApiKey } from './demo';
