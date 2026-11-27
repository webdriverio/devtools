---
paths:
  - "packages/conformance/src/**"
  - "README.md"
  - "packages/*/README.md"
---

# Capability tables and user-facing docs

Scope: the generated capability tables, and the README and webpage docs that describe user-facing behaviour.

## Rules

- Never hand-edit the capability tables (the README tables and the docs-site `CrossFrameworkSupport.md` and `MobileTesting.md`). Regenerate with `pnpm docs:capabilities`, passing `--website <checkout>` in the same change. Why: a hand edit is overwritten on regeneration, and `capabilities.test.ts` fails when the README drifts from the declared source.
- Declare every new feature in `packages/conformance/src/features.ts` with one cell per adapter. A partial or unsupported cell carries a reason; a supported cell carries its evidence. Why: the typed map does not compile for a new adapter until each feature declares it.
- Every new user-facing option names a feature id in `packages/conformance/src/capability-options.ts`, or says why it is not one. Why: the coverage check otherwise never sees the option.
- Every conformance rule backs a tested cell or is listed in `INTERNAL_RULES` with a reason. Why: an unbacked rule claims coverage it does not have.
- A change to user-facing behaviour (an option, CLI, flag, output or workflow) updates the README here and mirrors it to the matching webpage doc in `webdriverio/webdriverio` (`website/docs/devtools/**`) in the same change. Why: a docs change that updates only one side is incomplete.
