---
paths:
  - "packages/trace/src/**"
  - "packages/trace/tests/fixtures/**"
---

# Trace zips from older writers

Scope: the trace-zip reader and writer, and the committed zips from older writers that test them.

## Rules

- A change to what the writer puts in a zip adds a fixture under `packages/trace/tests/fixtures/trace-formats/`, as that directory's README describes. Why: the hosted player runs the newest reader against zips every adapter version has written.
- Keep older fixtures. Why: each one is a format still in users' hands, and `trace-format-fixtures.test.ts` checks that the current reader still opens it.
