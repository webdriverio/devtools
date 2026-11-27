import fs from 'node:fs/promises'
import type { ZipSource } from '@wdio/devtools-trace/trace-reader'

/** The file a path named when it was checked; a later read refuses any other file found under that path. */
export interface CheckedFile {
  path: string
  size: number
  dev: number
  ino: number
  mtimeMs: number
}

/** Stats a checked path and refuses anything but a regular file, which a FIFO or device under a root would otherwise hang or flood. */
export async function checkedFile(file: string): Promise<CheckedFile> {
  const stat = await fs.stat(file)
  if (!stat.isFile()) {
    throw new Error(`Cannot open ${file}: it is not a regular file`)
  }
  return {
    path: file,
    size: stat.size,
    dev: stat.dev,
    ino: stat.ino,
    mtimeMs: stat.mtimeMs
  }
}

/** A zip on disk, read a range at a time. The file is opened per read, so a handle never holds a descriptor, and each open is checked to be the same file the path guard approved. */
export function fileZipSource(file: CheckedFile): ZipSource {
  return {
    size: file.size,
    async read(offset, length) {
      const handle = await fs.open(file.path, 'r')
      try {
        const stat = await handle.stat()
        // The modification time catches a rewrite in place, and a new file that took the old one's freed inode.
        if (
          stat.dev !== file.dev ||
          stat.ino !== file.ino ||
          stat.size !== file.size ||
          stat.mtimeMs !== file.mtimeMs
        ) {
          throw new Error(
            `${file.path} changed since the trace was opened; open it again`
          )
        }
        const buffer = new Uint8Array(length)
        const { bytesRead } = await handle.read(buffer, 0, length, offset)
        return buffer.subarray(0, bytesRead)
      } finally {
        await handle.close()
      }
    }
  }
}
