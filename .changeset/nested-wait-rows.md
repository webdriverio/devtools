---
'@wdio/devtools-app': minor
'@wdio/devtools-backend': minor
'@wdio/devtools-service': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
---

A command row can now name the row whose execution issued it (`parentId`), and the dashboard and the trace player nest such rows under that row, collapsed by default and open when it failed or holds the selected row. Selecting a nested row replays its page exactly as a top-level row does. This is how a wait shows the commands its condition issued. A command that failed under a wait that then passed is a poll the wait retried past: it renders neutral, with its error as the row's tooltip, stays out of the Errors tab and is not written as a failed action in the trace. Under a wait that timed out, its commands keep their errors. A trace recorded without nested rows reads back unchanged.
