---
"@wdio/devtools-backend": minor
---

Serve the page-side collector at `/api/collector`. Adapters used to locate the collector bundle on disk by walking up for `packages/script/dist/script.js`, which exists only in a monorepo checkout — an adapter installed from a package registry found nothing, and DOM replay silently disappeared while commands, console, network and screencast all kept working.

The backend now depends on `@wdio/devtools-script` and serves its source, resolved once at startup the same way the app bundle already is. That makes the collector version-matched to the backend by construction rather than pinned separately in every language, and a new adapter needs an HTTP GET instead of its own copy of a 200KB file. Resolution failure throws at startup rather than degrading, matching `getDevtoolsApp`: a backend that cannot hand out the collector is broken, and a silent failure here resurfaces as a mysteriously empty preview panel in whichever adapter connected.
