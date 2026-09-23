---
title: "Feature Spec: Remove `any` from the JS/TS SDK public API surface"
description: "Replace every `any` reachable from cyborgdb-js's exported declarations with real types, add a caller-supplied metadata generic, and gate regressions with Biome, a declaration-surface check, and a strict consumer compile."
owner: "@ahellegit"
author: "@cyborgdb-bot"
status: "draft"
last_reviewed: "2026-09-23"
---

# Feature Spec: Remove `any` from the JS/TS SDK public API surface

## Feature buckets

- `Compatibility > SDKs > JavaScript/TypeScript`
- `Internal Infrastructure > Code Quality`

## Terminology note

"Index" appears in this spec only inside code identifiers (`EncryptedIndex`, `createIndex`, `loadIndex`, `indexKey`) and in the verbatim TypeScript compiler message "Index signature for type 'string' is missing", where it means a TS index signature, not the container. The canonical prose term for the container is "collection" per [ADR-0022](../../architecture-decisions/0022-rename-index-to-collection.md), and identifiers are quoted as written per [`glossary.md`](../../terminus/glossary.md) rule 1. "Record" and "payload" appear only when naming competitor types (Pinecone `RecordMetadata`/`PineconeRecord`, Qdrant `Payload`). Those comparisons are deliberate, and the CyborgDB terms are "item" and "contents".

## Scope and non-goals

**In scope:** `cyborgdb-js` (label `repo:cyborgdb-js`). The surface is the package's exported type declarations (`dist/index.d.ts` and everything it names), made of hand-written `src/index.ts`, `src/types.ts`, `src/encryptedIndex.ts`, `src/client.ts` and `src/integrations/langchain/vectorstore.ts`. It also covers the lint config (`biome.json`), `tsconfig.json`, and a new type-test directory and CI workflow.

**Non-goals:** None (the ticket has no Non-goals field). Boundaries set while drafting, each with its reason:

- **Generated code is not edited.** `src/apis/**`, `src/models/**`, `.openapi-generator/**` and `update-openapi-client.sh` are expertise-guarded (`guards/cyborgdb-js.paths`), and a hand edit gets reverted at the next regen. The generated types that leak `any` are replaced *at the export boundary* with hand-written types (§1, Decision 1). They are not fixed in place.
- **`any` that comes from `@langchain/core`'s own declarations** (for example the `Record<string, any>` default on `DocumentInterface`'s metadata, which `CyborgVectorStore` returns) belongs to the upstream package, and this spec leaves it alone. Only `any` written in this package is in scope.
- **The `EncryptedIndex` constructor's `api: DefaultApi` parameter** (`src/encryptedIndex.ts:58`) is left as is. The generated `DefaultApi`/`runtime.ts` internals behind it are opaque to the surface check (§1, Decision 5).
- **Per-call-shape overloads on `query()`** (single query returns `QueryResultItem[]`, batch returns `QueryResultItem[][]`) are out of scope. See §5, Decision 6.
- **Other type tightening that isn't about `any`**, such as narrowing `include?: string[]` to a literal union, is out of scope.

## Copyability

**Verdict:** Copyable

The matching OSS behavior is typed, generic record metadata in a vector-DB TypeScript client:

- Pinecone's Apache-2.0 TypeScript client declares `class Index<T extends RecordMetadata = RecordMetadata>` and `PineconeRecord<T extends RecordMetadata = RecordMetadata>` (`pinecone-io/pinecone-ts-client`, `src/data/index.ts`, `src/data/vectors/types.ts`).
- Qdrant's JS REST client types the payload as `{ [key: string]: unknown }` (`qdrant/qdrant-js`, `packages/js-client-rest/src/openapi/generated_schema.ts`, `Payload`).

This spec copies both: a generic with a safe default, and `unknown` where a value really is dynamic. None of the four disqualifiers fire. The change is compile-time only, with no bulk read, no crypto representation, no plaintext scoring, and no runtime or wire effect. No `specs/research/` doc covers this surface. The `competitive-landscape/` folders have no notes on SDK typing. The canonical snapshot (`04-marketing/content-ops/reference/competitors.md`, `last_reviewed: 2026-09-18`) is inside its 60-day refresh window but doesn't cover SDK typing either, so the two upstream sources above were read directly on 2026-09-23.

## 1. API contract

This change is types only, with no runtime behavior change. It does not touch any REST endpoint or wire shape (graph node `terminus/api-contract`: SDK-layer only). Deployment mode: Service (JS SDK). There is no auth change.

### Current state (verified against source, `cyborginc/cyborgdb-js` default branch)

I measured the exported declaration surface by running `tsc --emitDeclarationOnly` on a scratch copy. That run found `any` in these places:

| Exported name | Where the `any` comes from | Source |
|---|---|---|
| `VERSION` | `require("../package.json").version` types as `any` | `src/index.ts:2` |
| `VectorItem` (and `UpsertRequest.items`) | `metadata?: { [key: string]: any } \| null` | `src/models/VectorItem.ts:56` (generated) |
| `QueryResultItem` | `metadata?: { [key: string]: any } \| null` | `src/models/QueryResultItem.ts:56` (generated) |
| `GetResponseModel` → `GetResultItemModel` | `metadata?: { [key: string]: any } \| null` | `src/models/GetResultItemModel.ts:38` (generated) |
| `BatchQueryRequest` | `filters?: { [key: string]: any } \| null` | `src/models/BatchQueryRequest.ts:125` (generated) |
| `HTTPValidationError` → `ValidationError` | `input?: any \| null` | `src/models/ValidationError.ts:50` (generated) |
| `CyborgVectorStore.FilterType` | `Record<string, any>` | `src/integrations/langchain/vectorstore.ts:38` |
| `CyborgVectorStore.similaritySearch` / `similaritySearchWithScore` | `_callbacks?: any` | `src/integrations/langchain/vectorstore.ts:372`, `:443` |
| `CyborgVectorStore.maxMarginalRelevanceSearch` | `filter?: Record<string, any>` | `src/integrations/langchain/vectorstore.ts:616` |

Two more places behave like `any` for callers without literally being `any`. Both are empty generated interfaces:

- `QueryResponse.results: Results`, where `interface Results {}` (`src/models/Results.ts:21`). `EncryptedIndex.query` returns this (`src/encryptedIndex.ts:605`). Every consumer has to cast to read results. The SDK's own LangChain integration does this three times (`(results.results as any).results`, `vectorstore.ts:401`, `:472`, `:544`), and the README quickstart's `results.results.forEach(result => result.id)` doesn't compile as written.
- `VectorItem.contents?: Contents`, where `interface Contents {}` (`src/models/Contents.ts:20`). This is why `src/encryptedIndex.ts:484` casts with `item.contents as any`.

Already correct, so no change needed:

- `GetResultItem.metadata?: VectorMetadata` (`src/types.ts:168`), with `VectorMetadata = JsonObject` (`src/types.ts:37`).
- `FilterExpression` (`src/types.ts:49`), used by `query` and `queryMetadata`.
- `CyborgDBErrorContext.cause?: unknown` (`src/errors.ts:82`).

Gates as they stand today:

- `tsconfig.json:95` sets `"strict": true`, which already turns on `noImplicitAny`. The explicit line is commented out at `tsconfig.json:96`.
- CI type-checks through `npm run build` (`.github/workflows/test.yml:128`), which runs `tsc --emitDeclarationOnly` (`package.json:21`).
- Biome runs through `npm run lint` → `biome check src` (`package.json:23`, `.github/workflows/test.yml:29`), with `suspicious.noExplicitAny: "off"` (`biome.json:19`).
- `biome.json` excludes `src/models/**` and `src/runtime.ts` (`biome.json:8-9`), and the rule wouldn't catch `VERSION` anyway, because that `any` is implicit from `require`. Turning the rule on flags exactly 12 hand-written sites: `client.ts:121`, `encryptedIndex.ts:484`, and 10 in `integrations/langchain/vectorstore.ts`. `src/__tests__/*.ts` contains further `any` uses, including in the guarded `ssl-verification.test.ts`.

### Decision 1 — Hand-written public model types replace the generated re-exports

Add hand-written types in `src/types.ts` under the same names, and point the `export { … } from "./models"` block in `src/index.ts:34-50` at them instead of the generated interfaces. The names stay the same, so `import { VectorItem } from "cyborgdb"` keeps working. `M extends object = VectorMetadata` throughout, with `VectorMetadata` as the default.

| Exported name | New definition |
|---|---|
| `VectorItem<M>` | `Omit<models.VectorItem, "metadata" \| "contents"> & { metadata?: M \| null; contents?: string \| Uint8Array \| null }` |
| `UpsertRequest<M>` | `Omit<models.UpsertRequest, "items"> & { items: VectorItem<M>[] }` |
| `QueryResultItem<M>` | `Omit<models.QueryResultItem, "metadata"> & { metadata?: M \| null }` |
| `QueryResponse<M>` | `Omit<models.QueryResponse, "results"> & { results: QueryResultItem<M>[] \| QueryResultItem<M>[][] }` |
| `GetResponseModel<M>` | `Omit<models.GetResponseModel, "results"> & { results: (Omit<models.GetResultItemModel, "metadata"> & { metadata?: M \| null })[] }` |
| `GetResultItem<M>` | the existing interface (`src/types.ts:156`), made generic: `metadata?: M` |
| `BatchQueryRequest` | `Omit<models.BatchQueryRequest, "filters"> & { filters?: FilterExpression \| null }` |
| `HTTPValidationError` | `Omit<models.HTTPValidationError, "detail"> & { detail?: (Omit<models.ValidationError, "input"> & { input?: unknown })[] }` |

The generated types whose exported surface has no `any` stay as plain re-exports: `CreateIndexRequest`, `DeleteRequest`, `ErrorResponseModel`, `GetRequest`, `IndexOperationRequest`, `MetadataFieldPolicy`, `MetadataResult`, `TrainRequest`, `BM25Config`. The §6 surface check keeps that true.

- *Rejected:* configure openapi-generator (`typeMappings`, AnyType→`unknown`) and regenerate. That would fix the types at the source and help all three SDKs, but the regenerated output lands in guarded paths and the guard blocks this PR. It is a candidate follow-up for a human-led regen (open question 3).
- *Rejected:* `M extends VectorMetadata` as the constraint. See Decision 2.

### Decision 2 — Constraint `M extends object`, default `VectorMetadata`

The generic *constraint* is `object`. The *default* is `VectorMetadata` (`JsonObject`).

- The constraint has to be `object`. On `tsc` 6.0.3 (the version pinned in `package.json`), an interface-typed value like `interface Meta { title: string }` is **not** assignable to `JsonObject`, and not to `Record<string, unknown>` either (TS2322, "Index signature for type 'string' is missing"). It **is** assignable to today's `{ [key: string]: any }`. A `JsonObject` or `Record` constraint would therefore break existing correct callers who pass interface-typed metadata, which violates the "existing correct callers compile without changes" criterion.
- The default is `VectorMetadata` because it is the SDK's existing precedent: `get()` already returns `metadata?: VectorMetadata` (`src/types.ts:168`). Reading an unparameterized field gives `JsonValue`, which callers narrow with `isJsonValue` (already exported, `src/types.ts`) or `typeof`, or they supply `M` instead.
- *Rejected:* default `Record<string, unknown>` (the Qdrant shape). It is equally strict to read, but it would make `get()` and `query()` disagree with the existing `GetResultItem`.

### Decision 3 — `EncryptedIndex` methods take the generic per call

- `upsert<M extends object = VectorMetadata>({ items?: VectorItem<M>[]; ids?; vectors?; metadata?: (M | null)[]; contents?: (string | null)[] })`. `metadata` was `(Record<string, unknown> | null)[]` (`src/encryptedIndex.ts:279`). That widens the accepted input, because interface-typed arrays now compile. The private `_upsertBinary` (`:941`) follows.
- `query<M extends object = VectorMetadata>(…): Promise<QueryResponse<M>>` (`:571`, `:605`). The private `_queryBinary` (`:1065`) follows.
- `get<M extends object = VectorMetadata>(…): Promise<GetResultItem<M>[]>` (`:173`).
- *Rejected:* a class-level generic `EncryptedIndex<M>` threaded through `CyborgDB.createIndex` / `loadIndex`. That is Pinecone's shape, but it widens the change to `client.ts`'s factory signatures. A per-call generic gives the same checking with a smaller diff. A class-level generic can be layered on later without breaking callers, because a class generic can default to the same type.

### Decision 4 — LangChain integration

- `declare FilterType: FilterExpression`, replacing `Record<string, any>` (`vectorstore.ts:38`). This is compatible with the base `VectorStore.FilterType: object | string` in `@langchain/core`, and a caller's `Record<string, any>` filter is still assignable to it (checked with `tsc`).
- `_callbacks?: Callbacks` from `@langchain/core/callbacks/manager`, which matches the base-class signatures of `similaritySearch` and `similaritySearchWithScore`.
- `maxMarginalRelevanceSearch` `options.filter?: this["FilterType"]`.
- Internal casts: remove the `(results.results as any).results` casts, which Decision 1's `QueryResponse` typing makes unnecessary. Replace `existingIndexes as any` (`:144`) with a narrowed `unknown`. Type `metric` as the `createIndex` parameter type instead of `as any` (`:165`). Replace the `globalThis` shim cast (`:107`) with a typed `unknown` narrow.

### Decision 5 — Regression gates

1. **Biome:** set `suspicious.noExplicitAny: "error"` in `biome.json`, with an `overrides` entry turning it `"off"` for `src/__tests__/**`. Biome can't scope a rule to exported declarations, so the rule bans explicit `any` in all hand-written `src`. That is stricter than the ticket asks, and it costs only the 12 sites listed above. The tests are exempt because they aren't public surface and include a guarded file.
   - *Rejected:* adding ESLint with `@typescript-eslint/no-explicit-any` to scope the rule to exports. That would add a second linter to a Biome repo for a narrower rule.
2. **`noImplicitAny`:** uncomment `"noImplicitAny": true` (`tsconfig.json:96`) so it survives a future change to `strict`. It is already enforced by `strict` and CI's `npm run build`.
3. **Declaration-surface check:** `scripts/check-public-any.mjs`, run after `npm run build`. It uses the TypeScript compiler API on `dist/index.d.ts` and walks every exported symbol's type recursively: properties, call/construct signature parameters and returns, type arguments, union and intersection members, index signatures, and base types. It exits non-zero on any type with `TypeFlags.Any` and prints the path to it (`VectorItem.metadata`). The walker stops at declarations under `node_modules/` (upstream-owned) and at `dist/apis/**` and `dist/runtime.d.ts` (generated client internals, reachable only through the `EncryptedIndex` constructor), and it keeps a visited set. This is the only gate that catches `VERSION` and a regen that reintroduces `any` into a re-exported generated type.
   - *Rejected:* a text grep of `dist/**/*.d.ts`. It can't tell reachable from unreachable, because the generated `*FromJSON(json: any)` helpers sit in reachable files without being exported by name.
4. **New workflow** `.github/workflows/type-surface.yml` on `pull_request` and `push` to `main`: `npm ci`, `npm run build`, `node scripts/check-public-any.mjs`, `npm run test:types` (§6). It needs no service or secrets. It is a new file because `test.yml`, `build_and_publish.yml` and `check_api_changes.yml` are guarded. Biome and `tsc` already run in `test.yml`, so the `biome.json`/`tsconfig.json` changes take effect there with no edit.

### `VERSION`

`export const VERSION: string = require("../package.json").version;` (`src/index.ts:2`).

- *Rejected:* `import { version } from "../package.json"`. That needs `resolveJsonModule` and moves `package.json` under `rootDir: ./src` (`tsconfig.json`), which is a config change for no gain.

### Error conditions

None added or changed. This work adds nothing to `terminus/error-catalog-template`.

## 2. Edge cases

- **Interface-typed metadata** (`interface Meta {…}`; `upsert({ items: [{ id, vector, metadata: m as Meta }] })`): compiles, and `M` is inferred as `Meta` (Decision 2). Type test required.
- **Unparameterized read** (`(await index.get({ ids }))[0].metadata?.title`): typed `JsonValue`, and calling `.toUpperCase()` without narrowing is a compile error. This is the intended tightening, and the same as `get()` today.
- **Parameterized read** (`index.query<Meta>({…})`): `results` items carry `metadata?: Meta | null`. Type test required.
- **Existing `as any` / `as QueryResultItem[]` casts on `results`**: still compile, because a cast from the union to one member is allowed.
- **README quickstart** (`results.results.forEach(r => r.id)`): still doesn't compile under the union (the element type is `QueryResultItem | QueryResultItem[]`). This isn't a regression, because it doesn't compile today against `{}`. The README gains an explicit narrow; the overload fix is deferred (§5, Decision 6).
- **Non-JSON metadata values** (`{ when: new Date() }`): still compile under `M extends object`, as today, and still serialize through `JSON.stringify` at runtime. Rejecting these at compile time would break correct callers who pass interface-typed metadata.
- **`contents` as `number[]`**: the new type `string | Uint8Array | null` rejects it. Today's `{}` accepted it, and `Buffer.from(number[])` works at runtime (`encryptedIndex.ts:484`). No in-repo caller does this: every non-string `contents` in `src/__tests__` is a `Buffer`. The case is written down because it is the one input a correct caller could previously pass that now fails. See open question 1.
- **`HTTPValidationError.detail[].input`**: now `unknown`, so readers must narrow.
- **LangChain filter typed `Record<string, any>` by the caller**: still assignable to `FilterExpression`.
- **Empty inputs, boundary sizes, concurrency, partial failure, idempotency, missing prerequisites, key handling, cross-tenant**: N/A. The change is compile-time only and doesn't change runtime control flow.

## 3. Encryption invariants and confidentiality claims

Does not apply. `terminus/invariants` is untouched. There is no new data path and no change to key handling (`indexKey` handling in `encryptedIndex.ts` is unchanged). The guarded `kms.test.ts` and `ssl-verification.test.ts` aren't edited.

## 4. Performance requirements

Does not apply. `terminus/performance-budgets` is untouched. Type-only changes are erased by esbuild (`package.json:19-20`), so the emitted JS changes only where a cast is replaced with a narrow. The new CI job has no budget.

## 5. Architecture decisions

- [ADR-0031](../../architecture-decisions/0031-cpp-as-source-of-truth.md): "Language-specific ergonomics" and "type marshalling" are SDK-layer concerns. Typing the JS surface belongs in the SDK and needs no core change. Cross-SDK parity isn't affected, because Python and Go have no `any` counterpart to mirror.
- No new ADR proposed. Whether the tightening counts as a "change to a field's type" under `terminus/api-contract` "What counts as a breaking change" (which would require an ADR) is open question 1.

**Decision 6 — no per-call-shape overloads.** `query()` collapses a nested result to a single level only when `isSingleQuery` is true (`encryptedIndex.ts:686-694`). That is set only for a 1-D `number[]` input. For `queryContents` alone and for the `Float32Array` binary path, the shape depends on the service response, which the source doesn't pin. An overload set would promise shapes the code doesn't guarantee. The union is honest, and overloads can follow once those shapes are specified.

## 6. Test acceptance criteria

- **Type-level unit tests (Layer 1):** `type-tests/public-surface.ts`, compiled by `tsc --noEmit -p type-tests/tsconfig.json` (strict), run as `npm run test:types`. The tests import from `../src/index`. Rejection cases use `// @ts-expect-error`, so an unexpectedly-accepting type fails the compile. No new dependency; *rejected:* `tsd` / `expect-type`. The tests assert:
  - `VectorItem<Meta>` rejects `metadata: { title: 1 }` when `Meta = { title: string }`, and accepts `{ title: "x" }`.
  - Interface-typed metadata passes through `upsert` (items form and `ids`/`vectors`/`metadata` form).
  - `query<Meta>()` result items expose `metadata?.title` as `string | undefined` (after narrowing the union arm).
  - Unparameterized `get()` metadata field is `JsonValue`. `// @ts-expect-error` on `.toUpperCase()` without a narrow.
  - `CyborgVectorStore` filter rejects `{ date: new Date() }` and accepts `{ category: "a", price: { $gt: 1 } }`.
  - `IsAny<T>` helper (`0 extends 1 & T ? true : false`) asserts `false` for `VERSION`, `VectorItem["metadata"]`, `QueryResultItem["metadata"]`, `BatchQueryRequest["filters"]`, and `HTTPValidationError["detail"]` element `input`.
- **Surface check:** `node scripts/check-public-any.mjs` exits 0 on the built package. It also has a self-test fixture (a tiny `.d.ts` with a planted `export declare const x: any`) that must make it exit non-zero.
- **Integration (Layer 3):** `type-tests/consumer/`, a standalone project with `"strict": true` that installs the `npm pack` tarball of the built package and compiles:
  - the README TypeScript snippets, with the quickstart's result narrow added;
  - `docs/langchain-integration.md` snippets;
  - a caller using interface-typed metadata and a caller using the generic.
- **Existing suite:** `npm run lint` passes with `noExplicitAny: "error"`. `npm run build` passes. Existing `src/__tests__` compile unchanged under ts-jest (they are the corpus for "existing correct callers compile without changes").
- **Layer 7:** flag for the next LLM-driven test run. This touches the SDK API shape and quickstart (T15 docs-as-tests).

This feature is done when:

- `check-public-any.mjs` reports zero `any` on `dist/index.d.ts`, and its planted fixture fails.
- `npm run test:types` passes, including every `@ts-expect-error` rejection case above.
- `type-surface.yml` runs on PRs, and `npm run lint` fails on a newly added explicit `any` in `src/` outside `__tests__`.
- `src/__tests__` compile unchanged, and the README quickstart compiles in the consumer project.
- No file under a `guards/cyborgdb-js.paths` glob is modified.

## 7. Architecture claims not to be second-guessed

- **Do not hand-edit `src/apis/**`, `src/models/**`, `.openapi-generator/**`, or `update-openapi-client.sh`.** They are regenerated from `openapi.json`, and any hand edit is reverted. Source: `guards/cyborgdb-js.paths`; SDK regen per [`../../development/workflows/openapi-sdk-regen.md`](../../development/workflows/openapi-sdk-regen.md).
- **Do not edit `.github/workflows/test.yml`, `build_and_publish.yml`, or `check_api_changes.yml`.** Add `type-surface.yml` instead. Source: `guards/cyborgdb-js.paths`.
- **Typing is SDK-layer work** per [ADR-0031](../../architecture-decisions/0031-cpp-as-source-of-truth.md) ("Boundary — what lives in the SDK layer"). No core or service change is needed.

## Open questions

### 1. **Does `api-contract.md`'s ADR requirement apply to a type-only tightening?**

Kind (a), a breaking-change classification. Pre-1.0, breaking changes ship with no compat shims (root `CLAUDE.md`, "Pre-1.0, no backwards compatibility"), so this spec adds no compat work either way. Separately, `terminus/api-contract` "What counts as a breaking change" lists "changing a field's type" and requires an ADR plus a release migration note. Two things change for callers:

- Reads of unparameterized metadata go from `any` to `JsonValue`, so un-narrowed property access stops compiling.
- `contents` rejects `number[]` (see the `contents` edge case).

The runtime and wire behavior are unchanged. The drafter's recommendation: no ADR, and one release-note line ("narrow metadata or pass a type parameter"). The ticket already describes the change as "type signatures tighten; source-compatible for correct callers". That call is policy, though.

- **Who can answer:** @dupontcyborg (breaking-change classification).
- **What closes it:** a ruling on the spec PR: release note only, or ADR plus release note.

### 2. **Does the consumer compile pass on Node 18 with the pinned TypeScript?**

Kind (b), a runtime fact. `package.json` declares `engines.node >=18.0.0` and `typescript ^6.0.3`. The workflow's Node version and whether `npm pack` + install of the tarball works offline in CI can only be seen in a run.

- **Who can answer:** the implementer.
- **What closes it:** the first `type-surface.yml` run on the implementation PR (`npm ci && npm run build && npm run test:types`).

### 3. **Should the generator-side fix (`typeMappings` AnyType→`unknown`) be filed for all three SDKs?**

Kind (a), ownership and scope of a follow-up. Decision 1 fixes JS at the export boundary because regen output is guarded. Fixing it at generation time would drop the wrapper types and help `cyborgdb-py` and `cyborgdb-go` too, but it is a human-led regen across three repos.

- **Who can answer:** @ahellegit (build/codegen).
- **What closes it:** file a ticket, or record "not worth it".

## References

- Source issue: `cyborginc/cyborgdb-core#2361`; epic `cyborginc/cyborgdb-core#816` (JavaScript/TypeScript SDK compatibility, open).
- Adjacent spec: [`763-typescript-sdk-create-packaging-test.md`](./763-typescript-sdk-create-packaging-test.md) (`cyborgdb-core#763`, open, not landed). Its packaging workflow and this spec's consumer compile both build and pack the SDK. They are independent, and neither blocks the other.
- Graph nodes consulted: `component/cyborgdb-sdks`, `terminus/api-contract`, `terminus/invariants`, `terminus/performance-budgets`, `terminus/glossary`, `adr-0031`.
- Prior art consulted: `07-engineering-docs/terminus/spec-template.md`, `07-engineering-docs/terminus/api-contract.md`, `07-engineering-docs/terminus/error-catalog-template.md` (no catalog change), `07-engineering-docs/terminus/glossary.md`, `07-engineering-docs/architecture-decisions/0031-cpp-as-source-of-truth.md`, `07-engineering-docs/specs/features/763-typescript-sdk-create-packaging-test.md`, `07-engineering-docs/specs/features/1235-js-sdk-typed-errors-and-url-validation.md` (guarded-path conventions), `07-engineering-docs/development/workflows/openapi-sdk-regen.md`; competitive landscape: `01-market-intelligence/competitive-landscape/{pinecone,qdrant}/` (none found for this feature area), `04-marketing/content-ops/reference/competitors.md` (no SDK-typing coverage); upstream sources read directly: `pinecone-io/pinecone-ts-client` `src/data/index.ts`, `src/data/vectors/types.ts`; `qdrant/qdrant-js` `packages/js-client-rest/src/openapi/generated_schema.ts`.
