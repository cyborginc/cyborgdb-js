
# CreateUserResponse

Response model for user creation.  Attributes:     user_id (str): The minted user\'s id (hex).     api_key (str): The user\'s API key. Returned once and never stored.

## Properties

Name | Type
------------ | -------------
`userId` | string
`apiKey` | string

## Example

```typescript
import type { CreateUserResponse } from ''

// TODO: Update the object below with actual values
const example = {
  "userId": null,
  "apiKey": null,
} satisfies CreateUserResponse

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateUserResponse
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


