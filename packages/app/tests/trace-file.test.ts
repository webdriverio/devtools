// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { announceTraceFile, takePickedFile } from '../src/utils/trace-file.js'

describe('announceTraceFile', () => {
  it('reaches the app from inside a shadow root', () => {
    const app = document.createElement('div')
    const header = app.attachShadow({ mode: 'open' })
    const button = document.createElement('button')
    header.appendChild(button)
    const file = new File(['zip'], 'trace.zip')
    const received: File[] = []
    app.addEventListener('app-trace-open', (event) =>
      received.push((event as CustomEvent<File>).detail)
    )

    announceTraceFile(button, file)

    expect(received).toEqual([file])
  })
})

describe('takePickedFile', () => {
  it('clears the input so picking the same file again fires change', () => {
    const input = document.createElement('input')
    input.type = 'file'
    const file = new File(['zip'], 'trace.zip')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })

    expect(takePickedFile(input)).toBe(file)
    expect(input.value).toBe('')
  })

  it('is undefined when nothing was picked', () => {
    expect(takePickedFile(undefined)).toBeUndefined()
  })
})
