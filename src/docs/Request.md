
# Request


## Properties

Name | Type
------------ | -------------
`text` | string
`textFields` | Array&lt;string&gt;
`textFieldWeights` | Array&lt;number&gt;
`requireAllTerms` | boolean
`alpha` | number
`rrfK` | number
`windowMult` | number
`indexName` | string
`indexKey` | string
`queryVectors` | Array&lt;Array&lt;number&gt;&gt;
`queryContents` | string
`topK` | number
`nProbes` | number
`rerankMult` | number
`greedy` | boolean
`filters` | { [key: string]: any; }
`include` | Array&lt;string&gt;

## Example

```typescript
import type { Request } from ''

// TODO: Update the object below with actual values
const example = {
  "text": null,
  "textFields": null,
  "textFieldWeights": null,
  "requireAllTerms": null,
  "alpha": null,
  "rrfK": null,
  "windowMult": null,
  "indexName": null,
  "indexKey": null,
  "queryVectors": null,
  "queryContents": null,
  "topK": null,
  "nProbes": null,
  "rerankMult": null,
  "greedy": null,
  "filters": null,
  "include": null,
} satisfies Request

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as Request
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


