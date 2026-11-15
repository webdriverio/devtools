---
paths:
  - "packages/*/package.json"
  - "packages/*/vite.config.ts"
  - "packages/*/tsup.config.ts"
  - "pnpm-workspace.yaml"
---

### Workspace-internal packages stay bundled

`packages/shared`, `packages/trace` and `packages/core` are `"private": true` and never published. Each consumer inlines their code into its own `dist/` at build time.

- All three are listed in `devDependencies` with `workspace:^`, never in `dependencies`. Vite and tsup both externalize anything in `dependencies` by default; `devDependencies` is what gets inlined.
- None of them is added to a bundler's `external` config. Vite's `external` callback receives both the bare package name *and* the resolved absolute path (e.g. `/Users/.../packages/core/src/index.ts`); a check for only one form silently externalizes the other.
- The service's callback enumerates the private packages, so **adding a fourth one means editing it** — a package missing from the list falls through to the default and is externalized silently, producing a dist that dies at install with `ERR_MODULE_NOT_FOUND`. It is a `PRIVATE_WORKSPACE_PACKAGES` array rather than a chain of `||`s for exactly that reason. Adding a workspace package also means adding it to `pnpm-workspace.yaml`, whose `packages:` list is explicit rather than a glob.
- The same callback receives bare relative imports (`./utils.js`, `../constants.js`). A check that allows only `./` will externalize `../`-style imports from subfolders and the dist crashes with `ERR_MODULE_NOT_FOUND` at install time.
- `packages/service/vite.config.ts` is the only config with the `external` callback, and the pattern to copy for a vite package. The tsup packages (`nightwatch-devtools`, `selenium-devtools`, `backend`) need no callback: their workspace-internal packages are `devDependencies`, which tsup inlines by default.
- After any change to a bundler config or build script, `grep -nE "(from|require\()\s*['\"](@wdio/devtools-(core|shared|trace)|.*/packages/(core|shared|trace)/)" packages/<pkg>/dist/*.js` should return nothing. That's how you catch the absolute-path leak. Match on the `from`/`require(` prefix, not the bare package name: `LIBRARY_NAME = "@wdio/devtools-core"` (written into the trace's `context-options`) and `Symbol.for("@wdio/devtools-core/assert-patched")` are inlined string *values* that legitimately survive bundling, so a bare-name grep always reports a false leak.

- A **CJS-only dependency must be externalized, not inlined**, or esbuild rewrites its `require` into a shim that throws `Dynamic require of "fs" is not supported` the moment the module loads. Declaring it in `dependencies` is what externalizes it; that is why all three adapters and `backend` list `yazl` there rather than in `devDependencies`. This is the opposite of the workspace-internal rule above, and for the same underlying reason: `dependencies` is externalized, `devDependencies` is inlined. Neither `pnpm build` nor `pnpm test` nor the leak grep notices — every one of them passes on a dist that dies on first import — so `packages/backend/tests/dist-bundling.test.ts` asserts the shim is absent.

Bundlers in use: **vite** for `app`, `service`, `script`; **tsup** for `backend`, `nightwatch-devtools`, `selenium-devtools`.

- **A published package that ships a BUNDLE declares its build libraries as `devDependencies`.** `app` and `script` each publish a vite build with everything inlined — the app's dist carries no bare import of lit, preact or codemirror, the script's none of htm, parse5 or preact — so listing those under `dependencies` installs a whole toolchain on every consumer that needs none of it. Measured against the registry: installing `@wdio/devtools-backend` cost **338 packages / 264 MB** with build libraries in `dependencies`, against **~85 / ~27 MB** without. Every adapter paid that; the Python one pays it hardest, since it fetches the backend at runtime. The test is the same grep as above — a bare import surviving in `dist/` means the dependency is real and belongs in `dependencies`; nothing surviving means it was build-time. Note this is the opposite default from the workspace-internal rule: there `devDependencies` is chosen so code is *inlined*, here it is chosen because the code *already* is.

