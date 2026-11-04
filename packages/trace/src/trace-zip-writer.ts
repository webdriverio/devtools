// Thin yazl wrapper that packages a trace into a single Buffer.
// Ported from Vince Graics' PR #209.

import { TRACE_ZIP_ENTRIES } from '@wdio/devtools-shared'
import yazl from 'yazl'

export interface TraceZipResource {
  /** Path inside the zip, e.g. `resources/page@xxx-12345.jpeg`. */
  resourceName: string
  data: Buffer
}

export interface TraceZipInputs {
  /** NDJSON action events (one JSON object per line). */
  traceNdjson: string
  /** NDJSON HAR resource-snapshot entries. Empty buffer when omitted. */
  networkNdjson: Buffer
  /** Human/LLM-readable Markdown transcript. */
  transcriptMd?: string
  /** NDJSON DOM mutation stream (one mutation per line). Omitted/empty → no entry. */
  mutationsNdjson?: Buffer
  /** NDJSON index of stored page resources. Omitted/empty → no entry. */
  pageResourcesNdjson?: Buffer
  /** Files written under `resources/` — typically screenshots + element snapshots. */
  resources: TraceZipResource[]
}

/** The first resource under each name: content-addressed producers can name the same bytes twice, and a zip must not list an entry twice. */
export function uniqueResources(
  resources: readonly TraceZipResource[]
): TraceZipResource[] {
  const seen = new Set<string>()
  return resources.filter((resource) => {
    if (seen.has(resource.resourceName)) {
      return false
    }
    seen.add(resource.resourceName)
    return true
  })
}

export function buildTraceZip(inputs: TraceZipInputs): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zipFile = new yazl.ZipFile()
    zipFile.addBuffer(
      Buffer.from(inputs.traceNdjson, 'utf8'),
      TRACE_ZIP_ENTRIES.trace
    )
    zipFile.addBuffer(inputs.networkNdjson, TRACE_ZIP_ENTRIES.network)
    if (inputs.transcriptMd) {
      zipFile.addBuffer(
        Buffer.from(inputs.transcriptMd, 'utf8'),
        TRACE_ZIP_ENTRIES.transcript
      )
    }
    if (inputs.mutationsNdjson?.length) {
      zipFile.addBuffer(inputs.mutationsNdjson, TRACE_ZIP_ENTRIES.mutations)
    }
    if (inputs.pageResourcesNdjson?.length) {
      zipFile.addBuffer(
        inputs.pageResourcesNdjson,
        TRACE_ZIP_ENTRIES.pageResources
      )
    }
    for (const resource of uniqueResources(inputs.resources)) {
      zipFile.addBuffer(
        resource.data,
        `${TRACE_ZIP_ENTRIES.resourcesDir}/${resource.resourceName}`
      )
    }
    zipFile.end()
    const chunks: Buffer[] = []
    zipFile.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk))
    zipFile.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    zipFile.outputStream.on('error', reject)
  })
}
