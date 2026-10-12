# @wdio/elements

Element detection and locator generation for WebdriverIO — browser DOM querying, mobile page-source parsing, accessibility tree extraction, and AI-readable snapshots.

## Install

```bash
npm install @wdio/elements
```

Requires `webdriverio` as a peer dependency (^10.0.0).

## Usage

### Unified entry point (auto-detects browser vs mobile)

```ts
import { getElements } from '@wdio/elements'

const result = await getElements(browser, { limit: 50, inViewportOnly: true })
// { total, showing, hasMore, elements, tree? }
```

### Accessibility snapshot (`getSnapshot`)

A single call for web and native sessions that returns the same text as the WebdriverIO CLI's `wdio session snapshot --selectors` (add `--viewport` for `{ viewport: true }`). It is built on `@wdio/snapshot`: each actionable element gets an `eN` ref, and its line ends in `→ <selector>`. The default walks the whole document, so on long pages `{ viewport: true }` is much smaller and faster.

```ts
import { getSnapshot } from '@wdio/elements'

const { text, refs } = await getSnapshot(browser) // full page
const visible = await getSnapshot(browser, { viewport: true })
// text: '- button "start" [ref=e1]  → ~start' (one line per node)
// refs: SnapshotRef[] — { id, candidates, … } for every ref in the text
```

Web sessions walk the DOM in the page; Android and iOS sessions parse the page source. Errors (`SnapshotError`) propagate instead of returning a placeholder.

Differences from the CLI, which keeps session state this function does not have:

- No wait for a freshly loaded page to settle before collecting.
- Iframes are not inlined over BiDi. A cut or cross-origin frame renders as the frame-hint note (`wdio session frame <ref>`).
- Refs are numbered from `e1` on every call.

`@wdio/devtools-service`'s `browser.getSnapshot()` does not call this function: the service is on `webdriverio` 9 and pins `@wdio/elements` 1.x, so it still returns the 1.x `{ text, elements }` shape.

### Browser

```ts
import { getInteractableBrowserElements } from '@wdio/elements'

const elements = await getInteractableBrowserElements(browser, {
  includeBounds: true,
  inViewportOnly: true
})
```

```ts
import { getBrowserAccessibilityTree } from '@wdio/elements'

const nodes = await getBrowserAccessibilityTree(browser, { inViewportOnly: true })
```

### Mobile

```ts
import { getMobileVisibleElements } from '@wdio/elements'

const elements = await getMobileVisibleElements(browser, 'ios', {
  includeBounds: true,
  includeContainers: false
})
```

### Locator generation

```ts
import { generateAllElementLocators, xmlToJSON } from '@wdio/elements/locators'

const locators = generateAllElementLocators(pageSource, {
  platform: 'android',
  viewportSize: { width: 1080, height: 2340 }
})
```

## API

### `getElements(browser, params)`

Auto-detects platform and returns a unified result.

| Param | Type | Default | Description |
|---|---|---|---|
| `inViewportOnly` | `boolean` | `true` | Skip off-screen elements |
| `includeContainers` | `boolean` | `false` | Include layout containers (mobile only) |
| `includeBounds` | `boolean` | `false` | Include element bounding boxes |
| `limit` | `number` | `0` | Max elements (0 = no limit) |
| `offset` | `number` | `0` | Pagination offset |

### `getSnapshot(browser, options)`

Returns `GetSnapshotResult` — `{ text, refs }` — where `text` is the rendered tree with `eN` refs and selectors, and `refs` is the `SnapshotRef[]` behind them.

| Param | Type | Default | Description |
|---|---|---|---|
| `viewport` | `boolean` | `false` | Only include what intersects the viewport; `false` snapshots the full page |

### `getInteractableBrowserElements(browser, options)`

Single `querySelectorAll` walk — returns flat list of interactable elements.

### `getBrowserAccessibilityTree(browser, options)`

Single DOM walk returning the accessibility tree as a flat `AccessibilityNode[]`.

### `getMobileVisibleElements(browser, platform, options)`

Parses page source XML (2 HTTP calls total) and returns elements with generated locators.

### `@wdio/elements/locators`

Re-exports the full locator generation pipeline from `@wdio/devtools-core`:

- `xmlToJSON`, `xmlToDOM`, `evaluateXPath`, `checkXPathUniqueness`
- `findDOMNodeByPath`, `parseAndroidBounds`, `parseIOSBounds`
- `flattenElementTree`, `countAttributeOccurrences`, `isAttributeUnique`
- `isInteractableElement`, `isLayoutContainer`, `hasMeaningfulContent`
- `shouldIncludeElement`, `getDefaultFilters`
- `getSuggestedLocators`, `getBestLocator`, `locatorsToObject`
- `generateAllElementLocators`

## Types

```ts
export type {
  BrowserElementInfo, GetBrowserElementsOptions,
  MobileElementInfo, GetMobileElementsOptions,
  AccessibilityNode,
  VisibleElementsResult,
  GetSnapshotOptions, GetSnapshotResult,
  CandidateKind, SnapshotCandidate, SnapshotNode, SnapshotRef
} from '@wdio/elements'

// From @wdio/elements/locators:
export type {
  ElementAttributes, JSONElement, Bounds,
  FilterOptions, UniquenessResult,
  LocatorStrategy, LocatorContext,
  ElementWithLocators, GenerateLocatorsOptions
} from '@wdio/elements/locators'
```
