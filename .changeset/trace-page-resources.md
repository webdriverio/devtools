---
'@wdio/devtools-service': minor
'@wdio/selenium-devtools': minor
'@wdio/nightwatch-devtools': minor
'@wdio/devtools-script': minor
'@wdio/devtools-app': minor
'@wdio/devtools-backend': minor
---

Trace mode now stores the stylesheets and fonts the page used, and the player replays them from the archive instead of the site under test, so a replayed page renders the same after the site changes, for a site the viewer cannot reach, and in the hosted player for an `http` site. The new `traceResources` option is `'styles'` by default and `'none'` to store nothing; images still load from the site. Each resource is read back by the page collector from the browser's HTTP cache (cross-origin only where the site allows CORS), stored once per archive by content hash and only when that archive's pages reference it, and capped at 1 MiB per resource and 8 MiB per archive. Those reads do not appear as network rows. Live mode is unchanged and reads nothing back.
