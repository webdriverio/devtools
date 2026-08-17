---
"@wdio/devtools-backend": patch
---

Pick up the merged dependency updates for the server's own stack: `@fastify/rate-limit` 10 to 11 and `@fastify/static` 9 to 10, plus `@wdio/cli` 9.28.0 to 9.30.1 and `@wdio/logger` 9.18.0 to 9.29.1. All four are runtime dependencies, so the published ranges only change when the package is released — which matters more than usual now that `npx @wdio/devtools-backend` is a supported entry point and resolves them itself.
