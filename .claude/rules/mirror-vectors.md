---
paths:
  - "packages/shared/mirror-vectors.json"
  - "packages/selenium-devtools-py/src/**"
  - "packages/selenium-devtools-py/tests/test_mirror_vectors.py"
  - "packages/selenium-devtools/tests/mirror-vectors.test.ts"
---

### Logic implemented in both TypeScript and Python

The Python adapter cannot import `core`, so some pure logic exists twice. `packages/shared/mirror-vectors.json` holds input/expected-output cases for it, one section per mirrored function; `packages/selenium-devtools/tests/mirror-vectors.test.ts` runs every section against the TypeScript side under `pnpm test`, and `packages/selenium-devtools-py/tests/test_mirror_vectors.py` runs the same file against the Python side in the Python CI job (whose path filter includes the file). Both runners refuse a section they do not handle. Covered today: assertion target resolution, native-session detection, run id, output directory, command row id range, wait poll keys, nested-wait identity, wait row naming (whose negated case the TypeScript runner skips, selenium-webdriver having no negated wait), performance payload shaping, the capture timing summary, the end-of-test capture stamp, the collector's mask prelude, resource URL keys and the per-action capture gate; `notCovered` in the file says why screencast thinning is not. Add a case whenever a change touches either side of a mirrored function, and a section when new logic is mirrored, provided its output is deterministic without a driver. A deliberate difference between the two goes in the section's `notes`, not around the case.

