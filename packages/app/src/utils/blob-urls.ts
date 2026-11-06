/** Creates and revokes object URLs; swapped in tests, where there is no URL registry to leak from. */
export interface BlobUrls {
  create(blob: Blob): string
  revoke(url: string): void
}

export const BROWSER_BLOB_URLS: BlobUrls = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url)
}
