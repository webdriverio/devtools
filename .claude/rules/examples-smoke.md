---
paths:
  - "examples/**"
  - "packages/conformance/smoke/**"
  - ".github/scripts/examples-smoke/**"
---

### Examples smoke job

`ci.yml`'s `examples-smoke` job (which sets `DEVTOOLS_MODE=trace` for the whole job) runs one desktop example per adapter (WDIO mocha, Selenium mocha, Nightwatch BDD, Python pytest) in trace mode in the runner's headless Chrome, against the fixture site (`pnpm smoke:fixtures`) via `DEVTOOLS_EXAMPLE_BASE_URL`, so no third-party page change can break it. `.github/scripts/examples-smoke/run-example.sh` collects the zips each run wrote and hands them to `pnpm smoke:assert`; each red step names its example and each `FAIL` line names the expectation, and the zips and run logs are uploaded as the `examples-smoke` artifact. It checks that capture still produces the rows the examples imply, and that an example's zips stay inside its byte budget, not how they render, so dashboard visuals, mobile and Safari still need a person. A change that alters an example's rows updates its expectation file in the same PR. A budget is the measured total plus about 25% and is lowered, with a new `measuredBytes`, when a change shrinks traces, so the win cannot be undone silently; the artifact is uploaded on every run that is not cancelled (`ci.yml` keeps it on success, since a green run's zips seed new reader fixtures), so a passing job's measurement is also its log's `trace zips total` line.

The venv's editable install of `selenium_devtools` points at the primary checkout, so in a worktree every Python example, and the backend and page collector it resolves through `_find_monorepo_backend`, come from `main` unless `PYTHONPATH=packages/selenium-devtools-py/src` is exported first. A Python run that reports the old behaviour from a worktree is usually this, not the change.

