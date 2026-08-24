
# UpsertRequest

Request model for adding or updating vectors in an encrypted index.  Inherits:     IndexOperationRequest: Includes `index_name` and `index_key`.  Attributes:     items (List[VectorItem]): List of vector items to be inserted or updated.

## Properties

Name | Type
------------ | -------------
`indexName` | string
`indexKey` | string
`items` | [Array&lt;VectorItem&gt;](VectorItem.md)

## Example

```typescript
import type { UpsertRequest } from ''

// TODO: Update the object below with actual values
const example = {
  "indexName": null,
  "indexKey": null,
  "items": null,
} satisfies UpsertRequest

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpsertRequest
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


