import { optionalNodeBuiltin } from "./nodeInterop";

interface NodeIncomingMessage {
	statusCode?: number;
	statusMessage?: string;
	headers: Record<string, string | string[] | undefined>;
	on(event: "data", listener: (chunk: Uint8Array) => void): this;
	on(event: "end", listener: () => void): this;
	on(event: "error", listener: (error: Error) => void): this;
}

interface NodeClientRequest {
	on(event: "error", listener: (error: Error) => void): this;
	setTimeout(ms: number, listener: () => void): this;
	destroy(error: Error): void;
	end(body?: Uint8Array): void;
}

interface NodeRequestModule {
	request(
		url: string,
		options: {
			method: string;
			headers: Record<string, string>;
			agent?: unknown;
			signal?: AbortSignal;
		},
		callback: (res: NodeIncomingMessage) => void,
	): NodeClientRequest;
}

interface NodeHttps extends NodeRequestModule {
	Agent: new (opts: { rejectUnauthorized: boolean }) => unknown;
}

interface RawResponse {
	status: number;
	statusText: string;
	headers: Headers;
	body: Uint8Array<ArrayBuffer>;
}

/** Statuses the `Response` constructor refuses to pair with a body. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Redirect limit from the Fetch standard, which native fetch also applies. */
const MAX_REDIRECTS = 20;

/** Headers the Fetch standard drops when a redirect turns the request into a GET. */
const BODY_HEADERS = [
	"content-encoding",
	"content-language",
	"content-location",
	"content-type",
	"content-length",
];

/**
 * Node's native fetch (undici) waits up to 300 s for response headers and
 * between body chunks. One socket-inactivity timeout of the same length keeps
 * both paths alike.
 */
const DEFAULT_INACTIVITY_TIMEOUT_MS = 300_000;

/**
 * A `fetch` that skips TLS certificate verification, for Node only.
 *
 * Node's built-in fetch ignores `https.Agent` and accepts only an undici
 * dispatcher, which Node does not expose without the `undici` package. Rather
 * than take a runtime dependency, this sends the request with `node:https`
 * and rebuilds a standard `Response`. It buffers the whole body, which suits
 * the SDK's JSON API calls, and otherwise follows native fetch: redirects are
 * followed per the Fetch standard, and a request with no socket activity for
 * `inactivityTimeoutMs` fails.
 *
 * Failures reject with `TypeError("fetch failed")` carrying the socket error as
 * `cause`, matching native fetch so error mapping treats both the same.
 *
 * @returns `undefined` when `node:https` is unavailable.
 */
export async function createInsecureFetch({
	inactivityTimeoutMs = DEFAULT_INACTIVITY_TIMEOUT_MS,
}: {
	inactivityTimeoutMs?: number;
} = {}): Promise<typeof fetch | undefined> {
	const https = await optionalNodeBuiltin<NodeHttps>("https");
	if (!https) {
		return undefined;
	}
	const agent = new https.Agent({ rejectUnauthorized: false });
	let http: Promise<NodeRequestModule | undefined> | undefined;

	const moduleFor = async (url: URL): Promise<NodeRequestModule> => {
		if (url.protocol === "https:") return https;
		if (url.protocol === "http:") {
			http ??= optionalNodeBuiltin<NodeRequestModule>("http");
			const mod = await http;
			if (mod) return mod;
		}
		throw new TypeError("fetch failed", {
			cause: new Error(`unsupported protocol ${url.protocol}`),
		});
	};

	return async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init);
		let url = new URL(request.url);
		let method = request.method;
		const headers = new Headers(request.headers);
		let body = request.body
			? new Uint8Array(await request.arrayBuffer())
			: undefined;

		for (let redirects = 0; ; redirects++) {
			const mod = await moduleFor(url);
			const raw = await send(mod, url, {
				method,
				headers: Object.fromEntries(headers),
				agent: url.protocol === "https:" ? agent : undefined,
				signal: request.signal,
				body,
				inactivityTimeoutMs,
			});

			const location = raw.headers.get("location");
			if (
				!REDIRECT_STATUSES.has(raw.status) ||
				location === null ||
				request.redirect === "manual"
			) {
				return new Response(
					NULL_BODY_STATUSES.has(raw.status) ? null : raw.body,
					{
						status: raw.status,
						statusText: raw.statusText,
						headers: raw.headers,
					},
				);
			}
			if (request.redirect === "error" || redirects >= MAX_REDIRECTS) {
				throw new TypeError("fetch failed", {
					cause: new Error(
						request.redirect === "error"
							? `unexpected redirect to ${location}`
							: `more than ${MAX_REDIRECTS} redirects`,
					),
				});
			}

			const next = new URL(location, url);
			if (
				raw.status === 303
					? method !== "HEAD"
					: (raw.status === 301 || raw.status === 302) && method === "POST"
			) {
				method = "GET";
				body = undefined;
				for (const name of BODY_HEADERS) headers.delete(name);
			}
			if (next.origin !== url.origin) headers.delete("authorization");
			url = next;
		}
	};
}

function send(
	mod: NodeRequestModule,
	url: URL,
	options: {
		method: string;
		headers: Record<string, string>;
		agent: unknown;
		signal: AbortSignal;
		body: Uint8Array | undefined;
		inactivityTimeoutMs: number;
	},
): Promise<RawResponse> {
	return new Promise<RawResponse>((resolve, reject) => {
		const fail = (error: Error) =>
			reject(
				error.name === "AbortError"
					? error
					: new TypeError("fetch failed", { cause: error }),
			);

		const req = mod.request(
			url.href,
			{
				method: options.method,
				headers: options.headers,
				agent: options.agent,
				signal: options.signal,
			},
			(res) => {
				const chunks: Uint8Array[] = [];
				res.on("data", (chunk) => chunks.push(chunk));
				res.on("error", fail);
				res.on("end", () => {
					const headers = new Headers();
					for (const [name, value] of Object.entries(res.headers)) {
						for (const v of Array.isArray(value) ? value : [value]) {
							if (v !== undefined) headers.append(name, v);
						}
					}
					resolve({
						status: res.statusCode ?? 500,
						statusText: res.statusMessage ?? "",
						headers,
						body: concat(chunks),
					});
				});
			},
		);
		req.setTimeout(options.inactivityTimeoutMs, () => {
			req.destroy(
				Object.assign(
					new Error(
						`no response activity for ${options.inactivityTimeoutMs} ms`,
					),
					{ code: "ETIMEDOUT" },
				),
			);
		});
		req.on("error", fail);
		req.end(options.body);
	});
}

function concat(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}
