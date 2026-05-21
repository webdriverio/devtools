import { expect } from '@wdio/globals'

describe('worldofbooks.com - search and add to basket', () => {
  it('searches for fantasy books and adds the first result to basket', async () => {
    await browser.url('https://www.worldofbooks.com')

    await $('button=Accept All Cookies').click()

    await $('input[type="search"]').setValue('fantasy')

    await $('button[type="submit"]').click()

    await $("(//button[normalize-space()='Add To Basket'])[1]").click()

    await expect(
      $('#cart-notification[aria-label="Item added!"]')
    ).toBeDisplayed()
  })
})
