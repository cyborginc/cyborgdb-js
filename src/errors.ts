/**
 * Shared API error handling for the CyborgDB SDK.
 *
 * `handleApiError` normalizes the various error shapes emitted by the
 * typescript-fetch generator (response/body/cause/code) into a single thrown
 * `Error`. Used by both the `CyborgDB` client and `EncryptedIndex` so the two
 * don't carry divergent copies of this logic.
 */
import type { ErrorResponseModel, HTTPValidationError } from "./models";

// Opt-in verbose diagnostics. Off by default so the SDK doesn't spam the host
// app's console on every failure — the thrown Error already carries the
// message. Enable with CYBORGDB_DEBUG=1 (or "true"). Guarded for browser
// builds where `process` is undefined.
const DEBUG =
	typeof process !== "undefined" &&
	(process.env?.CYBORGDB_DEBUG === "1" ||
		process.env?.CYBORGDB_DEBUG === "true");

function debugLog(...args: unknown[]): void {
	if (DEBUG) {
		console.error(...args);
	}
}

// --- Type guards for the assorted error shapes ----------------------------

const hasResponse = (
	err: unknown,
): err is {
	response: {
		statusCode?: number;
		status?: number;
		headers?: unknown;
		body?: unknown;
		data?: unknown;
	};
} => {
	return typeof err === "object" && err !== null && "response" in err;
};

const hasBody = (err: unknown): err is { body: unknown } => {
	return typeof err === "object" && err !== null && "body" in err;
};

const hasMessage = (err: unknown): err is { message: string } => {
	return (
		typeof err === "object" &&
		err !== null &&
		"message" in err &&
		typeof (err as { message: unknown }).message === "string"
	);
};

const hasCause = (err: unknown): err is { cause: unknown } => {
	return typeof err === "object" && err !== null && "cause" in err;
};

const hasCode = (err: unknown): err is { code: string } => {
	return typeof err === "object" && err !== null && "code" in err;
};

const hasStack = (err: unknown): err is { stack: string } => {
	return typeof err === "object" && err !== null && "stack" in err;
};

// --- Typed error classes --------------------------------------------------

/** Context captured on every typed error. */
export interface CyborgDBErrorContext {
	/** HTTP status, or null for transport failures and pre-flight validation. */
	statusCode?: number | null;
	/** Service correlation id, or null when the service did not supply one. */
	requestId?: string | null;
	/** The service's own message, or null when there was no response. */
	detail?: string | null;
	/** Retry-After in seconds, or null when absent. */
	retryAfter?: number | null;
	/** Index this call targeted, when the call site knows it. */
	indexName?: string | null;
	/** The originating error. */
	cause?: unknown;
}

/**
 * Base class for every error this SDK throws. Catch it to handle any CyborgDB
 * failure; catch a subclass to handle one kind.
 */
export class CyborgDBError extends Error {
	readonly statusCode: number | null;
	readonly requestId: string | null;
	readonly detail: string | null;
	readonly retryAfter: number | null;
	readonly indexName: string | null;
	/**
	 * Whether backing off and retrying can succeed. Fixed per error type —
	 * retry loops branch on this rather than re-deriving a status table.
	 */
	readonly retryable: boolean = false;

	constructor(message: string, context: CyborgDBErrorContext = {}) {
		super(
			message,
			context.cause !== undefined ? { cause: context.cause } : undefined,
		);
		this.name = new.target.name;
		this.statusCode = context.statusCode ?? null;
		this.requestId = context.requestId ?? null;
		this.detail = context.detail ?? null;
		this.retryAfter = context.retryAfter ?? null;
		this.indexName = context.indexName ?? null;
	}
}

/**
 * HTTP 400 and 422, and arguments this SDK rejects before sending the request
 * (including an unusable `baseUrl`). `statusCode` is null when caught
 * pre-flight.
 */
export class CyborgDBValidationError extends CyborgDBError {
	readonly retryable = false;
}

/** HTTP 401 and 403. Check the API key and its permissions. */
export class CyborgDBAuthenticationError extends CyborgDBError {
	readonly retryable = false;
}

/** HTTP 404 — the collection or item does not exist. */
export class CyborgDBNotFoundError extends CyborgDBError {
	readonly retryable = false;
}

/**
 * HTTP 409 — a state conflict, such as training while training is already in
 * progress. Poll for the terminal state; a backoff loop must not retry a 409.
 */
export class CyborgDBConflictError extends CyborgDBError {
	readonly retryable = false;
}

/**
 * HTTP 429. Honor `retryAfter` when set.
 *
 * The service does not rate-limit yet (cyborgdb-core#2386); this type exists so
 * callers can write the handler once.
 */
export class CyborgDBRateLimitError extends CyborgDBError {
	readonly retryable = true;
}

/** Any 5xx. Not "ServiceUnavailable": a 500 is a server bug, not unavailability. */
export class CyborgDBServiceError extends CyborgDBError {
	readonly retryable = true;
}

/**
 * No HTTP response reached the client — DNS failure, connection refused, TLS
 * failure, or timeout. `statusCode` is null.
 *
 * Timeouts land here too: a timeout and a refused connection have the same
 * caller action, and the difference is diagnostic — read `detail`.
 */
export class CyborgDBTransportError extends CyborgDBError {
	readonly retryable = true;
}

/**
 * Build the typed error for an HTTP status. Returns undefined for statuses the
 * taxonomy does not name, so those keep their existing untyped behavior.
 */
function errorForStatus(
	status: number,
	message: string,
	context: CyborgDBErrorContext,
): CyborgDBError | undefined {
	if (status === 401 || status === 403)
		return new CyborgDBAuthenticationError(message, context);
	if (status === 404) return new CyborgDBNotFoundError(message, context);
	if (status === 409) return new CyborgDBConflictError(message, context);
	if (status === 429) return new CyborgDBRateLimitError(message, context);
	if (status === 400 || status === 422)
		return new CyborgDBValidationError(message, context);
	if (status >= 500) return new CyborgDBServiceError(message, context);
	return undefined;
}

/** Read one header across the several shapes the generated client hands back. */
function headerValue(headers: unknown, name: string): string | null {
	if (!headers || typeof headers !== "object") return null;
	const get = (headers as { get?: (k: string) => string | null }).get;
	if (typeof get === "function") {
		return get.call(headers, name) ?? null;
	}
	const lower = name.toLowerCase();
	for (const [key, value] of Object.entries(
		headers as Record<string, unknown>,
	)) {
		if (key.toLowerCase() === lower && typeof value === "string") return value;
	}
	return null;
}

/** True when nothing answered: no HTTP status exists to key off. */
function isNetworkFailure(error: unknown): boolean {
	if (hasResponse(error)) return false;
	if (hasCode(error)) {
		return [
			"ECONNREFUSED",
			"ENOTFOUND",
			"ETIMEDOUT",
			"ECONNRESET",
			"EAI_AGAIN",
			"EPROTO",
			"CERT_HAS_EXPIRED",
		].includes((error as { code: string }).code);
	}
	return (
		error instanceof TypeError ||
		(hasMessage(error) && error.message === "fetch failed")
	);
}

/**
 * Normalize an error from the generated API client and throw the typed error
 * the taxonomy names for its status. Never returns.
 *
 * Statuses the taxonomy does not name keep their previous untyped `Error`, so
 * this is additive for those paths.
 */
export function handleApiError(
	error: unknown,
	context: { indexName?: string } = {},
): never {
	debugLog("Full error object:", JSON.stringify(error, null, 2));

	if (hasResponse(error)) {
		debugLog(
			"HTTP Status Code:",
			error.response.statusCode || error.response.status,
		);
		debugLog(
			"Response Headers:",
			JSON.stringify(error.response.headers, null, 2),
		);
		debugLog(
			"Response Body:",
			hasBody(error) ? error.body : error.response.body || error.response.data,
		);
	} else if (hasBody(error)) {
		debugLog("Error Body:", error.body);
	} else {
		debugLog("No response from server");
		if (hasMessage(error)) {
			debugLog("Error message:", error.message);
		}
		if (hasCause(error)) {
			debugLog("Error cause:", error.cause);
			if (typeof error.cause === "object" && error.cause !== null) {
				debugLog("Cause details:", JSON.stringify(error.cause, null, 2));
			}
		}
		if (hasCode(error)) {
			debugLog("Error code:", error.code);
		}
		if (hasStack(error)) {
			debugLog("Error stack trace:", error.stack);
		}
	}

	// Try to extract error details from different possible locations.
	// `ResponseError` from the generated runtime carries the raw fetch
	// `Response`, whose `.body` is a `ReadableStream`; the client-side fetch
	// wrapper in `CyborgDB`'s constructor pre-reads non-2xx bodies onto a
	// `parsedBody` property so we can recover the server's `detail` here.
	const parsedBody = hasResponse(error)
		? (error.response as { parsedBody?: unknown }).parsedBody
		: undefined;
	let errorBody: unknown = hasBody(error)
		? error.body
		: parsedBody !== undefined
			? parsedBody
			: hasResponse(error)
				? error.response.body || error.response.data
				: undefined;
	if (typeof errorBody === "string") {
		try {
			errorBody = JSON.parse(errorBody);
		} catch {
			// Keep as string if not valid JSON
		}
	}

	const headers = hasResponse(error) ? error.response.headers : undefined;
	const retryAfterRaw = headerValue(headers, "Retry-After");
	const retryAfter =
		retryAfterRaw !== null &&
		retryAfterRaw !== "" &&
		!Number.isNaN(Number(retryAfterRaw))
			? Number(retryAfterRaw)
			: null;
	const status = hasResponse(error)
		? (error.response.statusCode ?? error.response.status ?? null)
		: null;

	const detail = detailOf(errorBody);
	const base = {
		statusCode: status,
		requestId: headerValue(headers, "X-Request-Id"),
		detail,
		retryAfter,
		indexName: context.indexName ?? null,
		cause: error,
	};

	// Nothing answered: no status exists to key off.
	if (status === null && isNetworkFailure(error)) {
		const causeMsg =
			hasMessage(error) && error.message === "fetch failed" && hasCause(error)
				? hasMessage(error.cause)
					? error.cause.message
					: String(error.cause)
				: hasMessage(error)
					? error.message
					: "unknown transport failure";
		throw new CyborgDBTransportError(`Network request failed: ${causeMsg}`, {
			...base,
			detail: causeMsg,
		});
	}

	// A 422 from FastAPI carries an array `detail`; keep the original wording.
	if (
		typeof errorBody === "object" &&
		errorBody !== null &&
		"detail" in errorBody &&
		Array.isArray((errorBody as { detail: unknown }).detail)
	) {
		const err = errorBody as HTTPValidationError;
		const message = `Validation failed: ${JSON.stringify(err.detail)}`;
		throw (
			errorForStatus(status ?? 422, message, {
				...base,
				detail: JSON.stringify(err.detail),
			}) ?? new CyborgDBValidationError(message, base)
		);
	}

	if (detail !== null && status !== null) {
		const message = `${status} - ${detail}`;
		const typed = errorForStatus(status, message, base);
		if (typed) throw typed;
		throw new Error(message);
	}

	let errorMessage = hasMessage(error) ? error.message : "Unknown error";
	if (hasCode(error)) {
		errorMessage = `${errorMessage} (code: ${error.code})`;
	}
	const message = `HTTP error ${status ?? "Unknown"}: ${errorMessage}`;
	if (status !== null) {
		const typed = errorForStatus(status, message, base);
		if (typed) throw typed;
	}
	throw new Error(message);
}

/** Pull the service's own message out of a parsed error body. */
function detailOf(errorBody: unknown): string | null {
	if (typeof errorBody !== "object" || errorBody === null) return null;
	if (!("detail" in errorBody)) return null;
	const value = (errorBody as ErrorResponseModel).detail;
	if (typeof value === "string") return value;
	if (value === undefined || value === null) return null;
	return JSON.stringify(value);
}

// --- extractErrorDetail (used to detect "index does not exist" on delete) --

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function hasResponseProperty(err: unknown): err is { response: unknown } {
	return isObject(err) && "response" in err;
}

function hasBodyProperty(response: unknown): response is { body: unknown } {
	return isObject(response) && "body" in response;
}

function hasDetailString(body: unknown): body is { detail: string } {
	return isObject(body) && "detail" in body && typeof body.detail === "string";
}

/**
 * Safely extract a `detail` string from a nested error structure
 * (`err.response.body.detail`). Returns undefined when absent.
 */
export function extractErrorDetail(err: unknown): string | undefined {
	if (!hasResponseProperty(err)) {
		return undefined;
	}
	if (!hasBodyProperty(err.response)) {
		return undefined;
	}
	if (!hasDetailString(err.response.body)) {
		return undefined;
	}
	return err.response.body.detail;
}
