---
"@wdio/devtools-backend": patch
---

The published tarball ships `dist` and the README only. Without a `files` field, and with no `.npmignore` in the package, npm was including every `.ts` in `src/` and the whole of `tests/`. That matters now that `npx @wdio/devtools-backend` is a supported entry point rather than an internal dependency.
