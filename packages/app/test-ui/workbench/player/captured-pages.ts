// The captured pages the trace scenarios in `fixtures.ts` replay, shaped exactly
// as `packages/script` serializes them: every element carries the `data-wdio-ref`
// attribute the replay matches mutations against, and the two producers each
// shape comes from are
//   `parseDocument`  (collector.captureCurrentDom) → the full-DOM anchor
//   `parseFragment`  (serializeMutation)           → every added node
// both via `parseNode`, which builds nodes with preact's `h()`. Split out of
// `fixtures.ts` so that file holds the scenarios and this one the page shapes.

import type { SimplifiedVNode } from '../../../../script/types'

/**
 * Value the login page was captured with. Preact applies a non-empty `value` as
 * a PROPERTY, which raises the input's dirty-value flag — from then on the
 * `value` attribute alone no longer moves what the field displays. So a replay
 * that set the attribute without mirroring the property would keep showing this
 * string after the test typed over it.
 */
export const STALE_USERNAME = 'olduser'
export const TYPED_USERNAME = 'tomsmith'
export const FLASH_TEXT = 'You logged into a secure area!'

/** Label of the submit button. The reverse highlight has to resolve the locator
 *  the a11y tree captured, which for this element is its text — so the page needs
 *  an element whose TEXT identifies it. It is also the overlay's visible-text
 *  branch (see the three constants below). */
export const LOGIN_LABEL = 'Login'

/** The locator core's capture emits for that button — a text match, so XPath. */
export const LOGIN_XPATH = `//button[contains(., "${LOGIN_LABEL}")]`

/**
 * The captured page carries one element per branch of the accessible name the
 * element overlay reads (`elementLabel`): `aria-label` first, then visible text,
 * then `placeholder`. Without them every box on the page would be named `''` and
 * the whole fallback could be deleted unnoticed.
 *
 * `#username` has no text and no `aria-label`, so its PLACEHOLDER names it.
 */
export const USERNAME_PLACEHOLDER = 'Username'
/** `#cancel`'s visible text — which its `aria-label` must beat. */
export const CANCEL_TEXT = 'Cancel'
/** `#cancel`'s `aria-label`, captured PADDED so the trim is exercised too. */
export const CANCEL_ARIA_LABEL = 'Abandon sign in'
/** `#password` carries none of the three, so nothing names it. */
export const UNNAMED_LABEL = ''
/** Text `#flash` was captured with — the value every text change replaces, so a
 *  change that never landed is distinguishable from one that did. */
export const FLASH_PENDING = 'Signing you in…'

/** `#notice` holds text, an element, then text again: the mixed-content parent a
 *  characterData mutation has to address a single child of without disturbing
 *  the other two. */
export const NOTICE_LEAD = 'Signed in as '
export const NOTICE_WHO = 'guest'
export const NOTICE_TAIL = ' — session active'
export const NOTICE_TAIL_UPDATED = ' — session expires in 5 minutes'

/** Refs the mutation stream targets. `assignRef` numbers them and stamps one on
 *  EVERY element of the captured tree (`<html>` and `<head>` included); the
 *  names here cover only the elements the specs address, and read better in an
 *  assertion than a serial number. */
export const REF = {
  body: 'body-ref',
  form: 'form-ref',
  username: 'username-ref',
  password: 'password-ref',
  remember: 'remember-ref',
  planGuest: 'plan-guest-ref',
  planMember: 'plan-member-ref',
  submit: 'submit-ref',
  cancel: 'cancel-ref',
  error: 'error-ref',
  secureBody: 'secure-body-ref',
  flash: 'flash-ref',
  notice: 'notice-ref',
  who: 'who-ref',
  logout: 'logout-ref'
} as const

/** A serialized element as the collector emits it — attributes and the child
 *  list share `props`, and a wrapper fragment carries no `type` at all. */
export interface CapturedNode {
  type?: string
  props: Record<string, string | CapturedChild | CapturedChild[]>
}

/** A child of a captured element. A text child is a BARE STRING: `parseNode`
 *  returns a `#text` node's value, and `parseFragment` an added Text node's
 *  data, without wrapping either. */
export type CapturedChild = CapturedNode | string

/**
 * One serialized element, shaped as `parseNode` leaves it: attributes spread
 * onto `props`, children under `props.children` — a single child BARE, several
 * as an array. That split is not cosmetic: `parseNode` builds each node with
 * preact's `h()`, and `h(type, props, one)` stores that one child as-is, so a
 * real capture of `body > form` hands the replay an object where a capture of
 * `body > [div, a]` hands it an array. Always emitting an array would leave the
 * single-child path — the common one — untested.
 */
export function vnode(
  type: string,
  props: Record<string, string>,
  ...children: CapturedChild[]
): CapturedNode {
  if (children.length === 0) {
    return { type, props }
  }
  return {
    type,
    props: {
      ...props,
      children: children.length === 1 ? children[0] : children
    }
  }
}

/**
 * An added node as `serializeMutation` puts it on the wire. `parseFragment`
 * serializes a documentFragment, whose nodeName yields no tagName, so every
 * added node arrives inside a TYPELESS node holding it as its only child —
 * the wrapper `vnode-transform`'s ToDo branch unwraps on replay.
 */
export function capturedFragment(node: CapturedNode): CapturedNode {
  return { props: { children: node } }
}

/**
 * A captured page as `parseDocument` emits it: `html > [head, body]`, since
 * parse5 always materialises both. `head` takes at least two nodes here because
 * the replay prepends its `<base>` by spreading `head.props.children` — a real
 * page with a single `<title>` therefore hands it a bare object, the rebuild
 * throws, and the iframe stays blank (see `vnode-transform.test.ts`).
 */
export function capturedDocument(
  head: readonly [CapturedNode, CapturedNode, ...CapturedNode[]],
  body: CapturedNode
): CapturedNode {
  return vnode('html', { lang: 'en' }, vnode('head', {}, ...head), body)
}

/** Hands a captured tree to the mutation builders. `SimplifiedVNode` types its
 *  props as `Record<string, string>`, which cannot also hold the child list the
 *  real payload carries — `packages/script` casts for the same reason — so the
 *  tree is built with an honest shape and narrowed here. */
export const payload = (node: CapturedNode) =>
  node as unknown as SimplifiedVNode

export const loginPage = payload(
  capturedDocument(
    [
      vnode('meta', { charset: 'utf-8' }),
      // Never runs on replay — the player strips the captured page's scripts.
      vnode('script', { src: '/login.js' })
    ],
    vnode(
      'body',
      { 'data-wdio-ref': REF.body },
      vnode(
        'form',
        { id: 'login', 'data-wdio-ref': REF.form },
        vnode('input', {
          id: 'username',
          type: 'text',
          name: 'username',
          placeholder: USERNAME_PLACEHOLDER,
          value: STALE_USERNAME,
          'data-wdio-ref': REF.username
        }),
        vnode('input', {
          id: 'password',
          type: 'password',
          name: 'password',
          'data-wdio-ref': REF.password
        }),
        vnode('input', {
          id: 'remember',
          type: 'checkbox',
          'data-wdio-ref': REF.remember
        }),
        vnode('input', {
          id: 'plan-guest',
          type: 'radio',
          name: 'plan',
          checked: 'checked',
          'data-wdio-ref': REF.planGuest
        }),
        vnode('input', {
          id: 'plan-member',
          type: 'radio',
          name: 'plan',
          'data-wdio-ref': REF.planMember
        }),
        vnode(
          'button',
          {
            id: 'submit',
            type: 'submit',
            'data-wdio-ref': REF.submit
          },
          LOGIN_LABEL
        ),
        vnode(
          'button',
          {
            id: 'cancel',
            type: 'button',
            'aria-label': `  ${CANCEL_ARIA_LABEL}  `,
            'data-wdio-ref': REF.cancel
          },
          CANCEL_TEXT
        )
      )
    )
  )
)

export const securePage = payload(
  capturedDocument(
    [
      vnode('meta', { charset: 'utf-8' }),
      vnode('meta', { name: 'viewport', content: 'width=device-width' })
    ],
    vnode(
      'body',
      { 'data-wdio-ref': REF.secureBody },
      vnode(
        'div',
        {
          id: 'flash',
          class: 'success',
          'data-wdio-ref': REF.flash
        },
        FLASH_PENDING
      ),
      vnode(
        'p',
        { id: 'notice', 'data-wdio-ref': REF.notice },
        NOTICE_LEAD,
        vnode('strong', { id: 'who', 'data-wdio-ref': REF.who }, NOTICE_WHO),
        NOTICE_TAIL
      ),
      vnode('a', { id: 'logout', href: '/logout', 'data-wdio-ref': REF.logout })
    )
  )
)
