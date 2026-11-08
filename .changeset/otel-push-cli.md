---
'@wdio/devtools-otel': minor
---

New `devtools-otel` CLI pushes the tests listed in devtools artifacts manifests (written by the WebdriverIO, Selenium and Nightwatch adapters with `emitArtifactsManifest: true`; WebdriverIO and Selenium also write one unasked when an Allure reporter is detected) to an OpenTelemetry collector: one log record per test, and a trace per test (test as root span, actions as child spans) where its trace zip was retained. Manifests recorded under a retain policy are skipped with a warning, since their telemetry would be incomplete; record with `tracePolicy: 'on'`. See the package README.
