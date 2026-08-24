
# ListUsersResponse

Response model for listing an index\'s users.  Attributes:     users (List[UserInfo]): The users scoped to the index.

## Properties

Name | Type
------------ | -------------
`users` | [Array&lt;UserInfo&gt;](UserInfo.md)

## Example

```typescript
import type { ListUsersResponse } from ''

// TODO: Update the object below with actual values
const example = {
  "users": null,
} satisfies ListUsersResponse

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ListUsersResponse
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


