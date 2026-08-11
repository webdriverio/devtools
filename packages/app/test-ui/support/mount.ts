// Specs import the component module they exercise — that side effect is what
// registers the custom element; these helpers only create and connect the tag.

import { ContextProvider, type Context } from '@lit/context'
import type { LitElement } from 'lit'

export interface ContextValue {
  context: unknown
  value: unknown
}

/** Mocha's root hook — declared locally because `@types/mocha` sits under
 *  `@wdio/mocha-framework` and isn't in the app's type roots. */
declare const afterEach: (teardown: () => void) => void

const mountedRoots: Element[] = []

// Importing this module registers the teardown, so specs never clean up mounts.
afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    root.remove()
  }
})

export async function mount<T extends LitElement = LitElement>(
  tag: string,
  props?: Record<string, unknown>
): Promise<T> {
  const el = create<T>(tag, props)
  document.body.append(el)
  mountedRoots.push(el)
  await el.updateComplete
  return el
}

export async function mountWithContext<T extends LitElement = LitElement>(
  tag: string,
  contexts: ContextValue[],
  props?: Record<string, unknown>
): Promise<T> {
  const host = document.createElement('div')
  document.body.append(host)
  mountedRoots.push(host)

  for (const { context, value } of contexts) {
    const provider = new ContextProvider(host, {
      context: context as Context<unknown, unknown>,
      initialValue: value
    })
    // A plain div is no ReactiveElement, so @lit/context can't auto-wire the
    // controller — its connect signal has to be fired by hand.
    provider.hostConnected()
  }

  // Appended after the providers exist so the consumer's `context-request`
  // (dispatched on connect) already has a listening ancestor.
  const el = create<T>(tag, props)
  host.append(el)
  await el.updateComplete
  return el
}

export async function settle(el: LitElement): Promise<void> {
  await el.updateComplete
}

function create<T extends LitElement>(
  tag: string,
  props?: Record<string, unknown>
): T {
  const el = document.createElement(tag) as T
  if (props) {
    Object.assign(el, props)
  }
  return el
}
