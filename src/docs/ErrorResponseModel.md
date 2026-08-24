
# ErrorResponseModel

Standard error response model.  Attributes:     status_code (int): HTTP status code of the error.     detail (str): A detailed message describing the error.

## Properties

Name | Type
------------ | -------------
`statusCode` | number
`detail` | string

## Example

```typescript
import type { ErrorResponseModel } from ''

// TODO: Update the object below with actual values
const example = {
  "statusCode": null,
  "detail": null,
} satisfies ErrorResponseModel

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ErrorResponseModel
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


