/**
 * Shared API error handling for the CyborgDB SDK.
 *
 * `handleApiError` normalizes the various error shapes emitted by the
 * typescript-fetch generator (response/body/cause/code) into a single thrown
 * `Error`. Used by both the `CyborgDB` client and `EncryptedIndex` so the two
 * don't carry divergent copies of this logic.
 */
import type { ErrorResponseModel, HTTPValidationError } from "./models";
import { isError } from "./types";

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

/**
 * Normalize an error from the generated API client and throw a descriptive
 * `Error`. Never returns.
 */
export function handleApiError(error: unknown): never {
	debugLog("Full error object:", JSON.stringify(error, null, 2));

	// Handle different error formats from typescript-fetch generator
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
		// Log additional error details if available
		if (hasCause(error)) {
			debugLog("Error cause:", error.cause);
			// Log more details about the cause if it's an object
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

	// Try to extract error details from different possible locations
	let errorBody: unknown = hasBody(error)
		? error.body
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

	if (errorBody) {
		try {
			if (typeof errorBody === "object" && "detail" in (errorBody as object)) {
				const detailValue = (errorBody as { detail: unknown }).detail;
				if (Array.isArray(detailValue)) {
					const err = errorBody as HTTPValidationError;
					throw new Error(`Validation failed: ${JSON.stringify(err.detail)}`);
				} else {
					const err = errorBody as ErrorResponseModel;
					const statusCode =
						err.statusCode ||
						(hasResponse(error)
							? error.response.statusCode || error.response.status
							: undefined) ||
						"Unknown status";
					throw new Error(`${statusCode} - ${err.detail}`);
				}
			}
		} catch (e) {
			if (isError(e) && e.message.includes("Validation failed")) {
				throw e;
			}
			throw new Error(`Unhandled error format: ${JSON.stringify(errorBody)}`, {
				cause: e,
			});
		}
	}

	// Provide more detailed error message for fetch failures
	const statusCode = hasResponse(error)
		? error.response.statusCode || error.response.status
		: "Unknown";
	let errorMessage = hasMessage(error) ? error.message : "Unknown error";

	// Enhance error message with additional context if available
	if (
		hasMessage(error) &&
		error.message === "fetch failed" &&
		hasCause(error)
	) {
		const causeMsg = hasMessage(error.cause)
			? error.cause.message
			: String(error.cause);
		errorMessage = `Network request failed: ${causeMsg}`;
	} else if (hasCode(error)) {
		errorMessage = `${errorMessage} (code: ${error.code})`;
	}

	throw new Error(`HTTP error ${statusCode}: ${errorMessage}`);
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
