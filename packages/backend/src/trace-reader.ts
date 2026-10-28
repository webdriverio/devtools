import fs from 'node:fs/promises'
import { parseTraceZip } from '@wdio/devtools-trace'
import type { TracePlayerData } from '@wdio/devtools-shared'

export async function readTraceZip(zipPath: string): Promise<TracePlayerData> {
  const buffer = await fs.readFile(zipPath)
  return parseTraceZip(new Uint8Array(buffer))
}
