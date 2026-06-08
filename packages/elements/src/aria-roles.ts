// WAI-ARIA role data tables shared between the accessibility-tree and
// browser-elements page-injected scripts. Defined at module level so they
// can be type-checked + reused; the consuming scripts receive them as
// arguments to `browser.execute()` since values declared at module scope
// don't survive the function-source stringification that injects the script.

/** HTML <input type="..."> → implicit WAI-ARIA role. */
export const INPUT_TYPE_ROLES: Record<string, string> = {
  text: 'textbox',
  search: 'searchbox',
  email: 'textbox',
  url: 'textbox',
  tel: 'textbox',
  password: 'textbox',
  number: 'spinbutton',
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  submit: 'button',
  reset: 'button',
  image: 'button',
  file: 'button',
  color: 'button'
}

/** ARIA roles whose accessible name comes only from aria-label/labelledby,
 *  never from textContent (otherwise the section text leaks into the name). */
export const CONTAINER_ROLES: readonly string[] = [
  'navigation',
  'banner',
  'contentinfo',
  'complementary',
  'main',
  'form',
  'region',
  'group',
  'list',
  'listitem',
  'table',
  'row',
  'rowgroup',
  'generic'
]

/** CSS selector matching all elements treated as interactable by the page-side
 *  element walker. Includes native form/anchor elements plus ARIA-role aliases. */
export const INTERACTABLE_SELECTORS: readonly string[] = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="combobox"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="spinbutton"]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
]
