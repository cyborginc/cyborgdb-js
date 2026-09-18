/**
 * Entry point for the `cyborgdb` package.
 *
 * Everything reachable from here must run on Node, in browsers, and on Edge
 * runtimes (Vercel Edge, Cloudflare Workers), which provide no Node builtins.
 * The LangChain integration is deliberately *not* re-exported: it imports
 * `@langchain/core`, an optional peer dependency, so pulling it in here would
 * make the whole package fail to import for anyone who hasn't installed it.
 * Import it from `cyborgdb/integrations/langchain` instead.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const VERSION = require("../package.json").version;

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
// Export commonly used types and interfaces
export {
	BatchQueryRequest,
	BM25Config,
	CreateIndexRequest,
	DeleteRequest,
	ErrorResponseModel,
	GetRequest,
	GetResponseModel,
	HTTPValidationError,
	IndexOperationRequest,
	MetadataFieldPolicy,
	MetadataResult,
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
