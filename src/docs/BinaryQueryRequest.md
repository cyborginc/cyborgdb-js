
# BinaryQueryRequest

Request model for batch similarity search using binary format.  This is more efficient than BatchQueryRequest for large batches as vectors are sent as base64-encoded binary data instead of JSON arrays.  Inherits:     IndexOperationRequest: Includes `index_name` and `index_key`.     HybridQueryParams: `text` and the fusion knobs for hybrid search.  Attributes:     batch (BinaryQueryBatch): The batch of query vectors in binary format.     top_k (Optional[int]): Number of nearest neighbors to return for each query. Defaults to 100.     n_probes (Optional[int]): Number of lists to probe during the query. Defaults to auto.     greedy (Optional[bool]): Whether to use greedy search. Defaults to False.     rerank_mult (Optional[int]): Multiplier for stage 1 retrieval in reranking indexes. Defaults to 10.     filters (Optional[Dict[str, Any]]): Metadata filters as a JSON-like         dictionary (see `FILTERS_DESCRIPTION` for the operator set).         Defaults to {}.     include (List[str]): List of additional fields to include in the response. Defaults to `[]` (only IDs are returned).

## Properties

Name | Type
------------ | -------------
`text` | string
`textFields` | Array&lt;string&gt;
`textFieldWeights` | Array&lt;number&gt;
`requireAllTerms` | boolean
`alpha` | number
`rrfK` | number
`windowMult` | number
`indexName` | string
`indexKey` | string
`batch` | [BinaryQueryBatch](BinaryQueryBatch.md)
`topK` | number
`nProbes` | number
`rerankMult` | number
`greedy` | boolean
`filters` | { [key: string]: any; }
`include` | Array&lt;string&gt;

## Example

```typescript
import type { BinaryQueryRequest } from ''

// TODO: Update the object below with actual values
const example = {
  "text": null,
  "textFields": null,
  "textFieldWeights": null,
  "requireAllTerms": null,
  "alpha": null,
  "rrfK": null,
  "windowMult": null,
  "indexName": null,
  "indexKey": null,
  "batch": null,
  "topK": null,
  "nProbes": null,
  "rerankMult": null,
  "greedy": null,
  "filters": null,
  "include": null,
} satisfies BinaryQueryRequest

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BinaryQueryRequest
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


