
# BinaryVectorBatch

Represents a batch of vectors in binary format for efficient transfer.  Attributes:     ids (List[str]): List of unique identifiers for each vector.     vectors_b64 (str): Base64-encoded float32 numpy array (shape: n_vectors x dimension).     dimension (int): The dimension of each vector.     metadata (Optional[List[Optional[Dict[str, Any]]]]): Optional metadata for each vector.     contents (Optional[List[Optional[Union[str, bytes]]]]): Optional contents for each vector.

## Properties

Name | Type
------------ | -------------
`ids` | Array&lt;string&gt;
`vectorsB64` | string
`dimension` | number
`metadata` | Array&lt;{ [key: string]: any; } | null&gt;
`contents` | [Array&lt;BinaryVectorBatchContentsInner&gt;](BinaryVectorBatchContentsInner.md)

## Example

```typescript
import type { BinaryVectorBatch } from ''

// TODO: Update the object below with actual values
const example = {
  "ids": null,
  "vectorsB64": null,
  "dimension": null,
  "metadata": null,
  "contents": null,
} satisfies BinaryVectorBatch

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BinaryVectorBatch
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


