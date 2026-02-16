describe('Sample Nightwatch Test with DevTools', function() {
  
  it('should navigate to example.com and check title', async function(browser) {
    await browser
      .url('https://example.com')
      .waitForElementVisible('body', 5000)
      .assert.titleContains('Example')
      .assert.visible('h1')
    
    const result = await browser.getText('h1')
    browser.assert.ok(result.includes('Example'), 'H1 contains "Example"')
  });

  it('should perform basic interactions', async function(browser) {
    await browser
      .url('https://www.google.com')
      .waitForElementVisible('body', 5000)
      .assert.visible('textarea[name="q"]')
      .setValue('textarea[name="q"]', 'WebdriverIO DevTools')
      .pause(1000)
  });

});
