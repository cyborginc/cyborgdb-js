import type { EncryptedIndex, QueryResultItem } from "../index";
import type { Results } from "../models/Results";

/** Extract flat array of QueryResultItem from query response results. */
export function flattenResults(
	results: Results | QueryResultItem[] | QueryResultItem[][],
): QueryResultItem[] {
	if (!results) return [];
	if (
		Array.isArray(results) &&
		results.length > 0 &&
		Array.isArray(results[0])
	) {
		return (results as QueryResultItem[][]).flat();
	}
	return results as QueryResultItem[];
}

/**
 * Upserts become visible asynchronously. A fixed sleep is the worst of both
 * worlds — flaky on a loaded machine, wasted time on an idle one — so poll for
 * the condition and fail with a useful message if it never arrives.
 *
 * Mirrors py tests/helpers.py.
 */
const DEFAULT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 200;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Block until every id in `expected` is visible to queryMetadata. */
export async function waitForIds(
	index: EncryptedIndex,
	expected: string[],
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
	const want = new Set(expected);
	const deadline = Date.now() + timeoutMs;
	let seen = new Set<string>();
	while (Date.now() < deadline) {
		try {
			seen = new Set((await index.queryMetadata()).map((r) => r.id));
			if ([...want].every((id) => seen.has(id))) return;
		} catch {
			// The index may not be queryable for a moment after creation.
		}
		await delay(POLL_INTERVAL_MS);
	}
	const missing = [...want].filter((id) => !seen.has(id)).sort();
	throw new Error(
		`upserted ids still not visible after ${timeoutMs}ms; missing ${missing.join(", ")}`,
	);
}

/**
 * Block until `predicate` holds. For conditions neither id helper expresses —
 * a rewritten field becoming searchable, say. `description` is what the failure
 * message says was being waited for.
 */
export async function waitFor(
	predicate: () => Promise<boolean>,
	description: string,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await delay(POLL_INTERVAL_MS);
	}
	throw new Error(`timed out after ${timeoutMs}ms waiting for: ${description}`);
}

/** Block until none of `gone` are visible — the delete-side counterpart. */
export async function waitUntilGone(
	index: EncryptedIndex,
	gone: string[],
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let remaining: string[] = gone;
	while (Date.now() < deadline) {
		const ids = new Set((await index.queryMetadata()).map((r) => r.id));
		remaining = gone.filter((id) => ids.has(id));
		if (remaining.length === 0) return;
		await delay(POLL_INTERVAL_MS);
	}
	throw new Error(
		`deleted ids still visible after ${timeoutMs}ms: ${remaining.sort().join(", ")}`,
	);
}
