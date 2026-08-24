
# BinaryQueryBatch

Represents a batch of query vectors in binary format for efficient transfer.  Attributes:     vectors_b64 (str): Base64-encoded float32 numpy array (shape: n_queries x dimension).     dimension (int): The dimension of each vector.

## Properties

Name | Type
------------ | -------------
`vectorsB64` | string
`dimension` | number

## Example

```typescript
import type { BinaryQueryBatch } from ''

// TODO: Update the object below with actual values
const example = {
  "vectorsB64": null,
  "dimension": null,
} satisfies BinaryQueryBatch

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BinaryQueryBatch
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


