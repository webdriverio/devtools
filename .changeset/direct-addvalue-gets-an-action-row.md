---
"@wdio/devtools-service": patch
---

Give a direct `addValue` its own action row. It was excluded from the trace action vocabulary on the grounds that WDIO fires it inside `setValue`, where mapping it would double-count — but that assumed it only ever appears nested. A direct `addValue`, which is idiomatic on Appium, produced no action at all: the typing step was simply missing from the trace, and a spec doing click → `addValue` → `getText` exported two rows instead of three.

The double-count the exclusion guarded against cannot happen. The service logs a command only when it matches the top of its own command stack, and that stack is pushed for top-level user commands alone — so the nested `addValue` never reaches the command log to be mapped. Neither the Selenium nor the Nightwatch adapter emits a command by that name at all; `addValue` is WDIO's, and Selenium's equivalent `sendKeys` appends too and has always mapped to a fill. It renders the same way.

`clearValue` stays excluded: it has the same nesting story but no direct use that currently goes unrecorded.
