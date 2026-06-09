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

/**
 * Accessibility tree walk — returns a flat array of AccessibilityNode.
 *
 * Walks the DOM from `document.body`, assigning semantic roles (button, link,
 * textbox, heading, img, statictext, …) based on tag name, ARIA attributes,
 * and visibility. Each node carries a unique CSS selector.
 */
export function accessibilityTreeScript(inViewportOnly: boolean): string {
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

    function getSelector(element) {
      var tag = element.tagName.toLowerCase()
      var text = (element.textContent || '').trim().replace(/\\s+/g, ' ')
      if (text && text.length > 0 && text.length <= 120) {
        var sameTagElements = document.querySelectorAll(tag)
        var matchCount = 0
        sameTagElements.forEach(function(el) { if (el.textContent.includes(text)) { matchCount++ } })
        if (matchCount === 1) { return tag + '*=' + text }
      }
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
      if (element.id) { return '#' + CSS.escape(element.id) }
      var nameAttr = element.getAttribute('name')
      if (nameAttr) {
        var nameSel = tag + '[name="' + CSS.escape(nameAttr) + '"]'
        if (document.querySelectorAll(nameSel).length === 1) { return nameSel }
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

    function getDirectText(el) {
      var text = ''
      for (var i = 0; i < el.childNodes.length; i++) {
        if (el.childNodes[i].nodeType === 3) { text += el.childNodes[i].textContent }
      }
      return text.trim().replace(/\\s+/g, ' ')
    }

    function isVisible(el) {
      if (typeof el.checkVisibility === 'function') {
        return el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
      }
      var style = window.getComputedStyle(el)
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetWidth > 0 && el.offsetHeight > 0
    }

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
 * gets a computed accessible name and a unique CSS selector.
 */
export function elementsScript(
  includeBounds: boolean,
  inViewportOnly: boolean
): string {
  return `(function () {
    var interactableSelectors = [
      'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
      '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
      '[role="tab"]', '[role="menuitem"]', '[role="combobox"]', '[role="option"]',
      '[role="switch"]', '[role="slider"]', '[role="textbox"]', '[role="searchbox"]',
      '[role="spinbutton"]', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])'
    ].join(',')

    function isVisible(element) {
      if (typeof element.checkVisibility === 'function') {
        return element.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
      }
      var style = window.getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && element.offsetWidth > 0 && element.offsetHeight > 0
    }

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

    function getSelector(element) {
      var tag = element.tagName.toLowerCase()
      var text = (element.textContent || '').trim().replace(/\\s+/g, ' ')
      if (text && text.length > 0 && text.length <= 120) {
        var sameTagElements = document.querySelectorAll(tag)
        var matchCount = 0
        sameTagElements.forEach(function(el) { if (el.textContent.includes(text)) { matchCount++ } })
        if (matchCount === 1) { return tag + '*=' + text }
      }
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
      if (element.id) { return '#' + CSS.escape(element.id) }
      var nameAttr = element.getAttribute('name')
      if (nameAttr) {
        var nameSel = tag + '[name="' + CSS.escape(nameAttr) + '"]'
        if (document.querySelectorAll(nameSel).length === 1) { return nameSel }
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
      var entry = {
        tagName: htmlEl.tagName.toLowerCase(),
        name: getAccessibleName(htmlEl),
        type: htmlEl.getAttribute('type') || '',
        value: inputEl.value || '',
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
