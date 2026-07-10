// Verification harness for native-assert trace capture (browser.assert / verify).
// Run `pnpm demo:nightwatch` and inspect the dashboard Actions: the PASSING
// asserts must render green and the FAILING ones RED. If a failing assert shows
// green, the classic-chained capture is mis-reporting failures (the known risk
// in nativeAssertCapture — the wrapper sees the enqueue, not the queued result).
describe('Native assert capture check', function () {
  it('renders passing and failing native asserts', async function (browser) {
    await browser.url('https://example.com').waitForElementVisible('body', 5000)

    // Soft verify.* first — never aborts the test, so all four always run.
    browser.verify.titleContains('Example') // PASS → expect green
    browser.verify.titleContains('SOFT_FAIL_ME') // FAIL → expect RED

    // Hard assert.* — the classic-chained/queued path under test.
    browser.assert.titleContains('Example') // PASS → expect green
    browser.assert.titleContains('HARD_FAIL_ME') // FAIL → expect RED
  })
})
