/**
 * Date metadata coercion.
 *
 * The contract stores datetimes as epoch milliseconds; a JS `Date` must never
 * reach the wire as an ISO string. These tests run against a mocked fetch and
 * assert on the exact JSON the SDK sends, covering every path that carries
 * metadata or filters: upsert (json + binary) and query / queryBinary /
 * queryMetadata filters.
 */

import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it } from "@jest/globals";
import { DefaultApi } from "../apis/DefaultApi";
import { coerceDatetimes } from "../datetimes";
import { EncryptedIndex } from "../encryptedIndex";
import { CyborgDBValidationError } from "../errors";
import { Configuration } from "../runtime";

// The moments the conformance suite exercises: offset + sub-second precision.
const WHEN = new Date("2024-05-04T03:02:01.123+02:00");
const WHEN_MS = WHEN.getTime(); // 1714784521123 — already UTC epoch ms
const LATER = new Date("2025-01-01T00:00:00Z");

describe("coerceDatetimes", () => {
	it("converts a Date to integer epoch milliseconds", () => {
		expect(coerceDatetimes(WHEN)).toBe(WHEN_MS);
	});

	it("recurses through nested objects and arrays", () => {
		expect(
			coerceDatetimes({
				created: WHEN,
				tags: ["a", LATER],
				nested: { deep: { at: WHEN } },
				$and: [{ at: { $gte: WHEN } }, { at: { $lt: LATER } }],
			}),
		).toEqual({
			created: WHEN_MS,
			tags: ["a", LATER.getTime()],
			nested: { deep: { at: WHEN_MS } },
			$and: [{ at: { $gte: WHEN_MS } }, { at: { $lt: LATER.getTime() } }],
		});
	});

	it("passes primitives and non-plain objects through unchanged", () => {
		expect(coerceDatetimes("2024-05-04T01:02:01Z")).toBe(
			"2024-05-04T01:02:01Z",
		);
		expect(coerceDatetimes(42)).toBe(42);
		expect(coerceDatetimes(null)).toBeNull();
		const exotic = new Float32Array([1, 2]);
		expect(coerceDatetimes(exotic)).toBe(exotic);
	});

	it("does not mutate its input", () => {
		const input = { created: WHEN, nested: { at: WHEN } };
		coerceDatetimes(input);
		expect(input.created).toBeInstanceOf(Date);
		expect(input.nested.at).toBeInstanceOf(Date);
	});

	it("recognizes Dates and plain objects from another realm", () => {
		// instanceof and prototype identity both fail across realms; the checks
		// must be realm-independent or foreign Dates silently serialize as ISO.
		const foreign = runInNewContext(
			`({ created: new Date(${WHEN_MS}), nested: { at: new Date(${WHEN_MS}) } })`,
		);
		expect(coerceDatetimes(foreign)).toEqual({
			created: WHEN_MS,
			nested: { at: WHEN_MS },
		});
	});

	it("rejects an invalid Date", () => {
		expect(() => coerceDatetimes({ at: new Date(Number.NaN) })).toThrow(
			CyborgDBValidationError,
		);
	});
});

describe("Date coercion on the wire", () => {
	const sent: { url: string; body: any }[] = [];

	const fetchApi = (async (url: RequestInfo | URL, init?: RequestInit) => {
		sent.push({ url: String(url), body: JSON.parse(init?.body as string) });
		return new Response(
			JSON.stringify({ status: "success", results: [], message: "ok" }),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	}) as typeof fetch;

	const api = new DefaultApi(
		new Configuration({
			basePath: "http://localhost:8000",
			fetchApi,
			headers: { "Content-Type": "application/json" },
		}),
	);
	const index = new EncryptedIndex("test_index", new Uint8Array(32), api);

	const lastBody = () => sent[sent.length - 1].body;

	beforeEach(() => {
		sent.length = 0;
	});

	it("upsert (json) sends metadata Dates as epoch ms", async () => {
		await index.upsert({
			items: [
				{
					id: "a",
					vector: [0.1, 0.2],
					metadata: {
						created: WHEN,
						label: "keep-me",
						history: [WHEN, LATER],
						nested: { at: WHEN },
					},
				},
			],
		});

		const metadata = lastBody().items[0].metadata;
		expect(metadata.created).toBe(WHEN_MS);
		expect(metadata.label).toBe("keep-me");
		expect(metadata.history).toEqual([WHEN_MS, LATER.getTime()]);
		expect(metadata.nested).toEqual({ at: WHEN_MS });
	});

	it("upsert (ids + vectors) sends metadata Dates as epoch ms", async () => {
		await index.upsert({
			ids: ["a"],
			vectors: [[0.1, 0.2]],
			metadata: [{ created: WHEN }],
		});

		expect(lastBody().items[0].metadata.created).toBe(WHEN_MS);
	});

	it("upsert (binary) sends metadata Dates as epoch ms", async () => {
		await index.upsert({
			ids: ["a", "b"],
			vectors: new Float32Array([0.1, 0.2, 0.3, 0.4]),
			metadata: [{ created: WHEN }, null],
		});

		const { url, body } = sent[sent.length - 1];
		expect(url).toContain("upsert_binary");
		expect(body.batch.metadata).toEqual([{ created: WHEN_MS }, null]);
	});

	it("query (json) sends filter Dates as epoch ms", async () => {
		await index.query({
			queryVectors: [0.1, 0.2],
			filters: {
				created: { $gte: WHEN, $lt: LATER },
				stamp: WHEN,
				$or: [{ created: { $in: [WHEN, LATER] } }],
			},
		});

		expect(lastBody().filters).toEqual({
			created: { $gte: WHEN_MS, $lt: LATER.getTime() },
			stamp: WHEN_MS,
			$or: [{ created: { $in: [WHEN_MS, LATER.getTime()] } }],
		});
	});

	it("query (binary) sends filter Dates as epoch ms", async () => {
		await index.query({
			queryVectors: new Float32Array([0.1, 0.2]),
			dimension: 2,
			filters: { created: { $gt: WHEN } },
		});

		const { url, body } = sent[sent.length - 1];
		expect(url).toContain("query_binary");
		expect(body.filters).toEqual({ created: { $gt: WHEN_MS } });
	});

	it("queryMetadata sends filter Dates as epoch ms", async () => {
		await index.queryMetadata({ filters: { created: { $lte: WHEN } } });

		expect(lastBody().filters).toEqual({ created: { $lte: WHEN_MS } });
	});

	it("leaves ISO strings stored as strings (only real Dates convert)", async () => {
		const iso = WHEN.toISOString();
		await index.upsert({
			items: [{ id: "a", vector: [0.1, 0.2], metadata: { created: iso } }],
		});

		expect(lastBody().items[0].metadata.created).toBe(iso);
	});
});
