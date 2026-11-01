// Shadow root first, light DOM as fallback — components that render into their
// host's children (`createRenderRoot` overrides, slotted markup) resolve the
// same way as shadow-rendering ones.

export function shadow<E extends Element = HTMLElement>(
  host: Element,
  selector: string
): E | null {
  return (
    host.shadowRoot?.querySelector<E>(selector) ??
    host.querySelector<E>(selector)
  )
}

export function shadowAll<E extends Element = HTMLElement>(
  host: Element,
  selector: string
): E[] {
  const inShadow = host.shadowRoot
    ? Array.from(host.shadowRoot.querySelectorAll<E>(selector))
    : []
  return inShadow.length > 0
    ? inShadow
    : Array.from(host.querySelectorAll<E>(selector))
}

/** Trimmed, whitespace-collapsed textContent. */
export function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** text() of every match of `selector` inside host's shadow root. */
export function texts(host: Element, selector: string): string[] {
  return shadowAll(host, selector).map((el) => text(el))
}
