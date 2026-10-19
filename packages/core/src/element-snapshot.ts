/**
 * AI-readable snapshot serializers
 *
 * Converts accessibility trees and mobile element trees into depth-indented
 * text files that LLMs can consume without any parsing.
 */

// The web serializer lives in `trace` because the backend builds the trace for
// an adapter that cannot, and §2.2 bars the backend from importing core.
export {
  serializeWebSnapshot,
  type WebSnapshotOptions
} from '@wdio/devtools-trace/a11y-snapshot'

import {
  SNAPSHOT_INDENT_UNIT,
  SNAPSHOT_LOCATOR_DELIM,
  SNAPSHOT_PURPOSE_TOKEN
} from '@wdio/devtools-shared'

import type { JSONElement } from './locators/types.js'
import { parseAndroidBounds, parseIOSBounds } from './locators/xml-parsing.js'
import {
  ANDROID_INTERACTABLE_TAGS,
  IOS_INTERACTABLE_TAGS
} from './locators/constants.js'
import { getSuggestedLocators } from './locators/locator-generation.js'

// ---------------------------------------------------------------------------
// Mobile snapshot helpers
// ---------------------------------------------------------------------------

/** Shorten fully-qualified Android/iOS class names to the last segment. */
function simplifyTag(tagName: string): string {
  const dot = tagName.lastIndexOf('.')
  if (dot !== -1) {
    return tagName.slice(dot + 1)
  }
  return tagName.replace(/^XCUIElementType/, '')
}

// ---------------------------------------------------------------------------
// Mobile role classification — maps raw Android/iOS class names to semantic
// roles so the snapshot reads like the web version (button, textbox, img, …).
// ---------------------------------------------------------------------------

const ANDROID_ROLE_MAP: Record<string, string> = {
  'android.widget.Button': 'button',
  'android.widget.ImageButton': 'button',
  'android.widget.ToggleButton': 'button',
  'android.widget.FloatingActionButton': 'button',
  'com.google.android.material.button.MaterialButton': 'button',
  'com.google.android.material.floatingactionbutton.FloatingActionButton':
    'button',
  'android.widget.EditText': 'textbox',
  'android.widget.AutoCompleteTextView': 'textbox',
  'android.widget.MultiAutoCompleteTextView': 'textbox',
  'android.widget.SearchView': 'searchbox',
  'android.widget.ImageView': 'img',
  'android.widget.QuickContactBadge': 'img',
  'android.widget.CheckBox': 'checkbox',
  'android.widget.RadioButton': 'radio',
  'android.widget.Switch': 'switch',
  'android.widget.Spinner': 'combobox',
  'android.widget.SeekBar': 'slider',
  'android.widget.RatingBar': 'slider',
  'android.widget.ProgressBar': 'progressbar',
  'android.widget.TextView': 'statictext',
  'android.widget.CheckedTextView': 'statictext',
  'android.widget.RecyclerView': 'list',
  'android.widget.ListView': 'list',
  'android.widget.GridView': 'list',
  'android.webkit.WebView': 'webview'
}

const IOS_ROLE_MAP: Record<string, string> = {
  XCUIElementTypeButton: 'button',
  XCUIElementTypeLink: 'link',
  XCUIElementTypeTextField: 'textbox',
  XCUIElementTypeSecureTextField: 'textbox',
  XCUIElementTypeTextView: 'textbox',
  XCUIElementTypeSearchField: 'searchbox',
  XCUIElementTypeImage: 'img',
  XCUIElementTypeIcon: 'img',
  XCUIElementTypeSwitch: 'switch',
  XCUIElementTypeSlider: 'slider',
  XCUIElementTypeStepper: 'slider',
  XCUIElementTypeCheckBox: 'checkbox',
  XCUIElementTypeRadioButton: 'radio',
  XCUIElementTypePicker: 'combobox',
  XCUIElementTypePickerWheel: 'combobox',
  XCUIElementTypeDatePicker: 'combobox',
  XCUIElementTypeSegmentedControl: 'combobox',
  XCUIElementTypeStaticText: 'statictext',
  XCUIElementTypeCell: 'listitem',
  XCUIElementTypeTable: 'list',
  XCUIElementTypeCollectionView: 'list'
}

function classifyMobileRole(
  tagName: string,
  platform: 'android' | 'ios'
): string {
  if (platform === 'android') {
    return ANDROID_ROLE_MAP[tagName] || simplifyTag(tagName)
  }
  return IOS_ROLE_MAP[tagName] || simplifyTag(tagName)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clickable container whose label lives on a child TextView. */
function getFirstChildText(element: JSONElement): string | undefined {
  // Breadth-first: direct children checked before grandchildren.
  // This prefers a direct sibling label over a deeply nested one.
  const queue: JSONElement[] = [...(element.children || [])]
  while (queue.length > 0) {
    const el = queue.shift()!
    const text = el.attributes?.text?.trim()
    if (text) {
      return text
    }
    if (el.children) {
      queue.push(...el.children)
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Locator generation
// ---------------------------------------------------------------------------

function getBestAndroidLocator(
  attrs: JSONElement['attributes']
): string | undefined {
  // Pre-computed by the full locator pipeline (generateAllElementLocators).
  // Takes priority over the simplified fallback logic below.
  if (attrs._selector) {
    return attrs._selector
  }
  // ~ prefix = accessibility-id shorthand in WebdriverIO ($('~foo'))
  if (attrs['content-desc']) {
    return `~${attrs['content-desc']}`
  }
  if (attrs['resource-id']) {
    return `id:${attrs['resource-id']}`
  }
  if (attrs.text) {
    return `~${attrs.text}`
  }
  // Fallback: class-based locator (only useful with :nth-of-type or index)
  if (attrs.class) {
    return `class:${simplifyTag(attrs.class)}`
  }
  return undefined
}

function getBestIOSLocator(
  attrs: JSONElement['attributes']
): string | undefined {
  // Pre-computed by the full locator pipeline.
  if (attrs._selector) {
    return attrs._selector
  }
  // ~ prefix = accessibility-id shorthand (maps to `name` on iOS)
  if (attrs.name) {
    return `~${attrs.name}`
  }
  if (attrs.label) {
    return `~${attrs.label}`
  }
  if (attrs.value) {
    return `~${attrs.value}`
  }
  // Fallback: class-based locator
  if (attrs.type) {
    return `class:${simplifyTag(attrs.type)}`
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

function getMobileNodeIdentity(
  attrs: JSONElement['attributes'],
  platform: 'android' | 'ios'
): string {
  if (platform === 'android') {
    const contentDesc = attrs['content-desc']
    if (contentDesc) {
      return contentDesc
    }
    if (attrs.text) {
      return attrs.text
    }
    // Fall back to the last segment of the resource-id (e.g. "search_action_bar")
    const rid = attrs['resource-id']
    if (rid) {
      const slash = rid.lastIndexOf('/')
      return slash !== -1 ? rid.slice(slash + 1) : rid
    }
    return ''
  }
  return attrs.name || attrs.label || attrs.value || attrs.text || ''
}

// ---------------------------------------------------------------------------
// Interactivity
// ---------------------------------------------------------------------------

const ANDROID_INTERACTABLE_SET = new Set(ANDROID_INTERACTABLE_TAGS)
const IOS_INTERACTABLE_SET = new Set(IOS_INTERACTABLE_TAGS)

/** An element is *explicitly* interactive when it carries a click/focus/check
 *  attribute — as opposed to being interactive only because its tag is in the
 *  interactable-tag list.  Explicit parents should carry the → selector, not
 *  their tag-interactive children. */
function isExplicitlyInteractive(
  attrs: JSONElement['attributes'],
  platform: 'android' | 'ios'
): boolean {
  if (platform === 'android') {
    return (
      attrs.clickable === 'true' ||
      attrs.focusable === 'true' ||
      attrs.checkable === 'true' ||
      attrs['long-clickable'] === 'true'
    )
  }
  return attrs.accessible === 'true'
}

function isMobileInteractive(
  element: JSONElement,
  platform: 'android' | 'ios'
): boolean {
  const attrs = element.attributes
  if (platform === 'android') {
    if (ANDROID_INTERACTABLE_SET.has(element.tagName)) {
      return true
    }
    return (
      attrs.clickable === 'true' ||
      attrs['long-clickable'] === 'true' ||
      attrs.focusable === 'true' ||
      attrs.checkable === 'true'
    )
  }
  if (IOS_INTERACTABLE_SET.has(element.tagName)) {
    return true
  }
  return attrs.accessible === 'true'
}

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

interface WalkMobileOptions {
  inViewportOnly: boolean
  viewport: { width: number; height: number }
  /** Raw page-source XML. When provided, the full locator pipeline is used. */
  sourceXML?: string
  /** 'uiautomator2' or 'xcuitest'. Required when sourceXML is set. */
  automationName?: string
}

function isMobileInViewport(
  element: JSONElement,
  platform: 'android' | 'ios',
  viewport: { width: number; height: number }
): boolean {
  const bounds =
    platform === 'android'
      ? parseAndroidBounds(element.attributes.bounds || '')
      : parseIOSBounds(element.attributes)

  if (bounds.width === 0 && bounds.height === 0) {
    return true
  }

  return (
    bounds.x >= 0 &&
    bounds.y >= 0 &&
    bounds.width > 0 &&
    bounds.height > 0 &&
    bounds.x + bounds.width <= viewport.width &&
    bounds.y + bounds.height <= viewport.height
  )
}

// ---------------------------------------------------------------------------
// Flat-node representation (mirrors AccessibilityNode so both pipelines share
// inferPurpose, dedup, and rendering logic).
// ---------------------------------------------------------------------------

interface MobileFlatNode {
  role: string
  name: string
  selector: string
  depth: number
  isInteractive: boolean
  /** True when the element has clickable/focusable/checkable — the intended tap target. */
  isExplicitInteractive: boolean
  isInViewport: boolean
  tagName: string
}

/**
 * First pass: walk the JSONElement tree, apply viewport filtering and
 * collect every node into a flat array with semantic roles and selectors.
 */
function collectMobileNodes(
  element: JSONElement,
  platform: 'android' | 'ios',
  depth: number,
  nodes: MobileFlatNode[],
  walkOpts: WalkMobileOptions
): void {
  const attrs = element.attributes
  const role = classifyMobileRole(element.tagName, platform)
  let name = getMobileNodeIdentity(attrs, platform)
  const explicit = isExplicitlyInteractive(attrs, platform)
  const interactive = isMobileInteractive(element, platform)
  const inViewport = isMobileInViewport(element, platform, walkOpts.viewport)

  // Viewport filtering
  if (walkOpts.inViewportOnly) {
    if (interactive && !inViewport) {
      // Skip this node but still recurse (scroll children may be in view).
      for (const child of element.children || []) {
        collectMobileNodes(child, platform, depth + 1, nodes, walkOpts)
      }
      return
    }
    if (!interactive && !inViewport) {
      // Collapse off-screen container to a placeholder.
      nodes.push({
        role: 'generic',
        name: name ? `${role} "${name}"` : role,
        selector: '',
        depth,
        isInteractive: false,
        isExplicitInteractive: false,
        isInViewport: false,
        tagName: element.tagName
      })
      return
    }
  }

  // Generate a selector for every interactive element.
  // Use the full locator pipeline when source XML is available;
  // otherwise fall back to the simplified attribute-based heuristics.
  let locator = ''
  if (interactive) {
    if (walkOpts.sourceXML && walkOpts.automationName) {
      // Full pipeline: accessible-id, id, text, uiautomator, xpath, class-name
      const suggested = getSuggestedLocators(
        element,
        walkOpts.sourceXML,
        walkOpts.automationName,
        {
          sourceXML: walkOpts.sourceXML,
          parsedDOM: null,
          isAndroid: platform === 'android'
        }
      )
      if (suggested.length > 0) {
        locator = suggested[0][1] // first = best priority
      }
    }
    if (!locator) {
      // Simplified fallback
      locator =
        (platform === 'android'
          ? getBestAndroidLocator(attrs)
          : getBestIOSLocator(attrs)) ?? ''
    }

    // When the only locator is class-based and the element has no name,
    // pull a label from a child — common in Android native apps where a
    // clickable container row's label lives on a child TextView.  We
    // enrich the name rather than replacing the selector so the locator
    // still targets the correct (parent) element.
    if (
      !name &&
      platform === 'android' &&
      (locator.startsWith('class:') ||
        locator.startsWith('android=new UiSelector().className("'))
    ) {
      const childText = getFirstChildText(element)
      if (childText && childText.length < 100) {
        name = childText
      }
    }
  }

  nodes.push({
    role,
    name,
    selector: locator,
    depth,
    isInteractive: interactive,
    isExplicitInteractive: explicit,
    isInViewport: inViewport,
    tagName: element.tagName
  })

  for (const child of element.children || []) {
    collectMobileNodes(child, platform, depth + 1, nodes, walkOpts)
  }
}

// ---------------------------------------------------------------------------
// Context inference — shared with the web pipeline.
// Same-depth structural siblings (img, statictext, heading, …) provide
// context for following interactive nodes.
// ---------------------------------------------------------------------------

const MOBILE_STRUCTURAL_ROLES = new Set([
  'img',
  'heading',
  'list',
  'listitem',
  'webview',
  'progressbar',
  'slider',
  'switch',
  'generic'
])

function mobileInferPurpose(
  nodes: MobileFlatNode[],
  index: number
): string | undefined {
  const myDepth = nodes[index].depth
  for (let i = index - 1; i >= 0; i--) {
    if (nodes[i].depth <= myDepth && nodes[i].name) {
      if (
        nodes[i].depth === myDepth &&
        !MOBILE_STRUCTURAL_ROLES.has(nodes[i].role)
      ) {
        continue
      }
      return nodes[i].name
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// When a tag-only-interactive child (e.g. a statictext TextView) sits
// directly under an explicitly-interactive parent (e.g. a clickable
// LinearLayout row), the *parent* should carry the → selector — the
// child is just a label.  Suppress the child's interactivity so the
// parent renders as the actionable element.
// ---------------------------------------------------------------------------

function suppressTagOnlyChildren(nodes: MobileFlatNode[]): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (!node.isInteractive || node.isExplicitInteractive) {
      continue
    }
    // Walk up through ALL ancestors looking for an explicitly-interactive
    // parent.  The immediate depth-1 parent may just be a layout wrapper;
    // the real clickable row could be 2-3 levels up.
    for (let j = i - 1; j >= 0; j--) {
      if (nodes[j].depth < node.depth) {
        if (nodes[j].isExplicitInteractive) {
          node.isInteractive = false
          break // found — suppress and stop
        }
        // keep looking upward through the ancestor chain
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Render pass: flat nodes into lines with ∈ context, dedup, noise filter,
// and class-instance indexing.
// ---------------------------------------------------------------------------

/** Layout roles that carry no semantic meaning by themselves. */
const NOISY_ROLES = new Set([
  'FrameLayout',
  'LinearLayout',
  'ViewGroup',
  'RelativeLayout',
  'View',
  'CardView',
  'ConstraintLayout',
  'ScrollView'
])

/**
 * Pre-count selector occurrences so we can attach .instance(N) suffixes
 * to duplicate selectors.
 */
function countSelectors(nodes: MobileFlatNode[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const node of nodes) {
    if (node.selector) {
      counts.set(node.selector, (counts.get(node.selector) ?? 0) + 1)
    }
  }
  return counts
}

function renderMobileNodes(nodes: MobileFlatNode[]): string[] {
  const lines: string[] = []
  const selectorCounts = countSelectors(nodes)
  const selectorIndex = new Map<string, number>()

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const indent = SNAPSHOT_INDENT_UNIT.repeat(node.depth + 1)

    // Collapse anonymous layout containers at depth ≥ 2.
    // Keep depth 0-1 structural chrome and any named container.
    if (
      NOISY_ROLES.has(node.role) &&
      !node.name &&
      node.depth > 1 &&
      !node.isInteractive
    ) {
      continue
    }

    // Off-screen containers rendered as collapsed placeholders
    if (node.isInViewport === false && !node.isInteractive) {
      lines.push(`${indent}⋯ ${node.name} (off-screen)`)
      continue
    }

    // Dedup: skip statictext whose text is echoed by the parent interactive element
    if (node.role === 'statictext' && node.name) {
      let echoedByParent = false
      for (let j = i - 1; j >= 0; j--) {
        if (nodes[j].depth < node.depth) {
          if (
            nodes[j].isInteractive &&
            nodes[j].name &&
            nodes[j].name.includes(node.name)
          ) {
            echoedByParent = true
          }
          break
        }
      }
      if (echoedByParent) {
        continue
      }
    }

    if (node.isInteractive && node.selector) {
      // Append .instance(N) when the same selector repeats
      let selector = node.selector
      const total = selectorCounts.get(selector) ?? 1
      if (total > 1) {
        const idx = selectorIndex.get(selector) ?? 0
        selectorIndex.set(selector, idx + 1)
        selector = `${selector}.instance(${idx})`
      }

      const purpose = mobileInferPurpose(nodes, i)
      if (node.name) {
        lines.push(
          purpose
            ? `${indent}${node.role} "${node.name}" ${SNAPSHOT_PURPOSE_TOKEN} "${purpose}"  ${SNAPSHOT_LOCATOR_DELIM}  ${selector}`
            : `${indent}${node.role} "${node.name}"  ${SNAPSHOT_LOCATOR_DELIM}  ${selector}`
        )
      } else if (purpose) {
        lines.push(
          `${indent}${node.role} ${SNAPSHOT_PURPOSE_TOKEN} "${purpose}"  ${SNAPSHOT_LOCATOR_DELIM}  ${selector}`
        )
      } else {
        lines.push(
          `${indent}${node.role}  ${SNAPSHOT_LOCATOR_DELIM}  ${selector}`
        )
      }
    } else {
      // Container / structural / non-locatable
      lines.push(
        node.name
          ? `${indent}${node.role} "${node.name}"`
          : `${indent}${node.role}`
      )
    }
  }

  return lines
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MobileSnapshotOptions {
  /** Only include elements whose bounds intersect the viewport (default true). */
  inViewportOnly?: boolean
  /**
   * Raw XML page source string.  When provided the full locator pipeline
   * (getSuggestedLocators) runs on every interactive node, producing the same
   * selectors that getElements() returns.  Omit to use simplified heuristics.
   */
  sourceXML?: string
}

/**
 * Serialize a mobile element tree into a depth-indented text snapshot.
 *
 * @param root     Root JSONElement from the page source XML parse
 * @param context  Platform, optional device name, viewport, and source XML.
 *                 Include `sourceXML` to use the full locator pipeline.
 * @param options  {@link MobileSnapshotOptions}
 */
export function serializeMobileSnapshot(
  root: JSONElement,
  context: {
    platform: 'android' | 'ios'
    deviceName?: string
    viewport?: { width: number; height: number }
    /** Raw page-source XML. When set, selectors match getElements() output. */
    sourceXML?: string
  },
  options: MobileSnapshotOptions = {}
): string {
  const { platform, deviceName, viewport, sourceXML } = context
  const { inViewportOnly = true } = options

  // Falls back to the page source action-snapshot.ts stamps on the root
  const effectiveXML = sourceXML || root.attributes._sourceXML

  const effectiveViewport = viewport ?? { width: 9999, height: 9999 }
  const automationName = platform === 'android' ? 'uiautomator2' : 'xcuitest'

  let header = `[${platform}`
  if (deviceName) {
    header += ` — ${deviceName}`
  }
  if (viewport) {
    header += ` (${viewport.width}×${viewport.height})`
  }
  header += ']'

  const nodes: MobileFlatNode[] = []
  collectMobileNodes(root, platform, 0, nodes, {
    inViewportOnly,
    viewport: effectiveViewport,
    sourceXML: effectiveXML,
    automationName: effectiveXML ? automationName : undefined
  })

  // Let explicitly-interactive parents carry the → selector
  suppressTagOnlyChildren(nodes)

  const lines = renderMobileNodes(nodes)
  return [header, ...lines].join('\n')
}
