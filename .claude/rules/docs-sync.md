---
paths:
  - "README.md"
  - "packages/*/README.md"
---

### Documentation

- User-facing docs live in two places that must stay in sync: this repo's `README.md` (+ per-package READMEs) and the **WebdriverIO devtools webpage** (`website/docs/devtools/**` in the `webdriverio/webdriverio` repo — e.g. `wdio/TraceMode.md`). When a change adds, removes, or alters user-facing behavior (a new option, CLI, flag, output, or workflow), update the README here **and** mirror it to the matching webpage doc in the same change. A docs PR that updates only one side isn't complete.
