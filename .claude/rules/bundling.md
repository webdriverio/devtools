---
paths:
  - "packages/*/package.json"
  - "packages/*/vite.config.ts"
  - "packages/*/tsup.config.ts"
  - "pnpm-workspace.yaml"
  - "tsup.dts.ts"
---

# Bundling

Scope: the private workspace packages `shared`, `trace` and `core`, which consumers inline, and CJS-only dependencies, which they externalise.

## Rules

- List each bundled workspace package a consumer imports (`shared`, `trace`, `core`) in that consumer's `devDependencies` as `workspace:^`, never in `dependencies`. Why: vite and tsup externalise `dependencies`, so a private package left external is an unresolvable import in the published dist.
- Do not add a private package to a bundler's `external`. Why: vite's callback receives both the bare name and the absolute path, and checking only one form externalises the other.
- Add a fourth private package to `PRIVATE_WORKSPACE_PACKAGES` in `packages/service/vite.config.ts` and to the explicit `packages:` list in `pnpm-workspace.yaml`. Why: a package missing from the array is externalised silently, and the dist dies at install with `ERR_MODULE_NOT_FOUND`.
- Build the declarations of the service, the backend, both Node.js adapters and `trace-query` with tsup and the root `tsup.dts.ts` `INLINE_PRIVATE_TYPES` option; the service, whose JavaScript vite builds, runs tsup for declarations only. Why: a `.d.ts` that imports a private package resolves to nothing for a consumer, so under `skipLibCheck` its types become `any` and an interface extending one loses its members; the JS leak grep does not see it, `packages/conformance/tests/published-declarations.test.ts` does once the packages are built.
- Make a vite `external` callback treat `./` and `../` relative imports alike. Why: a check that allows only `./` externalises subfolder imports such as `../constants.js`, which crash the same way.
- Keep a CJS-only dependency in `dependencies`, never inlined. Why: esbuild rewrites its `require` into a shim that throws `Dynamic require of "fs" is not supported` on load; `packages/backend/tests/dist-bundling.test.ts` asserts the shim is absent. `backend` lists `xpath` and `@xmldom/xmldom` there for `trace`'s page-source parsing.
- A package that ships a bundle lists its build-only libraries in `devDependencies`; a library that survives as a bare import in `dist/` is a runtime dependency and goes in `dependencies`. Why: everything in `dependencies` is installed by every consumer.
- After a bundler config or build-script change, run the leak grep: `grep -nE "(from|require\()\s*['\"](@wdio/devtools-(core|shared|trace)|.*/packages/(core|shared|trace)/)" packages/<pkg>/dist/*.js` must print nothing. Why: match the `from`/`require(` prefix, because `LIBRARY_NAME` and `Symbol.for` legitimately inline the bare package name as string values.
