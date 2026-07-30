import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { RUNNER_ENV } from '@wdio/devtools-shared'
import { resolveRunId } from '../src/run-id.js'

describe('resolveRunId', () => {
  beforeEach(() => {
    delete process.env[RUNNER_ENV.RUN_ID]
  })

  afterEach(() => {
    delete process.env[RUNNER_ENV.RUN_ID]
  })

  it('reuses the id a parent process published', () => {
    process.env[RUNNER_ENV.RUN_ID] = 'inherited-run'
    expect(resolveRunId()).toBe('inherited-run')
  })

  it('generates an id once and keeps returning it', () => {
    const first = resolveRunId()
    expect(first).toBeTruthy()
    expect(resolveRunId()).toBe(first)
  })

  // Workers read the id from the environment, so generating without publishing
  // would give every worker of one run a different identity.
  it('publishes the id it generated to the environment', () => {
    expect(process.env[RUNNER_ENV.RUN_ID]).toBeUndefined()
    expect(resolveRunId()).toBe(process.env[RUNNER_ENV.RUN_ID])
  })

  it('gives separate runs separate ids', () => {
    const first = resolveRunId()
    delete process.env[RUNNER_ENV.RUN_ID]
    expect(resolveRunId()).not.toBe(first)
  })
})
