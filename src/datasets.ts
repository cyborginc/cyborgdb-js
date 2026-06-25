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

/**
 * A fully-loaded sample dataset, ready to upsert and query.
 *
 * Combines three layers:
 *  - **dataset metadata** (`name`, `dimension`, `metric`, …);
 *  - **convenience fields** built by the loader for quickstart/demo use
 *    (`items`, `sampleQueries`, `exampleFilters`);
 *  - **raw parallel arrays** plus **ground-truth fixture data** (`queries`,
 *    `*_neighbors`, `*_recall`, …) used to validate recall/accuracy. These
 *    keep their original snake_case names and are aligned by index.
 */
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

	// ---- convenience (built by the loader) ----
	/** Items with explicit IDs, vectors, and metadata — drop into `upsert`. */
	items: VectorItem[];
	/** A handful of query vectors for quick ANN similarity-search demos. */
	sampleQueries: number[][];
	/** Curated, guaranteed-to-match filters for metadata / range-query demos. */
	exampleFilters: SampleFilter[];

	// ---- raw parallel arrays (aligned by index) ----
	/** Explicit IDs, aligned with `vectors` / `metadata`. */
	ids: string[];
	/** All vectors, aligned with `ids` / `metadata`. */
	vectors: number[][];
	/** Per-vector metadata, aligned with `ids` / `vectors`. */
	metadata: Record<string, unknown>[];

	// ---- ground-truth fixture data (for recall / accuracy validation) ----
	/** Query vectors (superset of `sampleQueries`). */
	queries: number[][];
	/** Metadata filter expressions used by the recall benchmark. */
	metadata_queries: Record<string, unknown>[];
	/** Human-readable names for each entry in `metadata_queries`. */
	metadata_query_names: string[];
	/** Ground-truth nearest-neighbor IDs per query, untrained index. */
	untrained_neighbors: number[][];
	/** Ground-truth nearest-neighbor IDs per query, trained index. */
	trained_neighbors: number[][];
	/** Ground-truth metadata-match counts per filter, untrained index. */
	untrained_metadata_matches: number[][];
	/** Ground-truth metadata-match counts per filter, trained index. */
	trained_metadata_matches: number[][];
	/** Ground-truth neighbors per filter+query, untrained index. */
	untrained_metadata_neighbors: number[][][];
	/** Ground-truth neighbors per filter+query, trained index. */
	trained_metadata_neighbors: number[][][];
	/** Expected mean recall, untrained index. */
	untrained_recall: number;
	/** Expected mean recall, trained index. */
	trained_recall: number;
	/** Number of vectors upserted before training. */
	num_untrained_vectors: number;
	/** Number of vectors upserted after training. */
	num_trained_vectors: number;
}

/**
 * The shape stored in the hosted artifact and the local cache: everything in
 * {@link SampleDataset} except the loader-derived convenience fields, which are
 * rebuilt by `hydrate()` to avoid duplicating vectors on the wire/disk.
 */
export type RawSampleDataset = Omit<SampleDataset, "items" | "sampleQueries">;

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

/** Number of leading `queries` exposed as `sampleQueries` for quick demos. */
const NUM_SAMPLE_QUERIES = 10;

function defaultCacheDir(): string {
	const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
	return path.join(base, "cyborgdb");
}

/**
 * Build the loader-derived convenience fields (`items`, `sampleQueries`) from
 * the raw parallel arrays. The hosted artifact and the local cache store only
 * the raw arrays (no duplicated vectors), so this runs on every load.
 */
function hydrate(raw: RawSampleDataset): SampleDataset {
	const items: VectorItem[] = raw.ids.map((id, i) => ({
		id,
		vector: raw.vectors[i],
		metadata: raw.metadata[i],
	}));
	return {
		...raw,
		items,
		sampleQueries: raw.queries.slice(0, NUM_SAMPLE_QUERIES),
	};
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
			return hydrate(JSON.parse(cached) as RawSampleDataset);
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
	const raw = JSON.parse(json) as RawSampleDataset;

	// Best-effort local cache of the raw payload; a failed write must not break
	// the load. `items`/`sampleQueries` are rebuilt by hydrate() on read.
	try {
		fs.mkdirSync(cacheDir, { recursive: true });
		fs.writeFileSync(cacheFile, json, "utf8");
	} catch {
		// Read-only FS or similar — skip caching.
	}

	return hydrate(raw);
}
