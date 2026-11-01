/**
 * Normalises a date-like value (Date, timestamp number, ISO string, or
 * undefined) to a millisecond epoch number. Returns 0 for falsy / unparseable
 * input.
 */
export function getTimestamp(date: Date | number | string | undefined): number {
  if (!date) {
    return 0
  }
  if (date instanceof Date) {
    return date.getTime()
  }
  if (typeof date === 'number') {
    return date
  }
  return new Date(date).getTime() || 0
}
