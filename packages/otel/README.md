# @wdio/devtools-otel

Pushes the results of a devtools run to an OpenTelemetry collector, so test history is searchable over time. Each test becomes one log record (pass rate, flake rate, duration, top failing tests) and, when its trace zip was retained, a trace: the test as the root span, its actions as child spans, and its tracing groups as nesting.

## Usage

```sh
devtools-otel push out/devtools-artifacts-*.json \
  --artifact-base-url https://bucket.example/run-1
```

| Option | Meaning |
|---|---|
| `--artifact-base-url <url>` | Base URL the trace zips are served from. Each zip's `devtools.artifact.url` is this joined with the artifact path in its manifest. |
| `--run-id <id>` | Run identity stamped as `devtools.run.id`. Default: the pushed manifests' sessionIds, sorted and joined with `+`. |
| `--dry-run` | Print spans and log records to stdout instead of exporting. Needs no collector. |

Every manifest you pass is pushed as one run. Use `--run-id` to name the run in CI. Input problems fail before anything is exported: preflight reads and parses every manifest and every zip it names, and if any is missing or unparseable, nothing is pushed, every problem is listed, and the exit is non-zero. Records are exported in batches and flushed once at the end, so an export failure can be a partial push: the error names the run size (`the export of <total> test(s) failed`), the exit is non-zero, and some batches may already have reached the collector. Rerunning after fixing the collector pushes the whole set again, so any record already pushed is duplicated. The export queue is unbounded so that nothing is dropped before that flush, which means a run's spans and log records can all be held in memory at once.

## Recording side

Record with `mode: 'trace'`, `traceGranularity: 'test'` and `tracePolicy: 'on'`, with `emitArtifactsManifest: true`. The option is off by default; WebdriverIO still writes the manifest when an Allure reporter is configured and Selenium when an allure-js-commons runtime is active, unless `emitArtifactsManifest: false` is set; Nightwatch writes it only with the option. `'test'` granularity gives each test its own zip; with session or spec granularity the zips are shared, so those tests get their log record but no trace (with a warning). `tracePolicy: 'on'` keeps every zip. See the NOT SUPPORTED section for why.

## Configuration

The collector is set with the standard OpenTelemetry variables, read by the OTLP exporters and the resource detector:

- `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`: where and how to send
- `OTEL_SERVICE_NAME`: service name (default `devtools-tests`)
- `OTEL_RESOURCE_ATTRIBUTES`: resource attributes such as branch, commit and CI run id. Put low-cardinality run identity here.

## Sending to a hosted platform and separating projects

The upload is an OTLP/HTTP push, configured only through the standard OpenTelemetry variables:

- `OTEL_EXPORTER_OTLP_ENDPOINT`: the base URL; signals are sent to `/v1/traces` and `/v1/logs` under it
- `OTEL_EXPORTER_OTLP_HEADERS`: the platform token
- `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`: which project and environment the records belong to

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
  devtools-otel push out/devtools-artifacts-*.json --artifact-base-url https://bucket.example/shop-web-e2e/run-1
```

These become filterable resource attributes on every log record and span. In the example stack's Loki (`grafana/otel-lgtm:0.37.0`) these three became stream labels (`service_namespace`, `service_name`, `deployment_environment_name`), while per-test attributes stay structured metadata; check your own Loki's OTLP label configuration. Give each project its own bucket prefix for `--artifact-base-url`, so one project's zips never sit under another's.

## Telemetry

| Attribute | On | Meaning |
|---|---|---|
| `test.case.name` | log, root span | Test title |
| `test.suite.name` | log, root span | Spec file |
| `test.case.result.status` | log, root span | `pass` or `fail`; other manifest states pass through |
| `devtools.test.attempt` | log, root span | Attempt number of the final result |
| `devtools.duration_ms` | log, root span | The framework-reported duration when the manifest has one; else its `endTime` minus `startTime`; else first action or group start to last action or group end (absent without any of these) |
| `devtools.time_source` | log, root span | Where the record's timestamp came from: `manifest` (the manifest's `endTime`), `trace` (the zip's first action), or `manifest-file` (the manifest file's mtime, when neither exists) |
| `error.message` | log, root span | For a failed test: the manifest's failure message when present, else the first failing action's error. On a passing test only the manifest's message, if any; a caught or retried command's error is never used. A longer message is truncated to 4096 characters followed by `…`; the same applies to a failing action span's status and exception message |
| `devtools.failed_action` | log, root span | For a failed test: key of the first failing action in the final attempt's zip. Absent on a passing test |
| `devtools.run.id` | log, root span | Run identity |
| `devtools.artifact.url` | log, root span | URL of the retained trace zip |
| `devtools.action.key` | action span | Method plus its normalized selector; stable across runs, so passing and failing runs line up |
| `devtools.action.index` | action span | Ordinal of the action within the test |
| `devtools.action.method` | action span | The command the action ran (`click`, `waitForDisplayed`) |
| `devtools.action.selector` | action span | Its normalized selector; absent when the command took none |

A failed action span carries status `ERROR` and an exception event. A poll that a passing wait retried past is not failed. The commands a wait issued are child spans of the wait's span.

Two span events are added to the root span, each capped at the first 100 per test:

| Event | Attributes | Recorded for |
|---|---|---|
| `console` | `devtools.console.type`, `devtools.console.message` | Console `warn` and `error` lines |
| `http.request.failed` | `url.path`, `http.request.method`, `devtools.network.status` | Requests with status 0 or 400+; the URL is reduced to its pathname (no origin, query or fragment) |

Log records share the root span's trace id when a zip exists, so a log links to its trace. Tests with no retained zip, or whose zip covers several tests, still emit a log record, without a trace context; the latter is skipped with a warning on stderr. Cucumber steps are not tests: the manifest lists only scenarios, so a step gets no record of its own, and a scenario zip that also lists its step uids still counts as that one scenario's zip. A Cucumber manifest written by an earlier Selenium or Nightwatch adapter is rejected: its scenario entries carry no attempt and its steps are listed as tests. Re-record it with the current adapter.

## Timestamps and late records

A log record is stamped with the test's `endTime` when the manifest has one, else the zip's first action (`devtools.time_source` says which), else the manifest file's mtime. The SDK never stamps push time. Root spans always take their times from the zip.

Only the WDIO service writes per-test timing (`endTime`, `durationMs`) into the manifest. For a manifest from any other adapter, a test without a usable zip is stamped with the manifest file's mtime (`devtools.time_source=manifest-file`), and every test in that file gets the same timestamp.

Records are emitted in ascending timestamp order across all manifests. If they span more than an hour, or the oldest is more than an hour behind now, the CLI warns once on stderr and still pushes.

The warning matters because Loki drops entries that are about an hour behind the newest entry in a stream, and it does so silently: the push returns HTTP 200 and the entry is gone. A 2-hour-old record was verified to be dropped this way. Push promptly after the run. Loki can be configured to widen this window (`reject_old_samples_max_age`, and the out-of-order settings); check your Loki version's documentation for the exact names and defaults. The one-hour figure is what was observed, not a documented default.

## Attempts

The trace, failed action and artifact URL come from the zip of the test's final attempt, the one `attempt` names. A passing retry therefore never carries the failing first attempt's error or zip. A manifest with no artifact keys falls back to the zip whose path has the highest `-retry<n>` suffix.

## NOT SUPPORTED: retain-on-failure and retain-on-first-failure

`devtools-otel` cannot push a manifest with `retained: false` artifacts. Those mean a retain policy dropped zips, so the telemetry would be incomplete. The CLI prints a warning naming the manifest, skips it and exits 0. Record with `tracePolicy: 'on'`.

A future version may push telemetry for every test while keeping local zips only for failures. The duration and the failing action can already be derived from the action timestamps and the first erroring action.
