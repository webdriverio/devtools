---
minor
---

Node.js 22.23.4, 24.22.1, 26.12.1 or a later release of these lines is required on the PATH, where 22.19 was enough before. These are the first releases with the updated CA store for the eMudhra intermediate CA compromise, and the backend now requires them. With a Node release below the floor of its line, for example 22.22 or 24.21, which worked before, `enable()` now logs a warning (`could not start dashboard (...); continuing without capture`) that names the version it found and the versions it needs, then returns `None`, and the run continues without capture; `selenium-devtools install-backend` prints that error and exits with code 1. The odd lines (23, 25) behave the same. Update Node on the PATH, or attach to a backend someone else runs via `DEVTOOLS_PORT`, which still needs no local Node.
