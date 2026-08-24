
# MetadataResult

One row of a ``query_metadata`` result: the item id, plus a BM25 score when there is one.  ``score`` is present only on the text path. A filter-only query has nothing to score, so the key is absent rather than ``None`` — the same rule ``query()`` follows for ``distance`` and ``score``. Callers do not branch in practice: whoever passed ``text`` knows the key is there.  Split across two TypedDicts because that is how a per-key optional is expressed before ``typing.NotRequired`` (3.11); the package supports 3.10, and inheriting with ``total=False`` keeps ``id`` required while making ``score`` optional — one result type, no union, no ``typing_extensions`` dependency.  Note the package ships no ``py.typed`` marker, so this reaches editors reading the source but not a consumer\'s mypy/pyright — see the plan\'s v2 note.

## Properties

Name | Type
------------ | -------------
`id` | string
`score` | number

## Example

```typescript
import type { MetadataResult } from ''

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "score": null,
} satisfies MetadataResult

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as MetadataResult
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


