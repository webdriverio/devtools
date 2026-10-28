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

Every manifest you pass is pushed as one run. Use `--run-id` to name the run in CI. Input problems fail before anything is exported: preflight reads and parses every manifest and every zip it names, and if any is missing or unparseable, nothing is pushed, every problem is listed, and the exit is non-zero. An export failure mid-run is a partial push: the records before the failed one are already pushed, the error reports the count (`<n> of <total> test(s) were pushed before the export failed`), and the exit is non-zero. Rerunning after fixing the collector pushes the whole set again, so the already-pushed records are duplicated.

## Recording side

Record with `mode: 'trace'`, `traceGranularity: 'test'` and `tracePolicy: 'on'`, with the manifest enabled. `'test'` granularity gives each test its own zip; with session or spec granularity the zips are shared, so those tests get their log record but no trace (with a warning). `tracePolicy: 'on'` keeps every zip. See the NOT SUPPORTED section for why.

## Configuration

The collector is set with the standard OpenTelemetry variables, read by the OTLP exporters and the resource detector:

- `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`: where and how to send
- `OTEL_SERVICE_NAME`: service name (default `devtools-tests`)
- `OTEL_RESOURCE_ATTRIBUTES`: resource attributes such as branch, commit and CI run id. Put low-cardinality run identity here.

## Telemetry

| Attribute | On | Meaning |
|---|---|---|
| `test.case.name` | log, root span | Test title |
| `test.suite.name` | log, root span | Spec file |
| `test.case.result.status` | log, root span | `pass` or `fail`; other manifest states pass through |
| `devtools.test.attempt` | log, root span | Attempt number of the final result |
| `devtools.duration_ms` | log, root span | The framework-reported duration when the manifest has one; else its `endTime` minus `startTime`; else first action or group start to last action or group end (absent without any of these) |
| `devtools.time_source` | log, root span | Where the record's timestamp came from: `manifest` (the manifest's `endTime`), `trace` (the zip's first action), or `manifest-file` (the manifest file's mtime, when neither exists) |
| `error.message` | log, root span | For a failed test: the manifest's failure message when present, else the first failing action's error. On a passing test only the manifest's message, if any; a caught or retried command's error is never used |
| `devtools.failed_action` | log, root span | For a failed test: key of the first failing action in the final attempt's zip. Absent on a passing test |
| `devtools.run.id` | log, root span | Run identity |
| `devtools.artifact.url` | log, root span | URL of the retained trace zip |
| `devtools.action.key` | action span | Method plus its normalized selector; stable across runs, so passing and failing runs line up |
| `devtools.action.index` | action span | Ordinal of the action within the test |

Error action spans carry status `ERROR` and an exception event. Console `warn`/`error` lines are span events on the root span, with `messageType`. Failed requests (status 0 or 400+) are span events with only the URL pathname (no origin, query or fragment). Each is capped at 100 per test.

Log records share the root span's trace id when a zip exists, so a log links to its trace. Tests with no retained zip, or whose zip covers several tests, still emit a log record, without a trace context; the latter is skipped with a warning on stderr. Cucumber step entries in the manifest (entries without a `state`) are not tests: they get no record of their own, and a scenario zip that also lists its step uids still counts as that one scenario's zip.

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
