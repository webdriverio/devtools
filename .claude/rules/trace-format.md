---
paths:
  - "packages/trace/src/**"
  - "packages/trace/tests/fixtures/**"
---

### Trace zips from older writers

The hosted player runs the newest reader against zips any adapter version wrote. `packages/trace/tests/fixtures/trace-formats/` holds real zips from older writers, one per adapter, reduced by `reduce-fixture.ts` beside them (images become 1x1 images of the same format; every other entry keeps its bytes), each with a manifest counted from its raw entries; `trace-format-fixtures.test.ts` checks the current reader still yields what each one held. A release that changes what the writer puts in a zip adds a fixture for it, as the README there describes, and older ones stay.

