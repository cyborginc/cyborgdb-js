
# VectorItem

Represents a vectorized item for storage in the encrypted index.  Attributes:     id (str): Unique identifier for the vector item.     vector (Optional[List[float]]): The vector representation of the item.     contents (Optional[Union[str, bytes]]): The original text or associated content (can be string or bytes).     metadata (Optional[Dict[str, Any]]): Additional metadata associated with the item.

## Properties

Name | Type
------------ | -------------
`id` | string
`vector` | Array&lt;number&gt;
`contents` | [Contents](Contents.md)
`metadata` | { [key: string]: any; }

## Example

```typescript
import type { VectorItem } from ''

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "vector": null,
  "contents": null,
  "metadata": null,
} satisfies VectorItem

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as VectorItem
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


