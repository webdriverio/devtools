import { expect } from '@wdio/globals'

describe('ApiDemos - navigation and text input', () => {
  it('navigates into App > Activity > Custom Title and sets a title', async () => {
    // Main screen: list of API categories
    await $('android=new UiSelector().text("App")').click()

    // App sub-list
    await $('android=new UiSelector().text("Activity")').click()

    // Activity sub-list
    await $('android=new UiSelector().text("Custom Title")').click()

    // Custom Title screen: fill left input and tap its button
    await $('#left_text_edit').setValue('Hello Trace')
    await $('#left_text_button').click()

    await expect($('~Change Right')).toHaveText('Change Right')
  })
})
