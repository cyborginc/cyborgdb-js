import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gzipSync } from "node:zlib";
import {
	DATASETS,
	DEFAULT_SAMPLE_DATASET,
	loadSampleDataset,
	type RawSampleDataset,
} from "../datasets";

/**
 * Unit tests for the sample dataset loader.
 *
 * These are fully offline: `fetch` is mocked and the dataset is cached to a
 * throwaway temp directory, so no S3 access or running service is required.
 *
 * The mocked payload is the *raw* hosted shape (no `items`/`sampleQueries`);
 * those convenience fields are rebuilt by the loader's hydrate step.
 */

const FAKE_RAW: RawSampleDataset = {
	name: "quickstart-75k",
	version: 1,
	description: "test fixture",
	dimension: 3,
	metric: "euclidean",
	count: 2,
	exampleFilters: [
		{ name: "eq", filter: { string: "a" }, demonstrates: "equality" },
	],
	ids: ["item_0", "item_1"],
	vectors: [
		[1, 2, 3],
		[4, 5, 6],
	],
	metadata: [
		{ number: 0, string: "a" },
		{ number: 1, string: "b" },
	],
	queries: [[1, 2, 3]],
	metadata_queries: [{ string: "a" }],
	metadata_query_names: ["eq string a"],
	untrained_neighbors: [[0]],
	trained_neighbors: [[0]],
	untrained_metadata_matches: [[1]],
	trained_metadata_matches: [[1]],
	untrained_metadata_neighbors: [[[0]]],
	trained_metadata_neighbors: [[[0]]],
	untrained_recall: 1.0,
	trained_recall: 0.94,
	num_untrained_vectors: 1,
	num_trained_vectors: 1,
};

function rawBytes(dataset: RawSampleDataset): Buffer {
	return Buffer.from(JSON.stringify(dataset));
}

function gzipResponse(dataset: RawSampleDataset): Response {
	const gz = gzipSync(rawBytes(dataset));
	return {
		ok: true,
		status: 200,
		statusText: "OK",
		arrayBuffer: async () =>
			gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength),
	} as unknown as Response;
}

/** SHA-256 of the decompressed fixture, matching what the loader verifies. */
const FAKE_SHA256 = createHash("sha256")
	.update(rawBytes(FAKE_RAW))
	.digest("hex");

describe("loadSampleDataset", () => {
	let cacheDir: string;
	let fetchSpy: jest.SpyInstance;
	let originalSha256: string;

	beforeEach(() => {
		cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyborgdb-ds-"));
		fetchSpy = jest
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(gzipResponse(FAKE_RAW));
		// Pin the catalog digest to the fixture so integrity verification passes.
		originalSha256 = DATASETS[DEFAULT_SAMPLE_DATASET].sha256;
		DATASETS[DEFAULT_SAMPLE_DATASET].sha256 = FAKE_SHA256;
	});

	afterEach(() => {
		fetchSpy.mockRestore();
		DATASETS[DEFAULT_SAMPLE_DATASET].sha256 = originalSha256;
		fs.rmSync(cacheDir, { recursive: true, force: true });
	});

	it("downloads, decompresses, and hydrates the dataset", async () => {
		const ds = await loadSampleDataset(DEFAULT_SAMPLE_DATASET, { cacheDir });
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(ds.count).toBe(2);
		expect(ds.dimension).toBe(3);
		// items are built from ids + vectors + metadata
		expect(ds.items).toHaveLength(2);
		expect(ds.items[0].id).toBe("item_0");
		expect(ds.items[0].vector).toEqual([1, 2, 3]);
		expect(ds.items[1].metadata).toEqual({ number: 1, string: "b" });
		// sampleQueries are the leading queries
		expect(ds.sampleQueries).toEqual([[1, 2, 3]]);
		expect(ds.exampleFilters[0].filter).toEqual({ string: "a" });
		// raw ground-truth fields pass through unchanged
		expect(ds.trained_recall).toBe(0.94);
		expect(ds.untrained_neighbors).toEqual([[0]]);
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

	it("throws when the downloaded payload fails the integrity check", async () => {
		DATASETS[DEFAULT_SAMPLE_DATASET].sha256 = "0".repeat(64);
		await expect(
			loadSampleDataset(DEFAULT_SAMPLE_DATASET, { cacheDir }),
		).rejects.toThrow(/Integrity check failed/);
	});

	it("re-downloads when the cached file fails the integrity check", async () => {
		await loadSampleDataset(DEFAULT_SAMPLE_DATASET, { cacheDir });
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		// Tamper with the cached file; the pinned digest no longer matches.
		const cacheFile = path.join(cacheDir, "quickstart-75k_v1_dataset.json");
		fs.writeFileSync(cacheFile, "tampered");
		await loadSampleDataset(DEFAULT_SAMPLE_DATASET, { cacheDir });
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});
});
