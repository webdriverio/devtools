---
'@wdio/nightwatch-devtools': minor
---

`mode: 'telemetry'` runs Nightwatch tests without any DevTools output: no backend, no UI window, no per-action capture, screencast or trace zips. The run writes only the artifacts manifest, which records the run id and each attempt's trace id.
