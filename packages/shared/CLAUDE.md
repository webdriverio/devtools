# shared — design notes and known debt

Owns the types, contracts, constants and page-script strings that every package shares (`packages/shared/src`).

## Known debt

- **A captured text locator is generated in the recording runner's dialect.** Where: `shared/locator-dialect.ts` `locatorDialect(runner)`. WDIO runners get `a*=Logout`; nightwatch, selenium-webdriver and an unidentified recorder get `//a[contains(., "Logout")]`. Don't emit `tag*=` under WDIO for text containing `"`: WDIO compiles it to a broken XPath. `locatorsMatch` decomposes both dialects.
  - Known gap: `getSnapshot` on WebdriverIO ≥10.2 renders `@wdio/snapshot`'s selector strategies, which are not on this table, so `browser.getSnapshot()` and the trace's A11y tab can differ.
- **`Metadata.runner` and `metadata.options.framework` carry the same fact.** Where: the sidebar's `getFramework` reads the untyped one. Why unfixed: all three adapters set both; collapse `getFramework` onto `Metadata.runner` in the next change to either.
