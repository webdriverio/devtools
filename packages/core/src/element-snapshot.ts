/**
 * AI-readable snapshot serializers
 *
 * Converts accessibility trees and mobile element trees into depth-indented
 * text files that LLMs can consume without any parsing.
 */

import type {
  AccessibilityNode,
  SnapshotNode,
  SnapshotElement,
  SnapshotResult
} from './element-types.js'
import type { JSONElement } from './locators/types.js'
import { parseAndroidBounds, parseIOSBounds } from './locators/xml-parsing.js'
import {
  ANDROID_INTERACTABLE_TAGS,
  IOS_INTERACTABLE_TAGS
} from './locators/constants.js'
import { getSuggestedLocators } from './locators/locator-generation.js'

/**
 * Roles that can be interacted with — rendered with `→ selector`.
 * Structural roles (heading, img, form, nav, …) are intentionally excluded.
 */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'slider',
  'searchbox',
  'spinbutton',
  'switch',
  'tab',
  'menuitem',
  'option'
])

/**
 * Walk backwards from `index` to find the nearest ancestor or preceding
 * structural sibling with a non-empty name.  Same-depth nodes are only
 * used when they are structural (img, heading, statictext, …) — never
 * another interactive element.
 */
function inferPurpose(
  nodes: AccessibilityNode[],
  index: number
): string | undefined {
  const myDepth = nodes[index].depth
  for (let i = index - 1; i >= 0; i--) {
    if (nodes[i].depth <= myDepth && nodes[i].name) {
      // Same-depth sibling: only structural elements count
      if (nodes[i].depth === myDepth && INTERACTIVE_ROLES.has(nodes[i].role)) {
        continue
      }
      return nodes[i].name
    }
  }
  return undefined
}

export interface WebSnapshotOptions {
  /** Only include nodes whose bounding rect intersects the viewport (default true). */
  inViewportOnly?: boolean
}

/**
 * Serialize a web accessibility tree into a depth-indented text snapshot.
 *
 * @param nodes   Flat ordered node list from getBrowserAccessibilityTree()
 * @param context  Optional page context for the header line
 * @param options  {@link WebSnapshotOptions}
 */
export function serializeWebSnapshot(
  nodes: AccessibilityNode[],
  context?: { url?: string; title?: string },
  options: WebSnapshotOptions = {}
): string {
  const { inViewportOnly = true } = options

  let header = '[Page'
  if (context?.title) {
    header += `: ${context.title}`
  }
  if (context?.url) {
    header += ` — ${context.url}`
  }
  header += ']'

  const lines: string[] = [header]

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]

    // When viewport filtering is on, skip nodes that are known to be off-screen.
    // Nodes from a tree captured with inViewportOnly=false will have
    // isInViewport populated; nodes from a pre-filtered tree all have
    // isInViewport=true (or undefined for pre-existing data).
    if (inViewportOnly && node.isInViewport === false) {
      continue
    }

    const indent = '  '.repeat(node.depth + 1) // +1 indents everything under the header
    const isInteractive = INTERACTIVE_ROLES.has(node.role)

    if (isStatictextEchoedByParent(nodes, i)) {
      continue
    }

    // Heading gets level suffix: heading[2]
    const roleLabel =
      node.role === 'heading' && node.level
        ? `heading[${node.level}]`
        : node.role

    if (isInteractive) {
      // No selector → agent can't act on this node; skip entirely
      if (!node.selector) {
        continue
      }
      const purpose = inferPurpose(nodes, i)
      if (node.name) {
        // Show parent context when available — disambiguates
        // duplicate selectors like six "Add to Wishlist" buttons.
        lines.push(
          purpose
            ? `${indent}${roleLabel} "${node.name}" ∈ "${purpose}"  →  ${node.selector}`
            : `${indent}${roleLabel} "${node.name}"  →  ${node.selector}`
        )
      } else if (purpose) {
        lines.push(`${indent}${roleLabel} ∈ "${purpose}"  →  ${node.selector}`)
      } else {
        lines.push(`${indent}${roleLabel}  →  ${node.selector}`)
      }
    } else {
      // Container / structural: show role + name when present, no selector
      lines.push(
        node.name
          ? `${indent}${roleLabel} "${node.name}"`
          : `${indent}${roleLabel}`
      )
    }
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Mobile snapshot helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when `nodes[index]` is a statictext whose accessible name
 * is already echoed by its immediate interactive parent — such a node
 * adds no information and should be suppressed from the output.
 */
function isStatictextEchoedByParent(
  nodes: AccessibilityNode[],
  index: number
): boolean {
  const node = nodes[index]!
  if (node.role !== 'statictext' || !node.name) {
    return false
  }
  for (let j = index - 1; j >= 0; j--) {
    if (nodes[j]!.depth < node.depth) {
      const parent = nodes[j]!
      if (
        INTERACTIVE_ROLES.has(parent.role) &&
        parent.name &&
        parent.name.includes(node.name)
      ) {
        return true
      }
      break
    }
  }
  return false
}

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
    const indent = '  '.repeat(node.depth + 1)

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
            ? `${indent}${node.role} "${node.name}" ∈ "${purpose}"  →  ${selector}`
            : `${indent}${node.role} "${node.name}"  →  ${selector}`
        )
      } else if (purpose) {
        lines.push(`${indent}${node.role} ∈ "${purpose}"  →  ${selector}`)
      } else {
        lines.push(`${indent}${node.role}  →  ${selector}`)
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

  // Auto-detect source XML stashed by getMobileVisibleElementsWithTree
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

// ---------------------------------------------------------------------------
// Unified snapshot formatter — web + mobile share the same render pass.
// ---------------------------------------------------------------------------

/** Derive a tag name from a CSS selector prefix (e.g. "button*=Submit" → "button"). */
function extractTagFromSelector(selector: string, fallback: string): string {
  // Matches tag name followed by a CSS selector combinator or operator.
  // Supports hyphenated custom elements (my-component) and pseudo-classes (:nth-of-type).
  const match = selector.match(
    /^([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*)[*.#\[:=(^$~]/
  )
  if (match) {
    return match[1]
  }
  const spaceMatch = selector.match(/^([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*)\s/)
  if (spaceMatch) {
    return spaceMatch[1]
  }
  return fallback
}

/** Walk backwards to find the nearest structural container name for ∈ context. */
function findContextName(
  nodes: SnapshotNode[],
  index: number
): string | undefined {
  const myDepth = nodes[index].depth
  for (let i = index - 1; i >= 0; i--) {
    if (nodes[i].depth <= myDepth && nodes[i].name) {
      if (nodes[i].depth === myDepth && nodes[i].isInteractive) {
        continue
      }
      // Suppressed tag-interactive nodes (isInteractive=false but role is a
      // mobile-interactable label like 'statictext') shouldn't provide context
      // at same depth — their name is label text, not a container identity.
      // Mirrors mobileInferPurpose which skips same-depth nodes not in
      // MOBILE_STRUCTURAL_ROLES (which excludes 'statictext').
      if (nodes[i].depth === myDepth && nodes[i].role === 'statictext') {
        continue
      }
      return nodes[i].name
    }
  }
  return undefined
}

/**
 * Core formatter — converts a flat SnapshotNode[] into a text tree with
 * eN virtual IDs and an elements map for selector resolution.
 *
 * Platform-agnostic: both web and mobile pipelines feed into this function.
 */
export function buildSnapshot(
  header: string,
  nodes: SnapshotNode[]
): SnapshotResult {
  const selectorCounts = new Map<string, number>()
  for (const node of nodes) {
    if (node.isInteractive && node.selector) {
      selectorCounts.set(
        node.selector,
        (selectorCounts.get(node.selector) ?? 0) + 1
      )
    }
  }

  const lines: string[] = [header]
  const elements: Record<string, SnapshotElement> = {}
  const selectorIndex = new Map<string, number>()
  let counter = 1

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const indent = '  '.repeat(node.depth + 1)

    if (node.isInteractive && node.selector) {
      let selector = node.selector
      const total = selectorCounts.get(selector) ?? 1
      if (total > 1) {
        const idx = selectorIndex.get(selector) ?? 0
        selectorIndex.set(selector, idx + 1)
        selector = `${selector}.instance(${idx})`
      }

      const eId = `e${counter++}`

      const roleLabel =
        node.role === 'heading' && node.level
          ? `heading[${node.level}]`
          : node.role

      const context = findContextName(nodes, i)
      if (node.name && context) {
        lines.push(
          `${indent}${eId}  ${roleLabel} "${node.name}" ∈ "${context}"  →  ${selector}`
        )
      } else if (node.name) {
        lines.push(
          `${indent}${eId}  ${roleLabel} "${node.name}"  →  ${selector}`
        )
      } else if (context) {
        lines.push(
          `${indent}${eId}  ${roleLabel} ∈ "${context}"  →  ${selector}`
        )
      } else {
        lines.push(`${indent}${eId}  ${roleLabel}  →  ${selector}`)
      }

      elements[eId] = {
        selector: node.selector,
        ...(selector !== node.selector ? { qualifiedSelector: selector } : {}),
        tagName: node.tagName,
        role: node.role,
        text: node.name
      }
    } else {
      const roleLabel =
        node.role === 'heading' && node.level
          ? `heading[${node.level}]`
          : node.role
      lines.push(
        node.name
          ? `${indent}${roleLabel} "${node.name}"`
          : `${indent}${roleLabel}`
      )
    }
  }

  return { text: lines.join('\n'), elements }
}

// ---------------------------------------------------------------------------
// Web adapter — AccessibilityNode[] → SnapshotNode[]
// ---------------------------------------------------------------------------

export function accessibilityNodesToSnapshotNodes(
  nodes: AccessibilityNode[],
  options?: { inViewportOnly?: boolean }
): SnapshotNode[] {
  const { inViewportOnly = true } = options ?? {}

  const result: SnapshotNode[] = []

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]

    if (inViewportOnly && node.isInViewport === false) {
      continue
    }

    const isInteractive = INTERACTIVE_ROLES.has(node.role)

    if (isStatictextEchoedByParent(nodes, i)) {
      continue
    }

    // Interactive nodes without a selector can't be acted on — skip them
    // so they don't leak as non-actionable entries in the text tree.
    // Matches the guard in serializeWebSnapshot (line 141).
    if (isInteractive && !node.selector) {
      continue
    }

    const tagName =
      isInteractive && node.selector
        ? extractTagFromSelector(node.selector, node.role)
        : node.role

    result.push({
      role: node.role,
      name: node.name,
      selector: node.selector,
      depth: node.depth,
      isInteractive,
      tagName,
      level: node.level || undefined
    })
  }

  return result
}

// ---------------------------------------------------------------------------
// Mobile adapter — JSONElement tree → SnapshotNode[]
// ---------------------------------------------------------------------------

export function jsonElementToSnapshotNodes(
  root: JSONElement,
  platform: 'android' | 'ios',
  options?: {
    inViewportOnly?: boolean
    viewport?: { width: number; height: number }
    sourceXML?: string
  }
): SnapshotNode[] {
  const { inViewportOnly = true } = options ?? {}
  const effectiveViewport = options?.viewport ?? { width: 9999, height: 9999 }
  const automationName = platform === 'android' ? 'uiautomator2' : 'xcuitest'
  const effectiveXML = options?.sourceXML || root.attributes._sourceXML

  const mobileNodes: MobileFlatNode[] = []
  collectMobileNodes(root, platform, 0, mobileNodes, {
    inViewportOnly,
    viewport: effectiveViewport,
    sourceXML: effectiveXML,
    automationName: effectiveXML ? automationName : undefined
  })

  suppressTagOnlyChildren(mobileNodes)

  return mobileNodes.map((m) => ({
    role: m.role,
    name: m.name,
    selector: m.selector,
    depth: m.depth,
    isInteractive: m.isInteractive,
    tagName: m.tagName,
    level: undefined
  }))
}
