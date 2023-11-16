import WebdriverIOReporter from '@wdio/reporter'

export class TestReporter extends WebdriverIOReporter {
  get report () {
    return this.suites
  }
}
