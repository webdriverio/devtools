/** Counts per key, leaving out keys with none. */
export function countBy<T, K extends string>(
  items: readonly T[],
  keyOf: (item: T) => K
): Partial<Record<K, number>> {
  const counts: Partial<Record<K, number>> = {}
  for (const item of items) {
    const key = keyOf(item)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

/** An empty filter list asks for nothing to be filtered. */
export function allows<T>(filter: readonly T[] | undefined, value: T): boolean {
  return !filter?.length || filter.includes(value)
}

/** A filter list in one order, so two queries asking for the same thing share their cursors. */
export function sortedFilter<T extends string>(
  filter: readonly T[] | undefined
): T[] | undefined {
  return filter?.length ? [...filter].sort() : undefined
}
