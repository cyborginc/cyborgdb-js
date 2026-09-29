/**
 * Byte and encoding helpers built exclusively on web-standard APIs.
 *
 * The SDK has to import and run unchanged on Node, in browsers, and in Edge
 * runtimes (Vercel Edge, Cloudflare Workers). Edge runtimes provide no Node
 * builtins and no `Buffer`, so nothing in the SDK's module graph may reach for
 * either — see the `check:edge` script, which fails the build if one creeps
 * back in.
 *
 * Everything here is available on Node >= 18 (the SDK's engine floor), in
 * every modern browser, and on both Edge runtimes: `globalThis.crypto`,
 * `btoa`/`atob`, and `TextEncoder`/`TextDecoder`.
 */

/** Lookup table so hex encoding is a string concat per byte, not a format call. */
const HEX_BY_BYTE: string[] = Array.from({ length: 256 }, (_, i) =>
	i.toString(16).padStart(2, "0"),
);

/**
 * Web Crypto handle, or `undefined` where the host doesn't provide one.
 *
 * Read through a function rather than captured at module load: a host may
 * install the global after our module is evaluated, and capturing early would
 * pin `undefined` forever.
 */
function webCrypto(): Crypto | undefined {
	return (globalThis as { crypto?: Crypto }).crypto;
}

/**
 * Fill `length` bytes with cryptographically secure randomness.
 *
 * @throws If the host exposes no Web Crypto implementation.
 */
export function randomBytes(length: number): Uint8Array {
	const crypto = webCrypto();
	if (!crypto?.getRandomValues) {
		throw new Error(
			"No Web Crypto implementation available (globalThis.crypto.getRandomValues " +
				"is undefined), so a secure random key cannot be generated. Upgrade to " +
				"Node 18+ / a runtime with Web Crypto, or supply your own 32-byte key.",
		);
	}
	return crypto.getRandomValues(new Uint8Array(length));
}

/** Hex-encode bytes. Replaces `Buffer.from(bytes).toString("hex")`. */
export function toHex(bytes: Uint8Array): string {
	let out = "";
	for (let i = 0; i < bytes.length; i++) {
		out += HEX_BY_BYTE[bytes[i]];
	}
	return out;
}

/**
 * Chunk size for the `String.fromCharCode` fan-out in {@link toBase64}.
 * Applying the whole array at once blows the argument limit on large payloads.
 */
const FROM_CHAR_CODE_CHUNK = 0x8000;

/** Base64-encode bytes. Replaces `Buffer.from(bytes).toString("base64")`. */
export function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += FROM_CHAR_CODE_CHUNK) {
		binary += String.fromCharCode(
			...bytes.subarray(i, i + FROM_CHAR_CODE_CHUNK),
		);
	}
	return btoa(binary);
}

/** Decode a base64 string to bytes. Replaces `Buffer.from(b64, "base64")`. */
export function fromBase64(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/**
 * Coerce the binary shapes callers pass as `contents` into a `Uint8Array`,
 * matching what `Buffer.from(value)` used to accept (minus the string
 * overload, which callers handle separately because it is not binary).
 *
 * @throws If `value` is not a recognized binary shape.
 */
export function toBytes(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) {
		return value;
	}
	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value);
	}
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}
	if (Array.isArray(value)) {
		return Uint8Array.from(value as number[]);
	}
	throw new TypeError(
		`Expected binary contents (Uint8Array, ArrayBuffer, typed array, or number[]), got ${typeof value}`,
	);
}

/**
 * View a typed array's bytes without copying, honoring its offset and length
 * (`.buffer` alone can be larger than the view).
 */
export function viewBytes(view: ArrayBufferView): Uint8Array {
	return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/** UTF-8 decode bytes. Replaces `buffer.toString("utf8")`. */
export function decodeUtf8(bytes: Uint8Array): string {
	return new TextDecoder().decode(bytes);
}

/**
 * Hex-encoded SHA-256 of `data`, via Web Crypto.
 *
 * Async because `crypto.subtle.digest` is; Node's synchronous `createHash`
 * has no Edge equivalent.
 *
 * @throws If the host exposes no Web Crypto `subtle` implementation.
 */
export async function sha256Hex(data: Uint8Array): Promise<string> {
	const crypto = webCrypto();
	if (!crypto?.subtle) {
		throw new Error(
			"No Web Crypto implementation available (globalThis.crypto.subtle is " +
				"undefined), so the dataset integrity digest cannot be computed.",
		);
	}
	const digest = await crypto.subtle.digest(
		"SHA-256",
		data.buffer.slice(
			data.byteOffset,
			data.byteOffset + data.byteLength,
		) as ArrayBuffer,
	);
	return toHex(new Uint8Array(digest));
}
