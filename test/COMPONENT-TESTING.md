# Component testing plan — `packages/app`

Automated regression cover for the dashboard's rendering, so a UI change is
verified by running one test instead of clicking through the app. This document
is the plan and the component inventory; it is the single source of truth for
what is covered and what is next.

These are now the **only** automated UI tests in the repo. The previous
fixture-driven harness — Layer A (`pnpm verify`, golden `trace.zip` capture
snapshots) and Layer B (`pnpm verify:ui`, 54 whole-app pixel baselines) — was
removed along with its fixtures, recorders and CI gate. Layer B's baselines moved
with every fixture re-record, so a diff could never distinguish a data change
from a UI regression; Layer A was dropped with it.

**What no longer has automated cover**, so it is a conscious gap rather than a
forgotten one:

| Gone with the harness | Now caught by |
|---|---|
| Trace-format / reader contract across the six adapter+runner combinations | nothing automated — a `trace.zip` shape regression surfaces when someone opens a trace |
| CSS, spacing and theme regressions | nothing automated — visual review |
| Retention-policy wiring (granularity × policy → artifact set) | `core`'s unit tests for `trace-retention` / `trace-finalizer`, which cover the policy matrix but not the adapter→finalizer→manifest path |
| Live dashboard wiring (the behavioural specs) | nothing automated |

Running the real thing — `pnpm demo:wdio:mocha` and the other
`examples/<framework>/` projects — is what covers those now.

---

## Why

| | Count |
|---|---|
| Custom elements in `packages/app/src` | **31** |
| Non-component modules (helpers + 3 base classes) | 50 |
| Test files in `packages/app/tests` | 22 |
| Components with a **rendering** test | **0** |

The helpers extracted *out of* components are well covered — `duration`,
`tree-filter`, `mutation-at-command`, `network-helpers` and 18 more. What no test
touches is whether a component renders those values correctly, reacts to input,
or emits the right events. Until now that gap was filled by 54 whole-app pixel
baselines coupled to 6 trace recordings — the wrong granularity for developing a
single component, since it can't tell you *which* component broke and a
re-recorded fixture invalidated it wholesale.

Note two files register two elements each, so element count ≠ file count:
`sidebar/test-suite.ts` defines `wdio-test-suite` + `wdio-test-entry`, and
`tabs.ts` defines `wdio-devtools-tabs` + `wdio-devtools-tab`.

## Tooling

**`@wdio/browser-runner`** (WDIO Component Testing) — Vite-backed, runs specs
inside a real browser, first-class Lit support, no fixture or backend involved.
Mount a component with explicit inputs, assert its shadow DOM.

- Headless by default; `HEADED=1` to watch a component render.
- `--spec` runs one file or a folder glob, `--mochaOpts.grep` one case.
- Deterministic (DOM assertions, not pixels), so it can gate CI.

`@vitest/browser` was an unused devDependency defaulting to a Playwright
provider; removed in Phase 0 to keep one browser stack.

### Three config facts worth knowing

- `packages/app/wdio.conf.ts` hands the runner the app's **own** `vite.config.ts`
  (the `viteConfig` option takes an inline config). The components import
  `~icons/*` via unplugin-icons, Tailwind through postcss, and the
  `@` / `@core` / `@components` aliases — without that config every spec fails at
  import. Relatedly, every path in that Vite config is absolute
  (`collectionsNodeResolvePath`, the postcss config, the icon loader): the runner
  starts a Vite server per worker with the repo root as cwd, and cwd-relative
  defaults make every icon fail to resolve.
- Specs carry their own `test-ui/tsconfig.json` (mocha + `expect` globals via
  `@wdio/globals/types`), and `packages/app/tsconfig.json` **excludes**
  `test-ui/` so the app build never depends on test-runner types.
- `packages/app` devDepends on **`expect` pinned to an exact version**. The
  runner lists `expect` in `optimizeDeps.include` because it is CJS and must be
  pre-bundled to ESM; under pnpm it isn't resolvable from the Vite root, so Vite
  skips it and the browser's `import expect from 'expect'` dies with *"does not
  provide an export named 'default'"* — every spec fails at load. The pin must
  match the version `expect-webdriverio` resolves, or Vite pre-bundles a second
  copy and the error returns. Check with
  `node -e "console.log(require('expect/package.json').version)"` from
  `packages/app` against the `expect@x.y.z` path in the error.

---

## Composition tree

Derived from the render templates, not assumed. The test folders mirror this.

```
wdio-devtools                              app.ts
├─ wdio-devtools-header
├─ wdio-devtools-sidebar                   sidebar.ts
│  ├─ wdio-devtools-sidebar-filter
│  ├─ wdio-devtools-sidebar-summary
│  └─ wdio-devtools-sidebar-explorer
│     └─ wdio-test-suite
│        └─ wdio-test-entry
├─ wdio-devtools-workbench                 workbench.ts
│  ├─ wdio-devtools-tabs
│  │  └─ wdio-devtools-tab
│  ├─ wdio-devtools-browser                snapshot.ts — the viewer
│  │  └─ wdio-devtools-screencast-player
│  ├─ wdio-devtools-trace-timeline
│  ├─ wdio-devtools-trace-player-controls
│  ├─ wdio-devtools-actions
│  │  ├─ wdio-devtools-command-item
│  │  ├─ wdio-devtools-mutation-item
│  │  └─ wdio-devtools-group-item
│  ├─ wdio-devtools-console-logs
│  ├─ wdio-devtools-network
│  ├─ wdio-devtools-errors
│  ├─ wdio-devtools-a11y
│  ├─ wdio-devtools-metadata
│  ├─ wdio-devtools-source
│  ├─ wdio-devtools-logs
│  ├─ wdio-devtools-transcript
│  └─ wdio-devtools-compare
├─ wdio-devtools-compare                   also mounted at app level
├─ wdio-devtools-shortcuts
└─ wdio-devtools-start

wdio-devtools-placeholder                  shared leaf: browser, actions, network
```

## Layout

One folder per parent component, its children inside. Nesting stops at three
levels so the tree stays navigable.

```
packages/app/
├─ wdio.conf.ts                      component-test runner config
└─ test-ui/
   ├─ tsconfig.json                  mocha + expect globals for specs only
   ├─ support/
   │  ├─ mount.ts                    mount(tag, props) / mountWithContext(); auto-teardown
   │  ├─ builders.ts                 commandLog(), mutation(), documentLoaded()
   │  └─ queries.ts                  deep shadow-DOM query, rowTexts(), …
   ├─ shell/
   │  ├─ app.test.ts                 wdio-devtools
   │  ├─ header.test.ts
   │  ├─ shortcuts-overlay.test.ts
   │  └─ start.test.ts
   ├─ sidebar/
   │  ├─ sidebar.test.ts             parent: composition + collapse
   │  ├─ filter.test.ts
   │  ├─ summary.test.ts
   │  ├─ fixtures.ts                 suite trees, per-test states
   │  └─ explorer/
   │     ├─ explorer.test.ts
   │     ├─ test-suite.test.ts
   │     └─ test-entry.test.ts
   ├─ workbench/
   │  ├─ workbench.test.ts           parent: panel composition, dock, layout modes
   │  ├─ fixtures.ts                 command/mutation/network arrays
   │  ├─ tabs/
   │  │  ├─ tabs.test.ts
   │  │  └─ tab.test.ts
   │  ├─ actions/
   │  │  ├─ actions.test.ts          parent of the row components
   │  │  ├─ command-item.test.ts
   │  │  ├─ mutation-item.test.ts
   │  │  └─ group-item.test.ts
   │  ├─ player/
   │  │  ├─ snapshot.test.ts         wdio-devtools-browser
   │  │  ├─ screencast-player.test.ts
   │  │  ├─ trace-timeline.test.ts
   │  │  └─ trace-player-controls.test.ts
   │  └─ panels/
   │     ├─ console.test.ts
   │     ├─ network.test.ts
   │     ├─ errors.test.ts
   │     ├─ a11y-tree.test.ts
   │     ├─ metadata.test.ts
   │     ├─ source.test.ts
   │     ├─ logs.test.ts
   │     ├─ transcript.test.ts
   │     └─ compare.test.ts
   └─ shared/
      └─ placeholder.test.ts         used by three parents, owned by none
```

Why grouped rather than colocated in `src/`:

- A parent and its children are run and reviewed as one unit — one `--spec` glob
  covers the whole subtree.
- **Per-parent fixtures.** Sidebar specs need suite trees; workbench specs need
  command and mutation arrays. Those builders live in the folder that uses them
  (`sidebar/fixtures.ts`) rather than swelling one shared file.
- Parent specs can mount the real children and assert composition, while the
  child specs test the same components in isolation — the folder makes that pair
  obvious.

Two consequences to accept: a rename in `src/` needs a matching move here, and
the directory is deliberately **not** under `tests/` because the node runner's
glob is `packages/**/tests/**/*.test.ts` and would otherwise try to run browser
specs in node.

## Conventions

1. One spec per element, named after it — including the second element in a
   two-element file (`test-entry.test.ts`, `tab.test.ts`).
2. Mount with explicit inputs → assert output. No trace fixtures, no WebSocket,
   no backend.
3. Assert **semantics** — text, counts, attributes, emitted events, ARIA — never
   pixels. Nothing here pixel-diffs.
4. Cover the contract: inputs (properties + context), outputs (dispatched
   events), and the states that get forgotten — empty, single item, overflow,
   error, active/selected.
5. Pure logic stays in the node suite. If a spec starts asserting a computation,
   extract the helper instead — that is where the existing 22 tests came from.
6. Shared data builders in `support/builders.ts`; anything used by one folder
   only lives in that folder's `fixtures.ts`.
7. No DOM-string snapshots. They churn like pixel baselines and hide the intent.

## Running

```sh
pnpm test:ui                                                  # everything
pnpm test:ui --spec 'packages/app/test-ui/sidebar/**/*.test.ts'   # one subtree
pnpm test:ui --spec packages/app/test-ui/workbench/actions/actions.test.ts
pnpm test:ui --mochaOpts.grep "renders one row per command"    # one case
HEADED=1 pnpm test:ui --spec '**/player/snapshot.test.ts'      # watch it render
```

---

## Inventory

All 31 elements, by folder. **Tier** is regression risk × time on screen, not
file size. **Inherits** lists node-level helper tests that already cover that
component's extracted logic — a spec need not re-assert those.

### `test-ui/workbench/player/` (4)

| Tier | Element | Source | LOC | The spec covers | Inherits |
|---|---|---|---|---|---|
| 1 | `wdio-devtools-browser` | `browser/snapshot.ts` | 821 | Document-anchor rebuild, incremental mutation replay (attribute/childList/characterData), field-state (`value`/`checked`) application, screenshot fallback when no mutation is in range, URL bar resolution, view-mode switching | `mutation-at-command`, `url-at-timestamp`, `element-overlay` |
| 1 | `wdio-devtools-trace-timeline` | `browser/trace-timeline.ts` | 421 | Row ordering, duration bars, active-entry highlight, click → selection event | `trace-timeline-utils` |
| 2 | `wdio-devtools-screencast-player` | `browser/screencast-player.ts` | 343 | Frame selection by time, scrub → progress event, no-frames state | `scrubber` |
| 2 | `wdio-devtools-trace-player-controls` | `browser/trace-player-controls.ts` | 137 | Play/pause/step state, disabled at bounds, emitted control events | — |

### `test-ui/workbench/actions/` (4)

| Tier | Element | Source | LOC | The spec covers | Inherits |
|---|---|---|---|---|---|
| 1 | `wdio-devtools-actions` | `workbench/actions.ts` | 284 | Commands + document-load mutations merged in timestamp order, flat vs tree mode, per-row duration, active row scroll-into-view, empty state | `action-tree`, `active-entry`, `duration`, `category`, `call-source` |
| 1 | `wdio-devtools-command-item` | `workbench/actionItems/command.ts` | 127 | Command label + args, elapsed vs own-duration, duration heat bucket, error/active styling, selection event | `duration`, `category`, `call-source` |
| 1 | `wdio-devtools-mutation-item` | `workbench/actionItems/mutation.ts` | 114 | "Document loaded" for a URL-bearing childList, attribute-change label, added/removed node counts, hover → highlight event | `duration` |
| 2 | `wdio-devtools-group-item` | `workbench/actionItems/group.ts` | 69 | Group label, expanded/collapsed chevron, toggle event | — |

### `test-ui/workbench/panels/` (9)

| Tier | Element | Source | LOC | The spec covers | Inherits |
|---|---|---|---|---|---|
| 1 | `wdio-devtools-console-logs` | `workbench/console.ts` | 302 | One row per entry, level styling, browser/terminal source split, filter narrowing, empty state | `console-filter` |
| 1 | `wdio-devtools-network` | `workbench/network.ts` | 228 | One row per request, status/method/type columns, waterfall geometry, row → detail expansion | `network-helpers`, `waterfall` |
| 2 | `wdio-devtools-errors` | `workbench/errors.ts` | 218 | Grouping and de-duplication, stack rendering, assertion `Expected/Received` block, empty state | `errors-collect` |
| 2 | `wdio-devtools-a11y` | `workbench/a11y-tree.ts` | 373 | Tree nesting, role/name rendering, node selection, unavailable state (Selenium/Nightwatch traces carry no snapshot) | — |
| 2 | `wdio-devtools-metadata` | `workbench/metadata.ts` | 323 | Capability/option rows, per-session grouping, missing-field tolerance | — |
| 2 | `wdio-devtools-source` | `workbench/source.ts` | 383 | Highlighted call-site line, file switching, source-unavailable state | — |
| 2 | `wdio-devtools-logs` | `workbench/logs.ts` | 288 | Parameter/result rendering per command, long-value truncation, empty state | — |
| 2 | `wdio-devtools-transcript` | `workbench/transcript.ts` | 139 | Step ordering and formatting, empty state | — |
| 2 | `wdio-devtools-compare` | `workbench/compare.ts` | 459 | Baseline-vs-current pairing, marker placement, detail blocks, no-baseline state | `compareUtils` |

### `test-ui/workbench/` + `tabs/` (3)

| Tier | Element | Source | LOC | The spec covers | Inherits |
|---|---|---|---|---|---|
| 2 | `wdio-devtools-workbench` | `workbench.ts` | 498 | Panel composition, dock tab switching, player vs live layout, split/resize persistence | — |
| 2 | `wdio-devtools-tabs` | `tabs.ts` | 261 | Active tab, per-tab count badges, `open-dock-tab` event handling (the programmatic tab switch) | — |
| 2 | `wdio-devtools-tab` | `tabs.ts` | ↑ | Single tab: label, count badge, active/disabled state, click event | — |

### `test-ui/sidebar/` (6)

| Tier | Element | Source | LOC | The spec covers | Inherits |
|---|---|---|---|---|---|
| 1 | `wdio-devtools-sidebar-explorer` | `sidebar/explorer.ts` | 481 | Suite tree construction, filter narrowing, run/stop/rerun controls, running-state transitions | `tree-filter`, `contextUpdates`, `mark-running`, `run-detection`, `suite-merge` |
| 1 | `wdio-test-suite` | `sidebar/test-suite.ts` | 449 | Suite grouping, expand/collapse, child entry ordering, selection event | — |
| 1 | `wdio-test-entry` | `sidebar/test-suite.ts` | ↑ | Per-test row: state icon (passed/failed/running/skipped), title, retry marker, click event | — (see `test-entry-state` gap) |
| 2 | `wdio-devtools-sidebar-summary` | `sidebar/summary.ts` | 252 | Pass/fail/running/skipped counts, progress bar proportions, runner capability chips | `suite-summary`, `runnerCapabilities` |
| 2 | `wdio-devtools-sidebar-filter` | `sidebar/filter.ts` | 111 | Query input → filter event, tag syntax, clear control | — |
| 3 | `wdio-devtools-sidebar` | `sidebar.ts` | 56 | Composition and collapse state | — |

### `test-ui/shell/` (4)

| Tier | Element | Source | LOC | The spec covers | Inherits |
|---|---|---|---|---|---|
| 3 | `wdio-devtools` | `app.ts` | 259 | Player vs live routing, connected/disconnected state, overlay mounting | — |
| 3 | `wdio-devtools-header` | `header.ts` | 98 | Title, theme toggle, connection indicator | — |
| 3 | `wdio-devtools-shortcuts` | `shortcuts-overlay.ts` | 141 | Open/close, keybinding list rendering | — |
| 3 | `wdio-devtools-start` | `onboarding/start.ts` | 45 | Onboarding copy and CTA event | — |

### `test-ui/shared/` (1)

| Tier | Element | Source | LOC | The spec covers | Inherits |
|---|---|---|---|---|---|
| 2 | `wdio-devtools-placeholder` | `placeholder.ts` | 53 | Empty-state copy per panel; asserted once here rather than in every parent | — |

**Tier totals:** 10 · 15 · 6 = 31.

### Base classes (3)

Not registered elements; covered through their subclasses, no specs of their own.

| File | LOC | Subclassed by |
|---|---|---|
| `workbench/actionItems/item.ts` | 110 | `command-item`, `mutation-item`, `group-item` |
| `sidebar/collapseableEntry.ts` | 51 | sidebar tree entries |
| `core/element.ts` | 17 | most components (shared styles) |

---

## Helper gaps (node tests, no browser)

Meaningful logic in `packages/app` with no test at all. Cheaper than component
specs, and they belong in the existing node suite, not here. `test-entry-state`
is the one to do first — it drives the state icons in `wdio-test-entry`, a Tier 1
element that inherits no helper coverage today.

| Module | LOC |
|---|---|
| `controller/DataManager.ts` | 559 |
| `utils/DragController.ts` | 320 |
| `workbench/compare/stepResolution.ts` | 212 |
| `sidebar/test-entry-state.ts` | 174 |
| `workbench/compare/renderDetailBlock.ts` | 167 |
| `workbench/compare/markers.ts` | 118 |
| `controller/keyboard.ts` | 105 |
| `workbench/network/request-detail.ts` | 98 |
| `browser/vnode-transform.ts` | 40 |

## Phases

**Phase 0 — foundation. Landed and green:** 4/4 specs, **77 tests in 19s**
(command-item 32, mutation-item 16, actions 15, group-item 14). Runner config,
`support/` harness, the `test:ui` script, and `workbench/actions/` built end to
end plus `workbench/fixtures.ts`. All three shapes are proven — presentational
row, data-driven list, and a parent mounting its real children.

Harness API as built:

```ts
mount<T>(tag, props?)                     // props assigned as properties, awaits first render
mountWithContext<T>(tag, [{context, value}], props?)
settle(el)                                // await a re-render after mutating props
shadow(host, sel) / shadowAll(host, sel)  // shadow-root first, light-DOM fallback
text(el) / texts(host, sel)               // whitespace-collapsed
commandLog(o?) / mutation(o?) / documentLoaded(url, o?)
```

Mounted elements are torn down by a module-scope `afterEach` in `mount.ts`, so
specs never write cleanup. `mountWithContext` provides values through a real
`ContextProvider` on a wrapper host, which is what makes `subscribe: true`
consumers update — the actions panel takes **all** its data by context
(`mutationContext`, `commandContext`, `actionGroupsContext`), not properties.

Two limits to know: context values can't be updated after mount (re-mount
instead), and `shadow()` doesn't pierce a nested component's shadow root — call
it again on the child.

### What `HEADED=1` shows

The runner serves its own page — `<mocha-framework>` in an otherwise empty body,
with `body { width: calc(100% - 500px) }` so mounted elements clear the fixed
reporter panel. The panel on the right (logo, spinner, step control) is that
reporter, visible only when headed. The empty region on the left is where
`mount()` puts each element, and `mount.ts`'s `afterEach` removes it again — so
between tests the body really is empty.

Nothing here composes the dashboard; component tests never boot the app. Plain
`HEADED=1 pnpm test:ui` opens one window per spec file, so narrow with `--spec`.

**The left region looks empty because it is.** The teardown removes each element
after its test, and a test lasts tens of milliseconds — by the time the run ends
there is nothing left to see. To freeze one component on screen, pause inside the
test with the element still mounted:

```ts
const el = await mount('wdio-devtools-group-item', { group: … })
await browser.debug()   // holds the browser open, REPL in the terminal
```

```sh
HEADED=1 pnpm test:ui --spec '**/group-item.test.ts' \
  --mochaOpts.grep "renders the group title" --mochaOpts.timeout 600000
```

The timeout override is required: mocha's timeout is **not** suspended during
`debug()`, so the default 30s kills the pause. The reporter panel stays visible
while paused (`HIDE_REPORTER_FOR_COMMANDS` covers only `saveScreenshot`/
`savePDF`), and the component renders in the left region beside it.

`--watch` keeps the session alive and re-runs on file changes, which is good for
iterating — but it does not show you a component, because teardown still empties
the body between runs. The pause is what freezes it.

### Expected noise on a green run

All five of these appear on a fully passing run. None indicate a problem; they
cost four debugging rounds to establish, so don't re-investigate them. Set
`logLevel: 'error'` in `wdio.conf.ts` to drop the first four if the volume
bothers you.

| Line | Why |
|---|---|
| `ShadowRootManager: Expected element with shadow root but found <icon-mdi-…>` | Icons are configured with `shadow: false`, so those elements genuinely have no shadow root. One per icon rendered. |
| `Lit is in dev mode` | The dev server serves Lit's development build. |
| `BiDi setCookies failed, falling back to classic` | WebdriverIO falls back and proceeds. |
| `optimizeDeps.esbuildOptions … deprecated, use rolldownOptions` ×4 | The runner targets Vite 5; the repo pins Vite 8, where the dep optimizer is Rolldown. The option is ignored — its plugins target Stencil/Vue, not us. |
| `ERROR … No environment found for non determined environment` ×4 | Nothing to do with Vite. The runner's middleware looks up a test session by `cid` (query param or `WDIO_CID` cookie) on *every* request; one without either logs this and calls `next()`, handing the request to normal Vite handling. A mislabelled debug line on non-spec requests. |
| `Failed to resolve dependency: p-iteration` | The one entry in the runner's CJS list that resolves nowhere in this tree. Unreachable, therefore never imported. |

**Phase 1 — Tier 1.** `workbench/player/snapshot`, `trace-timeline`,
`sidebar/explorer/` (all three), `panels/console`, `panels/network`.

**Phase 2 — Tier 2.** 15 elements across the remaining folders.

## Expansion rule

This is what actually retires manual regression:

- A component you touch gets a spec, or a new case in its existing spec, in the
  same change.
- A UI bug gets a failing spec before the fix.
- A new component ships with a spec, in its parent's folder.

Tier 3 is added on contact. There is no target of 31 specs.
