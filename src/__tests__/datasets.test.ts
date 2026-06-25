import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gzipSync } from "node:zlib";
import {
	DEFAULT_SAMPLE_DATASET,
	loadSampleDataset,
	type SampleDataset,
} from "../datasets";

/**
 * Unit tests for the sample dataset loader.
 *
 * These are fully offline: `fetch` is mocked and the dataset is cached to a
 * throwaway temp directory, so no S3 access or running service is required.
 */

const FAKE_DATASET: SampleDataset = {
	name: "quickstart-75k",
	version: 1,
	description: "test fixture",
	dimension: 3,
	metric: "euclidean",
	count: 2,
	items: [
		{ id: "item_0", vector: [1, 2, 3], metadata: { number: 0, string: "a" } },
		{ id: "item_1", vector: [4, 5, 6], metadata: { number: 1, string: "b" } },
	],
	sampleQueries: [[1, 2, 3]],
	exampleFilters: [
		{ name: "eq", filter: { string: "a" }, demonstrates: "equality" },
	],
};

function gzipResponse(dataset: SampleDataset): Response {
	const gz = gzipSync(Buffer.from(JSON.stringify(dataset)));
	return {
		ok: true,
		status: 200,
		statusText: "OK",
		arrayBuffer: async () =>
			gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength),
	} as unknown as Response;
}

describe("loadSampleDataset", () => {
	let cacheDir: string;
	let fetchSpy: jest.SpyInstance;

	beforeEach(() => {
		cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyborgdb-ds-"));
		fetchSpy = jest
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(gzipResponse(FAKE_DATASET));
	});

	afterEach(() => {
		fetchSpy.mockRestore();
		fs.rmSync(cacheDir, { recursive: true, force: true });
	});

	it("downloads, decompresses, and parses the dataset", async () => {
		const ds = await loadSampleDataset(DEFAULT_SAMPLE_DATASET, { cacheDir });
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(ds.count).toBe(2);
		expect(ds.dimension).toBe(3);
		expect(ds.items[0].id).toBe("item_0");
		expect(ds.items[0].vector).toEqual([1, 2, 3]);
		expect(ds.sampleQueries).toHaveLength(1);
		expect(ds.exampleFilters[0].filter).toEqual({ string: "a" });
	});

	it("serves the second call from the local cache (no re-download)", async () => {
		await loadSampleDataset(DEFAULT_SAMPLE_DATASET, { cacheDir });
		await loadSampleDataset(DEFAULT_SAMPLE_DATASET, { cacheDir });
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("re-downloads when forceDownload is set", async () => {
		await loadSampleDataset(DEFAULT_SAMPLE_DATASET, { cacheDir });
		await loadSampleDataset(DEFAULT_SAMPLE_DATASET, {
			cacheDir,
			forceDownload: true,
		});
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("throws on an unknown dataset name", async () => {
		await expect(
			loadSampleDataset("does-not-exist", { cacheDir }),
		).rejects.toThrow(/Unknown sample dataset/);
	});

	it("throws when the download fails", async () => {
		fetchSpy.mockResolvedValue({
			ok: false,
			status: 404,
			statusText: "Not Found",
		} as unknown as Response);
		await expect(
			loadSampleDataset(DEFAULT_SAMPLE_DATASET, { cacheDir }),
		).rejects.toThrow(/HTTP 404/);
	});
});
