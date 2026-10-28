---
'@wdio/devtools-app': minor
'@wdio/devtools-backend': minor
'@wdio/devtools-service': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
---

A command row can now name the row whose execution issued it (`parentId`), and the dashboard and the trace player nest such rows under that row, collapsed by default and open when it failed or holds the selected row. Selecting a nested row replays its page exactly as a top-level row does. This is how a wait will show the commands its condition issued; no adapter sends the field yet, so every Actions list and trace renders as before, and a trace recorded without it reads back unchanged.
