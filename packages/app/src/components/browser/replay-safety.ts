// A trace is untrusted input: whoever recorded it chose the DOM it replays.
const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'xlink:href'
])
const SCRIPT_URL = /^\s*javascript:/i

/** An attribute that could run script or navigate the replay frame, whatever the page's policy. */
export function isUnsafeReplayAttribute(name: string, value: unknown): boolean {
  const attribute = name.toLowerCase()
  if (
    /^on[a-z]/.test(attribute) ||
    attribute === 'srcdoc' ||
    attribute === 'http-equiv'
  ) {
    return true
  }
  return (
    URL_ATTRIBUTES.has(attribute) &&
    typeof value === 'string' &&
    SCRIPT_URL.test(value)
  )
}

export function isUnsafeReplayElement(type: unknown): boolean {
  return typeof type === 'string' && type.toLowerCase() === 'script'
}
