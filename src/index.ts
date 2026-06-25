// eslint-disable-next-line @typescript-eslint/no-require-imports
export const VERSION = require("../package.json").version;

// Main SDK exports
export { CyborgDB as Client } from "./client";
// Export sample dataset loader
export {
	DEFAULT_SAMPLE_DATASET,
	type LoadSampleDatasetOptions,
	loadSampleDataset,
	type RawSampleDataset,
	SAMPLE_DATASETS_BASE_URL,
	type SampleDataset,
	type SampleFilter,
} from "./datasets";
// Export demo utilities
export { getDemoApiKey } from "./demo";
export { EncryptedIndex } from "./encryptedIndex";
// Export integrations
export * from "./integrations";
// Export commonly used types and interfaces
export {
	BatchQueryRequest,
	CreateIndexRequest,
	DeleteRequest,
	ErrorResponseModel,
	GetRequest,
	GetResponseModel,
	HTTPValidationError,
	IndexOperationRequest,
	QueryResponse,
	QueryResultItem,
	TrainRequest,
	UpsertRequest,
	VectorItem,
} from "./models";
// Export custom strongly-typed interfaces
export {
	DeleteResponse,
	FilterExpression,
	FilterOperator,
	FilterValue,
	GetResultItem,
	getErrorMessage,
	HealthResponse,
	isError,
	isJsonValue,
	JsonArray,
	JsonObject,
	JsonPrimitive,
	JsonValue,
	TrainResponse,
	UpsertResponse,
	VectorMetadata,
} from "./types";
