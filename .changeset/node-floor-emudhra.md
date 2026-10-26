---
'@wdio/devtools-backend': minor
'@wdio/devtools-service': minor
'@wdio/selenium-devtools': minor
'@wdio/nightwatch-devtools': minor
---

Require Node.js 22.23.4, 24.22.1, 26.12.1 or a later release of these lines. These are the first releases with the updated CA store for the eMudhra intermediate CA compromise ("ca-cert (eMudhra Intermediate CA Compromise) on 26.x, 24.x, 22.x" in the [October 2026 security releases](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)). Older versions trust intermediates whose private keys are public. `engines` only warns, except with Yarn 1 or `npm --engine-strict`.
