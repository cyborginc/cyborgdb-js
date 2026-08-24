
# CyborgdbServiceApiSchemasVectorsSuccessResponseModel

Standard success response model for operations like upsert and delete.  Attributes:     status (str): Operation status. Defaults to `\"success\"`.     message (str): Descriptive success message.

## Properties

Name | Type
------------ | -------------
`status` | string
`message` | string

## Example

```typescript
import type { CyborgdbServiceApiSchemasVectorsSuccessResponseModel } from ''

// TODO: Update the object below with actual values
const example = {
  "status": null,
  "message": null,
} satisfies CyborgdbServiceApiSchemasVectorsSuccessResponseModel

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CyborgdbServiceApiSchemasVectorsSuccessResponseModel
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


