
# BinaryUpsertRequest

Request model for adding or updating vectors using binary format.  This is more efficient than UpsertRequest for large batches as vectors are sent as base64-encoded binary data instead of JSON arrays.  Inherits:     IndexOperationRequest: Includes `index_name` and `index_key`.  Attributes:     batch (BinaryVectorBatch): The batch of vectors in binary format.

## Properties

Name | Type
------------ | -------------
`indexName` | string
`indexKey` | string
`batch` | [BinaryVectorBatch](BinaryVectorBatch.md)

## Example

```typescript
import type { BinaryUpsertRequest } from ''

// TODO: Update the object below with actual values
const example = {
  "indexName": null,
  "indexKey": null,
  "batch": null,
} satisfies BinaryUpsertRequest

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BinaryUpsertRequest
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


