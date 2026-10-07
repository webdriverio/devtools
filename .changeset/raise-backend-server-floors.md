---
'@wdio/devtools-backend': patch
---

Raise the minimum versions of the dashboard server's dependencies: `fastify` to 5.12.5, `@fastify/static` to 10.1.5 and `@fastify/websocket` to 11.3.1. A fresh install already resolves these, but an existing lockfile could keep the older releases the previous ranges allowed.
