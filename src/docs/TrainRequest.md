
# TrainRequest

Request model for training an index.  Attributes:     n_lists (Optional[int]): Number of lists/clusters for the index. Default is auto.     batch_size (Optional[int]): Size of each batch for training. Default is 2048.     max_iters (Optional[int]): Maximum iterations for training. Default is 100.     tolerance (Optional[float]): Convergence tolerance for training. Default is 1e-6.     max_memory (Optional[int]): Maximum memory (MB) usage during training. Default is 0 (no limit).

## Properties

Name | Type
------------ | -------------
`indexName` | string
`indexKey` | string
`nLists` | number
`batchSize` | number
`maxIters` | number
`tolerance` | number
`maxMemory` | number

## Example

```typescript
import type { TrainRequest } from ''

// TODO: Update the object below with actual values
const example = {
  "indexName": null,
  "indexKey": null,
  "nLists": null,
  "batchSize": null,
  "maxIters": null,
  "tolerance": null,
  "maxMemory": null,
} satisfies TrainRequest

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as TrainRequest
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


