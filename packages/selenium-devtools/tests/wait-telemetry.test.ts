import { describe, expect, it, vi } from 'vitest'
import { trackWaits, waitPollOf } from '../src/wait-tracking.js'
import type { Patchable } from '../src/types.js'

type Wait = (condition: () => unknown) => unknown

function trackedWait(observesPage: boolean) {
  const emit = vi.fn()
  const proto: Patchable = {
    wait(condition: () => unknown) {
      return condition()
    }
  }
  trackWaits(proto, emit, undefined, () => observesPage)
  const pollOfACall = () => waitPollOf('findElement', ['#x'], '#x')
  return { wait: proto.wait as Wait, emit, pollOfACall }
}

describe('trackWaits per mode', () => {
  it('leaves a telemetry wait as selenium wrote it: no row and no poll scope', () => {
    const { wait, emit, pollOfACall } = trackedWait(false)
    expect(wait(pollOfACall)).toBeUndefined()
    expect(emit).not.toHaveBeenCalled()
  })

  it('opens a row and a poll scope when the page is observed', async () => {
    const { wait, emit, pollOfACall } = trackedWait(true)
    expect(await wait(pollOfACall)).toMatchObject({
      pollKey: expect.any(String)
    })
    expect(emit).toHaveBeenCalledTimes(2)
  })
})
