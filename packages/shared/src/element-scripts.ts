/**
 * Browser-injectable script strings for element extraction.
 *
 * Each function returns a self-contained JavaScript string designed to run
 * inside a browser page via `browser.execute(script)`. The scripts have no
 * external dependencies and must be ES5-compatible.
 *
 * WDIO-dependent wrappers that call `browser.execute(script)` live in
 * `@wdio/elements` — these are just the script bodies.
 */

import { locatorDialect } from './locator-dialect.js'
import type { LocatorDialect, TextLocatorDialect } from './locator-dialect.js'
import type { TestRunnerId } from './types.js'

/**
 * HTTP contract for the page-side element scripts.
 *
 * Same reasoning as `COLLECTOR_API`: these are browser-injectable source
 * strings, and an adapter that cannot import this package — the Python one —
 * has no other way to reach them. Serving them keeps the version matched by
 * construction instead of ported per language, which is what left a Python
 * trace with no A11y tree at all.
 *
 * Generated rather than static, because the scripts bake in the runner's
 * locator dialect: a WDIO run wants `a*=Logout`, a protocol-level one wants
 * XPath, and the caller cannot patch that into a served string afterwards.
 */
export const ELEMENT_SCRIPTS_API = {
  get: '/api/element-scripts'
} as const

/** `Content-Type` for {@link ELEMENT_SCRIPTS_API}. A JSON envelope rather than
 *  raw source, because there are two scripts and a caller needs both. */
export const ELEMENT_SCRIPTS_CONTENT_TYPE = 'application/json; charset=utf-8'

/** Body of {@link ELEMENT_SCRIPTS_API} — one self-contained expression per
 *  script, both built by {@link buildElementScripts}. */
export interface ElementScriptsResponse {
  accessibilityTree: string
  elements: string
}

/** The pair every caller wants: both scripts in the form an action snapshot
 *  reads them, so the route and the in-process adapters cannot drift apart on
 *  which arguments that is. */
export function buildElementScripts(
  runner?: TestRunnerId
): ElementScriptsResponse {
  return {
    accessibilityTree: accessibilityTreeScript(true, runner),
    elements: elementsScript(true, true, runner)
  }
}

/** Shared by both injected scripts below — the same visibility gate decides
 *  which elements each one reports. */
const IS_VISIBLE_SCRIPT = `
    function isVisible(el) {
      if (typeof el.checkVisibility === 'function') {
        return el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
      }
      var style = window.getComputedStyle(el)
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetWidth > 0 && el.offsetHeight > 0
    }
`

/** XPath 1.0 has no string escape, so a value carrying both quote kinds is
 *  stitched from single-kind literals; a literal double quote can only enter the
 *  expression as its own single-quoted token. */
const XPATH_TEXT_LITERAL_SCRIPT = `
    function xpathTextLiteral(value) {
      if (value.indexOf('"') === -1) { return '"' + value + '"' }
      if (value.indexOf("'") === -1) { return "'" + value + "'" }
      var quoteToken = "'" + '"' + "'"
      var parts = value.split('"')
      var pieces = []
      for (var p = 0; p < parts.length; p++) {
        if (parts[p]) { pieces.push('"' + parts[p] + '"') }
        if (p < parts.length - 1) { pieces.push(quoteToken) }
      }
      // concat() takes at least two arguments — a value that is nothing but
      // double quotes yields one piece and needs no concat.
      return pieces.length > 1 ? 'concat(' + pieces.join(', ') + ')' : pieces[0]
    }
`

/** The meaning-bearing CSS branches: portable across all runners, so they are
 *  dialect-independent. Null when none of them identifies the element uniquely,
 *  which is what lets a caller order them against the text branch. */
const SEMANTIC_CSS_SELECTOR_SCRIPT = `
    function semanticCssSelector(element, tag) {
      var ariaLabel = element.getAttribute('aria-label')
      if (ariaLabel && ariaLabel.length <= 200) {
        var sel = '[aria-label="' + CSS.escape(ariaLabel) + '"]'
        if (document.querySelectorAll(sel).length === 1) { return sel }
      }
      var testId = element.getAttribute('data-testid')
      if (testId) {
        var testSel = '[data-testid="' + CSS.escape(testId) + '"]'
        if (document.querySelectorAll(testSel).length === 1) { return testSel }
      }
      if (element.id) {
        var idSel = '#' + CSS.escape(element.id)
        if (document.querySelectorAll(idSel).length === 1) { return idSel }
      }
      var nameAttr = element.getAttribute('name')
      if (nameAttr) {
        var nameSel = tag + '[name="' + CSS.escape(nameAttr) + '"]'
        if (document.querySelectorAll(nameSel).length === 1) { return nameSel }
      }
      var typeAttr = element.getAttribute('type')
      if (typeAttr) {
        var typeSel = tag + '[type="' + CSS.escape(typeAttr) + '"]'
        if (document.querySelectorAll(typeSel).length === 1) { return typeSel }
      }
      if (element.className && typeof element.className === 'string') {
        var classes = element.className.trim().split(/\\s+/).filter(Boolean)
        for (var i = 0; i < classes.length; i++) {
          var clsSel = tag + '.' + CSS.escape(classes[i])
          if (document.querySelectorAll(clsSel).length === 1) { return clsSel }
        }
        if (classes.length >= 2) {
          var twoClsSel = tag + classes.slice(0, 2).map(function(c) { return '.' + CSS.escape(c) }).join('')
          if (document.querySelectorAll(twoClsSel).length === 1) { return twoClsSel }
        }
      }
      return null
    }
`

/** Last resort: a positional `:nth-of-type` path, which always resolves but
 *  carries no meaning — hence every other branch getting first refusal. */
const POSITIONAL_SELECTOR_SCRIPT = `
    function positionalSelector(element) {
      var current = element
      var path = []
      while (current && current !== document.documentElement) {
        var seg = current.tagName.toLowerCase()
        if (current.id) { path.unshift('#' + CSS.escape(current.id)); break }
        var parent = current.parentElement
        if (parent) {
          var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === current.tagName })
          if (siblings.length > 1) { seg += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')' }
        }
        path.unshift(seg)
        current = current.parentElement
        if (path.length >= 4) { break }
      }
      return path.join(' > ')
    }
`

/** The text branch's return expression. WebdriverIO's `tag*=text` compiles
 *  internally to XPath with `"` quoting, so a text carrying a double quote would
 *  yield a broken expression — those keep the XPath form, which it also resolves. */
function textLocatorExpression(dialect: TextLocatorDialect): string {
  const xpath = "'//' + tag + '[contains(., ' + xpathTextLiteral(text) + ')]'"
  return dialect === 'webdriverio'
    ? `text.indexOf('"') === -1 ? tag + '*=' + text : ${xpath}`
    : xpath
}

/** Identify the element by its own text, in `dialect`'s grammar. Null when the
 *  text neither exists nor singles it out, so it composes with the CSS branches
 *  in either order. */
function textSelectorScript(dialect: TextLocatorDialect): string {
  return `
    function textSelector(element, tag) {
      var text = (element.textContent || '').trim().replace(/\\s+/g, ' ')
      if (!text || text.length > 120) { return null }
      var sameTagElements = document.querySelectorAll(tag)
      var matchCount = 0
      sameTagElements.forEach(function(el) { if (el.textContent.includes(text)) { matchCount++ } })
      // The DOM predicate this counts is exactly XPath's
      // \`//tag[contains(., text)]\`, so a single match here is a unique match
      // there — the emitted expression carries the uniqueness just checked.
      if (matchCount !== 1) { return null }
      return ${textLocatorExpression(dialect)}
    }
`
}

/** Shared by both injected scripts below, so one grammar produces the locator in
 *  `-snapshot.txt` and `-elements.json`. The dialect decides both what the text
 *  branch emits and where it sits; the positional path stays last either way. */
function getSelectorScript(dialect: LocatorDialect): string {
  const preferred =
    dialect.textBranch === 'first'
      ? ['textSelector(element, tag)', 'semanticCssSelector(element, tag)']
      : ['semanticCssSelector(element, tag)', 'textSelector(element, tag)']
  return `
    ${XPATH_TEXT_LITERAL_SCRIPT}
    ${SEMANTIC_CSS_SELECTOR_SCRIPT}
    ${POSITIONAL_SELECTOR_SCRIPT}
    ${textSelectorScript(dialect.text)}

    function getSelector(element) {
      var tag = element.tagName.toLowerCase()
      return ${preferred[0]} || ${preferred[1]} || positionalSelector(element)
    }
`
}

/**
 * Accessibility tree walk — returns a flat array of AccessibilityNode.
 *
 * Walks the DOM from `document.body`, assigning semantic roles (button, link,
 * textbox, heading, img, statictext, …) based on tag name, ARIA attributes,
 * and visibility. Each node carries a unique locator, in `runner`'s own text
 * dialect — omit it for the portable XPath form every runner resolves.
 */
export function accessibilityTreeScript(
  inViewportOnly: boolean,
  runner?: TestRunnerId
): string {
  return `(function () {
    var INPUT_TYPE_ROLES = {
      text: 'textbox', search: 'searchbox', email: 'textbox', url: 'textbox',
      tel: 'textbox', password: 'textbox', number: 'spinbutton',
      checkbox: 'checkbox', radio: 'radio', range: 'slider',
      submit: 'button', reset: 'button', image: 'button', file: 'button', color: 'button'
    }

    var CONTAINER_ROLES = new Set([
      'navigation', 'banner', 'contentinfo', 'complementary', 'main',
      'form', 'region', 'group', 'list', 'listitem', 'table', 'row', 'rowgroup', 'generic'
    ])

    function getRole(el) {
      var explicit = el.getAttribute('role')
      if (explicit) { return explicit.split(' ')[0] }
      var tag = el.tagName.toLowerCase()
      switch (tag) {
        case 'button': return 'button'
        case 'a': return el.hasAttribute('href') ? 'link' : null
        case 'input': {
          var type = (el.getAttribute('type') || 'text').toLowerCase()
          if (type === 'hidden') { return null }
          return INPUT_TYPE_ROLES[type] || 'textbox'
        }
        case 'select': return 'combobox'
        case 'textarea': return 'textbox'
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading'
        case 'img': return 'img'
        case 'nav': return 'navigation'
        case 'main': return 'main'
        case 'header': return !el.closest('article,aside,main,nav,section') ? 'banner' : null
        case 'footer': return !el.closest('article,aside,main,nav,section') ? 'contentinfo' : null
        case 'aside': return 'complementary'
        case 'dialog': return 'dialog'
        case 'form': return 'form'
        case 'section': return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? 'region' : null
        case 'summary': return 'button'
        case 'details': return 'group'
        case 'progress': return 'progressbar'
        case 'meter': return 'meter'
        case 'ul': case 'ol': return 'list'
        case 'li': return 'listitem'
        case 'table': return 'table'
      }
      if (el.contentEditable === 'true') { return 'textbox' }
      if (el.hasAttribute('tabindex') && parseInt(el.getAttribute('tabindex') || '-1', 10) >= 0) { return 'generic' }
      if (getDirectText(el)) { return 'statictext' }
      return null
    }

    function getAccessibleName(el, role) {
      var ariaLabel = el.getAttribute('aria-label')
      if (ariaLabel) { return ariaLabel.trim() }
      var labelledBy = el.getAttribute('aria-labelledby')
      if (labelledBy) {
        var texts = labelledBy.split(/\\s+/).map(function(id) { return (document.getElementById(id)?.textContent || '').trim() }).filter(Boolean)
        if (texts.length > 0) { return texts.join(' ').slice(0, 200) }
      }
      var tag = el.tagName.toLowerCase()
      if (tag === 'img' || (tag === 'input' && el.getAttribute('type') === 'image')) {
        var alt = el.getAttribute('alt')
        if (alt !== null) { return alt.trim() }
      }
      if (['input', 'select', 'textarea'].indexOf(tag) !== -1) {
        var id = el.getAttribute('id')
        if (id) {
          var label = document.querySelector('label[for="' + CSS.escape(id) + '"]')
          if (label) { return (label.textContent || '').trim() }
        }
        var parentLabel = el.closest('label')
        if (parentLabel) {
          var clone = parentLabel.cloneNode(true)
          clone.querySelectorAll('input,select,textarea').forEach(function(n) { n.remove() })
          var lt = (clone.textContent || '').trim()
          if (lt) { return lt }
        }
      }
      var ph = el.getAttribute('placeholder')
      if (ph) { return ph.trim() }
      var title = el.getAttribute('title')
      if (title) { return title.trim() }
      var childImg = el.querySelector('img')
      if (childImg) {
        var imgAlt = childImg.getAttribute('alt')
        if (imgAlt) { return imgAlt.trim() }
      }
      if (role && CONTAINER_ROLES.has(role)) { return '' }
      return ((el.textContent || '').trim().replace(/\\s+/g, ' ') || '').slice(0, 200)
    }

    ${getSelectorScript(locatorDialect(runner))}

    function getDirectText(el) {
      var text = ''
      for (var i = 0; i < el.childNodes.length; i++) {
        if (el.childNodes[i].nodeType === 3) { text += el.childNodes[i].textContent }
      }
      return text.trim().replace(/\\s+/g, ' ')
    }

    ${IS_VISIBLE_SCRIPT}

    function isInViewport(el) {
      var rect = el.getBoundingClientRect()
      return rect.top >= 0 && rect.left >= 0 && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) && rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    }

    function getLevel(el) {
      var m = el.tagName.toLowerCase().match(/^h([1-6])$/)
      if (m) { return parseInt(m[1], 10) }
      var ariaLevel = el.getAttribute('aria-level')
      if (ariaLevel) { return parseInt(ariaLevel, 10) }
      return undefined
    }

    function getState(el) {
      var inputEl = el
      var isCheckable = ['input', 'menuitemcheckbox', 'menuitemradio'].indexOf(el.tagName.toLowerCase()) !== -1 || ['checkbox', 'radio', 'switch'].indexOf(el.getAttribute('role') || '') !== -1
      return {
        disabled: el.getAttribute('aria-disabled') === 'true' || inputEl.disabled ? 'true' : '',
        checked: isCheckable && inputEl.checked ? 'true' : el.getAttribute('aria-checked') || '',
        expanded: el.getAttribute('aria-expanded') || '',
        selected: el.getAttribute('aria-selected') || '',
        pressed: el.getAttribute('aria-pressed') || '',
        required: inputEl.required || el.getAttribute('aria-required') === 'true' ? 'true' : '',
        readonly: inputEl.readOnly || el.getAttribute('aria-readonly') === 'true' ? 'true' : ''
      }
    }

    var result = []

    function walk(el, depth) {
      if (depth > 200) { return }
      if (!isVisible(el)) { return }
      var role = getRole(el)
      var inViewport = isInViewport(el)
      if (!role) {
        for (var i = 0; i < el.children.length; i++) { walk(el.children[i], depth + 1) }
        return
      }
      if (${inViewportOnly} && !inViewport) {
        for (var i = 0; i < el.children.length; i++) { walk(el.children[i], depth + 1) }
        return
      }
      var name = getAccessibleName(el, role)
      var selector = getSelector(el)
      var node = { role: role, name: name, selector: selector, depth: depth, level: getLevel(el) ?? '', isInViewport: inViewport }
      var state = getState(el)
      for (var k in state) { node[k] = state[k] }
      result.push(node)
      for (var i = 0; i < el.children.length; i++) { walk(el.children[i], depth + 1) }
    }

    for (var i = 0; i < document.body.children.length; i++) { walk(document.body.children[i], 0) }
    return result
  })()`
}

/**
 * Interactable element query — returns a flat array of BrowserElementInfo.
 *
 * Uses `querySelectorAll` with a broad interactable-selector list, then
 * filters by visibility and (optionally) viewport containment. Each element
 * gets a computed accessible name and a unique locator, in `runner`'s own text
 * dialect — omit it for the portable XPath form every runner resolves.
 */
export function elementsScript(
  includeBounds: boolean,
  inViewportOnly: boolean,
  runner?: TestRunnerId
): string {
  return `(function () {
    var interactableSelectors = [
      'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
      '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
      '[role="tab"]', '[role="menuitem"]', '[role="combobox"]', '[role="option"]',
      '[role="switch"]', '[role="slider"]', '[role="textbox"]', '[role="searchbox"]',
      '[role="spinbutton"]', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])'
    ].join(',')

    ${IS_VISIBLE_SCRIPT}

    function getAccessibleName(el) {
      var ariaLabel = el.getAttribute('aria-label')
      if (ariaLabel) { return ariaLabel.trim() }
      var labelledBy = el.getAttribute('aria-labelledby')
      if (labelledBy) {
        var texts = labelledBy.split(/\\s+/).map(function(id) { return (document.getElementById(id)?.textContent || '').trim() }).filter(Boolean)
        if (texts.length > 0) { return texts.join(' ').slice(0, 200) }
      }
      var tag = el.tagName.toLowerCase()
      if (tag === 'img' || (tag === 'input' && el.getAttribute('type') === 'image')) {
        var alt = el.getAttribute('alt')
        if (alt !== null) { return alt.trim() }
      }
      if (['input', 'select', 'textarea'].indexOf(tag) !== -1) {
        var id = el.getAttribute('id')
        if (id) {
          var label = document.querySelector('label[for="' + CSS.escape(id) + '"]')
          if (label) { return (label.textContent || '').trim() }
        }
        var parentLabel = el.closest('label')
        if (parentLabel) {
          var clone = parentLabel.cloneNode(true)
          clone.querySelectorAll('input,select,textarea').forEach(function(n) { n.remove() })
          var lt = (clone.textContent || '').trim()
          if (lt) { return lt }
        }
      }
      var ph = el.getAttribute('placeholder')
      if (ph) { return ph.trim() }
      var title = el.getAttribute('title')
      if (title) { return title.trim() }
      return ((el.textContent || '').trim().replace(/\\s+/g, ' ') || '').slice(0, 200)
    }

    ${getSelectorScript(locatorDialect(runner))}

    var elements = []
    var seen = new Set()

    document.querySelectorAll(interactableSelectors).forEach(function(el) {
      if (seen.has(el)) { return }
      seen.add(el)
      var htmlEl = el
      if (!isVisible(htmlEl)) { return }
      var inputEl = htmlEl
      var rect = htmlEl.getBoundingClientRect()
      var isInVp = rect.top >= 0 && rect.left >= 0 && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) && rect.right <= (window.innerWidth || document.documentElement.clientWidth)
      if (${inViewportOnly} && !isInVp) { return }
      var elType = htmlEl.getAttribute('type') || ''
      var entry = {
        tagName: htmlEl.tagName.toLowerCase(),
        name: getAccessibleName(htmlEl),
        type: elType,
        // A trace zip is a portable artifact, and nothing downstream reads a
        // password's value — the a11y name comes from the label, not the field.
        value: elType.toLowerCase() === 'password' ? '' : inputEl.value || '',
        href: htmlEl.getAttribute('href') || '',
        selector: getSelector(htmlEl),
        isInViewport: isInVp
      }
      ${includeBounds ? 'entry.boundingBox = { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height }' : ''}
      elements.push(entry)
    })
    return elements
  })()`
}
