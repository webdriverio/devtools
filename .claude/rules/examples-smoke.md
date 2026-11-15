---
paths:
  - "examples/**"
  - "packages/conformance/smoke/**"
  - ".github/scripts/examples-smoke/**"
---

# Examples smoke job

Scope: the `examples-smoke` job in `ci.yml`, which runs one desktop example per adapter in trace mode against the fixture site and checks the rows and byte budget of the zips. It does not check rendering.

## Rules

- A change that alters an example's rows updates its expectation file under `packages/conformance/smoke/expectations/` in the same PR. Why: the job checks captured rows against that file, so a stale file fails the job.
- Keep each byte budget at the measured total plus about 25%, and lower it with a new `measuredBytes` when a change shrinks traces. Why: a shrink then cannot be undone silently.
- In a worktree, `export PYTHONPATH=packages/selenium-devtools-py/src` before running a Python example. Why: the editable install of `selenium_devtools` points at the primary checkout, so the example and `_find_monorepo_backend` otherwise run `main`'s code.

## Accepted residuals

- Dashboard visuals, mobile and Safari are not checked by this job and still need a person.
