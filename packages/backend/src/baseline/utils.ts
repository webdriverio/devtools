import type { ActiveRun } from './types.js'

export function freshRun(): ActiveRun {
  return {
    commands: [],
    consoleLogs: [],
    networkRequests: [],
    mutations: [],
    sources: {},
    nodes: new Map(),
    startedAt: Date.now()
  }
}

/** Coerce a Date | ISO string | number from the WS payload into ms-since-epoch. */
export function toMs(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined
  }
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string') {
    const t = Date.parse(value)
    return Number.isFinite(t) ? t : undefined
  }
  if (value instanceof Date) {
    return value.getTime()
  }
  return undefined
}

export function pickMin(
  a: number | undefined,
  b: number | undefined
): number | undefined {
  if (a === undefined) {
    return b
  }
  if (b === undefined) {
    return a
  }
  return Math.min(a, b)
}

export function pickMax(
  a: number | undefined,
  b: number | undefined
): number | undefined {
  if (a === undefined) {
    return b
  }
  if (b === undefined) {
    return a
  }
  return Math.max(a, b)
}
