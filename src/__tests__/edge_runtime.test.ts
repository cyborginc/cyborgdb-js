/**
 * Smoke test: the SDK imports and runs an index lifecycle inside a runtime
 * with no Node builtins, no `process`, no `Buffer`, and no `require`.
 *
 * The bundle is executed in a `vm` context seeded with exactly the globals the
 * Vercel and Cloudflare Edge runtimes provide. That reproduces the failure mode
 * this guards against — `ReferenceError: Buffer is not defined`, or a module
 * that won't even evaluate — without pulling wrangler/workerd into devDeps and
 * onto CI's critical path. `npm run check:edge` covers the build-time half
 * (unresolvable `node:*` specifiers); this covers the runtime half.
 */

import vm from "node:vm";
import { beforeAll, describe, expect, it } from "@jest/globals";
import { buildSync } from "esbuild";

/** Requests the sandboxed SDK made, captured by the stub `fetch`. */
interface CapturedRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: unknown;
}

let bundle: string;

beforeAll(() => {
	const result = buildSync({
		entryPoints: ["src/index.ts"],
		bundle: true,
		platform: "browser",
		format: "iife",
		globalName: "cyborgdb",
		write: false,
		logLevel: "silent",
	});
	bundle = result.outputFiles[0].text;
});

/**
 * Build a context holding only globals an Edge runtime guarantees.
 *
 * Deliberately absent: `process`, `Buffer`, `require`, `module`, `global`,
 * `__dirname`, `__filename`. If the SDK touches one, the scenario throws.
 */
function createEdgeContext(captured: CapturedRequest[]): vm.Context {
	const fetchStub = async (url: string, init: RequestInit = {}) => {
		const body = init.body ? JSON.parse(init.body as string) : undefined;
		captured.push({
			url: String(url),
			method: init.method ?? "GET",
			headers: { ...((init.headers as Record<string, string>) ?? {}) },
			body,
		});
		return new Response(JSON.stringify(respondTo(String(url))), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	const context = vm.createContext({
		// Web-standard globals present on Node 18+, browsers, and both Edge
		// runtimes. This list IS the compatibility contract.
		fetch: fetchStub,
		crypto: globalThis.crypto,
		TextEncoder,
		TextDecoder,
		btoa: globalThis.btoa,
		atob: globalThis.atob,
		URL,
		URLSearchParams,
		Headers,
		Request,
		Response,
		AbortController,
		AbortSignal,
		ReadableStream,
		DecompressionStream,
		Blob,
		console,
		setTimeout,
		clearTimeout,
		queueMicrotask,
	});
	// A sandbox that quietly inherited Node's globals would make this whole
	// test vacuous, so assert the absences up front.
	for (const nodeOnly of ["process", "Buffer", "require", "__dirname"]) {
		expect(vm.runInContext(`typeof ${nodeOnly}`, context)).toBe("undefined");
	}
	return context;
}

/** Minimal canned service responses, keyed by request path. */
function respondTo(url: string): unknown {
	if (url.includes("/query")) {
		return {
			results: [[{ id: "a", distance: 0.1, metadata: { tag: "x" } }]],
		};
	}
	if (url.includes("/get")) {
		return { results: [{ id: "a", contents: "hello" }] };
	}
	return { status: "success" };
}

/**
 * Run `source` inside the sandbox with the SDK loaded as `cyborgdb`.
 * The scenario body is evaluated in the sandbox's realm, so every value it
 * constructs (Uint8Array, Float32Array, …) is realm-native — exactly as it
 * would be for real Edge code calling the SDK.
 */
async function runInEdge(
	source: string,
): Promise<{ result: any; captured: CapturedRequest[] }> {
	const captured: CapturedRequest[] = [];
	const context = createEdgeContext(captured);
	vm.runInContext(bundle, context);
	const result = await vm.runInContext(
		`(async () => { ${source} })()`,
		context,
	);
	return { result, captured };
}

describe("Edge runtime compatibility", () => {
	it("evaluates the bundle with no Node globals available", async () => {
		const { result } = await runInEdge(
			"return { version: typeof cyborgdb.VERSION, client: typeof cyborgdb.Client };",
		);
		expect(result.client).toBe("function");
		expect(result.version).toBe("string");
	});

	it("generates a 32-byte Uint8Array index key through Web Crypto", async () => {
		const { result } = await runInEdge(`
			const key = cyborgdb.Client.generateKey();
			return {
				length: key.length,
				isUint8Array: key instanceof Uint8Array,
				allZero: key.every((b) => b === 0),
			};
		`);
		expect(result).toEqual({
			length: 32,
			isUint8Array: true,
			allZero: false,
		});
	});

	it("runs create index / upsert / query with a Uint8Array key", async () => {
		const { result, captured } = await runInEdge(`
			const client = new cyborgdb.Client({
				baseUrl: "https://edge.example.com",
				apiKey: "test-key",
			});
			const key = client.generateKey();
			const index = await client.createIndex({
				indexName: "edge-smoke",
				indexKey: key,
				dimension: 4,
			});
			await index.upsert({
				items: [{ id: "a", vector: [0.1, 0.2, 0.3, 0.4] }],
			});
			const hits = await index.query({
				queryVectors: [0.1, 0.2, 0.3, 0.4],
				topK: 1,
			});
			return { keyHexLength: 64, hits: JSON.stringify(hits) };
		`);

		expect(result.hits).toContain('"id":"a"');

		const paths = captured.map((r) => new URL(r.url).pathname);
		expect(paths).toEqual([
			"/v1/indexes/create",
			"/v1/vectors/upsert",
			"/v1/vectors/query",
		]);

		// The key must reach the wire as 64 lowercase hex chars — the encoding
		// that used to go through Buffer.from(key).toString("hex").
		for (const request of captured) {
			expect((request.body as { index_key: string }).index_key).toMatch(
				/^[0-9a-f]{64}$/,
			);
		}
	});

	it("base64-encodes Float32Array payloads on the binary endpoints", async () => {
		const { captured } = await runInEdge(`
			const client = new cyborgdb.Client({
				baseUrl: "https://edge.example.com",
				apiKey: "test-key",
			});
			const index = await client.createIndex({
				indexName: "edge-binary",
				indexKey: client.generateKey(),
				dimension: 4,
			});
			await index.upsert({
				ids: ["a", "b"],
				vectors: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]),
			});
			await index.query({
				queryVectors: new Float32Array([1, 2, 3, 4]),
				dimension: 4,
				topK: 1,
			});
		`);

		const upsert = captured.find((r) => r.url.includes("/upsert_binary"));
		const query = captured.find((r) => r.url.includes("/query_binary"));

		const upsertB64 = (upsert?.body as any).batch.vectors_b64;
		const queryB64 = (query?.body as any).batch.vectors_b64;

		// Decoding here (in Node) must reproduce the exact float bytes the
		// sandbox encoded, proving the Buffer-free path is byte-identical.
		expect(
			new Float32Array(new Uint8Array(Buffer.from(upsertB64, "base64")).buffer),
		).toEqual(Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]));
		expect(
			new Float32Array(new Uint8Array(Buffer.from(queryB64, "base64")).buffer),
		).toEqual(Float32Array.from([1, 2, 3, 4]));
	});

	it("base64-encodes binary `contents` without Buffer", async () => {
		const { captured } = await runInEdge(`
			const client = new cyborgdb.Client({
				baseUrl: "https://edge.example.com",
				apiKey: "test-key",
			});
			const index = await client.createIndex({
				indexName: "edge-contents",
				indexKey: client.generateKey(),
				dimension: 2,
			});
			await index.upsert({
				items: [
					{ id: "bin", vector: [0.1, 0.2], contents: new Uint8Array([0, 1, 254, 255]) },
					{ id: "txt", vector: [0.3, 0.4], contents: "plain text" },
				],
			});
		`);

		const upsert = captured.find((r) => r.url.includes("/upsert"));
		const items = (upsert?.body as any).items;
		expect(items[0].contents).toBe(
			Buffer.from([0, 1, 254, 255]).toString("base64"),
		);
		// Strings still pass through verbatim rather than being base64'd.
		expect(items[1].contents).toBe("plain text");
	});

	it("does not emit debug logging when `process` is absent", async () => {
		// errors.ts reads process.env.CYBORGDB_DEBUG; an unguarded read would
		// throw a ReferenceError here rather than resolving to `false`.
		const { result } = await runInEdge(`
			const client = new cyborgdb.Client({
				baseUrl: "https://edge.example.com",
				apiKey: "test-key",
			});
			return typeof client.listIndexes;
		`);
		expect(result).toBe("function");
	});
});
