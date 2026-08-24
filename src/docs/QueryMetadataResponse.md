
# QueryMetadataResponse

Response model for a metadata query.  Attributes:     results (List[MetadataResult]): Matching items, using core\'s row shape         directly. On a `text=...` query each row is `{id, score}` in         descending score order; on a filter-only query each row is `{id}`         (no `score` key — there is nothing to score) following `order_by`         when set, else an unordered subset.     ids (List[str]): Matching item IDs, parallel to `results`. Retained         for backward compatibility with callers that only read IDs.     count (int): Number of items returned.

## Properties

Name | Type
------------ | -------------
`results` | [Array&lt;MetadataResult&gt;](MetadataResult.md)
`ids` | Array&lt;string&gt;
`count` | number

## Example

```typescript
import type { QueryMetadataResponse } from ''

// TODO: Update the object below with actual values
const example = {
  "results": null,
  "ids": null,
  "count": null,
} satisfies QueryMetadataResponse

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QueryMetadataResponse
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


