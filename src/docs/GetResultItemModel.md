
# GetResultItemModel

Represents an individual item retrieved from the encrypted index.  Attributes:     id (str): The unique identifier of the item.     metadata (Optional[Dict[str, Any]]): Additional metadata associated with the item.     contents (Optional[bytes]): The raw byte contents of the item.     vector (Optional[List[float]]): The vector representation of the item.

## Properties

Name | Type
------------ | -------------
`id` | string
`metadata` | { [key: string]: any; }
`contents` | string
`vector` | Array&lt;number&gt;

## Example

```typescript
import type { GetResultItemModel } from ''

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "metadata": null,
  "contents": null,
  "vector": null,
} satisfies GetResultItemModel

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as GetResultItemModel
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


