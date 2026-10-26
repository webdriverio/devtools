---
minor
---

Node.js 22.23.4, 24.22.1, 26.12.1 or a later release of these lines is required on the PATH, where 22.19 was enough before. These are the first releases with the updated CA store for the eMudhra intermediate CA compromise, and the backend now requires them. A Node release below the floor of its line, for example 22.22 or 24.21, worked before and now makes `enable()` raise a `RuntimeError` that names the version it found and the versions it needs; so do the odd lines (23, 25). Update Node on the PATH, or attach to a backend someone else runs via `DEVTOOLS_PORT`, which still needs no local Node.
