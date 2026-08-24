
# CreateUserRequest

Request model for minting a user API key scoped to one index.  Attributes:     permissions (List[str]): Subset of {\"read\", \"write\"}; at least one.     index_key (Optional[str]): Index KEK (hex) for SDK-supplied indexes.         Omit for KMS-backed indexes — the service resolves the KEK server-side.

## Properties

Name | Type
------------ | -------------
`permissions` | Array&lt;string&gt;
`indexKey` | string

## Example

```typescript
import type { CreateUserRequest } from ''

// TODO: Update the object below with actual values
const example = {
  "permissions": null,
  "indexKey": null,
} satisfies CreateUserRequest

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateUserRequest
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


