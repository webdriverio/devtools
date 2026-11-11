# Observability example: devtools traces in Grafana

This example pushes WebdriverIO devtools traces to an OTLP backend with `wdio-otel` (package `@wdio/opentelemetry`):

```
wdio-otel push <manifest...> [--artifact-base-url <url>] [--run-id <id>] [--trace-zips] [--dry-run]
```

For every attempt of every test it emits:

- **One span in Tempo per attempt.** Without `TRACEPARENT` each attempt is the root span of its own trace; when the run was launched under a `TRACEPARENT` (a CI job that propagates one), every attempt is a child of that job's span, so a job's attempts share its trace. The attempt span carries the trace and span ids the run recorded when the attempt started, so the same manifest pushed twice produces the same spans. It also carries the test's name, status, duration, run id and artifact URL as attributes, which the dashboard queries. Span attributes add the session id, the test uid, and the browser name, version and platform (`session.id`, `devtools.test.uid`, `devtools.browser.name`, `devtools.browser.version`, `devtools.platform.name`) where the run recorded them. On GitHub Actions and GitLab CI the pipeline and branch are resource attributes on every span (`vcs.ref.head.name`, `vcs.ref.head.revision`, `cicd.pipeline.name`, `cicd.pipeline.run.id`). `test.suite.name` is the spec file relative to the directory the tests ran in.
- **Action spans, with `--trace-zips`.** Each action of the final attempt becomes a child span carrying `devtools.action.key` and `devtools.action.index`. The CLI reads the zip only with this flag.
- **A link to the trace zip in your own bucket.** The zips never go to the OTLP backend. You upload them yourself, and `--artifact-base-url` tells the CLI where they live.

Two tests with the same full title in the same file share one test id, so the second is read as a retry of the first and the first is stamped failed. This is a known limitation.

Zips are optional. Without `--trace-zips` the CLI reads none; the replay link only needs the zip to be in the bucket at the path its manifest names.

## WDIO service configuration

The service needs these settings:

```ts
services: [['devtools', {
    mode: 'trace',
    traceGranularity: 'test',
    tracePolicy: 'on',
    emitArtifactsManifest: true,
}]]
```

`emitArtifactsManifest: true` is what makes the service write the artifacts manifest, `devtools-artifacts-<sessionId>.json`, in trace mode; without it only an Allure reporter in the config turns it on. The manifest and the trace zips land in `test-results/` under WDIO's `outputDir`, or under its `rootDir` (the config file's directory) when `outputDir` is unset. `wdio-otel push` reads these manifests, so run the commands below from that directory. `mode: 'telemetry'` writes the manifest with no zips, which is enough for the root spans but not for the failed action (see Top 10 failing actions below); add `--trace-zips` only when you have zips to read.

## Retain policies

`tracePolicy: 'retain-on-failure'` and `tracePolicy: 'retain-on-first-failure'` are pushed in full. Every test gets its root span. The zips the policy dropped are not linked, so those tests have no replay link and, under `--trace-zips`, no action spans.

## Steps

1. Start the stack from this directory:
   ```sh
   docker compose up -d
   ```
   `s3-init` creates the bucket `traces`, applies the read policy and CORS rule described under [One-click replay](#one-click-replay), and exits.
2. Run your tests with the configuration above.
3. Upload the output directory to the bucket (see the recipes below). Skip this when you only want the telemetry; the replay link and `--trace-zips` need the zips.
4. Push the telemetry after the run:
   ```sh
   npx wdio-otel push test-results/devtools-artifacts-*.json \
     --artifact-base-url http://127.0.0.1:9000/traces/<run-id> --run-id <run-id> --trace-zips
   ```
   `--trace-zips` adds the action spans from the zips you uploaded. Drop it when you did not upload them.
   Add `--dry-run` first if you want to see what would be sent.
5. Open Grafana at http://127.0.0.1:3001. The "WebdriverIO DevTools - Test Results" dashboard is provisioned automatically from `grafana/`. Grafana is on host port 3001 because the devtools live backend takes port 3000 by default.

The stack listens on IPv4 loopback only, so its addresses are written as `127.0.0.1`: a client that resolves `localhost` to `::1` first and does not fall back would be refused. The OTLP endpoints are `127.0.0.1:4317` (gRPC) and `127.0.0.1:4318` (HTTP). The local bucket is served by [RustFS](https://github.com/rustfs/rustfs), an S3-compatible store, because MinIO no longer publishes Docker images. Any S3-compatible store works in its place. Its S3 API is on `127.0.0.1:9000` with credentials `devtools` / `devtools-secret` (local use only).

Image tags: `grafana/otel-lgtm:0.37.0`, `rustfs/rustfs:1.0.1`, `amazon/aws-cli:2.37.13`.

Verified against these tags: the `lgtm-data` volume at `/data` holds Grafana, Tempo and Prometheus state, so it survives `docker compose down`. Tempo (3200) answers on its default port.

## Runs pushed after they finish

Spans keep the test's own start and end times, whenever the push happens. The stack mounts `tempo/tempo-config.yaml` over the image's Tempo config. That file is the image's config with two changes. The first: `live_store.wal.ingestion_time_range_slack` is 24 hours instead of Tempo's 2-minute default. Without the change, Tempo leaves out of its TraceQL metrics and time-windowed search any span whose end is more than 2 minutes before the push, so a late-pushed run shows 0 in every panel, though its trace still opens by id. With it, spans that ended between 5 seconds and about 97 minutes before the push were counted and found, measured on Tempo 3.1 in `grafana/otel-lgtm:0.37.0` up to 25 minutes after the push; 24 hours is the configured limit, not a tested one. `curl -s 127.0.0.1:3200/status/config | grep ingestion_time_range_slack` shows whether the mount took effect: one of the lines it prints reads `24h0m0s`, and the others keep `2m0s`. Freshly pushed spans can take a few minutes to appear in search and in the panels. The dashboard's time range must cover when the tests ran, not when they were pushed, and it defaults to the last 6 hours, so widen it for an older run. The second change: `overrides.defaults.ingestion.max_traces_per_user` is 0 (no limit) instead of 10000. Every test attempt is its own trace, and Tempo drops the traces past that limit while still answering the push with success, so `wdio-otel push` exits 0 and a 20,000-test run showed 10,000 tests. With the limit off, two 20,000-test pushes in a row were both counted in full; more than 40,000 at once is not tested. `curl -s 127.0.0.1:3200/metrics | grep tempo_discarded_spans_total` shows whether a backend dropped spans. Re-copy `tempo-config.yaml` from the image when its tag changes. A hosted Tempo, Grafana Cloud or another backend has its own limit, which this file does not change; those are not tested.

## One-click replay

The dashboard "WebdriverIO DevTools - Test Results" has a Test results table, whose Artifact column shows each test's zip URL, and a Replays table below it. Replays lists only the tests whose zip URL is `http(s)://` and links each to `${player_base}/?trace=<zip URL>`, where `player_base` is the dashboard's Replay host variable, `https://trace.webdriver.io` by default. Your browser fetches the zip from the bucket directly, so the zip never transits Grafana. A test whose zip a retain policy dropped, or whose URL is `s3://`, has no replay row. `wdio-otel push` warns when `--artifact-base-url` is not `http(s)://`.

The hosted player downloads only `https:` zip URLs, or URLs on its own origin, so one-click replay needs the bucket served over https. The local stack's bucket is `http://127.0.0.1:9000`, so the Replay link does not work there, from `https://trace.webdriver.io` or from a local `pnpm player:hosted`: the page shows `Could not open the trace URL: Only https URLs can be opened, and this one is http:`. For a local run, open the zip from its bucket URL, save it, and drop it onto the player's landing screen, which accepts a dropped `.zip`. Use https in real deployments. The bucket must allow anonymous `GET` and CORS from the replay host. `s3-init` sets both on the local stack from `s3/bucket-policy.json` and `s3/cors.json`; that CORS rule names `https://trace.webdriver.io`, so a different `player_base` needs its origin added to `s3/cors.json` as well.

**Anyone who can reach the bucket host can download every trace in it, without credentials.** The local bucket's policy (`s3/bucket-policy.json`) allows anonymous `s3:GetObject` on `traces/*`. A trace zip holds everything the run typed and displayed: typed input (passwords included) in its command rows and transcript, page text, DOM mutations, command arguments and test source. Span attributes are not scrubbed either: `error.message` carries the test's error text unchanged. The example is safe only because every published port is bound to `127.0.0.1`. Do not copy this policy to a bucket reachable from a network you do not control. The push CLI builds plain URLs from `--artifact-base-url` and has no presigned-URL support, so a private bucket needs a gateway that authenticates the viewer.

**The replay host is an opt-in.** `player_base` (the dashboard's "Replay host" variable, default `https://trace.webdriver.io`, the hosted WebdriverIO trace player) is the one setting that chooses where Replay opens a zip. To point it at a self-hosted player (`pnpm player:hosted` serves one at `http://localhost:4173`), set `player_base` to that origin. Choosing a host grants it two things: CORS read access to the bucket, so its page can fetch the zips, and the zip URL (bucket host and path) in its own URL, so the host sees every URL it is sent. Point `player_base` only at a viewer you trust with both. To change the default for everyone, edit the `player_base` variable in `grafana/devtools-dashboard.json`. This is POC-grade: it is meant for a private network and has had no security review.

Chrome may prompt for local network access when the replay host fetches from a loopback (`127.0.0.1`) or private IP address. Allow it, or the replay will not load.

Rows pushed with an `s3://` base URL are listed but their Replay link cannot be opened in a browser.

## Bring your own bucket

Treat a trace zip as sensitive as the run that produced it, whatever bucket holds it. The access warning under [One-click replay](#one-click-replay) applies to every bucket.

**RustFS** (this stack):

```sh
AWS_ACCESS_KEY_ID=devtools AWS_SECRET_ACCESS_KEY=devtools-secret \
  aws --endpoint-url http://127.0.0.1:9000 s3 cp --recursive ./test-results/ s3://traces/<run-id>/
```

**Amazon S3:**

```sh
aws s3 cp --recursive ./test-results/ s3://<bucket>/<run-id>/
```

**Google Cloud Storage:**

```sh
gcloud storage cp --recursive ./test-results/ gs://<bucket>/<run-id>/
```

## GitHub Actions

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    env:
      OTEL_EXPORTER_OTLP_ENDPOINT: ${{ secrets.OTEL_EXPORTER_OTLP_ENDPOINT }}
      OTEL_EXPORTER_OTLP_HEADERS: ${{ secrets.OTEL_EXPORTER_OTLP_HEADERS }}
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - name: Run tests
        run: npx wdio run wdio.conf.ts
      - name: Upload traces
        if: always()
        run: aws s3 cp --recursive test-results/ s3://bucket/${{ github.run_id }}/
      - name: Push telemetry
        if: always()
        run: npx wdio-otel push test-results/devtools-artifacts-*.json --run-id ${{ github.run_id }} --artifact-base-url https://traces.internal.example/${{ github.run_id }}/ --trace-zips
```

On GitHub Actions the CLI reads the branch, commit and run from the runner's own variables, so the job sets no `OTEL_RESOURCE_ATTRIBUTES`; a key set there replaces the detected one. `--run-id ${{ github.run_id }}` groups every manifest of the job under one run, and a re-run of the job reuses that id.

`--artifact-base-url` must be the https address that serves that bucket to your browser (with anonymous read and CORS for `https://trace.webdriver.io`, see One-click replay); an `s3://` URL is recorded but cannot be replayed. The upload step needs AWS credentials. Configure them in whatever way your organisation uses, for example `aws-actions/configure-aws-credentials`.

## Grafana Cloud

Point the standard OTLP variables at your stack:

```sh
export OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<region>.grafana.net/otlp
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic <base64 of instanceId:token>"
```

## Multiple projects

To separate projects or teams in one backend, set `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES` as described in `packages/otel/README.md`, Sending to a hosted platform and separating projects.

The provisioned dashboard currently filters on `resource.service.name="devtools-tests"`. A project pushed under another service name shows nothing there until you edit the queries in `grafana/devtools-dashboard.json`. Project and namespace variables are a planned change.

## Queries

Test results are spans in Tempo, queried with TraceQL. Every attempt is a span named after the test, with `service.name` `devtools-tests`: a root span without `TRACEPARENT`, a child of the CI job's span with it. The dashboard's test-level panels count only each test's final attempt, selected by `span.devtools.test.final_attempt = true`, so a retried test counts once and a test that failed then passed is not a failure. The Flaky panel is the one that reads earlier attempts, through `span.devtools.test.attempt`. Spans pushed before this attribute existed carry none, so those panels do not count them. The two trace-list tables, Failing test traces and Test results (latest traces), list traces, so under `TRACEPARENT` each row is a whole CI job named after its root span rather than one test; Replays and the metrics panels select attempt spans by attribute and are unaffected. The metrics panels read a 24-hour window at most, and Tempo rejects a longer range for TraceQL metrics.

Passed tests in the range, from their final attempts:

```traceql
{ resource.service.name="devtools-tests" && span.test.case.result.status = "pass" && span.devtools.test.final_attempt = true } | count_over_time()
```

p95 framework-reported duration per test, from final attempts (Tempo estimates it from power-of-two histogram buckets, so values are approximate):

```traceql
{ resource.service.name="devtools-tests" && span.test.case.result.status != nil && span.devtools.test.final_attempt = true } | quantile_over_time(span.devtools.duration_ms, .95) by (span.test.case.name)
```

Top 10 failing actions, from final attempts. `devtools.failed_action` is read from the test's own trace zip, so it, this query, the Top failing actions panel and the failed-action column of the Test results table are filled only for runs recorded in trace mode with `traceGranularity: 'test'` and pushed with `--trace-zips`; a `mode: 'telemetry'` run writes no zips and leaves them empty:

```traceql
{ resource.service.name="devtools-tests" && span.test.case.result.status = "fail" && span.devtools.test.final_attempt = true && span.devtools.failed_action != nil } | count_over_time() by (span.devtools.failed_action) | topk(10)
```

Passed after a retry. A `specFileRetries` rerun, which runs in a fresh worker, carries its real attempt number, so it is counted with in-process retries:

```traceql
{ resource.service.name="devtools-tests" && span.test.case.result.status = "pass" && span.devtools.test.attempt > 0 } | count_over_time()
```

Failed attempts, in search (includes earlier attempts that a later one passed):

```traceql
{ resource.service.name="devtools-tests" && span.test.case.result.status = "fail" }
```

Failed final attempts on one branch (`vcs.ref.head.name` is a resource attribute, set on GitHub Actions and GitLab CI):

```traceql
{ resource.service.name="devtools-tests" && resource.vcs.ref.head.name = "<branch>" && span.test.case.result.status = "fail" && span.devtools.test.final_attempt = true }
```

Final attempts on one browser, counted by status (the browser name is the one the adapter recorded):

```traceql
{ resource.service.name="devtools-tests" && span.devtools.browser.name = "<browser name>" && span.devtools.test.final_attempt = true } | count_over_time() by (span.test.case.result.status)
```

Every run of one test, to compare a passing trace with a failing one:

```traceql
{ span.test.case.name = "<title>" }
```
