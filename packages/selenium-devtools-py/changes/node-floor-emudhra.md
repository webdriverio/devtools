---
minor
---

Node.js 22.23.4, 24.22.1, 26.12.1 or a later release of these lines is required on the PATH, where 22.19 was enough before. These are the first releases with the updated CA store for the eMudhra intermediate CA compromise, and the backend now requires them. `enable()` also refuses the odd lines (23, 25). Attaching to a backend someone else runs, via `DEVTOOLS_PORT`, still needs no local Node.
