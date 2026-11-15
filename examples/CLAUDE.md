# examples — design notes and known debt

Per-framework demo projects under `examples/`: the desktop and mobile runs they drive, and the Chrome and Appium setup those runs depend on.

## Rules

- **No package pins a browser driver.** A pinned `chromedriver` on `PATH` (pnpm puts `node_modules/.bin` there) wins over Selenium Manager's resolution and fails on a major mismatch. Nightwatch's Chrome service builder sets `requiresDriverBinary: false`, and `chromedriver` is an optional peer.
- **The iOS simulator is chosen by udid; an unmatched `IOS_DEVICE_NAME` is refused.** A missing name makes XCUITest create and boot a device every run. The refusal and booted-simulator preflight are local-only, so `IOS_UDID` and a non-local `APPIUM_HOST` bypass them. Prerequisites are in `examples/MOBILE.md`.

## Known debt

- **Chrome drops all synthesized input after a breached credential is submitted.** Once a test submits a `(username, password)` pair found in Chrome's breach corpus, Chrome queries `passwordsleakcheck-pa.googleapis.com` and ~0.3-0.9 s later stops delivering all WebDriver mouse and keyboard input to that tab. chromedriver still returns 200. Triggered by the demo credential `tomsmith` / `SuperSecretPassword!`; a changed username or a random password does not trigger it.
  - Fix: pass `--host-resolver-rules=MAP passwordsleakcheck-pa.googleapis.com 127.0.0.1`. The examples that submit the credential (WDIO, Nightwatch, both Python) carry it. `--guest` also works; disabling the password manager via `prefs` does not, and WebdriverIO rejects `--incognito`. If a session is stuck, navigate away and back or open a new tab.
  - Don't pin `browserVersion` as a fix: this is not a version regression. It fires on Chrome 149-152, headless and headed, once per profile.
- **Nightwatch BDD example assertions are not Safari-proof.** 4 of 7 fail on Safari.
