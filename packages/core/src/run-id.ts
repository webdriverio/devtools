/**
 * Identity for one test run, shared by every process that reports into it.
 * The backend compares it across worker connects to tell "next spec of this
 * run" (keep the accumulated state) from "a new run" (wipe it).
 */

import { randomUUID } from 'node:crypto'
import { RUNNER_ENV } from '@wdio/devtools-shared'

/**
 * This run's id, generating and publishing one on first call. Runners fork
 * workers with the launcher's environment, so a launcher that calls this
 * before the run starts gives every worker the same id; a worker that gets
 * here first can only speak for itself, and each sibling reads as its own run.
 */
export function resolveRunId(): string {
  const existing = process.env[RUNNER_ENV.RUN_ID]
  if (existing) {
    return existing
  }
  const runId = randomUUID()
  process.env[RUNNER_ENV.RUN_ID] = runId
  return runId
}
