
# MetadataFieldPolicy

Per-field metadata indexing policy (one entry of `metadata_schema`).  Metadata itself stays schemaless — this is indexing policy, not validation.  Fields omitted from `metadata_schema` inherit the index-everything default.  Attributes:     filterable: Build inverted-index postings for the field, so         filters on it resolve from the index (pre-filter).  When         `false`, the field is still stored and still filterable, but         a filter referencing it forces the dense forward-blob         post-filter path — cheaper writes, slower filtered queries.     pattern: Additionally build the field\'s regex dictionary, which         makes `$regex` / `$contains` resolvable from the index.         Requires `filterable=true`.     full_text: Route the field\'s string value through the BM25         analyzer instead of exact-match indexing.  This is what makes         the field searchable by `query_metadata(text=...)` and hybrid         `query(text=...)`.  A field is either analyzed or exact-match         indexed, so `full_text=true` is incompatible with both         `pattern=true` and an explicit `filterable=true`, and implies         `filterable=false`.

## Properties

Name | Type
------------ | -------------
`filterable` | boolean
`pattern` | boolean
`fullText` | boolean

## Example

```typescript
import type { MetadataFieldPolicy } from ''

// TODO: Update the object below with actual values
const example = {
  "filterable": null,
  "pattern": null,
  "fullText": null,
} satisfies MetadataFieldPolicy

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as MetadataFieldPolicy
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


