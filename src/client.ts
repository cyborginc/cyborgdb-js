import { randomBytes } from "node:crypto";
import { DefaultApi } from "./apis/DefaultApi";
import { EncryptedIndex } from "./encryptedIndex";
import { handleApiError } from "./errors";
import type {
	CreateIndexRequest,
	CreateIndexRequestStoragePrecisionEnum,
	IndexInfoResponseModel,
	IndexOperationRequest,
	MetadataFieldPolicy,
} from "./models";
import { Configuration } from "./runtime";
import type { HealthResponse } from "./types";

/**
 * CyborgDB TypeScript SDK
 * Provides an interface to interact with CyborgDB vector database service.
 *
 * The `apiKey` passed at construction is sent as the `X-API-Key` header on
 * every request and may be any of three kinds, depending on how the service
 * is deployed:
 *
 * - **Single service key** — the default; the one `CYBORGDB_API_KEY` the
 *   service was started with. Full access, no RBAC.
 * - **Root key** — when the service runs with `CYBORGDB_SERVICE_ROOT_KEY` set,
 *   RBAC is on. A client using the root key has admin access and can mint
 *   per-user keys via {@link EncryptedIndex.createUser}.
 * - **User key** (`cdbk_...`) — minted by `createUser` and scoped to one
 *   index with `read` / `write` permissions enforced cryptographically.
 *   A user client calls `loadIndex({ indexName })` with **no** `indexKey`
 *   (the service resolves it), then performs the data operations its
 *   permissions allow. User keys work only against KMS-backed indexes
 *   (the service must be able to resolve the index KEK server-side);
 *   SDK-supplied-KEK indexes have no server-side key to resolve for a
 *   user.
 */
export class CyborgDB {
	private api: DefaultApi;

	/**
	 * Create a new CyborgDB client
	 * @param baseUrl Base URL of the CyborgDB service
	 * @param apiKey API key for authentication
	 * @param verifySsl Optional SSL verification setting. If not provided, auto-detects based on URL
	 */
	constructor({
		baseUrl,
		apiKey,
		verifySsl,
	}: {
		baseUrl: string;
		apiKey?: string;
		verifySsl?: boolean;
	}) {
		// If baseUrl is http, disable SSL verification
		if (baseUrl.startsWith("http://")) {
			verifySsl = false;
		}

		// Auto-detect SSL verification if not explicitly set
		if (verifySsl === undefined) {
			// Auto-detect: disable SSL verification for localhost/127.0.0.1 (development)
			if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
				verifySsl = false;
				console.info(
					"SSL verification disabled for localhost (development mode)",
				);
			} else {
				verifySsl = true;
			}
		} else if (!verifySsl) {
			console.warn(
				"SSL verification is disabled. Not recommended for production.",
			);
		}

		// Configure fetch API based on environment and SSL settings
		let fetchApi: typeof fetch | undefined;

		// Only configure custom fetch in Node.js when SSL verification is disabled
		if (
			!verifySsl &&
			typeof process !== "undefined" &&
			process.versions?.node
		) {
			// Browser environments can't disable SSL verification (security restriction)
			// Node.js 18+ has built-in fetch but needs a custom agent for SSL options
			try {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const https = require("node:https");
				const agent = new https.Agent({
					rejectUnauthorized: false,
				});

				fetchApi = (url: RequestInfo | URL, init?: RequestInit) => {
					return globalThis.fetch(url, { ...init, agent } as any);
				};

				console.warn("SSL verification disabled in Node.js environment");
			} catch {
				// Fallback: warn that SSL verification can't be disabled
				console.warn(
					"Could not configure SSL verification - using default fetch",
				);
			}
		}

		// Pre-read the body of non-2xx responses and stash the parsed JSON on
		// the Response.  The generated runtime throws a `ResponseError` whose
		// `response.body` is a `ReadableStream`, so `handleApiError` can't
		// recover the server's `detail` synchronously without this.
		const inner = fetchApi ?? globalThis.fetch.bind(globalThis);
		fetchApi = async (url: RequestInfo | URL, init?: RequestInit) => {
			const res = await inner(url, init);
			if (!res.ok) {
				try {
					(res as unknown as { parsedBody?: unknown }).parsedBody = await res
						.clone()
						.json();
				} catch {
					// Non-JSON body — leave parsedBody undefined and let
					// handleApiError fall back to its generic message.
				}
			}
			return res;
		};

		// Create configuration
		const config = new Configuration({
			basePath: baseUrl,
			apiKey: apiKey ? () => apiKey : undefined,
			fetchApi,
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
		});

		this.api = new DefaultApi(config);
	}

	/**
	 * List all available indexes
	 * @returns Promise with the list of index names
	 */
	async listIndexes(): Promise<string[]> {
		try {
			const response = await this.api.listIndexesV1IndexesListGet();
			return response.indexes || [];
		} catch (error: unknown) {
			handleApiError(error);
		}
	}

	/**
	 * Validate an optional index key is exactly 32 bytes. No-op when undefined
	 * (KMS-managed indexes supply no key). Mirrors py's `_validate_index_key`
	 * and go's `keyBytesToHex` length check.
	 */
	private validateKeyLength(indexKey?: Uint8Array): void {
		if (indexKey !== undefined && indexKey.length !== 32) {
			throw new Error(`indexKey must be 32 bytes, got ${indexKey.length}`);
		}
	}

	/**
	 * Create a new encrypted DiskIVF index
	 *
	 * Two key-management modes — pass exactly one of `indexKey` / `kmsName`:
	 *   - SDK-managed (legacy): pass `indexKey`, omit `kmsName`. The SDK
	 *     supplies the 32-byte key directly; the service records this as
	 *     `provider: none`.
	 *   - KMS-managed: pass `kmsName` (referencing a registry entry), omit
	 *     `indexKey`. The service generates and wraps the KEK internally; the
	 *     SDK never holds a key.
	 *
	 * At least one of `indexKey` / `kmsName` is required. Supplying both is
	 * rejected by the service with a 400 (the named slot already determines
	 * the key source); `none` is not a registry slot you reference by name.
	 *
	 * @param indexName Name of the index
	 * @param indexKey 32-byte encryption key (required unless `kmsName` references a real KMS provider)
	 * @param kmsName Optional name of a `kms.registry` entry in the service config
	 * @param dimension Vector dimensionality (auto-detected from the first upsert if omitted)
	 * @param metric Distance metric for the index (optional)
	 * @param embeddingModel Optional name of embedding model
	 * @param storagePrecision Optional on-disk rerank-vector precision ('float32' | 'float16')
	 * @param metadataSchema Optional per-field metadata indexing policy, fixed at
	 *   create time: `{ title: { filterable: true, pattern: true } }`. Fields left
	 *   out are filterable (opt-out posture); `pattern` requires `filterable` and
	 *   builds the regex dictionary that `$regex`/`$contains` need. On `query()`
	 *   this only decides how a filter resolves; `queryMetadata()` enforces it.
	 * @returns Promise with the created index
	 */
	async createIndex({
		indexName,
		indexKey,
		kmsName,
		dimension,
		metric,
		embeddingModel,
		storagePrecision,
		metadataSchema,
	}: {
		indexName: string;
		indexKey?: Uint8Array;
		kmsName?: string;
		dimension?: number;
		metric?: "euclidean" | "squared_euclidean" | "cosine";
		embeddingModel?: string;
		storagePrecision?: "float32" | "float16";
		metadataSchema?: { [field: string]: MetadataFieldPolicy };
	}) {
		// Local guard mirrored from the py/go SDKs: at least one of the two.
		if (indexKey === undefined && kmsName === undefined) {
			throw new Error("createIndex requires indexKey, kmsName, or both");
		}
		// Validate the key only when present (still must be 32 bytes).
		this.validateKeyLength(indexKey);

		try {
			const keyHex = indexKey
				? Buffer.from(indexKey).toString("hex")
				: undefined;

			const createRequest: CreateIndexRequest = {
				indexName: indexName,
				dimension: dimension,
				embeddingModel: embeddingModel,
				metric: metric,
				storagePrecision: storagePrecision as
					| CreateIndexRequestStoragePrecisionEnum
					| undefined,
				...(keyHex !== undefined && { indexKey: keyHex }),
				...(kmsName !== undefined && { kmsName }),
				...(metadataSchema !== undefined && { metadataSchema }),
			};

			await this.api.createIndexV1IndexesCreatePost({
				createIndexRequest: createRequest,
			});
			return new EncryptedIndex(indexName, indexKey, this.api);
		} catch (error: unknown) {
			handleApiError(error);
		}
	}

	/**
	 * Retrieve detailed information about an existing index
	 *
	 * This is a low-level method used internally by other operations. It fetches
	 * comprehensive index metadata including configuration, training status, and
	 * operational parameters.
	 *
	 * **Information Retrieved:**
	 * - Index name and type (disk_ivf)
	 * - Current training status (trained/untrained)
	 * - Index configuration (dimensions, metrics, clustering parameters)
	 * - Vector count and other operational statistics
	 *
	 * **Security Note:**
	 * Requires the correct encryption key - invalid keys will result in authentication errors.
	 * The key must be the same 32-byte key used when the index was created.
	 *
	 * **Usage Examples:**
	 * ```typescript
	 * // Typically used internally, but can be called directly
	 * const indexInfo = await client.describeIndex("my-index", indexKey);
	 * console.log(`Is trained: ${indexInfo.isTrained}`);
	 * console.log(`Dimensions: ${indexInfo.dimension}`);
	 * ```
	 *
	 * @param indexName Name of the index to describe
	 * @param indexKey 32-byte encryption key (omit for fully-KMS-managed indexes)
	 * @returns Promise resolving to complete index information and metadata
	 * @throws Error if index doesn't exist, key is invalid, or server unreachable
	 * @private Internal method - consider using loadIndex() for public access
	 */
	private async describeIndex(
		indexName: string,
		indexKey?: Uint8Array,
	): Promise<IndexInfoResponseModel> {
		try {
			// Convert binary key to hex string format expected by API. Omit it
			// entirely for fully-KMS-managed indexes (server resolves the KEK).
			const keyHex = indexKey
				? Buffer.from(indexKey).toString("hex")
				: undefined;

			// Prepare request with index identifier and (optional) authentication key
			const request: IndexOperationRequest = {
				indexName: indexName,
				...(keyHex !== undefined && { indexKey: keyHex }),
			};

			// Make API call to retrieve comprehensive index information
			const apiResponse = await this.api.getIndexInfoV1IndexesDescribePost({
				indexOperationRequest: request,
			});

			// Extract and return the structured response
			return apiResponse;
		} catch (error: unknown) {
			handleApiError(error);
		}
	}

	/**
	 * Generate a cryptographically secure 32-byte encryption key
	 *
	 * Creates a random 32-byte (256-bit) key suitable for index encryption.
	 * Each key is unique and provides strong security for your vector data.
	 *
	 * @returns Uint8Array containing 32 cryptographically secure random bytes
	 */
	generateKey(): Uint8Array {
		// Generate 32 bytes of cryptographically secure random data
		// Uses Node.js crypto.randomBytes() which leverages OS entropy sources
		return new Uint8Array(randomBytes(32));
	}

	/**
	 * Static method to generate a cryptographically secure 32-byte encryption key
	 *
	 * Creates a random 32-byte (256-bit) key suitable for index encryption.
	 * Each key is unique and provides strong security for your vector data.
	 *
	 * @returns Uint8Array containing 32 cryptographically secure random bytes
	 */
	static generateKey(): Uint8Array {
		// Generate 32 bytes of cryptographically secure random data
		// Uses Node.js crypto.randomBytes() which leverages OS entropy sources
		return new Uint8Array(randomBytes(32));
	}

	/**
	 * Load and connect to an existing encrypted index
	 *
	 * Establishes a connection to a previously created index using its name and
	 * (optionally) its encryption key. For fully-KMS-managed indexes the service
	 * resolves the KEK from its own cache, so `indexKey` is optional. For legacy
	 * (SDK-managed) indexes and `provider: none` KMS slots, `indexKey` is required.
	 *
	 * @param indexName Name of the existing index to load
	 * @param indexKey 32-byte encryption key (omit for fully-KMS-managed indexes)
	 * @returns Promise resolving to EncryptedIndex instance ready for vector operations
	 * @throws Error if index doesn't exist, key is incorrect, or connection fails
	 */
	async loadIndex({
		indexName,
		indexKey,
	}: {
		indexName: string;
		indexKey?: Uint8Array;
	}): Promise<EncryptedIndex> {
		// Validate the key only when present (KMS-backed indexes supply none).
		this.validateKeyLength(indexKey);
		try {
			// Validate that the index exists and the key is correct
			const response = await this.describeIndex(indexName, indexKey);

			const loadedIndex: EncryptedIndex = new EncryptedIndex(
				response.indexName,
				indexKey,
				this.api,
			);

			return loadedIndex;
		} catch (error: unknown) {
			// Enhance error context with operation details
			handleApiError(error);
		}
	}

	/**
	 * Check the health of the server
	 * @returns Promise with the health status
	 */
	async getHealth(): Promise<HealthResponse> {
		try {
			const response = await this.api.healthCheckV1HealthGet();
			return response as HealthResponse;
		} catch (error: unknown) {
			handleApiError(error);
		}
	}
}
