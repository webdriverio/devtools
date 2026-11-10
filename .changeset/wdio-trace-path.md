---
'@wdio/devtools-service': patch
---

Print the path of every trace a run wrote when the worker finishes. The path was only logged at `info` level, which the usual `logLevel: 'warn'` hides, so a trace-mode run ended without saying where its trace went.
