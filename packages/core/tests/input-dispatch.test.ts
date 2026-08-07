import { describe, it, expect } from 'vitest'
import { isInputDispatchingCommand } from '@wdio/devtools-shared'
import {
  InputDispatchGate,
  beginInputDispatch,
  isInputDispatchInFlight
} from '../src/input-dispatch.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('isInputDispatchingCommand', () => {
  it('classifies pointer and keyboard commands across runners', () => {
    for (const command of [
      'click',
      'doubleClick',
      'moveTo',
      'dragAndDrop',
      'touchAction',
      'scrollIntoView',
      'selectByVisibleText',
      'setValue',
      'sendKeys',
      'addValue',
      'clearValue',
      'clear',
      'keys'
    ]) {
      expect(isInputDispatchingCommand(command)).toBe(true)
    }
  })

  it("covers runner-native pointer commands ACTION_MAP doesn't name", () => {
    for (const command of [
      'moveToElement',
      'mouseButtonClick',
      'mouseButtonDown',
      'mouseButtonUp',
      'rightClick',
      'submitForm'
    ]) {
      expect(isInputDispatchingCommand(command)).toBe(true)
    }
  })

  it('leaves reads, waits, navigation and unknown commands alone', () => {
    for (const command of [
      'getText',
      'isDisplayed',
      'getCurrentUrl',
      'waitForElementVisible',
      'url',
      'execute',
      'takeScreenshot',
      'notACommand'
    ]) {
      expect(isInputDispatchingCommand(command)).toBe(false)
    }
  })
})

describe('InputDispatchGate', () => {
  it('opens for an input command and closes on release', () => {
    const gate = new InputDispatchGate()
    expect(gate.isOpen()).toBe(false)
    const close = gate.open('click')
    expect(gate.isOpen()).toBe(true)
    close()
    expect(gate.isOpen()).toBe(false)
  })

  it('never opens for a command that dispatches no input', () => {
    const gate = new InputDispatchGate()
    const close = gate.open('getText')
    expect(gate.isOpen()).toBe(false)
    expect(() => close()).not.toThrow()
  })

  it('stays open until the last of several overlapping commands closes', () => {
    const gate = new InputDispatchGate()
    const closeClick = gate.open('click')
    const closeKeys = gate.open('setValue')
    closeClick()
    expect(gate.isOpen()).toBe(true)
    closeKeys()
    expect(gate.isOpen()).toBe(false)
  })

  it('recovers after the bound when a command never closes its window', async () => {
    const gate = new InputDispatchGate(20)
    gate.open('click') // deliberately never closed
    expect(gate.isOpen()).toBe(true)
    await sleep(40)
    expect(gate.isOpen()).toBe(false)
  })

  it('closing an already-expired window is harmless', async () => {
    const gate = new InputDispatchGate(20)
    const close = gate.open('click')
    await sleep(40)
    expect(gate.isOpen()).toBe(false)
    close()
    expect(gate.isOpen()).toBe(false)
  })
})

describe('process-wide gate', () => {
  it('routes begin/close through the shared instance', () => {
    expect(isInputDispatchInFlight()).toBe(false)
    const close = beginInputDispatch('click')
    try {
      expect(isInputDispatchInFlight()).toBe(true)
    } finally {
      close()
    }
    expect(isInputDispatchInFlight()).toBe(false)
  })
})
