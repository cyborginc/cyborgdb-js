
# ListIDsResponse

Response model for listing all IDs in the index.  Attributes:     ids (List[str]): List of all item IDs in the index.     count (int): Total number of IDs in the index.

## Properties

Name | Type
------------ | -------------
`ids` | Array&lt;string&gt;
`count` | number

## Example

```typescript
import type { ListIDsResponse } from ''

// TODO: Update the object below with actual values
const example = {
  "ids": null,
  "count": null,
} satisfies ListIDsResponse

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ListIDsResponse
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


