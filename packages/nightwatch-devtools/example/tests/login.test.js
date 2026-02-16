describe('The Internet Guinea Pig Website', function() {

  it('should log into the secure area with valid credentials', async function(browser) {
    console.log('[TEST] Navigating to login page')
    browser
      .url('https://the-internet.herokuapp.com/login')
      .waitForElementVisible('body')

    console.log('[TEST] Attempting login with username: tomsmith')
    await browser
      .setValue('#username', 'tomsmith')
      .setValue('#password', 'SuperSecretPassword!')
      .click('button[type="submit"]')

    console.log('[TEST] Verifying flash message: You logged into a secure area!')
    await browser
      .waitForElementVisible('#flash')
      .assert.textContains('#flash', 'You logged into a secure area!')

    console.log('[TEST] Flash message verified successfully')
  })

  it('should show error with invalid credentials', async function(browser) {
    console.log('[TEST] Navigating to login page')
    await browser
      .url('https://the-internet.herokuapp.com/login')
      .waitForElementVisible('body')

    console.log('[TEST] Attempting login with username: foobar')
    await browser
      .setValue('#username', 'foobar')
      .setValue('#password', 'barfoo')
      .click('button[type="submit"]')

    console.log('[TEST] Verifying flash message: Your username is invalid!')
    await browser
      .waitForElementVisible('.flash', 5000)
      .assert.textContains('.flash', 'Your username is invalid!')

    console.log('[TEST] Flash message verified successfully')
  })

})
