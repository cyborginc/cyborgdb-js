
# GetRequest

Request model for retrieving specific vectors from the index.  Inherits:     IndexOperationRequest: Includes `index_name` and `index_key`.  Attributes:     ids (List[str]): List of vector item IDs to retrieve.     include (List[str]): List of fields to include in the response.         Defaults to `[\"vector\", \"contents\", \"metadata\"]`.

## Properties

Name | Type
------------ | -------------
`indexName` | string
`indexKey` | string
`ids` | Array&lt;string&gt;
`include` | Array&lt;string&gt;

## Example

```typescript
import type { GetRequest } from ''

// TODO: Update the object below with actual values
const example = {
  "indexName": null,
  "indexKey": null,
  "ids": null,
  "include": null,
} satisfies GetRequest

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as GetRequest
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


