
# ListIDsRequest

Request model for listing all IDs in the index.  Inherits:     IndexOperationRequest: Includes `index_name` and `index_key`.

## Properties

Name | Type
------------ | -------------
`indexName` | string
`indexKey` | string

## Example

```typescript
import type { ListIDsRequest } from ''

// TODO: Update the object below with actual values
const example = {
  "indexName": null,
  "indexKey": null,
} satisfies ListIDsRequest

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ListIDsRequest
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


