import { describe, it, expect } from 'vitest'
import { occupiesDriver } from '@wdio/devtools-shared'
import {
  InFlightGate,
  beginDriverCapture,
  beginDriverCommand,
  isDriverBusy
} from '../src/driver-activity.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('occupiesDriver', () => {
  it('holds the driver for input, reads, navigation and unknown commands', () => {
    for (const command of [
      'click',
      'doubleClick',
      'moveTo',
      'dragAndDrop',
      'setValue',
      'sendKeys',
      'keys',
      'moveToElement',
      'mouseButtonClick',
      'rightClick',
      'submitForm',
      'getText',
      'isDisplayed',
      'getCurrentUrl',
      'url',
      'execute',
      'takeScreenshot',
      'notACommand'
    ]) {
      expect(occupiesDriver(command)).toBe(true)
    }
  })

  it('leaves waits and host-side commands alone', () => {
    for (const command of [
      'waitUntil',
      'waitForDisplayed',
      'waitForExist',
      'waitForElementVisible',
      'waitForElementPresent',
      'pause',
      'debug',
      'call',
      'perform'
    ]) {
      expect(occupiesDriver(command)).toBe(false)
    }
  })
})

describe('InFlightGate', () => {
  it('opens on open and closes on release', () => {
    const gate = new InFlightGate()
    expect(gate.isOpen()).toBe(false)
    const close = gate.open()
    expect(gate.isOpen()).toBe(true)
    close()
    expect(gate.isOpen()).toBe(false)
  })

  it('stays open until the last of several overlapping windows closes', () => {
    const gate = new InFlightGate()
    const closeClick = gate.open()
    const closeKeys = gate.open()
    closeClick()
    expect(gate.isOpen()).toBe(true)
    closeKeys()
    expect(gate.isOpen()).toBe(false)
  })

  it('recovers after the bound when a window never closes', async () => {
    const gate = new InFlightGate(20)
    gate.open()
    expect(gate.isOpen()).toBe(true)
    await sleep(40)
    expect(gate.isOpen()).toBe(false)
  })

  it('closing an already-expired window is harmless', async () => {
    const gate = new InFlightGate(20)
    const close = gate.open()
    await sleep(40)
    expect(gate.isOpen()).toBe(false)
    close()
    expect(gate.isOpen()).toBe(false)
  })
})

describe('process-wide gate', () => {
  it('opens for a command that holds the driver', () => {
    expect(isDriverBusy()).toBe(false)
    const close = beginDriverCommand('click')
    try {
      expect(isDriverBusy()).toBe(true)
    } finally {
      close()
    }
    expect(isDriverBusy()).toBe(false)
  })

  it('opens nothing for a wait, and its closer is a harmless no-op', () => {
    const close = beginDriverCommand('waitForDisplayed')
    expect(isDriverBusy()).toBe(false)
    expect(() => close()).not.toThrow()
  })

  it('opens for a capture', () => {
    const close = beginDriverCapture()
    try {
      expect(isDriverBusy()).toBe(true)
    } finally {
      close()
    }
    expect(isDriverBusy()).toBe(false)
  })
})
