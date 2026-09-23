# Plan: Remove `any` from the JS/TS SDK public API surface
# Ticket: cyborginc/cyborgdb-core#2361
# Branch: agent/2361-remove-any-from-the-js-ts-sdk-public-api
# Spec: spec.md (verbatim copy of internal-docs/07-engineering-docs/specs/features/2361-remove-any-from-the-js-ts-sdk-public-api.md)

## Implementation steps

1. **`src/types.ts`** — Add generic wrapper types (`VectorItem<M>`, `UpsertRequest<M>`, `QueryResultItem<M>`, `QueryResponse<M>`, `GetResponseModel<M>`, `GetResultItem<M>`, `BatchQueryRequest`, `HTTPValidationError`) with constraint `M extends object = VectorMetadata`. Import the generated model types as a namespace alias (`import * as models from "./models"`) to use with `Omit<models.X, …>`. Make the existing `GetResultItem` interface generic.

2. **`src/index.ts`** — Fix `VERSION` explicit type: `export const VERSION: string = require("../package.json").version;`. Update the `export { … } from "./models"` re-export block to re-export the new hand-written types from `./types` in place of the generated generated interfaces for: `VectorItem`, `UpsertRequest`, `QueryResultItem`, `QueryResponse`, `GetResponseModel`, `GetResultItem`, `BatchQueryRequest`, `HTTPValidationError`. Keep all other generated re-exports (`CreateIndexRequest`, `DeleteRequest`, `ErrorResponseModel`, `GetRequest`, `IndexOperationRequest`, `MetadataFieldPolicy`, `MetadataResult`, `TrainRequest`, `BM25Config`) as-is from `./models`.

3. **`src/encryptedIndex.ts`** — Add per-call generics `<M extends object = VectorMetadata>` to `get`, `upsert`, `query` (public), `_upsertBinary`, `_queryBinary` (private). Update parameter types: `metadata` in upsert to `(M | null)[]`, return types to `Promise<GetResultItem<M>[]>` and `Promise<QueryResponse<M>>`. Remove the `item.contents as any` cast (`:484`) — the wrapper type now gives `contents?: string | Uint8Array | null`. Fix `existingIndexes as any` (`:144`) with a typed `unknown` narrow. Type `metric` parameter with the correct `createIndex` parameter type instead of `as any` (`:165`).

4. **`src/integrations/langchain/vectorstore.ts`** — Replace `declare FilterType: Record<string, any>` with `declare FilterType: FilterExpression` (import `FilterExpression` from `../types`). Replace `_callbacks?: any` with `_callbacks?: Callbacks` (import `Callbacks` from `@langchain/core/callbacks/manager`) on `similaritySearch` and `similaritySearchWithScore`. Update `maxMarginalRelevanceSearch` `options.filter` to `this["FilterType"]`. Remove the three `(results.results as any).results` casts (`:401`, `:472`, `:544`) — the `QueryResponse<M>` wrapper makes them unnecessary. Replace the `globalThis` shim cast (`:107`) with a typed `unknown` narrow.

5. **`biome.json`** — Set `suspicious.noExplicitAny` to `"error"` (currently `"off"` at line 19). Add an `overrides` entry scoped to `["src/__tests__/**"]` that sets `suspicious.noExplicitAny: "off"` so guarded test files (`kms.test.ts`, `ssl-verification.test.ts`) and other tests remain unaffected.

6. **`tsconfig.json`** — Uncomment `"noImplicitAny": true` at line 96 so the setting is explicit and survives a future removal of the `"strict": true` umbrella.

7. **`scripts/check-public-any.mjs`** (new file) — Implement the TypeScript compiler API walker: load `dist/index.d.ts`, walk every exported symbol's type recursively (properties, call/construct signature parameters and returns, type arguments, union/intersection members, index signatures, base types), stop at `node_modules/` declarations and at `dist/apis/**`/`dist/runtime.d.ts`, maintain a visited set. Exit non-zero and print the path on `TypeFlags.Any`. Include a self-test mode: load a tiny in-memory `.d.ts` fixture with `export declare const x: any` and assert non-zero exit.

8. **`package.json`** — Add `"test:types": "tsc --noEmit -p type-tests/tsconfig.json"` script. Add `"check-surface": "node scripts/check-public-any.mjs"` script.

9. **`type-tests/tsconfig.json`** (new file) — `{ "compilerOptions": { "strict": true, "noEmit": true, "rootDir": ".", "baseUrl": ".." }, "include": ["public-surface.ts"] }` referencing `../src/index.ts`.

10. **`type-tests/public-surface.ts`** (new file) — Type-level unit tests asserting:
    - `VectorItem<Meta>` rejects `metadata: { title: 1 }` (`// @ts-expect-error`) and accepts `{ title: "x" }`.
    - Interface-typed metadata compiles through `upsert` (items form and `ids`/`vectors`/`metadata` form).
    - `query<Meta>()` result items expose `metadata?.title` as `string | undefined` after narrowing the union arm.
    - Unparameterized `get()` metadata is `JsonValue`; `// @ts-expect-error` on `.toUpperCase()` without narrowing.
    - `CyborgVectorStore` filter rejects `{ date: new Date() }` and accepts `{ category: "a", price: { $gt: 1 } }`.
    - `IsAny<T>` (`0 extends 1 & T ? true : false`) returns `false` for `VERSION`, `VectorItem["metadata"]`, `QueryResultItem["metadata"]`, `BatchQueryRequest["filters"]`, and `HTTPValidationError["detail"][0]["input"]`.

11. **`type-tests/consumer/`** (new directory) — Standalone consumer project (`package.json` with `"strict": true`) that installs the `npm pack` tarball and compiles: README TypeScript snippets (with result narrow added), `docs/langchain-integration.md` snippets, a caller using interface-typed metadata, and a caller using the generic parameter explicitly.

12. **`.github/workflows/type-surface.yml`** (new file) — CI workflow triggered on `pull_request` and `push` to `main`. Steps: `npm ci`, `npm run build`, `node scripts/check-public-any.mjs`, `npm run test:types`. Declare explicit `permissions: contents: read`. No secrets required.

## Acceptance criteria

- [ ] `check-public-any.mjs` reports zero `any` on `dist/index.d.ts`, and its planted fixture fails.
- [ ] `npm run test:types` passes, including every `@ts-expect-error` rejection case above.
- [ ] `type-surface.yml` runs on PRs, and `npm run lint` fails on a newly added explicit `any` in `src/` outside `__tests__`.
- [ ] `src/__tests__` compile unchanged, and the README quickstart compiles in the consumer project.
- [ ] No file under a `guards/cyborgdb-js.paths` glob is modified.

## Files expected to change

- `src/index.ts` — fix `VERSION` type; re-point model re-exports at hand-written wrapper types
- `src/types.ts` — add generic wrapper types; make `GetResultItem` generic
- `src/encryptedIndex.ts` — add per-call generics to `get`, `upsert`, `query`, `_upsertBinary`, `_queryBinary`; remove `as any` casts; type `metric` and `existingIndexes`
- `src/integrations/langchain/vectorstore.ts` — `FilterType`, `_callbacks`, `filter`, internal casts
- `biome.json` — enable `noExplicitAny: "error"`, add `__tests__` override
- `tsconfig.json` — uncomment `noImplicitAny: true`
- `package.json` — add `test:types` and `check-surface` scripts
- `scripts/check-public-any.mjs` (new)
- `type-tests/tsconfig.json` (new)
- `type-tests/public-surface.ts` (new)
- `type-tests/consumer/package.json` (new)
- `type-tests/consumer/index.ts` (new)
- `.github/workflows/type-surface.yml` (new)

## Constraints

- **Generated code is not edited.** `src/apis/**`, `src/models/**`, `.openapi-generator/**` and `update-openapi-client.sh` are expertise-guarded (`guards/cyborgdb-js.paths`), and a hand edit gets reverted at the next regen. The generated types that leak `any` are replaced *at the export boundary* with hand-written types (§1, Decision 1). They are not fixed in place.
- **`any` that comes from `@langchain/core`'s own declarations** (for example the `Record<string, any>` default on `DocumentInterface`'s metadata, which `CyborgVectorStore` returns) belongs to the upstream package, and this spec leaves it alone. Only `any` written in this package is in scope.
- **The `EncryptedIndex` constructor's `api: DefaultApi` parameter** (`src/encryptedIndex.ts:58`) is left as is. The generated `DefaultApi`/`runtime.ts` internals behind it are opaque to the surface check (§1, Decision 5).
- **Per-call-shape overloads on `query()`** (single query returns `QueryResultItem[]`, batch returns `QueryResultItem[][]`) are out of scope. See §5, Decision 6.
- **Other type tightening that isn't about `any`**, such as narrowing `include?: string[]` to a literal union, is out of scope.
