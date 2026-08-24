
# IndexTrainingStatusResponseModel

Response model for retrieving the training status of indexes.  Attributes:     training_indexes (List[str]): List of index names currently being trained or queued.     retrain_threshold (int): Vector-count floor before the first training (was the         retrain multiplier; field name kept stable for SDK compatibility).     currently_training (Optional[str]): Name of the index currently being trained.     queued_indexes (List[str]): List of indexes queued for training.     worker_running (bool): Whether the training worker thread is running.     worker_pid (int): Deprecated - kept for backward compatibility with SDK.     global_training (Dict[str, Any]): Deprecated - kept for backward compatibility with SDK.

## Properties

Name | Type
------------ | -------------
`trainingIndexes` | Array&lt;string&gt;
`retrainThreshold` | number
`currentlyTraining` | string
`queuedIndexes` | Array&lt;string | null&gt;
`workerRunning` | boolean
`workerPid` | number
`globalTraining` | { [key: string]: any; }

## Example

```typescript
import type { IndexTrainingStatusResponseModel } from ''

// TODO: Update the object below with actual values
const example = {
  "trainingIndexes": null,
  "retrainThreshold": null,
  "currentlyTraining": null,
  "queuedIndexes": null,
  "workerRunning": null,
  "workerPid": null,
  "globalTraining": null,
} satisfies IndexTrainingStatusResponseModel

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as IndexTrainingStatusResponseModel
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


