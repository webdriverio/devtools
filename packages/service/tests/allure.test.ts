import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TraceArtifact } from '@wdio/devtools-core'

const addAttachment = vi.fn()
vi.mock('@wdio/allure-reporter', () => ({
  addAttachment,
  default: { addAttachment }
}))

import {
  attachArtifactToAllure,
  resetAllureReporterCache
} from '../src/allure.js'

function artifact(over: Partial<TraceArtifact> = {}): TraceArtifact {
  return {
    kind: 'trace',
    path: '',
    scope: 'test',
    testUids: ['u1'],
    retained: true,
    ...over
  }
}

describe('attachArtifactToAllure', () => {
  const dirs: string[] = []
  beforeEach(() => {
    addAttachment.mockReset()
    resetAllureReporterCache()
  })
  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))
    )
  })

  async function tempZip(name: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'allure-'))
    dirs.push(dir)
    const p = join(dir, name)
    await writeFile(p, 'zip-bytes')
    return p
  }

  it('is a no-op for a non-retained artifact', async () => {
    await attachArtifactToAllure(artifact({ retained: false, path: '/x.zip' }))
    expect(addAttachment).not.toHaveBeenCalled()
  })

  it('is a no-op for an artifact with no path yet', async () => {
    await attachArtifactToAllure(artifact({ path: '' }))
    expect(addAttachment).not.toHaveBeenCalled()
  })

  it('attaches a trace zip as a plain application/zip download', async () => {
    const path = await tempZip('trace-abc.zip')
    await attachArtifactToAllure(artifact({ path }))
    expect(addAttachment).toHaveBeenCalledOnce()
    const [name, content, type] = addAttachment.mock.calls[0]!
    expect(name).toBe('trace-abc.zip')
    expect(Buffer.isBuffer(content)).toBe(true)
    expect(type).toBe('application/zip')
  })

  it('attaches a video artifact as video/webm', async () => {
    const path = await tempZip('rec-abc.webm')
    await attachArtifactToAllure(artifact({ kind: 'video', path }))
    const [, , type] = addAttachment.mock.calls[0]!
    expect(type).toBe('video/webm')
  })

  it('attaches a screenshot artifact as image/png', async () => {
    const path = await tempZip('screenshot-u1.png')
    await attachArtifactToAllure(artifact({ kind: 'screenshot', path }))
    const [, , type] = addAttachment.mock.calls[0]!
    expect(type).toBe('image/png')
  })

  it('skips a directory-format artifact without throwing (ndjson-directory)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'allure-dir-'))
    dirs.push(dir)
    await expect(
      attachArtifactToAllure(artifact({ path: dir }))
    ).resolves.toBeUndefined()
    expect(addAttachment).not.toHaveBeenCalled()
  })

  it('never rejects when the artifact path is missing', async () => {
    await expect(
      attachArtifactToAllure(artifact({ path: '/no/such/trace.zip' }))
    ).resolves.toBeUndefined()
    expect(addAttachment).not.toHaveBeenCalled()
  })
})
