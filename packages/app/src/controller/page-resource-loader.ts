import type { PageResourceRef } from '@wdio/devtools-shared'

import type { StoredPageResource } from '../components/browser/archived-resources.js'

/** Reads a trace's stored stylesheets as text and its fonts as they are, so replay can rewrite and serve them; one that cannot be read replays live. */
export async function readPageResources(
  refs: readonly PageResourceRef[],
  read: (entry: string) => Promise<Blob | undefined>
): Promise<StoredPageResource[]> {
  const loaded = await Promise.all(
    refs.map(async ({ url, kind, mimeType, entry }) => {
      const blob = await read(entry)
      if (!blob) {
        return undefined
      }
      return kind === 'stylesheet'
        ? { url, kind, mimeType, text: await blob.text() }
        : { url, kind, mimeType, blob }
    })
  )
  return loaded.filter((resource) => resource !== undefined)
}
