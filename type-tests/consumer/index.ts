/**
 * Consumer type-check project. Installs the npm pack tarball and verifies that
 * README and docs snippets compile cleanly under strict mode.
 *
 * Run after `npm pack --pack-destination type-tests/consumer/` in the root:
 *   cd type-tests/consumer && npm install && tsc --noEmit
 */

import { Client, EncryptedIndex } from "cyborgdb";
import type {
	QueryResultItem,
	VectorItem,
	FilterExpression,
} from "cyborgdb";

// ---------------------------------------------------------------------------
// README quickstart snippet — with result narrow added
// ---------------------------------------------------------------------------
async function readmeQuickstart() {
	const client = new Client({
		baseUrl: "https://localhost:8000",
		apiKey: "your-api-key",
	});

	const indexKey = client.generateKey();
	const index = await client.createIndex({
		indexName: "my-index",
		indexKey,
	});

	interface DocMeta {
		category: string;
		language: string;
	}

	const items: VectorItem<DocMeta>[] = [
		{
			id: "doc1",
			vector: [0.1, 0.2, 0.3],
			contents: "Hello world!",
			metadata: { category: "greeting", language: "en" },
		},
		{
			id: "doc2",
			vector: [0.4, 0.5, 0.6],
			contents: "Bonjour le monde!",
			metadata: { category: "greeting", language: "fr" },
		},
	];

	await index.upsert<DocMeta>({ items });

	const queryVector = [0.1, 0.2, 0.3];
	const results = await index.query<DocMeta>({
		queryVectors: queryVector,
		topK: 10,
		include: ["distance"],
	});

	// Narrow union to flat array before iterating
	const flat: QueryResultItem<DocMeta>[] = Array.isArray(results.results[0])
		? (results.results as QueryResultItem<DocMeta>[][])[0]
		: (results.results as QueryResultItem<DocMeta>[]);

	flat.forEach((result) => {
		console.log(`ID: ${result.id}, Distance: ${result.distance}`);
	});
}

// ---------------------------------------------------------------------------
// Caller using interface-typed metadata
// ---------------------------------------------------------------------------
interface ProductMeta {
	name: string;
	price: number;
}

async function interfaceMetadataCaller(index: EncryptedIndex) {
	const products: ProductMeta[] = [
		{ name: "Widget A", price: 9.99 },
		{ name: "Widget B", price: 19.99 },
	];

	await index.upsert<ProductMeta>({
		items: products.map((p, i) => ({
			id: `product-${i}`,
			vector: [0.1 * i],
			metadata: p,
		})),
	});

	const queryResults = await index.query<ProductMeta>({
		queryVectors: [0.1],
		topK: 5,
	});

	const flat = Array.isArray(queryResults.results[0])
		? (queryResults.results as QueryResultItem<ProductMeta>[][])[0]
		: (queryResults.results as QueryResultItem<ProductMeta>[]);

	for (const item of flat) {
		const name: string | undefined = item.metadata?.name;
		console.log(name);
	}
}

// ---------------------------------------------------------------------------
// Caller using the generic parameter explicitly
// ---------------------------------------------------------------------------
async function genericParamCaller(index: EncryptedIndex) {
	type ArticleMeta = { title: string; author: string };

	const result = await index.get<ArticleMeta>({ ids: ["article-1"] });
	const title: string | undefined = result[0]?.metadata?.title;
	console.log(title);
}

// ---------------------------------------------------------------------------
// Filter expression that matches the shape required
// ---------------------------------------------------------------------------
const validFilter: FilterExpression = {
	category: "electronics",
	price: { $gt: 100, $lte: 500 },
};

void readmeQuickstart;
void interfaceMetadataCaller;
void genericParamCaller;
void validFilter;
