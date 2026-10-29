// Apart from `trace-reader.ts`, which the hosted player runs in a browser.

import fs from 'node:fs/promises'
import type { TracePlayerData } from '@wdio/devtools-shared'

import { parseTraceZip } from './trace-reader.js'

/** Read a trace.zip from disk and reconstruct the player payload. */
export async function readTraceZip(zipPath: string): Promise<TracePlayerData> {
  const buffer = await fs.readFile(zipPath)
  return parseTraceZip(new Uint8Array(buffer))
}
