/**
 * cyborgdb-tests adapter for the cyborgdb JS SDK.
 *
 * Reads JSON-RPC requests on fd 3 and writes responses on fd 4 (see
 * cyborgdb-tests ADAPTERS.md); the ops themselves are in dispatch.ts. Loads the
 * built `cyborgdb` package by name, which resolves through package.json
 * `exports` to `dist/`, the code users install. Run `npm run build` first.
 * Node runs this file directly (type stripping, Node >= 22.18).
 *
 * CYBORGDB_TESTS_VARIANT picks the SDK path: json (default) or binary. The JS
 * client is already Promise-based, so there is no async variant.
 *
 * Run under the driver, from a cyborgdb-tests checkout:
 *   CYBORG_TEST_SDK_BASE_URL=http://localhost:8000 bin/cyborgdb-tests run \
 *     --adapter "node ../cyborgdb-js/tests/conformance/adapter.ts" \
 *     --env sdk --variant json
 */

import { createReadStream, fstatSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import {
	adapterError,
	CODE_PARSE,
	createAdapter,
	parseRequest,
	type Sdk,
} from "./dispatch.ts";

/** Serves requests from fd 3 until the driver closes it, one at a time. */
async function main(): Promise<void> {
	try {
		fstatSync(3);
		fstatSync(4);
	} catch {
		console.error(
			"adapter: fd 3/4 not open; run under the cyborgdb-tests driver",
		);
		process.exit(1);
	}
	// The CommonJS build: what Node users get from require().
	const cyborgdb: Sdk = createRequire(import.meta.url)("cyborgdb");
	let adapter: ReturnType<typeof createAdapter>;
	try {
		adapter = createAdapter(cyborgdb, {
			variant: process.env.CYBORGDB_TESTS_VARIANT || "json",
			env: process.env,
		});
	} catch (error) {
		console.error(`adapter: ${(error as Error).message}`);
		process.exit(1);
	}
	const lines = createInterface({
		input: createReadStream("", { fd: 3 }),
		crlfDelay: Number.POSITIVE_INFINITY,
	});
	for await (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) continue;
		let request: { id?: unknown; method?: unknown; params?: unknown };
		try {
			request = parseRequest(line) as typeof request;
		} catch (error) {
			const response = {
				jsonrpc: "2.0",
				id: null,
				error: { code: CODE_PARSE, message: (error as Error).message },
			};
			writeSync(4, `${JSON.stringify(response)}\n`);
			continue;
		}
		const response = { jsonrpc: "2.0", id: request?.id ?? null };
		try {
			Object.assign(response, await adapter.handle(request ?? {}));
		} catch (error) {
			Object.assign(response, adapterError(error)); // report it, keep serving
		}
		writeSync(4, `${JSON.stringify(response)}\n`);
	}
}

main();
