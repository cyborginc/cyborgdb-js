/**
 * Type-level unit tests for the cyborgdb public API surface.
 * Compiled with `tsc --noEmit -p type-tests/tsconfig.json` (strict mode).
 * Uses `// @ts-expect-error` to assert that incorrect usage is rejected.
 */

import type {
	BatchQueryRequest,
	EncryptedIndex,
	FilterExpression,
	HTTPValidationError,
	QueryResultItem,
	UpsertRequest,
	VectorItem,
	VectorMetadata,
	VERSION,
} from "src/index";
import type { CyborgVectorStore } from "src/integrations/langchain/vectorstore";

// ---------------------------------------------------------------------------
// IsAny<T> helper — returns true only when T is literally `any`
// ---------------------------------------------------------------------------
type IsAny<T> = 0 extends 1 & T ? true : false;

// ---------------------------------------------------------------------------
// 1. VectorItem<Meta> rejects metadata: { title: 1 } and accepts { title: "x" }
// ---------------------------------------------------------------------------
interface Meta {
	title: string;
}

// Should accept
const _goodItem: VectorItem<Meta> = {
	id: "1",
	vector: [0.1, 0.2],
	metadata: { title: "x" },
};

// Should reject — title must be string, not number
const _badItem: VectorItem<Meta> = {
	id: "2",
	vector: [0.1, 0.2],
	// @ts-expect-error
	metadata: { title: 1 },
};

// ---------------------------------------------------------------------------
// 2. Interface-typed metadata compiles through upsert (items form)
// ---------------------------------------------------------------------------
declare const index: EncryptedIndex;

async function testUpsertItemsForm() {
	await index.upsert<Meta>({
		items: [{ id: "1", vector: [0.1], metadata: { title: "hello" } }],
	});
}

// ---------------------------------------------------------------------------
// 3. Interface-typed metadata compiles through upsert (ids/vectors/metadata form)
// ---------------------------------------------------------------------------
async function testUpsertArrayForm() {
	const metas: (Meta | null)[] = [{ title: "hi" }, null];
	await index.upsert<Meta>({
		ids: ["a", "b"],
		vectors: [[0.1], [0.2]],
		metadata: metas,
	});
}

// ---------------------------------------------------------------------------
// 4. query<Meta>() result items expose metadata?.title as string | undefined
// ---------------------------------------------------------------------------
async function testQueryResult() {
	const response = await index.query<Meta>({ queryVectors: [0.1, 0.2] });
	const results = response.results;
	// Narrow from union to flat array
	const flat: QueryResultItem<Meta>[] = Array.isArray(results[0])
		? (results as QueryResultItem<Meta>[][])[0]
		: (results as QueryResultItem<Meta>[]);
	const title: string | undefined = flat[0]?.metadata?.title;
	void title;
}

// ---------------------------------------------------------------------------
// 5. Unparameterized get() metadata is JsonValue; .toUpperCase() without
//    narrowing is a compile error
// ---------------------------------------------------------------------------
async function testGetMetadata() {
	const items = await index.get({ ids: ["a"] });
	const meta = items[0]?.metadata;
	// @ts-expect-error — metadata is VectorMetadata (JsonObject), not string; .toUpperCase() doesn't exist
	const _upper = meta?.toUpperCase();
	void _upper;
}

// ---------------------------------------------------------------------------
// 6. CyborgVectorStore filter rejects Date and accepts valid FilterExpression
// ---------------------------------------------------------------------------
declare const store: CyborgVectorStore;

// Should accept
const _goodFilter: FilterExpression = { category: "a", price: { $gt: 1 } };

// Should reject — Date is not a valid FilterValue
// @ts-expect-error
const _badFilter: FilterExpression = { date: new Date() };

// ---------------------------------------------------------------------------
// 7. IsAny<T> returns false for all named exports that must not be `any`
// ---------------------------------------------------------------------------

// VERSION is typed as string
type VersionIsAny = IsAny<typeof VERSION>;
const _versionCheck: VersionIsAny = false;

// VectorItem["metadata"] must not be any (it should be VectorMetadata | null | undefined)
type VectorItemMetaIsAny = IsAny<VectorItem["metadata"]>;
const _viMetaCheck: VectorItemMetaIsAny = false;

// QueryResultItem["metadata"] must not be any
type QRIMetaIsAny = IsAny<QueryResultItem["metadata"]>;
const _qriMetaCheck: QRIMetaIsAny = false;

// BatchQueryRequest["filters"] must not be any (should be FilterExpression | null | undefined)
type BQRFiltersIsAny = IsAny<BatchQueryRequest["filters"]>;
const _bqrFiltersCheck: BQRFiltersIsAny = false;

// HTTPValidationError detail input must not be any (should be unknown)
type HTTPVEInputIsAny = IsAny<
	NonNullable<HTTPValidationError["detail"]>[0]["input"]
>;
const _httpveCheck: HTTPVEInputIsAny = false;

// ---------------------------------------------------------------------------
// 8. IsExact<A, B> — confirm parameterised metadata resolves precisely
// ---------------------------------------------------------------------------
type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

interface TitleMeta {
	title: string;
}

// VectorItem<TitleMeta>["metadata"] must be exactly TitleMeta | null | undefined
type VectorItemMetaExact = IsExact<
	VectorItem<TitleMeta>["metadata"],
	TitleMeta | null | undefined
>;
const _viMetaExact: VectorItemMetaExact = true;

// QueryResultItem<TitleMeta>["metadata"] must be exactly TitleMeta | null | undefined
type QRIMetaExact = IsExact<
	QueryResultItem<TitleMeta>["metadata"],
	TitleMeta | null | undefined
>;
const _qriMetaExact: QRIMetaExact = true;

// HTTPValidationError detail input is exactly unknown
type HTTPVEInputExact = IsExact<
	NonNullable<HTTPValidationError["detail"]>[0]["input"],
	unknown
>;
const _httpveExact: HTTPVEInputExact = true;

// Silence unused variable warnings
void _goodItem;
void _goodFilter;
void _versionCheck;
void _viMetaCheck;
void _qriMetaCheck;
void _bqrFiltersCheck;
void _httpveCheck;
void testUpsertItemsForm;
void testUpsertArrayForm;
void testQueryResult;
void testGetMetadata;
void store;
void _viMetaExact;
void _qriMetaExact;
void _httpveExact;
