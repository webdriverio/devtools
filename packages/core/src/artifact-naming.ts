/**
 * Filename helpers for per-test artifacts (screenshots, videos). Shared so the
 * screenshot and video writers slug a test uid identically.
 */

/** File-safe slug of a value: keep alphanumerics, `_` and `-`; collapse the
 *  rest to a single `-`; trim leading/trailing dashes. */
export function fileSlug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
}
