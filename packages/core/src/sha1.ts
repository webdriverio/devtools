import { createHash } from 'node:crypto'

/** Hex SHA-1 used for content-addressed trace resources. */
export function sha1Hex(data: Buffer | string): string {
  return createHash('sha1').update(data).digest('hex')
}
