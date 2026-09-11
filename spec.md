---
title: "Feature Spec: TypeScript SDK — Packaging Test"
description: "Automated packaging validation for cyborgdb-js that checks build correctness, package.json metadata, and published file inclusion on every PR and v* tag."
owner: "@raili-cyborg"
author: "@cyborgdb-bot"
status: "draft"
last_reviewed: "2026-09-09"
---

# Feature Spec: TypeScript SDK — Packaging Test

## Feature buckets

- `Internal Infrastructure > CI/CD` — new workflow validates build and publish correctness before every release
- `Internal Infrastructure > Test Automation` — automated artifact-level validation of the published npm package

## 1. API contract

No new or changed API surface. This feature adds a CI workflow only; no SDK methods, REST endpoints, configuration schema, or user-facing behavior are modified.

Does not apply — no API contract entries.

## 2. Edge cases

All edge cases are build-artifact states the packaging test must detect and fail on:

| Edge case | Expected behavior |
|---|---|
| Build script exits non-zero (TypeScript compile error, esbuild failure) | `npm run build` step fails; `package-validation` job fails with non-zero exit |
| `dist/` present but missing CJS output (`dist/index.js`) | `npm pack --dry-run` does not list `dist/index.js`; file-list assertion fails |
| `dist/` present but missing ESM output (`dist/index.esm.js`) | `npm pack --dry-run` does not list `dist/index.esm.js`; file-list assertion fails |
| `dist/` present but missing type declarations (`dist/index.d.ts`) | `npm pack --dry-run` does not list `dist/index.d.ts`; file-list assertion fails |
| `package.json` `main` field absent or set to a wrong value | metadata assertion fails |
| `package.json` `module` field absent or set to a wrong value | metadata assertion fails |
| `package.json` `types` field absent or set to a wrong value | metadata assertion fails |
| `package.json` `name` field differs from `"cyborgdb"` | metadata assertion fails |
| `.npmignore` updated to exclude a previously-included expected file | `npm pack --dry-run` omits that file; file-list assertion catches the regression |
| `npm run build` run when `dist/` is stale or absent | the workflow runs `npm run build` unconditionally; stale contents are rebuilt |
| No source files in `src/` | build step fails; workflow fails before metadata or file-list checks run |

## 3. Encryption invariants and confidentiality claims

Does not apply. This feature introduces no new data path, no customer-secret handling, and no change to the plaintext boundary. Graph node `terminus/invariants` is unaffected; `component/cyborgdb-sdks` is touched only at the CI layer, not at the runtime layer.

## 4. Performance requirements

Does not apply. This is a CI automation job. No query-path latency, throughput, or memory budget applies. CI job runtime is unconstrained; it runs `npm install && npm run build && npm pack --dry-run` on `ubuntu-latest` with Node.js 22, consistent with existing CI (`.github/workflows/test.yml:13,22` and `.github/workflows/build_and_publish.yml:10,23`).

## 5. Architecture decisions

This feature depends on:

- `[ADR-0031](../../architecture-decisions/0031-cpp-as-source-of-truth.md)` — C++ core is the source of truth; SDKs are thin wrappers that marshal types and call in. Publishing the SDK correctly enforces the wrapper contract.

No new ADR is required. The load-bearing design decisions are documented below.

**Decision A — New standalone workflow `package-test.yml`, not a modification of existing workflows.**
Rejected alternative: embed packaging validation steps inside `.github/workflows/build_and_publish.yml`.
Reason: `.github/workflows/build_and_publish.yml`, `.github/workflows/test.yml`, and `.github/workflows/check_api_changes.yml` are in the agent pipeline's expertise-guard set for `cyborginc/cyborgdb-js`. New workflow files may be added; those three files may not be edited by an agent implementation. Adding a new file is the only safe path.

**Decision B — `npm pack --dry-run` for file-list validation, not a directory listing.**
Rejected alternative: `ls dist/` or `find dist/ -name "..."` assertions.
Reason: `npm pack --dry-run` respects both the `package.json` `files` array (`package.json:11-15`) and `.npmignore`, producing the canonical list of what will appear in the published tarball. A directory listing misses `.npmignore` exclusions and would pass for files that will never be published.

**Decision C — Validate `name`, `version`, `main`, `module`, `types`; assert `exports` is not required.**
Rejected alternative: assert that an `exports` field is present.
Reason: `package.json` (full file verified, `package.json:1-75`) contains no `exports` key. Asserting on an absent field requires adding an `exports` map, which is a separate scope change not called for by this ticket.

**Decision D — Validate `module` field even though the ticket body does not enumerate it.**
Rejected alternative: validate only the fields the ticket body lists (`name`, `version`, `main`, `types`).
Reason: the `module` field (`package.json:6`, value `"dist/index.esm.js"`) is the ESM entry point used by bundlers for tree-shaking and is present in the published package. Omitting it from metadata validation creates a gap where the ESM entry regresses silently.

## 6. Test acceptance criteria

The packaging test workflow is the deliverable. "Done" means all of the following hold:

- [ ] `package-test.yml` triggers on every PR opened or updated against `cyborgdb-js` main.
- [ ] `package-test.yml` triggers on every `v*` tag push to `cyborgdb-js`.
- [ ] On a PR with a clean build: the `package-validation` job passes and the status check is green.
- [ ] On a PR with a deliberate build error (e.g., a TypeScript syntax error in `src/index.ts`): `package-validation` fails with a non-zero exit in the build step.
- [ ] On a PR with a `package.json` `main` field deliberately removed: `package-validation` fails in the metadata check step.
- [ ] On a PR with `dist/index.esm.js` removed from the `package.json` `files` list: `package-validation` fails in the file-list check step.
- [ ] After the GitHub tag protection ruleset is configured (see open question 1): a `v*` tag push where the packaging test fails prevents `publish_to_npm` from running.

Layer assignments:
- Layer 1 (unit): N/A — no algorithmic logic.
- Layer 2 (API contract): N/A — no API surface change.
- Layer 3 (integration): the workflow itself is the integration test; the above acceptance items are the criteria.
- Layer 4 (perf): N/A.
- Layer 5 (reliability): N/A — no invariant touched.
- Layer 6 (dashboard): N/A.
- Layer 7 (LLM-driven): N/A — no user-facing surface changed.

## 7. Architecture claims not to be second-guessed

- **Do not edit `.github/workflows/build_and_publish.yml`, `.github/workflows/test.yml`, or `.github/workflows/check_api_changes.yml`.** These are in the agent pipeline's expertise-guard set. Add new workflow files only.
- **Use `npm pack --dry-run` for file-list validation, not `ls dist/`.** Decision B above explains why. The canonical test for "what will be published" is what npm itself reports.
- **Use Node.js 22 on `ubuntu-latest`.** Consistent with `.github/workflows/test.yml:13,22` and `.github/workflows/build_and_publish.yml:10,23`.
- **The blocking requirement on `v*` tag push is satisfied via a GitHub tag protection ruleset, not a `needs:` dependency in `build_and_publish.yml`.** See open question 1. The `publish_to_npm` job (`build_and_publish.yml:247-250`) cannot be edited.
- **The `package-validation` job name must match exactly what the tag protection ruleset requires.** Do not rename the job without coordinating with the ruleset configuration (open question 1).

## Open questions

### 1. **Who configures the GitHub tag protection ruleset that makes `package-validation` a required check on `v*` tags?**

Kind (a): human-only action — requires GitHub admin access to `cyborginc/cyborgdb-js`.

The `publish_to_npm` job (`build_and_publish.yml:247-250`) is in the pipeline's expertise-guard set and cannot be modified to add a `needs: [package-test]` dependency. To make the new packaging test block npm publish on a `v*` tag push, a GitHub admin must configure:

> GitHub Settings → Rules → Rulesets → add (or update) a tag ruleset targeting `refs/tags/v*` → "Require status checks to pass" → add the check named `package-validation` from the workflow `Package Test`.

Who can answer: @raili-cyborg (CI, deploy).
Closed when: the ruleset is in place and a dry-run `v*` tag push confirms that `publish_to_npm` does not proceed when `package-validation` fails.

## References

- [cyborginc/cyborgdb-core#763](https://github.com/cyborginc/cyborgdb-core/issues/763) — source ticket
- `[ADR-0031](../../architecture-decisions/0031-cpp-as-source-of-truth.md)` — C++ as source of truth; SDK wrapper contract
- No existing spec for packaging validation in `cyborgdb-js`; derived here.

Graph nodes consulted:
- `component/cyborgdb-sdks` — JS SDK component node; confirms packaging surface this spec validates
- `terminus/invariants` — verified no behavioral invariants are touched by a CI-only change
