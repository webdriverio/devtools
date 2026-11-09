# @wdio/wdio-otel

Pushes the results of a devtools run to an OpenTelemetry collector, so test history is searchable over time. Each attempt of each test becomes a root span, stamped with the trace and span ids the run minted when the attempt started. With `--trace-zips` the attempt's actions become its child spans. Spans are the only signal the CLI sends: a test's pass or fail, duration and failure live on its root span.

## Usage

```sh
wdio-otel push out/devtools-artifacts-*.json \
  --artifact-base-url https://bucket.example/run-1
```

| Option | Meaning |
|---|---|
| `--artifact-base-url <url>` | Base URL the trace zips are served from. Each zip's `devtools.artifact.url` is this joined with the artifact path in its manifest. Needs no zip to be read. |
| `--run-id <id>` | Run identity stamped as `devtools.run.id`. Default: the manifests' `runId` when they all agree, else the pushed manifests' sessionIds, sorted and joined with `+`. |
| `--trace-zips` | Read each test's final-attempt trace zip and push its actions as child spans. Off by default, so the CLI reads no zip. A zip that is missing or unreadable warns and skips that test's actions; the rest of the push goes ahead, and the CLI then exits 1 naming each unreadable zip. |
| `--dry-run` | Print spans to stdout instead of exporting. Needs no collector. |

Every manifest you pass is pushed as one run. Use `--run-id` to name the run in CI. An input problem that stops the whole push (a manifest that is not JSON or not an artifacts manifest) fails before anything is exported: every problem is listed and the exit is non-zero. Spans are exported in batches and flushed once at the end, so an export failure can be a partial push: the error names the run size (`the export of <total> test(s) failed`), the exit is non-zero, and some batches may already have reached the collector. Rerunning after fixing the collector pushes the whole set again, so any span already pushed is sent twice. The export queue is unbounded so that nothing is dropped before that flush, which means a run's spans can all be held in memory at once.

## Recording side

Record with `mode: 'telemetry'` when you want only the telemetry. It runs no backend, opens no window and captures no per-action state. It writes the artifacts manifest and no zips, which is all `wdio-otel` needs without `--trace-zips`.

Use `mode: 'trace'` with `traceGranularity: 'test'` when you also want the actions as child spans. Each test then gets its own zip, and `--trace-zips` reads it. With session or spec granularity the zips are shared: those tests still get their root span and, with `--artifact-base-url`, the shared zip's URL, but no action spans (`--trace-zips` warns once per manifest). `tracePolicy: 'on'` keeps every zip. In trace mode the manifest is written only with `emitArtifactsManifest: true`; WebdriverIO also writes it when an Allure reporter is configured and Selenium when an allure-js-commons runtime is active, unless `emitArtifactsManifest: false` is set; Nightwatch only with the option. Under a retain policy the zips of passing tests are dropped; the push still covers those tests, and the dropped zips are simply not linked or read.

## Configuration

The collector is set with the standard OpenTelemetry variables, read by the OTLP exporter and the resource detector:

- `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`: where and how to send
- `OTEL_SERVICE_NAME`: service name (default `devtools-tests`)
- `OTEL_RESOURCE_ATTRIBUTES`: resource attributes such as branch, commit and CI run id. Put low-cardinality run identity here.

## Stamped ids and TRACEPARENT

The run mints each attempt's trace and span ids when the attempt starts, and writes them into the manifest with the run id. `wdio-otel` uses those ids as they are, so for a manifest that carries `attempts`, pushing it twice produces the same spans, and an attempt's root span has the span id the manifest names. A manifest from before attempts gets random root ids on each push. Child spans take ids derived from their root's span id and their position, so they are stable across pushes whenever their root is.

If the process that starts the run has a `TRACEPARENT` environment variable (the W3C trace context header a CI job can set), the run reads it once, and each attempt joins that trace: every root span is a child of the CI parent span, and the manifest records the parent under `parent`. Retried tests therefore show every attempt under the same CI trace. A `TRACESTATE` variable is carried along when set. An invalid `TRACEPARENT` is logged and ignored.

The CLI records every span it is given regardless of the sampled flag in `TRACEPARENT`.

## Sending to a hosted platform and separating projects

The upload is an OTLP/HTTP push, configured only through the standard OpenTelemetry variables:

- `OTEL_EXPORTER_OTLP_ENDPOINT`: the base URL; spans are sent to `/v1/traces` under it
- `OTEL_EXPORTER_OTLP_HEADERS`: the platform token
- `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`: which project and environment the spans belong to

Keep tokens in CI secrets, never in files.

Examples (check each platform's current docs; endpoints and header names change):

| Platform | `OTEL_EXPORTER_OTLP_ENDPOINT` | `OTEL_EXPORTER_OTLP_HEADERS` |
|---|---|---|
| Grafana Cloud | `https://otlp-gateway-<region>.grafana.net/otlp` | `Authorization=Basic <base64 of instanceId:token>` |
| Honeycomb | `https://api.honeycomb.io` | `x-honeycomb-team=<key>` |
| New Relic | `https://otlp.nr-data.net` | `api-key=<key>` |
| Datadog | A Datadog Agent or OpenTelemetry Collector with an OTLP receiver | As that agent or collector requires |

To keep several projects apart in one organisation, use resource attributes:

- `service.namespace`: the organisation or team
- `service.name`: the project or suite (default `devtools-tests`)
- `deployment.environment.name`: the environment

```sh
OTEL_SERVICE_NAME=shop-web-e2e \
OTEL_RESOURCE_ATTRIBUTES=service.namespace=acme,deployment.environment.name=staging,vcs.ref.head.name=main \
  wdio-otel push out/devtools-artifacts-*.json --artifact-base-url https://bucket.example/shop-web-e2e/run-1
```

These become filterable resource attributes on every span. Give each project its own bucket prefix for `--artifact-base-url`, so one project's zips never sit under another's.

## Telemetry

| Attribute | On | Meaning |
|---|---|---|
| `test.case.name` | root span | Test title |
| `test.suite.name` | root span | Spec file |
| `test.case.result.status` | root span | `pass` or `fail`; other states pass through. A root span takes its attempt's state |
| `devtools.test.attempt` | root span | Attempt number |
| `devtools.test.final_attempt` | root span | `true` on the root of the test's final attempt, `false` on each earlier attempt's root. Filter on it to count a test once |
| `devtools.duration_ms` | root span | On the final attempt: the framework-reported duration when the manifest has one; else the test's `endTime` minus `startTime`; else its attempt record's `endTime` minus `startTime`; else first action or group start to last action or group end under `--trace-zips` (absent without any of these). On an earlier attempt: its attempt record's `endTime` minus `startTime` |
| `devtools.time_source` | root span | Where the root's duration came from: `manifest` (the test's or its attempt record's times), `trace` (the zip's actions, with `--trace-zips`, also when the manifest gives a start but no end), or `manifest-file` (the manifest file's mtime, when neither exists). A `manifest` root with no `devtools.duration_ms` had a start and no end |
| `error.message` | root span | For a failed final attempt: the manifest's failure message when present, else the first failing action's error (with `--trace-zips`). Never set on an earlier attempt, and never from a passing test's caught or retried command. A longer message is truncated to 4096 characters followed by `…`; the same applies to a failing action span's status and exception message |
| `devtools.failed_action` | root span | For a failed test: key of the first failing action in the final attempt's zip. Needs `--trace-zips`; absent on a passing test |
| `devtools.run.id` | root span | Run identity |
| `devtools.artifact.url` | root span | URL of the final attempt's trace zip, when `--artifact-base-url` is set and the zip was not dropped by a retain policy. At session or spec granularity the zip is shared with the other tests it covers |
| `devtools.action.key` | action span | Method plus its normalized selector; stable across runs, so passing and failing runs line up |
| `devtools.action.index` | action span | Ordinal of the action within the test |
| `devtools.action.method` | action span | The command the action ran |
| `devtools.action.selector` | action span | The selector the action ran on, normalized, when it has one |

Each attempt is one root span named after the test. A retried test therefore has one root per attempt, and each root's status is its own attempt's state. The trace id and span id of every root come from the manifest, as described under Stamped ids and TRACEPARENT.

With `--trace-zips`, a failed action's span carries status `ERROR` and an exception event. A failure is decided by the same rule the rest of devtools uses: a poll that a passing wait retried past is not an error, and a wait that resolves `false` is one. A wait's polls are child spans of the wait's span.

With `--trace-zips`, the root span also carries these span events, each kind capped at the first 100 per test:

| Event | Attributes |
|---|---|
| `console` (`warn` and `error` lines) | `devtools.console.type`, `devtools.console.message` |
| `http.request.failed` (status 0 or 400+) | `url.path` (the pathname only, no origin, query or fragment), `http.request.method`, `devtools.network.status` |

Cucumber steps are not tests: the manifest lists only scenarios, so a step gets no span of its own, and a scenario zip that also lists its step uids counts as that one scenario's zip. A Cucumber manifest written by an earlier Selenium or Nightwatch adapter is rejected: its scenario entries carry no attempt and its steps are listed as tests. Re-record it with the current adapter.

## Timestamps

A root span starts and ends at its attempt's `startTime` and `endTime` in the manifest. A manifest from before attempts existed uses the test's own timing instead: its `startTime`, `endTime` and `durationMs`. Under `--trace-zips`, a root is widened to cover the zip's actions, so every action falls inside its root. A root with no timing at all is zero-width at the manifest file's mtime. The SDK never stamps push time.

Only the WDIO service writes per-test timing (`endTime`, `durationMs`) into the manifest. For a manifest from Selenium or Nightwatch each root is timed from its attempt record, written for every test whose start the adapter saw; a test with neither starts at the manifest file's mtime (`devtools.time_source=manifest-file`). The Python adapter writes no manifest, so a pytest run has nothing to push.

## Attempts

Each attempt is pushed as its own root span. The final attempt's trace zip is the only zip read: it supplies the child spans, the failed action and the first-action timestamp. A passing retry therefore never carries the failing first attempt's error or zip. A zip with no key is matched to an attempt by its folder's `-retry<n>` suffix (no suffix is attempt 0), so a manifest with no artifact keys links the zip of the final attempt's folder. An earlier attempt's zip never stands in for a final attempt that has none; that test gets no zip and no action spans. The attempt record the writer stamped `final` is the final one; a manifest whose attempts do not have exactly one such record is rejected. WebdriverIO's `specFileRetries` reruns a failed spec in a fresh worker that writes its own manifest, restarting the test's attempt numbers at 0. Pushed together, a failed final that another manifest's final for the same test started after is pushed as an earlier attempt, so only the retry keeps `devtools.test.final_attempt=true`; that failed root still carries its own error, failed action and zip URL, since that worker's zip is the failure's replay. Finals that overlap in time, such as the same spec in two browsers, each keep theirs; two browsers run one after the other cannot be told from a retry, so a failure followed by the other browser's run of that test is read as retried. Two tests with the same full title in the same file share one test id, so the second is read as a retry and the first is stamped failed; this is a known limitation.

## Retain policies

A manifest recorded under `retain-on-failure` or `retain-on-first-failure` is pushed in full. Its dropped zips (`retained: false`) are neither linked nor read, so those tests have their root spans but no action spans and no artifact URL.
