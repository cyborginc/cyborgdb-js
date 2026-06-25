/**
 * Sample dataset loader for CyborgDB.
 *
 * Fetches a small reference dataset hosted on S3 on demand and caches it
 * locally, so quickstart and test code can populate an index without bundling
 * data into the SDK. Hosting the dataset out-of-band keeps the SDK lean and
 * lets us iterate the dataset without cutting an SDK release.
 *
 * @example
 * ```typescript
 * import { Client, loadSampleDataset } from 'cyborgdb';
 *
 * const dataset = await loadSampleDataset();
 * const index = await client.createIndex({ indexName: 'demo', indexKey });
 * await index.upsert({ items: dataset.items });
 * ```
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gunzipSync } from "node:zlib";
import type { VectorItem } from "./models";

/**
 * Base URL for hosted sample datasets (public-read S3 bucket).
 *
 * Datasets live at versioned per-dataset paths (`<name>/v<n>/dataset.json.gz`),
 * so the dataset can be iterated without an SDK release — re-upload under a new
 * version path and bump the entry in {@link DATASETS}.
 */
export const SAMPLE_DATASETS_BASE_URL =
	"https://cyborgdb-sample-datasets.s3.amazonaws.com";

/** A curated, named metadata filter that is guaranteed to match rows. */
export interface SampleFilter {
	/** Human-readable label for docs/UX. */
	name: string;
	/** A filter expression accepted by `index.query({ filters })`. */
	filter: Record<string, unknown>;
	/** What demo this filter illustrates. */
	demonstrates: string;
}

/** A fully-loaded sample dataset, ready to upsert and query. */
export interface SampleDataset {
	/** Dataset identifier, e.g. `"quickstart-75k"`. */
	name: string;
	/** Dataset schema version. */
	version: number;
	/** Human-readable description. */
	description: string;
	/** Vector dimensionality. */
	dimension: number;
	/** Distance metric the vectors were generated for, e.g. `"euclidean"`. */
	metric: string;
	/** Number of items in the dataset. */
	count: number;
	/** Items with explicit IDs, vectors, and metadata — drop into `upsert`. */
	items: VectorItem[];
	/** A handful of query vectors for ANN similarity-search demos. */
	sampleQueries: number[][];
	/** Curated filters for metadata / range-query demos. */
	exampleFilters: SampleFilter[];
}

/** Catalog of available datasets and where to fetch each one. */
const DATASETS: Record<string, { objectPath: string }> = {
	"quickstart-75k": { objectPath: "quickstart-75k/v1/dataset.json.gz" },
};

/** Default dataset returned by `loadSampleDataset()` with no arguments. */
export const DEFAULT_SAMPLE_DATASET = "quickstart-75k";

export interface LoadSampleDatasetOptions {
	/**
	 * Directory to cache the decompressed dataset in.
	 * Defaults to `$XDG_CACHE_HOME/cyborgdb` or `~/.cache/cyborgdb`.
	 */
	cacheDir?: string;
	/** Re-download even if a cached copy exists. Defaults to `false`. */
	forceDownload?: boolean;
}

function defaultCacheDir(): string {
	const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
	return path.join(base, "cyborgdb");
}

/**
 * Load a hosted sample dataset, fetching from S3 on first use and caching
 * the decompressed copy locally for subsequent calls.
 *
 * @param name Dataset name (default: `"quickstart-75k"`).
 * @param options Cache directory / force-download overrides.
 * @returns The parsed dataset, ready to `upsert` and `query`.
 * @throws If the dataset name is unknown or the download fails.
 */
export async function loadSampleDataset(
	name: string = DEFAULT_SAMPLE_DATASET,
	options: LoadSampleDatasetOptions = {},
): Promise<SampleDataset> {
	const entry = DATASETS[name];
	if (!entry) {
		const known = Object.keys(DATASETS).join(", ");
		throw new Error(
			`Unknown sample dataset "${name}". Available datasets: ${known}.`,
		);
	}

	const cacheDir = options.cacheDir ?? defaultCacheDir();
	// Cache key mirrors the versioned object path so a dataset bump never
	// serves a stale cached copy.
	const cacheFile = path.join(
		cacheDir,
		`${entry.objectPath.replace(/\//g, "_").replace(/\.gz$/, "")}`,
	);

	if (!options.forceDownload && fs.existsSync(cacheFile)) {
		try {
			const cached = fs.readFileSync(cacheFile, "utf8");
			return JSON.parse(cached) as SampleDataset;
		} catch {
			// Corrupt cache — fall through and re-download.
		}
	}

	const url = `${SAMPLE_DATASETS_BASE_URL}/${entry.objectPath}`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(
			`Failed to download sample dataset "${name}" from ${url}: ` +
				`HTTP ${response.status} ${response.statusText}`,
		);
	}

	const compressed = Buffer.from(await response.arrayBuffer());
	const json = gunzipSync(compressed).toString("utf8");
	const dataset = JSON.parse(json) as SampleDataset;

	// Best-effort local cache; a failed write must not break the load.
	try {
		fs.mkdirSync(cacheDir, { recursive: true });
		fs.writeFileSync(cacheFile, json, "utf8");
	} catch {
		// Read-only FS or similar — skip caching.
	}

	return dataset;
}
