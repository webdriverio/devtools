import yazl from 'yazl'
import type { TraceSession } from './types.js'
import type { ResourceSnapshotEvent } from './network.js'

export function buildTraceZip(
  session: TraceSession,
  networkEntries?: ResourceSnapshotEvent[]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zipFile = new yazl.ZipFile()

    const traceNdjson = session.events.map((e) => JSON.stringify(e)).join('\n')
    zipFile.addBuffer(Buffer.from(traceNdjson, 'utf8'), 'trace.trace')

    const networkNdjson = networkEntries?.length
      ? Buffer.from(
          networkEntries.map((e) => JSON.stringify(e)).join('\n'),
          'utf8'
        )
      : Buffer.alloc(0)
    zipFile.addBuffer(networkNdjson, 'trace.network')

    for (const screenshot of session.screenshots) {
      zipFile.addBuffer(screenshot.data, `resources/${screenshot.resourceName}`)
    }

    for (const snapshot of session.elementSnapshots) {
      zipFile.addBuffer(snapshot.data, `resources/${snapshot.resourceName}`)
    }

    zipFile.end()

    const chunks: Buffer[] = []
    zipFile.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk))
    zipFile.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    zipFile.outputStream.on('error', reject)
  })
}
