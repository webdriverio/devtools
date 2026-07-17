// Thin yazl wrapper that packages a trace into a single Buffer.
// Ported from Vince Graics' PR #209.

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
  /** Files written under `resources/` — typically screenshots + element snapshots. */
  resources: TraceZipResource[]
}

export function buildTraceZip(inputs: TraceZipInputs): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zipFile = new yazl.ZipFile()
    zipFile.addBuffer(Buffer.from(inputs.traceNdjson, 'utf8'), 'trace.trace')
    zipFile.addBuffer(inputs.networkNdjson, 'trace.network')
    if (inputs.transcriptMd) {
      zipFile.addBuffer(
        Buffer.from(inputs.transcriptMd, 'utf8'),
        'transcript.md'
      )
    }
    if (inputs.mutationsNdjson?.length) {
      zipFile.addBuffer(inputs.mutationsNdjson, 'trace.mutations')
    }
    for (const resource of inputs.resources) {
      zipFile.addBuffer(resource.data, `resources/${resource.resourceName}`)
    }
    zipFile.end()
    const chunks: Buffer[] = []
    zipFile.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk))
    zipFile.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    zipFile.outputStream.on('error', reject)
  })
}
