
# DeleteRequest

Request model for deleting vectors from the encrypted index.  Inherits:     IndexOperationRequest: Includes `index_name` and `index_key`.  Attributes:     ids (List[str]): List of vector item IDs to be deleted.

## Properties

Name | Type
------------ | -------------
`indexName` | string
`indexKey` | string
`ids` | Array&lt;string&gt;

## Example

```typescript
import type { DeleteRequest } from ''

// TODO: Update the object below with actual values
const example = {
  "indexName": null,
  "indexKey": null,
  "ids": null,
} satisfies DeleteRequest

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DeleteRequest
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


