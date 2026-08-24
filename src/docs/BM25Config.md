
# BM25Config

BM25 scoring config an index reports back via `index_config()`.  Present only for indexes with at least one `full_text` field. `k1` and `b` are the tuning parameters supplied at create time (or their defaults); `analyzer_version` identifies the tokenizer/stemmer pipeline the corpus was indexed with.

## Properties

Name | Type
------------ | -------------
`k1` | number
`b` | number
`analyzerVersion` | string

## Example

```typescript
import type { BM25Config } from ''

// TODO: Update the object below with actual values
const example = {
  "k1": null,
  "b": null,
  "analyzerVersion": null,
} satisfies BM25Config

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BM25Config
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


