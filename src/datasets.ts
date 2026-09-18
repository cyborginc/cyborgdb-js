/**
 * Sample dataset loader for CyborgDB.
 *
 * Fetches a small reference dataset hosted on S3 on demand and caches it
 * locally, so quickstart and test code can populate an index without bundling
 * data into the SDK. Hosting the dataset out-of-band keeps the SDK lean and
 * lets us iterate the dataset without cutting an SDK release.
 *
 * Runs on any runtime: download, integrity check, and decompression use only
 * web-standard APIs. The local disk cache is Node-only and loaded lazily, so
 * on browsers and Edge runtimes the dataset is simply re-fetched each time
 * rather than cached.
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

import { decodeUtf8, sha256Hex } from "./bytes";
import type { VectorItem } from "./models";
import { optionalNodeBuiltin } from "./nodeInterop";

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

/**
 * Catalog of available datasets: where to fetch each one and the SHA-256 of its
 * decompressed JSON, pinned so a bucket compromise or a poisoned local cache
 * file can't be trusted silently. The same digest is verified post-download and
 * on cache read.
 *
 * Exported for tests to inject a fixture digest; it is intentionally not
 * re-exported from `index.ts`, so it is not part of the public API.
 */
export const DATASETS: Record<string, { objectPath: string; sha256: string }> =
	{
		"quickstart-75k": {
			objectPath: "quickstart-75k/v1/dataset.json.gz",
			sha256:
				"6e2db96a0932f036698ebf5e25cf0871cc69b649f7fb352f9e3dddcf9af0540f",
		},
	};

/**
 * Upper bound on the decompressed dataset size. Guards against a decompression
 * bomb: a tiny gzip that expands to many GBs and OOMs the host. The largest
 * shipped dataset is well under this; pick a generous cap.
 */
const MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024;

/** Bounds the dataset download so a stalled connection can't hang forever. */
const DOWNLOAD_TIMEOUT_MS = 120_000;

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

/**
 * The Node modules the on-disk cache needs, or `undefined` where they don't
 * exist (browser, Edge runtime). Loaded through {@link optionalNodeBuiltin} so
 * no `node:*` specifier ever enters the static module graph.
 */
async function nodeCacheModules(): Promise<
	| {
			fs: typeof import("node:fs");
			os: typeof import("node:os");
			path: typeof import("node:path");
	  }
	| undefined
> {
	const [fs, os, path] = await Promise.all([
		optionalNodeBuiltin<typeof import("node:fs")>("fs"),
		optionalNodeBuiltin<typeof import("node:os")>("os"),
		optionalNodeBuiltin<typeof import("node:path")>("path"),
	]);
	return fs && os && path ? { fs, os, path } : undefined;
}

/**
 * Resolve where a dataset's cached copy lives, or `undefined` on a runtime
 * with no filesystem.
 *
 * @param cacheDir Caller override; defaults to `$XDG_CACHE_HOME/cyborgdb` or
 *   `~/.cache/cyborgdb`.
 * @param key Cache file name, derived from the versioned object path.
 */
async function resolveCache(
	cacheDir: string | undefined,
	key: string,
): Promise<
	{ fs: typeof import("node:fs"); dir: string; file: string } | undefined
> {
	const mods = await nodeCacheModules();
	if (!mods) {
		return undefined;
	}
	const { fs, os, path } = mods;
	const dir =
		cacheDir ??
		path.join(
			process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
			"cyborgdb",
		);
	return { fs, dir, file: path.join(dir, key) };
}

/**
 * Gunzip `compressed` using the web-standard `DecompressionStream`, refusing
 * to buffer more than `maxBytes`.
 *
 * The cap guards against a decompression bomb: a tiny gzip that expands to
 * many GBs and OOMs the host. It replaces `zlib.gunzipSync`'s
 * `maxOutputLength`, which has no Edge equivalent.
 *
 * @throws RangeError if the decompressed stream exceeds `maxBytes`.
 */
async function gunzip(
	// `Uint8Array<ArrayBuffer>` rather than a bare `Uint8Array`: a stream chunk
	// must be a `BufferSource`, which excludes views over a SharedArrayBuffer.
	// The only caller builds this straight from `response.arrayBuffer()`.
	compressed: Uint8Array<ArrayBuffer>,
	maxBytes: number,
): Promise<Uint8Array> {
	if (typeof DecompressionStream === "undefined") {
		throw new Error(
			"This runtime provides no DecompressionStream, so the gzipped dataset " +
				"cannot be decompressed.",
		);
	}

	// Typed as BufferSource, not Uint8Array, to line up with
	// DecompressionStream's `writable: WritableStream<BufferSource>`.
	const source = new ReadableStream<BufferSource>({
		start(controller) {
			controller.enqueue(compressed);
			controller.close();
		},
	});
	const reader = source
		.pipeThrough(new DecompressionStream("gzip"))
		.getReader();

	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new RangeError(
				`Decompressed dataset exceeds the ${maxBytes}-byte limit`,
			);
		}
		chunks.push(value);
	}

	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
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

	// Cache key mirrors the versioned object path so a dataset bump never
	// serves a stale cached copy. `undefined` on runtimes with no filesystem,
	// where every load re-downloads.
	const cache = await resolveCache(
		options.cacheDir,
		entry.objectPath.replace(/\//g, "_").replace(/\.gz$/, ""),
	);

	if (cache && !options.forceDownload && cache.fs.existsSync(cache.file)) {
		try {
			const cached = cache.fs.readFileSync(cache.file);
			// Verify the cached file against the pinned digest: a poisoned cache
			// must not be trusted. A mismatch falls through to re-download.
			if ((await sha256Hex(cached)) === entry.sha256) {
				return hydrate(JSON.parse(decodeUtf8(cached)) as RawSampleDataset);
			}
		} catch {
			// Corrupt cache — fall through and re-download.
		}
	}

	const url = `${SAMPLE_DATASETS_BASE_URL}/${entry.objectPath}`;
	let response: Response;
	try {
		response = await fetch(url, {
			signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
		});
	} catch (err) {
		throw new Error(
			`Failed to download sample dataset "${name}" from ${url}: ${err}`,
		);
	}
	if (!response.ok) {
		throw new Error(
			`Failed to download sample dataset "${name}" from ${url}: ` +
				`HTTP ${response.status} ${response.statusText}`,
		);
	}

	const compressed = new Uint8Array(await response.arrayBuffer());
	let decompressed: Uint8Array;
	try {
		decompressed = await gunzip(compressed, MAX_DECOMPRESSED_BYTES);
	} catch (err) {
		throw new Error(`Failed to decompress sample dataset "${name}": ${err}`);
	}

	const digest = await sha256Hex(decompressed);
	if (digest !== entry.sha256) {
		throw new Error(
			`Integrity check failed for sample dataset "${name}": ` +
				`expected SHA-256 ${entry.sha256}, got ${digest}.`,
		);
	}

	const raw = JSON.parse(decodeUtf8(decompressed)) as RawSampleDataset;

	// Best-effort local cache of the raw payload; a failed write must not break
	// the load. `items`/`sampleQueries` are rebuilt by hydrate() on read.
	if (cache) {
		try {
			cache.fs.mkdirSync(cache.dir, { recursive: true });
			cache.fs.writeFileSync(cache.file, decompressed);
		} catch {
			// Read-only FS or similar — skip caching.
		}
	}

	return hydrate(raw);
}
