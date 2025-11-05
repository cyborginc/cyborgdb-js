/**
 * Comprehensive TypeScript types for CyborgDB SDK
 *
 * This file provides strongly-typed alternatives to generic `any` and `object` types
 * throughout the SDK, improving type safety and developer experience.
 */

import {
  GetResultItemModel,
} from './models';

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
  $not?: FilterExpression;
  $exists?: boolean;
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
   * Number of vectors upserted
   */
  upsertedCount?: number;
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
   * Number of vectors deleted
   */
  deletedCount?: number;
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
 * Training status information
 */
export interface TrainingStatus {
  /**
   * Array of index names currently being trained
   */
  training_indexes: string[];
  /**
   * The multiplier used for the retraining threshold
   */
  retrain_threshold: number;
}

/**
 * Get operation result item with proper typing
 * Extends GetResultItemModel from models with enhanced type safety for metadata and contents
 */
export interface GetResultItem extends Omit<GetResultItemModel, 'metadata' | 'contents'> {
  /**
   * The original content as Buffer, Blob, or string (if included)
   */
  contents?: Buffer | Blob | string;
  /**
   * Metadata associated with the vector (if included)
   */
  metadata?: VectorMetadata;
}

/**
 * Type guard to check if a value is a valid JSON value
 */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;

  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (type === 'object') {
    return Object.values(value as object).every(isJsonValue);
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
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}
