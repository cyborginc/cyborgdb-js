/**
 * Regression tests for EncryptedIndex.get() contents decoding.
 *
 * Bug: get() used to unconditionally run `Buffer.from(contents, "base64")` on
 * the value the service returns. In text-in mode upsert() sends string contents
 * verbatim (so the service can embed them), and the service stores/returns that
 * raw UTF-8 string — base64-decoding it produced garbage ("corrupted/unreadable"
 * text in downstream RAG). These tests pin the round-trip both ways and run
 * fully offline by mocking the API layer the index talks to.
 */
import { describe, expect, it } from "@jest/globals";
import type { DefaultApi } from "../apis/DefaultApi";
import { EncryptedIndex } from "../encryptedIndex";

// Build an EncryptedIndex whose API layer echoes a fixed `contents` wire value
// back from getVectorsV1VectorsGetPost — i.e. exactly what the service stores.
function indexReturningContents(wireContents: string): EncryptedIndex {
	const fakeApi = {
		getVectorsV1VectorsGetPost: async () => ({
			results: [{ id: "doc-1", contents: wireContents }],
		}),
	} as unknown as DefaultApi;
	return new EncryptedIndex("idx", new Uint8Array(32), fakeApi);
}

describe("EncryptedIndex.get() contents round-trip", () => {
	it("returns text contents verbatim (no base64 mangling)", async () => {
		// What the service stores for a text-in upsert: the raw markdown chunk.
		const text =
			'---\ntitle: "Upsert"\nmode: "wide"\n---\n\nAdds or updates vector ' +
			"embeddings in the index. If an item already exists at `id`, it is " +
			"overwritten.";
		const index = indexReturningContents(text);

		const [item] = await index.get({ ids: ["doc-1"], include: ["contents"] });

		expect(item.contents).toBe(text);
		// Guard against the specific regression: base64-decoding the text would
		// have produced different, shorter, garbled bytes.
		expect(item.contents).not.toBe(
			Buffer.from(text, "base64").toString("utf-8"),
		);
	});

	it("returns contents stored as base64 by older SDKs verbatim", async () => {
		// SDK versions before contents became UTF-8 text base64-encoded bytes; the
		// service stores that string, and get() must not try to decode it.
		const original = Buffer.from([0x00, 0xff, 0x10, 0x42, 0x7f, 0x80, 0xc3]);
		const wire = original.toString("base64");
		const index = indexReturningContents(wire);

		const [item] = await index.get({ ids: ["doc-1"], include: ["contents"] });

		// Returned verbatim as the base64 string; callers decode to recover bytes.
		expect(item.contents).toBe(wire);
		expect(Buffer.from(item.contents as string, "base64")).toEqual(original);
	});
});
