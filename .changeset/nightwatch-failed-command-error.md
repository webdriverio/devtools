---
'@wdio/nightwatch-devtools': patch
---

A command that failed at the protocol level, such as a navigation the browser refused, now carries its error on its row, so it shows red in the actions list and in the Errors tab. Nightwatch reports that failure as `{status: -1, value: null, error}`, and the row was read from `value`, so it rendered as a success with no result.
