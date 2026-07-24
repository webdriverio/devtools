/**
 * Filename helpers for per-test artifacts (screenshots, videos). Shared so the
 * screenshot and video writers slug a test uid identically.
 */

/** Strip leading and trailing occurrences of `char` via a linear scan. A regex
 *  like `/^c+|c+$/` is O(n²) on long runs of `c` (the anchored `+` is retried
 *  at each position) — flagged by CodeQL's js/polynomial-redos — so this avoids
 *  regex entirely. `char` must be a single character. */
export function trimChar(value: string, char: string): string {
  let start = 0
  let end = value.length
  while (start < end && value[start] === char) {
    start++
  }
  while (end > start && value[end - 1] === char) {
    end--
  }
  return value.slice(start, end)
}

/** File-safe slug of a value: keep alphanumerics, `_` and `-`; collapse the
 *  rest to a single `-`; trim leading/trailing dashes. */
export function fileSlug(value: string): string {
  return trimChar(value.replace(/[^a-zA-Z0-9_-]+/g, '-'), '-')
}
