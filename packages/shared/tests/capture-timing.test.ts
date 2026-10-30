import { describe, expect, it } from 'vitest'
import {
  CAPTURE_PROBES,
  captureTimingFileName,
  isEnvFlagOn
} from '../src/capture-timing.js'

describe('isEnvFlagOn', () => {
  it.each([undefined, '', ' ', '0', 'false', 'No', 'OFF'])(
    'is off for %s',
    (value) => {
      expect(isEnvFlagOn(value)).toBe(false)
    }
  )

  it.each(['1', 'true', 'yes', 'on', 'anything'])('is on for %s', (value) => {
    expect(isEnvFlagOn(value)).toBe(true)
  })
})

describe('capture timing contract', () => {
  it('names one NDJSON file per process', () => {
    expect(captureTimingFileName(4242)).toBe('capture-timing-4242.ndjson')
  })

  it('lists the probes in the order a capture issues them', () => {
    expect(CAPTURE_PROBES.indexOf('url')).toBeLessThan(
      CAPTURE_PROBES.indexOf('screenshot')
    )
    expect(CAPTURE_PROBES.at(-1)).toBe('process')
  })
})
