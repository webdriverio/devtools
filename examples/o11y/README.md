# Observability example: devtools traces in Grafana

This example pushes WebdriverIO devtools traces to an OTLP backend with `devtools-otel` (package `@wdio/devtools-otel`):

```
devtools-otel push <manifest...> [--artifact-base-url <url>] [--run-id <id>] [--dry-run]
```

For every test it emits:

- **One log record in Loki.** This is the historical record you query for pass rate, flakiness and duration.
- **One trace in Tempo.** This is the drill-down view. Each action becomes a span carrying `devtools.action.key` and `devtools.action.index`.
- **A link to the trace zip in your own bucket.** The zips never go to the OTLP backend. You upload them yourself, and `--artifact-base-url` tells the CLI where they live.

## WDIO service configuration

The service needs these settings:

```ts
services: [['devtools', {
    mode: 'trace',
    traceGranularity: 'test',
    tracePolicy: 'on',
}]]
```

The artifacts manifest is emitted by the service in trace mode as `devtools-artifacts-<sessionId>.json` in the output directory. `devtools-otel push` reads these manifests.

## NOT SUPPORTED

`tracePolicy: 'retain-on-failure'` and `tracePolicy: 'retain-on-first-failure'` are not supported. The CLI skips such manifests with a warning, because the passing tests' zips have been dropped and the telemetry would only describe failures.

The plan for the future is to emit telemetry for every test while the local zips keep only the failures.

## Steps

1. Start the stack from this directory:
   ```sh
   docker compose up -d
   ```
   `s3-init` creates the bucket `traces`, applies the read policy and CORS rule described under [One-click replay](#one-click-replay), and exits.
2. Run your tests with the configuration above.
3. Upload the output directory to the bucket (see the recipes below).
4. Push the telemetry right after the run. Loki silently drops records about an hour behind the newest in a stream, and the push reports success when it does (see `packages/otel/README.md`, Timestamps and late records):
   ```sh
   npx devtools-otel push devtools-output/devtools-artifacts-*.json \
     --artifact-base-url http://localhost:9000/traces/<run-id> --run-id <run-id>
   ```
   Add `--dry-run` first if you want to see what would be sent.
5. Open Grafana at http://localhost:3000. The "WebdriverIO DevTools - Test Results" dashboard is provisioned automatically from `grafana/`.

The OTLP endpoints are `localhost:4317` (gRPC) and `localhost:4318` (HTTP). The local bucket is served by [RustFS](https://github.com/rustfs/rustfs), an S3-compatible store, because MinIO no longer publishes Docker images. Any S3-compatible store works in its place. Its S3 API is on `localhost:9000` with credentials `devtools` / `devtools-secret` (local use only). Port 9001 is published for the RustFS console, but it answers 403 with this configuration.

Image tags: `grafana/otel-lgtm:0.37.0`, `rustfs/rustfs:1.0.1`, `amazon/aws-cli:2.37.13`.

Verified against these tags: the `lgtm-data` volume at `/data` holds Grafana, Loki, Tempo and Prometheus state, so it survives `docker compose down`. Tempo (3200) and Loki (3100) answer on their default ports. Loki exposes the OTLP attributes as structured metadata with dots replaced by underscores (`test_case_result_status`, `devtools_duration_ms`), which is what the LogQL queries below use.

## One-click replay

The dashboard "WebdriverIO DevTools - Test Results" has a Test results table. Its Replay column links to `${player_base}/?record=<zip URL>`, where `player_base` is the dashboard's Replay host variable. Your browser fetches the zip from the bucket directly, so the zip never transits Grafana. The Replay column only shows a link when the recorded artifact URL is `http(s)://`; other URLs (for example `s3://`) stay visible as plain text in the Artifact column, and `devtools-otel push` warns when `--artifact-base-url` is not `http(s)://`.

For the link to work, the artifact base URL must be an HTTP(S) address your browser can reach, as in step 4 above. Use https in real deployments. The bucket must allow anonymous `GET` and CORS from the replay host. `s3-init` sets both on the local stack from `s3/bucket-policy.json` and `s3/cors.json`; that CORS rule names `https://player.vibium.dev`, so a different `player_base` needs its origin added to `s3/cors.json` as well.

The access model is **network-private**. Anyone who can reach the bucket host can read every trace in it: typed input (passwords included), page text, DOM mutations, command arguments and test source. Keep the bucket on an internal network or VPN and never expose it publicly. A dedicated hosted trace viewer is planned to replace this.

**The replay host is an opt-in.** `player_base` (the dashboard's "Replay host" variable, default `https://player.vibium.dev`, the Vibium player) is the one setting that chooses where Replay opens a zip. Its default is this example's choice today; a dedicated hosted viewer can replace it later by changing that value. Choosing a host grants it two things: CORS read access to the bucket, so its page can fetch the zips, and the zip URL (bucket host and path) in its own URL, so the host sees every URL it is sent. Point `player_base` only at a viewer you trust with both. To change the default for everyone, edit the `player_base` variable in `grafana/devtools-dashboard.json`. This is POC-grade: it is meant for a private network and has had no security review.

Chrome may prompt for local network access when player.vibium.dev fetches from `localhost` or a private IP address. Allow it, or the replay will not load.

Rows pushed with an `s3://` base URL are listed but their Replay link cannot be opened in a browser.

## Bring your own bucket

Whatever the access policy, treat a trace zip as sensitive as the run that produced it: it contains everything the run typed and displayed, page text, DOM mutations, typed form input (passwords included, keystroke by keystroke), command arguments and test source. Keep the bucket reachable only from an internal network, as described under [One-click replay](#one-click-replay).

**RustFS** (this stack):

```sh
AWS_ACCESS_KEY_ID=devtools AWS_SECRET_ACCESS_KEY=devtools-secret \
  aws --endpoint-url http://localhost:9000 s3 cp --recursive ./devtools-output/ s3://traces/<run-id>/
```

**Amazon S3:**

```sh
aws s3 cp --recursive ./devtools-output/ s3://<bucket>/<run-id>/
```

**Google Cloud Storage:**

```sh
gcloud storage cp --recursive ./devtools-output/ gs://<bucket>/<run-id>/
```

## GitHub Actions

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    env:
      OTEL_EXPORTER_OTLP_ENDPOINT: ${{ secrets.OTEL_EXPORTER_OTLP_ENDPOINT }}
      OTEL_EXPORTER_OTLP_HEADERS: ${{ secrets.OTEL_EXPORTER_OTLP_HEADERS }}
      OTEL_RESOURCE_ATTRIBUTES: vcs.ref.head.name=${{ github.ref_name }},vcs.ref.head.revision=${{ github.sha }},cicd.pipeline.run.id=${{ github.run_id }}
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - name: Run tests
        run: npx wdio run wdio.conf.ts
      - name: Upload traces
        if: always()
        run: aws s3 cp --recursive devtools-output/ s3://bucket/${{ github.run_id }}/
      - name: Push telemetry
        if: always()
        run: npx devtools-otel push devtools-output/devtools-artifacts-*.json --artifact-base-url https://traces.internal.example/${{ github.run_id }}/
```

`--artifact-base-url` must be the internal https address that serves that bucket to your browser (with CORS for `https://player.vibium.dev`, see One-click replay); an `s3://` URL is recorded but cannot be replayed. The upload step needs AWS credentials. Configure them in whatever way your organisation uses, for example `aws-actions/configure-aws-credentials`.

## Grafana Cloud

Point the standard OTLP variables at your stack:

```sh
export OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<region>.grafana.net/otlp
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic <base64 of instanceId:token>"
```

## Sample queries

These are starting points to adapt, not tested dashboards. Loki stores the record's attributes as structured metadata, and the names below assume dots are sanitized to underscores (`test.case.result.status` becomes `test_case_result_status`). That has not been verified. Check the actual names in Grafana Explore and adjust.

**LogQL**

Pass rate over the last day:

```logql
sum(count_over_time({service_name="devtools-tests"} | test_case_result_status="pass" [1d]))
/
sum(count_over_time({service_name="devtools-tests"} [1d]))
```

Flaky tests (passed after an in-process retry; `specFileRetries` retries run in a fresh worker and are not counted):

```logql
sum by (test_case_name) (count_over_time({service_name="devtools-tests"} | test_case_result_status="pass" | devtools_test_attempt > 0 [7d]))
```

p95 test duration:

```logql
quantile_over_time(0.95, {service_name="devtools-tests"} | unwrap devtools_duration_ms [1d])
```

Top 10 failing tests:

```logql
topk(10, sum by (test_case_name) (count_over_time({service_name="devtools-tests"} | test_case_result_status="fail" [7d])))
```

**TraceQL**

Failed tests:

```traceql
{ span.test.case.result.status = "fail" }
```

Every run of one test, to compare a passing trace with a failing one:

```traceql
{ span.test.case.name = "<title>" }
```
