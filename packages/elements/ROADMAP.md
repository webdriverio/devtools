# @wdio/elements Roadmap

## Current state (May 2026)

The package delivers LLM-readable element snapshots for both web and mobile:

| Capability | Web | Mobile |
|---|---|---|
| Interactable element list | `getInteractableBrowserElements()` | `getMobileVisibleElements()` |
| Semantic tree | `getBrowserAccessibilityTree()` | *(raw `JSONElement` only)* |
| Snapshot serialization | `serializeWebSnapshot()` | `serializeMobileSnapshot()` |
| Unified API | `getElements()` returns both | `getElements()` returns both |
| Viewport filtering | `inViewportOnly` (default true) | `inViewportOnly` (default true) |
| Role classification | Computed in-browser from tag/ARIA | `ANDROID_ROLE_MAP` / `IOS_ROLE_MAP` in snapshot.ts |
| Locator generation | CSS selectors in browser script | `getSuggestedLocators()` from locator-generation.ts |
| Context disambiguation | `∈` via `inferPurpose()` | `∈` via `mobileInferPurpose()` |
| Duplicate selector indexing | N/A (selectors are unique) | `.instance(N)` suffix |

## Architectural concerns

### 1. Two independent mobile pipelines

`serializeMobileSnapshot` in `snapshot.ts` has its own copies of:

- **Role classification** — `ANDROID_ROLE_MAP` / `IOS_ROLE_MAP` duplicate logic from `locators/constants.ts` and `locators/element-filter.ts`.
- **Interactivity detection** — `isMobileInteractive()` shadows `isInteractableElement()` from `element-filter.ts`. They use different criteria (tag-based vs attribute-based) and can disagree.
- **Locator generation** — `getBestAndroidLocator()` / `getBestIOSLocator()` are simplified fallbacks. The full pipeline (`getSuggestedLocators()`) is now wired in when source XML is available, but the fallback still exists and the two paths can produce different selectors for the same element.

These should be collapsed: `serializeMobileSnapshot` should consume pre-computed roles, interactivity flags, and selectors from the locator pipeline, not recompute them.

### 2. No mobile equivalent of `getBrowserAccessibilityTree()`

The web path returns a flat `AccessibilityNode[]` with roles, names, selectors, depths, and state. The mobile path returns a raw `JSONElement` tree — the snapshot does all enrichment internally via `collectMobileNodes()` → `MobileFlatNode[]` (a private interface). There is no public function to get an enriched flat node list for mobile.

**Proposal:** Extract `collectMobileNodes()` into a public `getMobileAccessibilityTree()` that returns `MobileFlatNode[]` (or a shared type). `serializeMobileSnapshot()` becomes a pure formatting pass — like `serializeWebSnapshot()` already is.

### 3. Layout noise in mobile snapshots

The Android view hierarchy includes every layout container (`FrameLayout`, `LinearLayout`, `ViewGroup`, etc.). The current noise filter (`NOISY_ROLES`) collapses anonymous containers at depth ≥ 2, but named containers and depth 0-1 scaffolding still appear. The web a11y tree doesn't have this problem because the browser's accessibility computation already skips layout-only `<div>`s.

**Proposal:** A `collapseContainers` option on the snapshot (default `true`) that skips any container without an interactive descendant. Alternatively, the tree collection pass could flag "informative" vs "structural" containers and let the renderer decide.

### 4. Selector format for mobile

Mobile selectors are Appium/WDIO-specific strings (`~Accessibility`, `android=new UiSelector()...`, `id:com.example:id/foo`). The web path outputs CSS selectors (`a*=Highlights`, `#cart-icon-bubble`). An LLM/agent needs different selector parsing logic per platform. There's no common selector abstraction.

**Proposal:** A `SelectorString` type with platform-aware parsing, or at minimum consistent prefix conventions documented for LLM consumption.

### 5. The raw tree doesn't carry locators unless processed

`getMobileVisibleElementsWithTree()` returns `{ elements, tree }` where `tree` is the raw `xmlToJSON()` output. Locators are only on `elements` (from `generateAllElementLocators()`). The snapshot reads locators by running `getSuggestedLocators()` again (or falling back). If a consumer wants to annotate the tree themselves, they must re-run the locator pipeline.

**Proposal:** Enrich the tree in-place during `generateAllElementLocators()` — attach `_selector`, `_role`, and `_interactive` attributes to each `JSONElement` node that passes the filter. The raw tree becomes self-describing.

## Improvement backlog

| Priority | What | Effort |
|---|---|---|
| P0 | Merge `isMobileInteractive` + role classification into `generateAllElementLocators` — one source of truth | Medium |
| P1 | Extract `getMobileAccessibilityTree()` as a public API returning enriched flat nodes | Medium |
| P1 | Enrich `JSONElement` tree nodes with locators during `generateAllElementLocators()` | Small |
| P2 | `collapseContainers` option on `serializeMobileSnapshot` | Small |
| P2 | Unify web + mobile serialization into a single `serializeSnapshot()` function | Large |
| P3 | Document selector format conventions for LLM consumption | Small |
| P3 | Add `checked`/`selected`/`expanded` state rendering to mobile snapshot (parity with web) | Small |

## Verified capabilities

- [x] Web: viewport-only snapshot with semantic roles and unique CSS selectors
- [x] Web: `∈` disambiguation for duplicate selectors (6 "Add to Wishlist" buttons → each with book title context)
- [x] Web: `statictext` role capturing visible text (book titles, promo copy, cookie text)
- [x] Web: deduplication of echoed text (child text already in parent name → skipped)
- [x] Mobile: semantic role mapping (TextView→statictext, ImageView→img, Button→button, etc.)
- [x] Mobile: full-pipeline selectors via `getSuggestedLocators()` wired into snapshot
- [x] Mobile: `~` prefix for accessibility-id, `id:` for resource-id, `android=new UiSelector()...` for compound
- [x] Mobile: `.instance(N)` indexing for duplicate selectors
- [x] Mobile: explicit tap-target promotion (clickable parent carries `→`, label children provide `∈` context)
- [x] Mobile: layout noise collapse for anonymous containers
- [x] Mobile: `∈` context from actual parent, not previous list-item sibling
- [x] Unified `getElements()` API returning `{ elements, tree }` for both platforms
- [x] `inViewportOnly` default `true` across all entry points with per-function toggles
