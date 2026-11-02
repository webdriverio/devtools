import * as shared from '@wdio/devtools-shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@wdio/devtools-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof shared>()
  return { ...actual, typedValuePattern: vi.fn(actual.typedValuePattern) }
})

const { clearTypedValues, maskCommandArgs, scrubTypedText } =
  await import('../src/input-masking.js')

describe('the scrub pattern', () => {
  beforeEach(() => {
    clearTypedValues()
    vi.mocked(shared.typedValuePattern).mockClear()
  })

  it('is built once for many scrubs and rebuilt only when a value is typed', () => {
    maskCommandArgs('webdriverio', 'setValue', ['S3cret pass'])
    const page = `<html>${'x'.repeat(100_000)} S3cret pass</html>`
    for (let i = 0; i < 20; i++) {
      expect(
        scrubTypedText(page).endsWith(`${shared.MASKED_VALUE}</html>`)
      ).toBe(true)
    }
    expect(shared.typedValuePattern).toHaveBeenCalledTimes(1)

    maskCommandArgs('webdriverio', 'setValue', ['another value'])
    scrubTypedText(page)
    expect(shared.typedValuePattern).toHaveBeenCalledTimes(2)
  })
})
