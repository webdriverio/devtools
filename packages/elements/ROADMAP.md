# Roadmap

Prioritized work items for the devtools monorepo. Items are ordered by priority
within each phase; dependencies are noted inline.

---

## Phase 1 — Foundation (tests + safe extractions)

Before touching the hot paths, add coverage and extract non-breaking helpers.

### 1.1 Locator-generation unit tests

`packages/core/src/locators/` has zero tests. Every item downstream (XML parse
dedup, interactive-element merge, `isInUiAutomatorScope` fix) needs this safety
net first.

**Effort:** ~3 hours. **Depends on:** nothing.

### 1.2 Snapshot-output golden tests

`serializeMobileSnapshot` and `serializeWebSnapshot` need output-fidelity tests
before the interactive-element dedup or mobile pipeline unification. Without
them, any change to the snapshot format is a blind regression risk for LLM
consumers.

**Effort:** ~2 hours. **Depends on:** nothing.

### 1.3 Extract `getMobileAccessibilityTree()`

Expose `collectMobileNodes()` as a public `getMobileAccessibilityTree()`
returning `MobileFlatNode[]`. `serializeMobileSnapshot()` becomes a pure
formatting pass — matching `serializeWebSnapshot()`'s shape.

**Effort:** ~2 hours. **Depends on:** 1.2 (golden tests). **Unblocks:** 2.1, 2.2.

---

## Phase 2 — Core dedup & unification

### 2.1 Merge interactive-element checks

`element-snapshot.ts` duplicates `locators/element-filter.ts`:
- `isMobileInteractive` / `isExplicitlyInteractive` → use
  `isInteractableElement`
- `isMobileInViewport` → use shared `isWithinViewport`
- `inferPurpose` / `mobileInferPurpose` → parameterize the role-skip
  predicate
- Static-text echo dedup → extract shared helper

**Effort:** ~3 hours. **Depends on:** 1.2, 1.3.

### 2.2 Unify mobile pipeline role classification

`serializeMobileSnapshot` has its own copies of `ANDROID_ROLE_MAP` /
`IOS_ROLE_MAP`, interactivity detection, and locator fallbacks
(`getBestAndroidLocator` / `getBestIOSLocator`). Thread `_role`, `_interactive`,
and `_selector` through via the shared tree so `serializeMobileSnapshot` doesn't
re-classify what `generateAllElementLocators` already computed.

**Effort:** ~4 hours. **Depends on:** 1.3, 2.1. **Unblocks:** 2.3.

### 2.3 Thread parsed XML through to both consumers

`pageSource` XML is parsed 3× per mobile snapshot (`xmlToJSON` twice,
`xmlToDOM` once). Pass the initial `jsonTree` through to both
`serializeMobileSnapshot` and `generateAllElementLocators`. Also removes the
redundant second `getSuggestedLocators` call per element.

**Effort:** ~1 day. **Depends on:** 1.1, 2.2.

---

## Phase 3 — Hot-path & trace fixes

### 3.1 `isInUiAutomatorScope` computed once per element

Both `getSimpleSuggestedLocators` and `getComplexSuggestedLocators` call it for
the same element. Compute once in `getSuggestedLocators`, pass as parameter.

**Effort:** ~15 min. **Depends on:** 1.1.

### 3.2 `resolveContextNaming(caps)` called once

`buildContextOptions` and `buildTraceBundle` both call it with the same args.
The title is already available on `events[0]`. Thread it through.

**Effort:** ~15 min. **Depends on:** nothing.

### 3.3 Extract `makeScreencastFrame` helper

The initial t=0 frame manually duplicates `buildScreencastFrames`'s
construction logic. Extract a shared `makeScreencastFrame` helper; use for both
t=0 and subsequent frames.

**Effort:** ~20 min. **Depends on:** nothing.

### 3.4 Mobile layout-noise filter made configurable

Add `collapseContainers` option to `MobileSnapshotOptions` so consumers can
adjust the `NOISY_ROLES` threshold or disable the filter.

**Effort:** ~30 min. **Depends on:** nothing.

### 3.5 `selectBestLocators` in elements wrapper delegates to core

`mobile-elements.ts`'s `LOCATOR_PRIORITY` and `selectBestLocators` duplicate
`getBestLocator` from core. Route through the re-export. Verify no external
consumers break.

**Effort:** ~30 min. **Depends on:** nothing.

---

## Phase 4 — Adapter convergence

### 4.1 `onLine` override unified in base class

All three adapters duplicate the same `onLine` override. Move the
`consoleLogs.push` into `SessionCapturerBase.onLine` after resolving the type
mismatch between `createConsoleLogEntry`'s return type and the stored array.

**Effort:** ~30 min. **Depends on:** nothing.

### 4.2 `CommandLog.startTime` populated in nightwatch + selenium

Nightwatch and selenium never set `startTime`, so command durations are always
0ms in their traces. Add start-timestamp capture to the nightwatch
`browserProxy` and selenium `onCommand` hooks.

**Effort:** ~2 hours. **Depends on:** nothing (framework-specific wiring).

### 4.3 Nightwatch `traceMode` moved off capturer field

`SessionCapturer.traceMode` is a mutable public field set from
`session-init.ts`. Neither service nor selenium store it on the capturer. Thread
`mode` through an options bag to `captureCommand()`. Watch for breaking changes
to the nightwatch browser proxy signature.

**Effort:** ~1 hour. **Depends on:** nothing.

### 4.4 Unify `replaceCommand` logic

Nightwatch and selenium both implement ~35 lines of entry-find, error-serialize,
command-counter-increment, and push logic. Unify under
`SessionCapturerBase` with a parameterized splice-vs-mutate policy.

**Effort:** ~1.5 hours. **Depends on:** nothing.

---

## Completed

- **Snapshot promise drain** — Nightwatch and selenium now drain
  `snapshotCaptures` via `Promise.allSettled` before writing the trace zip
  (2026-06-16).

---

## Deferred

Items considered but not prioritized:

- **`INTERNAL_COMMANDS` extraction** — only `'execute'` overlaps across all
  three adapters. Not worth extracting.
- **`SelectorString` type** — no concrete consumer exists. Revisit if an LLM
  consumer needs to parse selector strings.
- **Unify web + mobile serialization** — blocked on 1.3. The renderers are too
  different in input types and passes to unify directly; revisit after Phase 2.
