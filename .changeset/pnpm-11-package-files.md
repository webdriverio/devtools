---
'@wdio/devtools-app': minor
'@wdio/devtools-script': minor
'@wdio/devtools-service': minor
---

The packages list their published files explicitly. `@wdio/devtools-app` now ships its built `dist/` and `CHANGELOG.md`: its sources, tests, test and build configuration, root `index.html` and `public/` are no longer in the tarball. Its `exports` now names `dist/index.html`, the page the backend serves; it named `src/index.ts`, a file no version has shipped. `@wdio/devtools-script` ships `dist/`, `src/`, `types.d.ts` and `CHANGELOG.md`: its tests, build configuration and root `index.html` are no longer in the tarball. `@wdio/devtools-service` ships `dist/`, `bin/`, `README.md` and `CHANGELOG.md`: `tsconfig.build.json` is no longer in the tarball.
