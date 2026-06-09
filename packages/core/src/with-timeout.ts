// Resolves `promise` if it settles before `ms`; otherwise resolves to the
// supplied fallback value. Used by per-action snapshot capture to guard
// against hung in-page scripts (heavy pages, infinite-render loops) without
// stalling the user's test.

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  return Promise.race([
    promise.then((v) => {
      if (timer) {
        clearTimeout(timer)
      }
      return v
    }),
    timeout
  ])
}

/** Default ceiling for a single in-page snapshot probe. */
export const SNAPSHOT_PROBE_TIMEOUT_MS = 2500
