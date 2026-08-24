
# QueryMetadataRequest

Request model for a metadata query (no query vector), optionally with a BM25 full-text leg.  Inherits:     IndexOperationRequest: Includes `index_name` and `index_key`.     TextSearchParams: `text` and the BM25 field knobs. When `text` is set         the result is ranked by BM25 score; a `filters` given alongside         acts as a pre-filter (the text leg scores only its survivors).         `order_by` is not supported together with `text`.  Attributes:     filters (Optional[Dict[str, Any]]): Metadata filters as a JSON-like         dictionary. Unlike `/query`, every leaf must be resolvable from         the metadata index — see the field description.     top_k (Optional[int]): Cap on the number of results returned. `None`         returns every match. Applied AFTER `order_by`.     order_by (Optional[str]): Metadata field to sort the matches by         (post-filter). Unordered when omitted. Not supported with `text`.     ascending (bool): Sort direction when `order_by` is set.

## Properties

Name | Type
------------ | -------------
`text` | string
`textFields` | Array&lt;string&gt;
`textFieldWeights` | Array&lt;number&gt;
`requireAllTerms` | boolean
`indexName` | string
`indexKey` | string
`filters` | { [key: string]: any; }
`topK` | number
`orderBy` | [OrderBy](OrderBy.md)
`ascending` | boolean

## Example

```typescript
import type { QueryMetadataRequest } from ''

// TODO: Update the object below with actual values
const example = {
  "text": null,
  "textFields": null,
  "textFieldWeights": null,
  "requireAllTerms": null,
  "indexName": null,
  "indexKey": null,
  "filters": null,
  "topK": null,
  "orderBy": null,
  "ascending": null,
} satisfies QueryMetadataRequest

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QueryMetadataRequest
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


