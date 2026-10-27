/** The demo credential the-internet documents and every login example types. */
export const FIXTURE_USERNAME = 'tomsmith'
export const FIXTURE_PASSWORD = 'SuperSecretPassword!'

/** Where `pnpm smoke:fixtures` listens unless told otherwise; ci.yml's base URL uses it. */
export const FIXTURE_DEFAULT_PORT = 4567
export const FIXTURE_DEFAULT_HOST = '127.0.0.1'

/** Largest login form body the fixture reads, in bytes. */
export const FIXTURE_MAX_BODY_BYTES = 16 * 1024

/** How each runner words a wait that ran out, so a timeout fails the smoke run whichever adapter hit it. */
export const TIMEOUT_PATTERNS: readonly RegExp[] = [
  // Error names: selenium-webdriver and Nightwatch (TimeoutError), Python selenium (TimeoutException).
  /\b(?:TimeoutError|TimeoutException)\b/,
  // selenium-webdriver's driver.wait().
  /\bWait timed out after\b/,
  // Nightwatch's waitForElement* and element locators.
  /\bTimed out while waiting for element\b/,
  // WebdriverIO's waitForDisplayed/Exist/Enabled/Clickable/Stable.
  /\bstill (?:not )?(?:displayed|existing|enabled|clickable|stable)\b.* after \d+ms/,
  // WebdriverIO's waitUntil.
  /\bwaitUntil condition timed out after\b/
]

/** pytest's nodeid separator: a test group titled by nodeid matches its function name after the last one. */
export const NODEID_SEPARATOR = '::'
