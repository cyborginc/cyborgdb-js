
# CreateIndexRequest

Request model for creating a new encrypted DiskIVF index.  Exactly one of `kms_name` / `index_key` must be supplied; supplying both is rejected with 400.  Attributes:     index_name: The name/identifier of the index.     kms_name: Name of a `kms.registry` entry in the service YAML.         When supplied (and `index_key` is omitted), the service         generates the KEK itself, wraps it under that entry\'s KMS,         and persists the envelope.     index_key: A 32-byte encryption key as a hex string.  When         supplied (and `kms_name` is omitted), the SDK provides the         KEK directly and the persisted envelope records         `provider=\"none\"`.     dimension (Optional[int]): Dimensionality of the vectors. Auto-detected         from the first upsert if omitted.     embedding_model (Optional[str]): Optional embedding model name.     metric (Optional[str]): Optional distance metric.     storage_precision (Optional[Literal[\"float32\", \"float16\"]]): On-disk         rerank-vector dtype. Defaults to float32 in core.     metadata_schema (Optional[Dict[str, MetadataFieldPolicy]]): Per-field         metadata indexing policy, keyed by field name (dot-path for         nested fields).  Omitted fields are filterable by default         (opt-out posture).  Fixed at create time and immutable.     text_fields (Optional[List[str]]): Shorthand for marking fields         `full_text=true` in `metadata_schema`.  A field listed here is         analyzed by BM25 and becomes searchable by `query(text=...)` /         `query_metadata(text=...)`.  Cannot name a field the schema         already sets `full_text=false`.     bm25_k1 (Optional[float]): BM25 term-frequency saturation (>= 0,         default 1.2 in core).  Requires at least one full_text field.     bm25_b (Optional[float]): BM25 length-normalization strength         (in [0, 1], default 0.75 in core).  Requires at least one         full_text field.  BM25 full-text search is opt-in and derived, not flagged: an index with at least one full_text field supports the `text=...` query legs; an index with none writes no BM25 config at all.

## Properties

Name | Type
------------ | -------------
`indexName` | string
`kmsName` | string
`indexKey` | string
`dimension` | number
`embeddingModel` | string
`metric` | string
`storagePrecision` | string
`metadataSchema` | [{ [key: string]: MetadataFieldPolicy; }](MetadataFieldPolicy.md)
`textFields` | Array&lt;string&gt;
`bm25K1` | number
`bm25B` | number

## Example

```typescript
import type { CreateIndexRequest } from ''

// TODO: Update the object below with actual values
const example = {
  "indexName": null,
  "kmsName": null,
  "indexKey": null,
  "dimension": null,
  "embeddingModel": null,
  "metric": null,
  "storagePrecision": null,
  "metadataSchema": null,
  "textFields": null,
  "bm25K1": null,
  "bm25B": null,
} satisfies CreateIndexRequest

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateIndexRequest
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


