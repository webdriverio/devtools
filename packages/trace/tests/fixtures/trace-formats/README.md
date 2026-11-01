# Trace format fixtures

The hosted player always runs the newest reader, while the zips people open were written by whatever adapter version recorded them. Each zip here is a real trace from an older writer, and `../../trace-format-fixtures.test.ts` checks that the current `parseTraceZip` still opens it with its commands, console output, network requests, DOM mutations, screencast frames, sources and metadata intact. A reader change that breaks an older trace fails `pnpm test`.

## What is here

| Fixture | Written by | Why it is kept |
|---|---|---|
| `wdio-mocha-2026-10-28-14977b93` | WDIO service, mocha example | Written before #508, so every frame-snapshot inlines its screenshot as a base64 data URI; PNG screenshots sit under `.jpeg` names |
| `selenium-mocha-2026-10-28-14977b93` | Selenium adapter, mocha example | Same format; a failed wait row, a failed `node:assert` row, and JPEG screencast frames beside PNG ones |
| `nightwatch-bdd-2026-10-28-14977b93` | Nightwatch adapter, BDD example | Same format; `waitForElementVisible` rows and a failed native assert row |
| `python-pytest-2026-10-28-14977b93` | Python adapter, pytest example | Same format; three browser sessions in one zip |

All four come from one `examples-smoke` CI artifact (run 40774299701 at `14977b93`, 2026-10-28). The two earlier smoke artifacts (2026-10-27) were inspected and wrote the same format, so they add nothing a reader could break separately.

Each `<name>.json` is the fixture's manifest: counts and key fields taken from the zip's raw entries when it was reduced, not through the reader, so a reader bug cannot write itself into the expectation.

## How a fixture is reduced

Real zips are mostly screenshots. `reduce-fixture.ts` keeps every entry, in the same order and under the same name, and changes only images:

- Each image resource (detected by its bytes, not its name) becomes a 1x1 image of the same format carrying its own resource name as a comment (a JPEG `COM` segment or a PNG `tEXt` chunk). The test reads that name back from each frame the reader returns, so a frame paired with the wrong resource still fails.
- In `.trace` streams, each `data:image/...;base64,` payload is replaced by a 1x1 image of the same format. The rest of each line, the data URI prefix included, keeps its bytes.
- Every other entry keeps its bytes. The zip is rewritten with yazl, as the writer does, with a fixed entry time so reducing the same source twice gives the same file.

This does not weaken what is tested: the reader never decodes an image. It base64-encodes resource bytes into frames and never reads a frame-snapshot's HTML, so what it can get wrong (which entries it finds, how it pairs frames with commands, how it parses every stream) is all exercised on the original structure.

## Adding a fixture

When a release changes what the writer puts in a zip, add a trace from that release for each adapter whose output changed:

1. Take a short run's zip, ideally from a green `examples-smoke` CI artifact (`gh run download <run-id> -n examples-smoke`), which drives the local fixture site and so holds only its public demo credentials.
2. Reduce it, naming it `<example>-<capture date>-<short commit>`, with the example name starting with the adapter (`wdio`, `selenium`, `nightwatch`, `python`):

   ```sh
   pnpm exec tsx packages/trace/tests/fixtures/trace-formats/reduce-fixture.ts <trace.zip> <name> "<where the zip came from>"
   ```

3. Check what the zip carries before committing it: no tokens, private hostnames, user names or home paths outside the CI runner's `/home/runner/work`.
4. Run `pnpm test`. Keep older fixtures: each one is a format still in users' hands.

A zip from a foreign tool may need the manifest's counting rules in `reduce-fixture.ts` extended, for instance for structural steps other than `Tracing` rows.
