import { CyborgDBValidationError } from "./errors";

/**
 * Recursively replace JavaScript `Date` objects with integer epoch
 * milliseconds.
 *
 * The service contract stores datetimes as epoch milliseconds (metadata has no
 * native date type), and the Python SDK coerces `datetime` values the same way
 * (`coerce_datetimes`). Without this, `JSON.stringify` serializes a `Date` via
 * `toJSON()` as an ISO-8601 string, so the value is stored as a string and
 * range filters on it are rejected.
 *
 * Applied to upsert metadata and to filter operands before sending, so nested
 * filter objects (`$and` / `$or` / `$in`) are coerced transparently. `Date` is
 * timezone-less (epoch-based) in JS, so unlike Python there is no naive/aware
 * distinction to resolve. Strings, numbers, and other types pass through
 * unchanged; non-plain objects are left alone.
 */
export function coerceDatetimes(value: unknown): unknown {
	if (value instanceof Date) {
		const ms = value.getTime();
		if (Number.isNaN(ms)) {
			throw new CyborgDBValidationError(
				"Invalid Date (NaN timestamp) in metadata or filters",
			);
		}
		return ms;
	}
	if (Array.isArray(value)) {
		return value.map(coerceDatetimes);
	}
	if (isPlainObject(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, coerceDatetimes(v)]),
		);
	}
	return value;
}

// Only recurse into plain mappings (mirroring py, which recurses only
// dict/list); exotic objects pass through and serialize as they always did.
function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}
