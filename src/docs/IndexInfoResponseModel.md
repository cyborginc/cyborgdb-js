
# IndexInfoResponseModel

Response model for retrieving information about an index.  Attributes:     index_name (str): The name of the index.     is_trained (bool): Indicates whether the index has been trained.     dimension (int): Dimensionality of the vectors. `0` before the         first upsert when create_index was called without an explicit         dimension (auto-detect).     metric (str): Distance metric (`euclidean`, `cosine`, or         `squared_euclidean`).     n_lists (int): Number of inverted lists in the IVF index. `1`         for untrained indexes.     metadata_schema (Dict[str, MetadataFieldPolicy]): Per-field metadata         indexing overrides recorded at create time. Empty when the         index uses the default index-everything posture.     bm25 (Optional[BM25Config]): BM25 scoring config when the index has         at least one full_text field; `None` otherwise.

## Properties

Name | Type
------------ | -------------
`indexName` | string
`isTrained` | boolean
`dimension` | number
`metric` | string
`nLists` | number
`metadataSchema` | [{ [key: string]: MetadataFieldPolicy; }](MetadataFieldPolicy.md)
`bm25` | [BM25Config](BM25Config.md)

## Example

```typescript
import type { IndexInfoResponseModel } from ''

// TODO: Update the object below with actual values
const example = {
  "indexName": null,
  "isTrained": null,
  "dimension": null,
  "metric": null,
  "nLists": null,
  "metadataSchema": null,
  "bm25": null,
} satisfies IndexInfoResponseModel

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as IndexInfoResponseModel
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


