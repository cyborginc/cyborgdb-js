
# OrderBy

Metadata field to sort matches by, applied after filtering. Accepts a field name, or a single-field MongoDB-style dict such as {\'views\': -1} (1 ascending, -1 descending) which overrides `ascending`. Unordered when omitted. Items missing the field, or holding a non-scalar, sort last. Not supported with `text`.

## Properties

Name | Type
------------ | -------------

## Example

```typescript
import type { OrderBy } from ''

// TODO: Update the object below with actual values
const example = {
} satisfies OrderBy

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as OrderBy
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


