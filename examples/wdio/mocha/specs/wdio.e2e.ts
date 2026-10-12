import { getSnapshot } from "@wdio/elements"
import * as fs from "node:fs"

describe('webdriver.io', () => {
  it('wdio/elements snapshot and screenshot', async () => {
    await browser.url('/')
    await browser.waitUntil(async () => {
      const title = await browser.getTitle()
      return title.includes('WebdriverIO')
    })

    performance.mark('snapshot-start')
    const { text } =  await getSnapshot(browser, { inViewportOnly: true })
    performance.mark('snapshot-end')
    performance.measure('snapshot', 'snapshot-start', 'snapshot-end')
    performance.getEntriesByName('snapshot').forEach(console.log);

    await fs.writeFileSync(process.cwd() + '/snapshot-full.txt', text)
    await fs.writeFileSync(process.cwd() + '/screenshot.jpg', await browser.takeScreenshot(), 'base64')
  })
})
