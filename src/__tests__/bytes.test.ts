/**
 * Unit tests for the web-standard byte helpers that replaced `Buffer` across
 * the SDK. Node's `Buffer` is used here purely as the reference oracle — the
 * helpers themselves must never reach for it, which `npm run check:edge`
 * enforces against the real bundle.
 */

import { describe, expect, it } from "@jest/globals";
import {
	decodeUtf8,
	fromBase64,
	randomBytes,
	sha256Hex,
	toBase64,
	toBytes,
	toHex,
	viewBytes,
} from "../bytes";

describe("toHex", () => {
	it("matches Buffer's hex encoding", () => {
		const bytes = new Uint8Array([0x00, 0x01, 0x0f, 0x10, 0x7f, 0x80, 0xff]);
		expect(toHex(bytes)).toBe(Buffer.from(bytes).toString("hex"));
	});

	it("zero-pads bytes below 0x10", () => {
		expect(toHex(new Uint8Array([0, 5, 10]))).toBe("00050a");
	});

	it("encodes an empty array as an empty string", () => {
		expect(toHex(new Uint8Array(0))).toBe("");
	});

	it("matches Buffer over the full byte range", () => {
		const all = new Uint8Array(256).map((_, i) => i);
		expect(toHex(all)).toBe(Buffer.from(all).toString("hex"));
	});

	it("produces the 64-char hex a 32-byte index key serializes to", () => {
		const key = randomBytes(32);
		const hex = toHex(key);
		expect(hex).toHaveLength(64);
		expect(hex).toMatch(/^[0-9a-f]{64}$/);
		expect(Buffer.from(hex, "hex")).toEqual(Buffer.from(key));
	});
});

describe("toBase64 / fromBase64", () => {
	it("matches Buffer's base64 encoding", () => {
		const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
		expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
	});

	it("pads correctly for every input length mod 3", () => {
		for (const length of [0, 1, 2, 3, 4, 5]) {
			const bytes = new Uint8Array(length).map((_, i) => i * 37);
			expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
		}
	});

	it("handles payloads larger than the fromCharCode chunk size", () => {
		// 0x8000 is the chunk boundary in toBase64; cross it comfortably.
		const bytes = new Uint8Array(0x8000 * 2 + 17).map((_, i) => i % 256);
		expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
	});

	it("round-trips through fromBase64", () => {
		const bytes = new Uint8Array(1024).map((_, i) => (i * 7) % 256);
		expect(fromBase64(toBase64(bytes))).toEqual(bytes);
	});
});

describe("viewBytes", () => {
	it("encodes a Float32Array's bytes exactly as Buffer did", () => {
		const floats = Float32Array.from([1.5, -2.25, 0, 3.125]);
		expect(toBase64(viewBytes(floats))).toBe(
			Buffer.from(floats.buffer).toString("base64"),
		);
	});

	it("honors byteOffset so a windowed view doesn't leak its whole buffer", () => {
		const backing = new ArrayBuffer(64);
		const window = new Float32Array(backing, 16, 4);
		window.set([1, 2, 3, 4]);

		const bytes = viewBytes(window);
		expect(bytes.byteLength).toBe(16);
		expect(toBase64(bytes)).toBe(
			Buffer.from(backing, 16, 16).toString("base64"),
		);
	});
});

describe("toBytes", () => {
	it("passes a Uint8Array through unchanged", () => {
		const bytes = new Uint8Array([1, 2, 3]);
		expect(toBytes(bytes)).toBe(bytes);
	});

	it("accepts the shapes Buffer.from() used to accept", () => {
		const expected = new Uint8Array([1, 2, 3]);
		expect(toBytes(new Uint8Array([1, 2, 3]).buffer)).toEqual(expected);
		expect(toBytes([1, 2, 3])).toEqual(expected);
		expect(toBytes(new Int8Array([1, 2, 3]))).toEqual(expected);
		// A Buffer already is a Uint8Array, so it passes through uncopied;
		// compare contents rather than the exact subclass.
		expect(Array.from(toBytes(Buffer.from([1, 2, 3])))).toEqual([1, 2, 3]);
	});

	it("rejects shapes that are not binary", () => {
		expect(() => toBytes(42)).toThrow(TypeError);
		expect(() => toBytes({})).toThrow(TypeError);
		expect(() => toBytes(null)).toThrow(TypeError);
	});
});

describe("decodeUtf8", () => {
	it("matches Buffer's utf8 decoding, multi-byte characters included", () => {
		const text = 'héllo — "wörld" 🛡';
		const bytes = new TextEncoder().encode(text);
		expect(decodeUtf8(bytes)).toBe(text);
		expect(decodeUtf8(bytes)).toBe(Buffer.from(bytes).toString("utf8"));
	});
});

describe("randomBytes", () => {
	it("returns the requested number of bytes", () => {
		expect(randomBytes(32)).toHaveLength(32);
		expect(randomBytes(1)).toHaveLength(1);
	});

	it("returns a Uint8Array, the type the index key API expects", () => {
		const key = randomBytes(32);
		expect(key).toBeInstanceOf(Uint8Array);
		expect(key.constructor).toBe(Uint8Array);
	});

	it("does not repeat across calls", () => {
		const seen = new Set<string>();
		for (let i = 0; i < 50; i++) {
			seen.add(toHex(randomBytes(32)));
		}
		expect(seen.size).toBe(50);
	});

	it("is not all zeros (i.e. actually filled)", () => {
		expect(randomBytes(32).some((b) => b !== 0)).toBe(true);
	});
});

describe("sha256Hex", () => {
	it("matches the known digest of the empty input", async () => {
		await expect(sha256Hex(new Uint8Array(0))).resolves.toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
	});

	it("matches Node's crypto digest for arbitrary bytes", async () => {
		const { createHash } = await import("node:crypto");
		const bytes = new Uint8Array(4096).map((_, i) => (i * 31) % 256);
		const expected = createHash("sha256").update(bytes).digest("hex");
		await expect(sha256Hex(bytes)).resolves.toBe(expected);
	});

	it("digests only the view, not the whole backing buffer", async () => {
		const { createHash } = await import("node:crypto");
		const backing = new Uint8Array(100).map((_, i) => i);
		const window = backing.subarray(10, 20);
		const expected = createHash("sha256").update(window).digest("hex");
		await expect(sha256Hex(window)).resolves.toBe(expected);
	});
});
