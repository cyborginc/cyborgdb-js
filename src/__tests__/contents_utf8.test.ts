/**
 * Contents are UTF-8 text over the service: upsert sends bytes as their UTF-8
 * text rather than base64, and rejects contents with no UTF-8 form before any
 * request is made. Runs offline against a fake API layer.
 */
import { describe, expect, it } from "@jest/globals";
import type { DefaultApi } from "../apis/DefaultApi";
import { EncryptedIndex } from "../encryptedIndex";
import { CyborgDBValidationError } from "../errors";

function recordingIndex() {
	const calls: { json: unknown[]; binary: unknown[] } = {
		json: [],
		binary: [],
	};
	const fakeApi = {
		upsertVectorsV1VectorsUpsertPost: async (args: unknown) => {
			calls.json.push(args);
			return { status: "success", message: "ok" };
		},
		upsertVectorsBinaryV1VectorsUpsertBinaryPost: async (args: unknown) => {
			calls.binary.push(args);
			return { status: "success", message: "ok" };
		},
	} as unknown as DefaultApi;
	return {
		index: new EncryptedIndex("idx", new Uint8Array(32), fakeApi),
		calls,
	};
}

function sentContents(call: unknown): unknown {
	return (call as { upsertRequest: { items: { contents?: unknown }[] } })
		.upsertRequest.items[0].contents;
}

describe("upsert sends contents as UTF-8 text", () => {
	it("sends bytes as their text, not base64", async () => {
		const { index, calls } = recordingIndex();
		await index.upsert({
			items: [
				{
					id: "a",
					vector: [1, 0],
					contents: new TextEncoder().encode("alpha"),
				},
			],
		});
		expect(sentContents(calls.json[0])).toBe("alpha");
	});

	it("keeps multi-byte text and a leading BOM", async () => {
		const { index, calls } = recordingIndex();
		const text = "\ufeffcafé 日本 😀";
		await index.upsert({
			items: [
				{ id: "a", vector: [1, 0], contents: new TextEncoder().encode(text) },
			],
		});
		expect(sentContents(calls.json[0])).toBe(text);
	});

	it("passes well-formed strings through unchanged", async () => {
		const { index, calls } = recordingIndex();
		await index.upsert({
			items: [{ id: "a", vector: [1, 0], contents: "hello 😀" }],
		});
		expect(sentContents(calls.json[0])).toBe("hello 😀");
	});
});

describe("upsert rejects contents that are not valid UTF-8", () => {
	const cases: [string, Parameters<EncryptedIndex["upsert"]>[0]][] = [
		[
			"bytes",
			{
				items: [
					{
						id: "a",
						vector: [1, 0],
						contents: new Uint8Array([0x61, 0xff, 0x62]),
					},
				],
			},
		],
		[
			"a string with a lone surrogate",
			{ items: [{ id: "a", vector: [1, 0], contents: "a\udcffb" }] },
		],
		[
			"binary path with a lone surrogate",
			{ ids: ["a"], vectors: new Float32Array([1, 0]), contents: ["a\ud800b"] },
		],
	];

	it.each(cases)("%s", async (_name, args) => {
		const { index, calls } = recordingIndex();
		const err = await index.upsert(args).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(CyborgDBValidationError);
		expect((err as Error).message).toContain("valid UTF-8");
		expect((err as Error).message).toContain('id: "a"');
		expect(calls.json).toHaveLength(0);
		expect(calls.binary).toHaveLength(0);
	});
});
