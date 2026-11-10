import {
  DEFAULT_CAPTURE_MASK,
  MASKED_VALUE,
  type CaptureMaskConfig
} from '@wdio/devtools-shared'

// Declared by the adapter ahead of this bundle (shared `withCaptureMask`); absent, masking keeps its default.
declare const __wdioCaptureMask: Partial<CaptureMaskConfig> | undefined

function declaredConfig(): CaptureMaskConfig {
  const declared =
    typeof __wdioCaptureMask === 'object' && __wdioCaptureMask
      ? __wdioCaptureMask
      : {}
  return {
    inputs: declared.inputs !== false,
    selectors: Array.isArray(declared.selectors)
      ? declared.selectors.filter((s): s is string => typeof s === 'string')
      : DEFAULT_CAPTURE_MASK.selectors
  }
}

/** Attributes that carry an element's text, masked with it under a mask selector. */
const SELECTOR_MASKED_ATTRIBUTES: ReadonlySet<string> = new Set([
  'aria-label',
  'title',
  'alt',
  'placeholder'
])

/** One invalid selector would make `matches` throw for the whole list, so each is tried alone. */
function validSelectorList(selectors: string[]): string | null {
  const valid = selectors.filter((selector) => {
    try {
      document.createDocumentFragment().querySelector(selector)
      return true
    } catch {
      return false
    }
  })
  return valid.length ? valid.join(', ') : null
}

export class PageMask {
  readonly inputs: boolean
  readonly selector: string | null
  // A show-password toggle turns the field into a text input that still holds the password.
  #wasPassword = new WeakSet<Element>()

  constructor(config: CaptureMaskConfig = declaredConfig()) {
    this.inputs = config.inputs
    this.selector = validSelectorList(config.selectors)
  }

  /** The element itself matches a mask selector; its descendants inherit that through the walk. */
  matchesSelector(element: Element): boolean {
    return this.selector !== null && element.matches(this.selector)
  }

  #insideSelector(node: Node | null): boolean {
    return (
      this.selector !== null &&
      node instanceof Element &&
      node.closest(this.selector) !== null
    )
  }

  /** A password field, or one that was a password field when last seen, while input masking is on. */
  masksFieldKind(element: Element): boolean {
    if (!this.inputs || element.tagName !== 'INPUT') {
      return false
    }
    if ((element as HTMLInputElement).type === 'password') {
      this.#wasPassword.add(element)
      return true
    }
    return this.#wasPassword.has(element)
  }

  /** Whether an element's value is masked, by its kind or by a mask selector over it. */
  masksValue(element: Element): boolean {
    return this.masksFieldKind(element) || this.#insideSelector(element)
  }

  /** Whether attribute `name` is masked, given whether the element's value is and whether it sits under a mask selector. */
  masksAttributeOf(
    name: string,
    valueMasked: boolean,
    inSelector: boolean
  ): boolean {
    return name === 'value'
      ? valueMasked
      : inSelector && SELECTOR_MASKED_ATTRIBUTES.has(name)
  }

  masksAttribute(element: Element, name: string): boolean {
    return this.masksAttributeOf(
      name,
      this.masksValue(element),
      this.#insideSelector(element)
    )
  }

  /** Whether text inside `parent` is masked: only under a mask selector. */
  masksTextUnder(parent: Node | null): boolean {
    return this.#insideSelector(parent)
  }

  maskValue(value: string): string {
    return value === '' ? '' : MASKED_VALUE
  }

  /** Whitespace stays, so masked text keeps the layout it had. */
  maskText(text: string): string {
    return text.trim() === '' ? text : MASKED_VALUE
  }
}

export const pageMask = new PageMask()
