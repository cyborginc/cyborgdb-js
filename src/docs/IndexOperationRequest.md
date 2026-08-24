
# IndexOperationRequest

Request model for performing operations on an existing index (e.g., delete, describe).  Exactly one of two paths applies on every request:   * `index_key` is supplied — the SDK-supplied KEK for an index     whose stored envelope records `provider=\"none\"`.  The service     validates it against the cached hash.   * `index_key` is omitted — the index must be KMS-backed.  The     service reads the `KMSBlob` snapshot, resolves the KEK via     the named KMS (cached by the `kek_cache` TTL), and uses that.  Attributes:     index_name (str): The name/identifier of the index.     index_key (str, optional): 32-byte encryption key as hex string.         Required for SDK-supplied indexes (envelope `provider=\"none\"`);         must be omitted for KMS-backed indexes.

## Properties

Name | Type
------------ | -------------
`indexName` | string
`indexKey` | string

## Example

```typescript
import type { IndexOperationRequest } from ''

// TODO: Update the object below with actual values
const example = {
  "indexName": null,
  "indexKey": null,
} satisfies IndexOperationRequest

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as IndexOperationRequest
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


