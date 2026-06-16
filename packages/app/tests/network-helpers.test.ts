import { describe, it, expect } from 'vitest'

import { statusKind, getStatusClass } from '../src/utils/network-helpers.js'
import { STATUS_KIND } from '../src/utils/network-constants.js'

describe('statusKind', () => {
  it('buckets 2xx as ok', () => {
    expect(statusKind(200)).toBe(STATUS_KIND.OK)
    expect(statusKind(204)).toBe(STATUS_KIND.OK)
  })

  it('buckets 3xx as redirect', () => {
    expect(statusKind(301)).toBe(STATUS_KIND.REDIRECT)
    expect(statusKind(304)).toBe(STATUS_KIND.REDIRECT)
  })

  it('buckets 4xx/5xx as error', () => {
    expect(statusKind(404)).toBe(STATUS_KIND.ERROR)
    expect(statusKind(500)).toBe(STATUS_KIND.ERROR)
  })

  it('treats a missing status as pending', () => {
    expect(statusKind(undefined)).toBe(STATUS_KIND.PENDING)
  })

  it('treats an error flag as error regardless of status', () => {
    expect(statusKind(200, true)).toBe(STATUS_KIND.ERROR)
    expect(statusKind(undefined, true)).toBe(STATUS_KIND.ERROR)
  })
})

describe('getStatusClass', () => {
  it('derives the text colour from the status bucket', () => {
    expect(getStatusClass(200)).toBe('text-green-500')
    expect(getStatusClass(302)).toBe('text-yellow-500')
    expect(getStatusClass(404)).toBe('text-red-500')
    expect(getStatusClass(undefined)).toBe('text-gray-500')
  })
})
