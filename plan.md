# Implementation Plan — Issue #763: TypeScript SDK Packaging Test

## Implementation steps

1. Create `.github/workflows/package-test.yml` — set workflow `name: Package Test`; this name is the string the tag-protection ruleset must reference.
2. Add `on:` triggers to `.github/workflows/package-test.yml` — `pull_request` targeting `main` (types: `opened`, `synchronize`, `reopened`) and `push` matching tags `v*`.
3. Add top-level `permissions: contents: read` to `.github/workflows/package-test.yml` — baseline per the internal-docs universal rule; no additional permissions needed for this job.
4. Define the `package-validation` job in `.github/workflows/package-test.yml` — runs on `ubuntu-latest`; job name must be exactly `package-validation` to match the required tag-ruleset check name.
5. Add `actions/checkout@v4` and `actions/setup-node@v4` steps to `package-validation` — Node.js version `22`, consistent with `test.yml` and `build_and_publish.yml`.
6. Add `npm ci` install step to `package-validation`.
7. Add `npm run build` step to `package-validation` — runs unconditionally so stale or absent `dist/` is always rebuilt; this step fails and short-circuits all subsequent steps on any TypeScript or esbuild error.
8. Add metadata validation step to `package-validation` — use `node -e` (or `jq`) to read `package.json` and assert: `name === "cyborgdb"`, `main === "dist/index.js"`, `module === "dist/index.esm.js"`, `types === "dist/index.d.ts"`; exit non-zero on any mismatch.
9. Add file-list validation step to `package-validation` — run `npm pack --dry-run 2>&1` and assert that the output lists `dist/index.js`, `dist/index.esm.js`, and `dist/index.d.ts`; exit non-zero if any expected file is absent. Use `npm pack --dry-run` (not `ls dist/`) so `.npmignore` exclusions are respected.

## Acceptance criteria

- [ ] `package-test.yml` triggers on every PR opened or updated against `cyborgdb-js` main.
- [ ] `package-test.yml` triggers on every `v*` tag push to `cyborgdb-js`.
- [ ] On a PR with a clean build: the `package-validation` job passes and the status check is green.
- [ ] On a PR with a deliberate build error (e.g., a TypeScript syntax error in `src/index.ts`): `package-validation` fails with a non-zero exit in the build step.
- [ ] On a PR with a `package.json` `main` field deliberately removed: `package-validation` fails in the metadata check step.
- [ ] On a PR with `dist/index.esm.js` removed from the `package.json` `files` list: `package-validation` fails in the file-list check step.
- [ ] After the GitHub tag protection ruleset is configured (see open question 1): a `v*` tag push where the packaging test fails prevents `publish_to_npm` from running.

## Files expected to change

- `.github/workflows/package-test.yml` (new file — the sole deliverable)
