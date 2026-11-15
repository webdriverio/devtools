---
paths:
  - "packages/shared/mirror-vectors.json"
  - "packages/selenium-devtools-py/src/**"
  - "packages/selenium-devtools-py/tests/test_mirror_vectors.py"
  - "packages/selenium-devtools/tests/mirror-vectors.test.ts"
---

# Logic implemented in both TypeScript and Python

Scope: pure logic that the Python adapter mirrors, because it cannot import `core`.

## Rules

- Give mirrored logic a section in `packages/shared/mirror-vectors.json` when its output is deterministic without a driver. Why: the vectors are the only check that the TypeScript and Python copies agree; both runners refuse a section they do not handle.
- Add a case whenever a change touches either side of a mirrored function. Why: without a new case, the other copy is never checked against the change.
- Record a deliberate difference between the two in the section's `notes`, not around the case. Why: `notes` is where a reader looks to learn why the copies differ.

## Accepted residuals

- The TypeScript runner skips the negated wait-row case, because selenium-webdriver has no negated wait.
- Screencast buffer thinning is not mirror-tested; `notCovered` in the JSON gives the reason.
