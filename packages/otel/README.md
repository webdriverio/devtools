# @wdio/opentelemetry

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

The package is `@wdio/opentelemetry` and installs the `wdio-otel` bin. Every manifest you pass is pushed as one run. If the manifests' `runId` values do not all match and no `--run-id` is given, each span's `devtools.run.id` becomes the manifests' session ids, sorted and joined with `+`, so the name changes with whichever sessions were pushed together. Pass `--run-id` in CI. An input problem that stops the whole push (a manifest that is not JSON or not an artifacts manifest) fails before anything is exported: every problem is listed and the exit is non-zero.

Spans are exported in sequential batches of 512, and the queue is flushed each time 4096 emitted spans are waiting, then once more at the end. A failed batch stops the push and exits 1 with a message of this form:

```
wdio-otel: export failed: <n> span(s) reached the collector, <m> emitted span(s) did not, and tests <a>..<b> were not sent: <cause>
```

The `and tests ... were not sent` clause appears only when some tests had not been emitted yet. Batches sent before the failure stay on the collector, so the push can be partial. Rerunning after fixing the collector pushes the whole set again. For a manifest that carries attempt records the ids are the same on every push, so a backend that dedupes by span id keeps one copy; without attempt records the root ids are random and each push adds new roots.

## Recording side

Record with `mode: 'telemetry'` when you want only the telemetry. It runs no backend, opens no window and captures no per-action state. It writes the artifacts manifest and no zips, which is all `wdio-otel` needs without `--trace-zips`.

Use `mode: 'trace'` with `traceGranularity: 'test'` when you also want the actions as child spans. Each test then gets its own zip, and `--trace-zips` reads it. With session or spec granularity the zips are shared: those tests still get their root span and, with `--artifact-base-url`, the shared zip's URL, but no action spans (`--trace-zips` warns once per manifest). `tracePolicy: 'on'` keeps every zip. In trace mode the manifest is written only with `emitArtifactsManifest: true`; WebdriverIO also writes it when an Allure reporter is configured and Selenium when an allure-js-commons runtime is active, unless `emitArtifactsManifest: false` is set; Nightwatch only with the option. Under a retain policy the zips of passing tests are dropped; the push still covers those tests, and the dropped zips are simply not linked or read.

## Configuration

The collector is set with the standard OpenTelemetry variables, read by the OTLP exporter and the resource detector:

- `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`: where and how to send
- `OTEL_SERVICE_NAME`: service name (default `devtools-tests`)
- `OTEL_RESOURCE_ATTRIBUTES`: resource attributes such as branch, commit and CI run id. Put low-cardinality run identity here.

## CI metadata

Under GitHub Actions (`GITHUB_ACTIONS=true`) or GitLab CI (`GITLAB_CI=true`) the CLI adds these resource attributes to every span, from the variables shown. An empty variable counts as unset, and the first listed variable that is set wins.

| Attribute | GitHub Actions | GitLab CI |
|---|---|---|
| `cicd.pipeline.name` | `GITHUB_WORKFLOW` | `CI_PIPELINE_NAME`, else `CI_PROJECT_PATH` |
| `cicd.pipeline.run.id` | `GITHUB_RUN_ID` | `CI_PIPELINE_ID` |
| `cicd.pipeline.run.url.full` | `GITHUB_SERVER_URL`/`GITHUB_REPOSITORY`/actions/runs/`GITHUB_RUN_ID`, only when all three are set | `CI_PIPELINE_URL` |
| `vcs.ref.head.name` | `GITHUB_HEAD_REF`, else `GITHUB_REF_NAME` | `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME`, else `CI_COMMIT_REF_NAME` |
| `vcs.ref.head.revision` | `GITHUB_SHA` | `CI_COMMIT_SHA` |

A key set in `OTEL_RESOURCE_ATTRIBUTES` overrides the detected value. Other CI systems are not detected, so set the attributes by hand, for example:

```sh
OTEL_RESOURCE_ATTRIBUTES=vcs.ref.head.name=main,vcs.ref.head.revision=$COMMIT_SHA,cicd.pipeline.run.id=$BUILD_ID
```

## Stamped ids and TRACEPARENT

The run mints each attempt's trace and span ids when the attempt starts, and writes them into the manifest with the run id. `wdio-otel` uses those ids as they are, so for a manifest that carries `attempts`, pushing it twice produces the same spans, and an attempt's root span has the span id the manifest names. A manifest from before attempts gets random root ids on each push. Child spans take ids derived from their root's span id and their position, so they are stable across pushes whenever their root is.

If the process that starts the run has a `TRACEPARENT` environment variable (the W3C trace context header a CI job can set), the run reads it once, and each attempt joins that trace: every root span is a child of the CI parent span, and the manifest records the parent under `parent`. Retried tests therefore show every attempt under the same CI trace. A `TRACESTATE` variable is carried along when set. An invalid `TRACEPARENT` is logged and ignored.

The CLI records and exports every span it is given regardless of the sampled flag in `TRACEPARENT`. If the CI parent span was not sampled, the backend never receives it, so these spans show a parent it does not have.

Without `TRACEPARENT`, each test attempt starts its own trace, and there is no run root span: a run is the set of spans that share a `devtools.run.id`.

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
| `test.suite.name` | root span | Spec file, relative to the manifest's `cwd` (the directory the tests ran in). A manifest without `cwd`, such as one from an older adapter, gets the spec path as recorded |
| `session.id` | root span | Session the test ran in (the manifest's `sessionId`) |
| `devtools.test.uid` | root span | The test's uid in the manifest |
| `devtools.browser.name`, `devtools.browser.version`, `devtools.platform.name` | root span | From the manifest's `browserName`, `browserVersion` and `platformName`; absent when the manifest does not record them |
| `test.case.result.status` | root span | `pass` or `fail`; other states pass through. A root span takes its attempt's state |
| `devtools.test.attempt` | root span | Attempt number |
| `devtools.test.final_attempt` | root span | `true` on the root of the test's final attempt, `false` on each earlier attempt's root. Filter on it to count a test once |
| `devtools.duration_ms` | root span | On the final attempt: the framework-reported duration when the manifest has one; else the test's `endTime` minus `startTime`; else its attempt record's `endTime` minus `startTime`; else first action or group start to last action or group end under `--trace-zips` (absent without any of these). On an earlier attempt: its attempt record's `endTime` minus `startTime` |
| `devtools.time_source` | root span | Where the root's duration came from: `manifest` (the test's or its attempt record's times), `trace` (the zip's actions, with `--trace-zips`, also when the manifest gives a start but no end), or `manifest-file` (the manifest file's mtime, when neither exists). A `manifest` root with no `devtools.duration_ms` had a start and no end |
| `error.message` | root span | For a failed final attempt: the test's error when the manifest has one, else the final attempt record's error, else the first failing action's error (with `--trace-zips`). An earlier attempt carries the error its own record kept, if any. A passing test never takes an error from a caught or retried command. A longer message is truncated to 4096 characters followed by `…`; the same applies to a failing action span's status and exception message |
| `devtools.failed_action` | root span | For a failed test: key of the first failing action in the final attempt's zip. Needs `--trace-zips`; absent on a passing test |
| `devtools.run.id` | root span | Run identity |
| `devtools.artifact.url` | root span | URL of the final attempt's trace zip, when `--artifact-base-url` is set and the zip was not dropped by a retain policy. At session or spec granularity the zip is shared with the other tests it covers |
| `devtools.action.key` | action span | Method plus its normalized selector; stable across runs, so passing and failing runs line up |
| `devtools.action.index` | action span | Ordinal of the action within the test |
| `devtools.action.method` | action span | The command the action ran |
| `devtools.action.selector` | action span | The selector the action ran on, normalized, when it has one |

Each attempt is one root span named after the test. A retried test therefore has one root per attempt, and each root's status is its own attempt's state. The trace id and span id of every root come from the manifest, as described under Stamped ids and TRACEPARENT.

Only the final attempt gets `devtools.artifact.url`. The URL is built from the zip's path relative to the manifest's directory, so a results folder can be unpacked anywhere and pushed, provided the zips are published under `--artifact-base-url` at the same relative paths.

With `--trace-zips`, a failed action's span carries status `ERROR` and an exception event. A failure is decided by the same rule the rest of devtools uses: a poll that a passing wait retried past is not an error, and a wait that resolves `false` is one. A wait's polls are child spans of the wait's span.

With `--trace-zips`, the root span also carries these span events, each kind capped at the first 100 per test:

| Event | Attributes |
|---|---|
| `console` (`warn` and `error` lines) | `devtools.console.type`, `devtools.console.message` |
| `http.request.failed` (status 0 or 400+) | `url.path` (the pathname only, no origin, query or fragment), `http.request.method`, `devtools.network.status` |

Cucumber steps are not tests: the manifest lists only scenarios, so a step gets no span of its own, and a scenario zip that also lists its step uids counts as that one scenario's zip. A Cucumber manifest from an earlier adapter is still read: its old step entries are dropped and each scenario without an `attempt` takes attempt 0. It has no attempt records, though, so its roots get random ids and their timing comes from the test's own fields. Re-record it with the current adapter for stable ids.

A test the run started but never finished has no recorded outcome. It is pushed without `test.case.result.status`, and the CLI warns `N test(s) in <file> have no recorded outcome and are pushed without a status`.

## Timestamps

A root span starts and ends at its attempt's `startTime` and `endTime` in the manifest. A manifest from before attempts existed uses the test's own timing instead: its `startTime`, `endTime` and `durationMs`. Under `--trace-zips`, a root is widened to cover the zip's actions, so every action falls inside its root. A root with no timing at all is zero-width at the manifest file's mtime. The SDK never stamps push time.

Because spans keep the test's own times, a push made after the run sends spans that are already minutes or hours old, and the backend has to accept them. Tempo 3 drops spans older than `live_store.wal.ingestion_time_range_slack` (2 minutes by default) from TraceQL metrics, so a dashboard counts nothing for a run pushed later than that, while the trace still opens by id. `examples/o11y` raises that setting to 24 hours. A search needs a time range that covers the test's own time, not the push time. Other backends were not tested.

A test's own `endTime` and `durationMs` are written when the adapter stamps them: the WDIO service does so as each test ends, and Selenium and Nightwatch take them from their suite stats once the suite has ended. A root's timing comes from its attempt record when the manifest has one. A test with no start and no end is timed at the manifest file's mtime (`devtools.time_source=manifest-file`). The Python adapter writes no manifest, so a pytest run has nothing to push.

## Attempts

Each attempt is pushed as its own root span. The final attempt's trace zip is the only zip read: it supplies the child spans, the failed action and the first-action timestamp. A passing retry therefore never carries the failing first attempt's error or zip. A zip with no key is matched to an attempt by its folder's `-retry<n>` suffix (no suffix is attempt 0), so a manifest with no artifact keys links the zip of the final attempt's folder. An earlier attempt's zip never stands in for a final attempt that has none; that test gets no zip and no action spans. The attempt record the writer stamped `final` is the final one; a manifest whose attempts do not have exactly one such record is rejected. WebdriverIO's `specFileRetries` reruns a failed spec in a fresh worker that writes its own manifest, restarting the test's attempt numbers at 0. Pushed together, a failed final that another manifest's final for the same test started after is pushed as an earlier attempt, so only the retry keeps `devtools.test.final_attempt=true`; that failed root still carries its own error, failed action and zip URL, since that worker's zip is the failure's replay. Finals that overlap in time, such as the same spec in two browsers, each keep theirs. Finals are compared only within the same browser name, browser version and platform, so a Chrome failure is not hidden by a later Firefox pass. The one residual: two runs with identical browser identity that run one after the other are still read as a retry. Two tests with the same full title in the same file share one test id, so the second is read as a retry and the first is stamped failed; this is a known limitation.

## Retain policies

A manifest recorded under `retain-on-failure` or `retain-on-first-failure` is pushed in full. Its dropped zips (`retained: false`) are neither linked nor read, so those tests have their root spans but no action spans and no artifact URL.

## Running in CI

Add a step after the test step. The package must be installed in the project so `npx` finds the bin. Each adapter writes its manifests to a `test-results/` subfolder of the directory it resolves (the spec's or the config's folder), or of your `outputDir` when you set one, so adjust the glob to match. The CLI does not expand globs itself; the shell does, so leave the pattern unquoted. If nothing matches, the shell passes the pattern through and the CLI reports that file as not JSON.

```yaml
- name: Push test results to OpenTelemetry
  if: always()
  env:
    OTEL_EXPORTER_OTLP_ENDPOINT: https://otlp.example.com
    # Optional: only when the collector needs a token
    OTEL_EXPORTER_OTLP_HEADERS: ${{ secrets.OTEL_EXPORTER_OTLP_HEADERS }}
    OTEL_SERVICE_NAME: shop-web-e2e
  run: npx wdio-otel push test-results/devtools-artifacts-*.json --run-id ${{ github.run_id }} --artifact-base-url https://bucket.example/run-${{ github.run_id }}
```

## Not included yet

Span links between attempts, a run root span, zip links for non-final attempts, `traceparent` injection into the app under test, metrics and logs signals. The Python adapter writes no manifest, so a pytest run has nothing to push.
