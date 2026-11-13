---
'@wdio/devtools-service': minor
'@wdio/selenium-devtools': minor
'@wdio/nightwatch-devtools': minor
---

The artifacts manifest format changed incompatibly. Artifact paths are relative to the manifest's directory, `tests[].attempts[]` carries a `final` flag on the attempt that decided the test, `tests[].specFile` is relative to the working directory when it lies under it, and the absolute `cwd` is gone. The manifest now carries `manifestVersion: 2`, so a reader can tell it from the older format. A script that read the absolute artifact path must resolve it against the manifest's directory, and one that read `cwd` must stop doing so. Without a `TRACEPARENT`, every attempt of one test now carries the same trace id, derived from the run id (`DEVTOOLS_RUN_ID`) and the test's uid, where each attempt had its own before; a run id reused across runs therefore puts the same test's attempts from those runs in one trace.
