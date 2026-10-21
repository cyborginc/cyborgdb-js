/**
 * Comprehensive TypeScript types for CyborgDB SDK
 *
 * This file provides strongly-typed alternatives to generic `any` and `object` types
 * throughout the SDK, improving type safety and developer experience.
 */

import type {
	QueryResponse as GeneratedQueryResponse,
	GetResultItemModel,
	MetadataFieldPolicy,
	QueryResultItem,
} from "./models";

/**
 * Represents any valid JSON primitive value
 */
export type JsonPrimitive = string | number | boolean | null;

/**
 * Represents any valid JSON value (recursive definition)
 * This is used for metadata and other JSON-serializable data
 */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/**
 * Represents a JSON object with string keys and JsonValue values
 */
export interface JsonObject {
	[key: string]: JsonValue;
}

/**
 * Represents a JSON array
 */
export type JsonArray = JsonValue[];

/**
 * Metadata type for vector items
 * Metadata must be a valid JSON object
 */
export type VectorMetadata = JsonObject;

/**
 * Filter expressions for querying vectors
 * Supports MongoDB-style query operators
 *
 * Examples:
 * - Simple equality: { category: "tech" }
 * - Comparison: { age: { $gt: 18, $lt: 65 } }
 * - Array operations: { tags: { $in: ["javascript", "typescript"] } }
 * - Logical operators: { $and: [{ price: { $gte: 10 } }, { stock: { $gt: 0 } }] }
 */
export type FilterExpression = {
	[key: string]: FilterValue | FilterOperator;
};

/**
 * Possible filter values
 */
export type FilterValue = JsonPrimitive | JsonArray;

/**
 * MongoDB-style filter operators
 */
export interface FilterOperator {
	$eq?: FilterValue;
	$ne?: FilterValue;
	$gt?: number;
	$gte?: number;
	$lt?: number;
	$lte?: number;
	$in?: JsonArray;
	$nin?: JsonArray;
	$and?: FilterExpression[];
	$or?: FilterExpression[];
	$nor?: FilterExpression[];
	$not?: FilterExpression;
	$exists?: boolean;
	/**
	 * ECMAScript regex, matched with search semantics (unanchored).
	 *
	 * On `query()` this resolves from the field's regex dictionary when the
	 * index declared it `pattern: true`, and otherwise falls back to a
	 * post-filter — same rows either way. On `queryMetadata()` there is no
	 * fallback, so a non-pattern field is rejected.
	 */
	$regex?: string;
	/** Substring match. Same index-resolution rules as `$regex`. */
	$contains?: string;
}

/**
 * Response from upsert operations
 */
export interface UpsertResponse {
	/**
	 * Status of the operation
	 */
	status: string;
	/**
	 * Additional message or details
	 */
	message?: string;
}

/**
 * Response from delete operations
 */
export interface DeleteResponse {
	/**
	 * Status of the operation
	 */
	status: string;
	/**
	 * Additional message or details
	 */
	message?: string;
}

/**
 * Response from train operations
 */
export interface TrainResponse {
	/**
	 * Status of the training operation
	 */
	status: string;
	/**
	 * Additional message or details
	 */
	message?: string;
}

/**
 * Response from health check
 */
export interface HealthResponse {
	/**
	 * Status of the service
	 */
	status: string;
	/**
	 * Optional additional health information
	 */
	[key: string]: string;
}

/**
 * Get operation result item with proper typing
 * Extends GetResultItemModel from models with enhanced type safety for metadata and contents
 */
export interface GetResultItem
	extends Omit<GetResultItemModel, "metadata" | "contents"> {
	/**
	 * The stored content, returned verbatim as a string (if included). Text
	 * contents round-trip as the original UTF-8 string. Binary contents that
	 * were upserted as a Buffer round-trip as a base64 string — decode them with
	 * `Buffer.from(contents, "base64")`.
	 */
	contents?: string;
	/**
	 * Metadata associated with the vector (if included)
	 */
	metadata?: VectorMetadata;
}

/**
 * Result of `query()` and `rerank()`: one list of matches for a single query,
 * or one list per query vector for a batch.
 *
 * Replaces the generated `QueryResponse`, whose `results` the generator emits
 * as `{}` because the schema is an `anyOf` of the two array shapes.
 */
export interface QueryResponse extends Omit<GeneratedQueryResponse, "results"> {
	results: QueryResultItem[] | QueryResultItem[][];
}

/**
 * BM25 scorer config an index reports, from `bm25()` and `describe()`.
 */
export interface BM25Description {
	k1: number;
	b: number;
	analyzerVersion?: string | null;
}

/**
 * Result of `EncryptedIndex.describe()`: the index's configuration and state
 * from one describe call.
 */
export interface IndexDescription {
	indexName: string;
	/** Index type, for example `disk_ivf`. */
	indexType: string;
	/**
	 * `0` until the first upsert when the index was created without an
	 * explicit `dimension`.
	 */
	dimension: number;
	metric: string;
	storagePrecision: "float32" | "float16" | "tq12" | "tq8" | "tq6" | "tq4";
	/** `1` until the index is trained. */
	nLists: number;
	/**
	 * `training` only while a train is running; an index waiting in the
	 * service's training queue still reports `untrained` or `trained`.
	 */
	trainingState: "untrained" | "training" | "trained";
	/**
	 * Overridden fields as `{ filterable, pattern, fullText }`, plus
	 * `$default: { filterable: false }` under the allowlist posture. `{}` when
	 * the index uses the default index-everything posture.
	 */
	metadataSchema: { [field: string]: MetadataFieldPolicy };
	/** `null` when the index has no `fullText` field. */
	bm25: BM25Description | null;
	/** Present only when the index was created with an embedding model. */
	embeddingModel?: string;
}

/**
 * Result of `Client.getTrainingStatus()`.
 */
export interface TrainingStatus {
	/** Names of the indexes training right now. */
	trainingIndexes: string[];
	/** Vector count past which the service retrains an index. */
	retrainThreshold: number;
}

/**
 * One entry of `Client.listEmbeddingModels()`.
 */
export interface EmbeddingModel {
	name: string;
	dimension: number;
	maxSeqLength: number;
}

/**
 * Type guard to check if a value is a valid JSON value
 * Handles circular references by tracking visited objects
 */
export function isJsonValue(
	value: unknown,
	visited: WeakSet<object> = new WeakSet(),
): value is JsonValue {
	if (value === null) return true;

	const type = typeof value;
	if (type === "string" || type === "number" || type === "boolean") {
		return true;
	}

	if (Array.isArray(value)) {
		// Check for circular reference
		if (visited.has(value)) return false;
		visited.add(value);
		return value.every((item) => isJsonValue(item, visited));
	}

	if (type === "object") {
		const obj = value as object;
		// Check for circular reference
		if (visited.has(obj)) return false;
		visited.add(obj);
		return Object.values(obj).every((item) => isJsonValue(item, visited));
	}

	return false;
}

/**
 * Type guard to check if an error is an Error instance
 */
export function isError(error: unknown): error is Error {
	return error instanceof Error;
}

/**
 * Helper to safely extract error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
	if (isError(error)) {
		return error.message;
	}
	if (typeof error === "string") {
		return error;
	}
	return String(error);
}
