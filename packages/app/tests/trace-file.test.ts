// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import {
  announceTraceSources,
  takePickedSources
} from '../src/utils/trace-file.js'
import type { TraceSource } from '../src/utils/trace-sources.js'

function pick(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true })
}

function inFolder(file: File, relative: string): File {
  Object.defineProperty(file, 'webkitRelativePath', { value: relative })
  return file
}

describe('announceTraceSources', () => {
  it('reaches the app from inside a shadow root', () => {
    const app = document.createElement('div')
    const header = app.attachShadow({ mode: 'open' })
    const button = document.createElement('button')
    header.appendChild(button)
    const sources: TraceSource[] = [
      { path: 'trace.zip', read: () => Promise.resolve(new Blob()) }
    ]
    const received: (readonly TraceSource[])[] = []
    app.addEventListener('app-trace-open', (event) =>
      received.push(event.detail)
    )

    announceTraceSources(button, sources)

    expect(received).toEqual([sources])
  })
})

describe('takePickedSources', () => {
  it('clears the input so picking the same files again fires change', async () => {
    const input = document.createElement('input')
    input.type = 'file'
    const file = new File(['zip'], 'trace.zip')
    pick(input, [file])

    const sources = takePickedSources(input)

    expect(sources.map(({ path }) => path)).toEqual(['trace.zip'])
    await expect(sources[0].read()).resolves.toBe(file)
    expect(input.value).toBe('')
  })

  it('keeps only the zips of a picked folder, named by their path in it', () => {
    const input = document.createElement('input')
    pick(input, [
      inFolder(new File(['zip'], 'trace.zip'), 'run/login-chrome/trace.zip'),
      inFolder(new File(['png'], 'shot.png'), 'run/login-chrome/shot.png'),
      inFolder(new File(['{}'], 'manifest.json'), 'run/manifest.json')
    ])

    expect(takePickedSources(input).map(({ path }) => path)).toEqual([
      'run/login-chrome/trace.zip'
    ])
  })

  it('is empty when nothing was picked', () => {
    expect(takePickedSources(undefined)).toEqual([])
  })
})
