import {
  DEFAULT_CAPTURE_MASK,
  MASKED_VALUE,
  TYPING_SURFACE_SELECTOR,
  typedValuePattern,
  UNMASKED_INPUT_TYPES,
  type CaptureMaskConfig
} from '@wdio/devtools-shared'

// Declared by the adapter ahead of this bundle (shared `withCaptureMask`); absent, masking keeps its default.
declare const __wdioCaptureMask: Partial<CaptureMaskConfig> | undefined

/** Bounds the fields remembered for scrubbing, so a page that spawns inputs cannot grow it without end. */
const TYPED_FIELDS_MAX = 64

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
  #typed = new Map<Element, string>()
  #pattern: RegExp | null | undefined

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

  /** A text-like input or a textarea, whose value is typed text, while input masking is on. */
  masksFieldKind(element: Element): boolean {
    if (!this.inputs) {
      return false
    }
    const tag = element.tagName
    return (
      tag === 'TEXTAREA' ||
      (tag === 'INPUT' &&
        !UNMASKED_INPUT_TYPES.has((element as HTMLInputElement).type))
    )
  }

  /** Whether an element's value is masked, by its kind or by a mask selector over it. */
  masksValue(element: Element): boolean {
    return this.masksFieldKind(element) || this.#insideSelector(element)
  }

  /** A textarea, an editable region or an ARIA textbox: its own text is what was typed. */
  isTypingSurface(element: Element): boolean {
    return (
      this.inputs &&
      (element.tagName === 'TEXTAREA' ||
        element.matches(TYPING_SURFACE_SELECTOR))
    )
  }

  /** Whether text inside `parent` is masked: inside a typing surface, or under a mask selector. */
  masksTextUnder(parent: Node | null): boolean {
    if (!(parent instanceof Element)) {
      return false
    }
    if (
      this.inputs &&
      (parent.tagName === 'TEXTAREA' ||
        parent.closest(TYPING_SURFACE_SELECTOR) !== null)
    ) {
      return true
    }
    return this.#insideSelector(parent)
  }

  /** The selector the element scripts mask a text-derived name under, or null with input masking off. */
  typingSurfaceSelector(): string | null {
    return this.inputs ? TYPING_SURFACE_SELECTOR : null
  }

  maskValue(value: string): string {
    return value === '' ? '' : MASKED_VALUE
  }

  /** Whitespace stays, so masked text keeps the layout it had. */
  maskText(text: string): string {
    return text.trim() === '' ? text : MASKED_VALUE
  }

  /** Remember what the user typed into a field (the input listener, never the anchor walk, which reads prefilled values too). */
  noteTyped(element: Element, value: string): void {
    this.#typed.delete(element)
    if (value !== '') {
      this.#typed.set(element, value)
    }
    if (this.#typed.size > TYPED_FIELDS_MAX) {
      this.#typed.delete(this.#typed.keys().next().value!)
    }
    this.#pattern = undefined
  }

  scrub(text: string): string {
    if (this.#typed.size === 0) {
      return text
    }
    if (this.#pattern === undefined) {
      this.#pattern = typedValuePattern(this.#typed.values())
    }
    return this.#pattern ? text.replace(this.#pattern, MASKED_VALUE) : text
  }
}

export const pageMask = new PageMask()
