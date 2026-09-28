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
	end(body?: Uint8Array): void;
}

interface NodeHttps {
	Agent: new (opts: { rejectUnauthorized: boolean }) => unknown;
	request(
		url: string,
		options: {
			method: string;
			headers: Record<string, string>;
			agent: unknown;
			signal?: AbortSignal;
		},
		callback: (res: NodeIncomingMessage) => void,
	): NodeClientRequest;
}

/** Statuses the `Response` constructor refuses to pair with a body. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * A `fetch` that skips TLS certificate verification, for Node only.
 *
 * Node's built-in fetch ignores `https.Agent` and accepts only an undici
 * dispatcher, which Node does not expose without the `undici` package. Rather
 * than take a runtime dependency, this sends the request with `node:https`
 * and rebuilds a standard `Response`. It buffers the whole body and does not
 * follow redirects, which suits the SDK's JSON API calls.
 *
 * Failures reject with `TypeError("fetch failed")` carrying the socket error as
 * `cause`, matching native fetch so error mapping treats both the same.
 *
 * @returns `undefined` when `node:https` is unavailable.
 */
export async function createInsecureFetch(): Promise<typeof fetch | undefined> {
	const https = await optionalNodeBuiltin<NodeHttps>("https");
	if (!https) {
		return undefined;
	}
	const agent = new https.Agent({ rejectUnauthorized: false });

	return async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init);
		const body = request.body
			? new Uint8Array(await request.arrayBuffer())
			: undefined;

		return new Promise<Response>((resolve, reject) => {
			const req = https.request(
				request.url,
				{
					method: request.method,
					headers: Object.fromEntries(request.headers),
					agent,
					signal: request.signal,
				},
				(res) => {
					const chunks: Uint8Array[] = [];
					res.on("data", (chunk) => chunks.push(chunk));
					res.on("error", reject);
					res.on("end", () => {
						const headers = new Headers();
						for (const [name, value] of Object.entries(res.headers)) {
							for (const v of Array.isArray(value) ? value : [value]) {
								if (v !== undefined) headers.append(name, v);
							}
						}
						const status = res.statusCode ?? 500;
						resolve(
							new Response(
								NULL_BODY_STATUSES.has(status) ? null : concat(chunks),
								{ status, statusText: res.statusMessage ?? "", headers },
							),
						);
					});
				},
			);
			req.on("error", (error) => {
				reject(
					error.name === "AbortError"
						? error
						: new TypeError("fetch failed", { cause: error }),
				);
			});
			req.end(body);
		});
	};
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
