
# QueryResultItem

Represents a single result from a similarity search.  A result carries either `distance` (pure vector query; smaller = more similar) or `score` (hybrid query; the fused BM25 + vector relevance, larger = more relevant) — never both, since a text hit has no vector distance.  Attributes:     id (str): The identifier of the retrieved item.     distance (Optional[float]): Distance from the query vector (smaller = more similar).     score (Optional[float]): Fused relevance score on a hybrid (`text=...`) query (larger = more relevant).     metadata (Optional[Dict[str, Any]]): Additional metadata for the result.     vector (Optional[List[float]]): The retrieved vector (if included in response).

## Properties

Name | Type
------------ | -------------
`id` | string
`distance` | number
`score` | number
`metadata` | { [key: string]: any; }
`vector` | Array&lt;number&gt;

## Example

```typescript
import type { QueryResultItem } from ''

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "distance": null,
  "score": null,
  "metadata": null,
  "vector": null,
} satisfies QueryResultItem

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QueryResultItem
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


