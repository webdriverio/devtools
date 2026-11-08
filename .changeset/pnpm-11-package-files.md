---
'@wdio/devtools-app': patch
'@wdio/devtools-script': patch
---

The packages list their published files explicitly. `@wdio/devtools-app` now ships only its built `dist/`: its sources, tests, test and build configuration, root `index.html`, `public/` and `CHANGELOG.md` are no longer in the tarball. `@wdio/devtools-script` ships `dist/`, `src/` and `types.d.ts`: its tests, build configuration, root `index.html` and `CHANGELOG.md` are no longer in the tarball.
