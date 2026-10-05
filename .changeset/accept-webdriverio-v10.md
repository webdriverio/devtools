---
'@wdio/devtools-service': minor
'@wdio/elements': minor
---

Accept WebdriverIO 10 as a peer. The service required `webdriverio` `^9.19.1` and `@wdio/protocols` at exactly `9.30.1`, and `@wdio/elements` required `webdriverio` `^9.0.0`, so adding either to a v10 project conflicted with the project's own `webdriverio` and `@wdio/protocols`. Both majors are now accepted. The service uses none of the APIs v10 removed: its `addCommand` call already passes no third argument, and assertion folding keys on the matcher's value-read command, not on the matcher name that v10 now reports as the alias.
