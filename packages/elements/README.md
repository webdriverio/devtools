# @wdio/elements

Element detection and locator generation for WebdriverIO — browser DOM querying, mobile page-source parsing, accessibility tree extraction, and AI-readable snapshots.

## Install

```bash
npm install @wdio/elements
```

Requires `webdriverio` as a peer dependency (^9.0.0).

## Usage

### Unified entry point (auto-detects browser vs mobile)

```ts
import { getElements } from '@wdio/elements'

const result = await getElements(browser, { limit: 50, inViewportOnly: true })
// { total, showing, hasMore, elements, tree? }
```

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

For the raw JSON element tree alongside the flat list:

```ts
import { getMobileVisibleElementsWithTree } from '@wdio/elements'

const { elements, tree } = await getMobileVisibleElementsWithTree(browser, 'android')
```

### AI-readable snapshots

```ts
import { serializeWebSnapshot, serializeMobileSnapshot } from '@wdio/elements'

const snapshot = await serializeWebSnapshot(browser, { includeBounds: true })
// or
const snapshot = await serializeMobileSnapshot(browser, 'android', { includeLocators: true })
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

### `getInteractableBrowserElements(browser, options)`

Single `querySelectorAll` walk — returns flat list of interactable elements.

### `getBrowserAccessibilityTree(browser, options)`

Single DOM walk returning the accessibility tree as a flat `AccessibilityNode[]`.

### `getMobileVisibleElements(browser, platform, options)`

Parses page source XML (2 HTTP calls total) and returns elements with generated locators.

### `getMobileVisibleElementsWithTree(browser, platform, options)`

Same as above but also returns the raw `JSONElement` tree.

### `serializeWebSnapshot(browser, options)` / `serializeMobileSnapshot(browser, platform, options)`

Generate AI-readable (TOON-format) snapshots for LLM consumption.

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
  WebSnapshotOptions, MobileSnapshotOptions
} from '@wdio/elements'

// From @wdio/elements/locators:
export type {
  ElementAttributes, JSONElement, Bounds,
  FilterOptions, UniquenessResult,
  LocatorStrategy, LocatorContext,
  ElementWithLocators, GenerateLocatorsOptions
} from '@wdio/elements/locators'
```
