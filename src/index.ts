// eslint-disable-next-line @typescript-eslint/no-require-imports
export const VERSION: string = require("../package.json").version;

// Main SDK exports
export { CyborgDB as Client } from "./client";
// Export sample dataset loader
export {
	DEFAULT_SAMPLE_DATASET,
	type LoadSampleDatasetOptions,
	loadSampleDataset,
	SAMPLE_DATASETS_BASE_URL,
	type SampleDataset,
	type SampleFilter,
} from "./datasets";
// Export demo utilities
export { getDemoApiKey } from "./demo";
export { EncryptedIndex } from "./encryptedIndex";
// Export the typed error classes
export {
	CyborgDBAuthenticationError,
	CyborgDBConflictError,
	CyborgDBError,
	type CyborgDBErrorContext,
	CyborgDBNotFoundError,
	CyborgDBRateLimitError,
	CyborgDBServiceError,
	CyborgDBTransportError,
	CyborgDBValidationError,
} from "./errors";
// Export integrations
export * from "./integrations";
// Export commonly used types and interfaces — generated types with no `any` on the surface
export {
	BM25Config,
	CreateIndexRequest,
	DeleteRequest,
	ErrorResponseModel,
	GetRequest,
	IndexOperationRequest,
	MetadataFieldPolicy,
	MetadataResult,
	TrainRequest,
} from "./models";
// Hand-written wrapper types replace the generated ones for names that had `any` on the surface
export {
	BatchQueryRequest,
	DeleteResponse,
	FilterExpression,
	FilterOperator,
	FilterValue,
	GetResponseModel,
	GetResultItem,
	getErrorMessage,
	HealthResponse,
	HTTPValidationError,
	isError,
	isJsonValue,
	JsonArray,
	JsonObject,
	JsonPrimitive,
	JsonValue,
	QueryResponse,
	QueryResultItem,
	TrainResponse,
	UpsertRequest,
	UpsertResponse,
	VectorItem,
	VectorMetadata,
} from "./types";
