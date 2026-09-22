# Mobile examples

One per adapter, all driving the same session so a difference in the dashboard
is a difference in the adapter and not in the test:

```sh
pnpm demo:wdio:mobile
pnpm demo:selenium:mobile
pnpm demo:nightwatch:mobile
pnpm demo:python:mobile
```

`DEVTOOLS_MODE=live` flips any of them to live mode, exactly as the desktop
demos do. Trace is the default.

```sh
DEVTOOLS_MODE=live pnpm demo:selenium:mobile
```

The dashboard starts itself — the adapter does it (`ensureBackendStarted` in the
JS adapters, `enable()` in Python). Nothing needs a backend started by hand.

## What you need

**This is an opt-in toolchain, and it is not small.** Between the Android SDK
and one system image, expect several gigabytes. Nothing here is bundled, and
none of it is needed for any other demo or test in this repo.

1. **Android SDK and an emulator**, or a real device with USB debugging on.
   Android Studio installs both, but it is not needed — Google's CLI installer
   is far lighter and is the route these instructions assume:

   ```sh
   # macOS arm64; see developer.android.com for the other builds. Downloaded
   # and read before it runs, rather than piped into a shell: `latest` is a
   # mutable URL, so piping executes whatever it returns at that moment.
   curl -fsSL -o /tmp/android-cli-install.sh \
     https://dl.google.com/android/cli/latest/darwin_arm64/install.sh
   less /tmp/android-cli-install.sh        # read it
   bash /tmp/android-cli-install.sh
   ```

   That leaves `android-cli` in `~/.android/bin` (**not** on your PATH) and an
   SDK root that it does _not_ necessarily report correctly: `android-cli info`
   said `~/Library/Android/sdk` on the machine this was written on while the
   actual `platform-tools`, `emulator` and `system-images` were in
   `/opt/homebrew/share/android-commandlinetools`. **The directory holding
   `platform-tools` is the one to export**, whatever `info` claims:

   ```sh
   export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools   # check yours
   export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$HOME/.android/bin"
   ```

   Appium's Android driver reads `ANDROID_HOME` and refuses the session without
   it, _after_ accepting the connection — which is why an unset variable
   surfaces as a 40-line driver stack trace rather than as a setup problem.
   The preflight below catches that case and prints the export lines for
   whichever SDK it can find.

   Then create a device once, and boot it:

   ```sh
   android-cli --sdk="$ANDROID_HOME" emulator create medium_phone
   # downloads an arm64 system image — a few minutes, ~3 GB

   emulator -avd medium_phone            # leave this terminal open
   adb wait-for-device
   adb devices                           # must list emulator-5554  device
   ```

   The **emulator has to run in a terminal that stays alive** — a first boot
   takes minutes, and anything that reaps the process group kills it mid-boot.
   `android-cli emulator start medium_phone` also works and waits for boot, but
   the raw `emulator` binary is the more predictable of the two. If a fresh API
   36 image fails to boot, its own log notes that "Guest Angle is still unstable
   for API > 35" — add `-gpu swiftshader_indirect`.

2. **Appium 2.x or 3.x** and the Android driver. **Export the SDK path first,
   in this shell** — Appium's Android driver reads its OWN environment, so
   exporting it where the tests run changes nothing and the session is refused
   with `Neither ANDROID_HOME nor ANDROID_SDK_ROOT environment variable was
exported`, delivered through the client as a WebDriver failure that looks
   like a test problem:

   ```sh
   export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools   # yours may differ
   export PATH="$PATH:$ANDROID_HOME/platform-tools"

   npm i -g appium
   appium driver install uiautomator2
   appium --address 127.0.0.1 --port 4723
   ```

   The preflight reads the running Appium's environment and says so when this
   is what is wrong, because nothing else in the stack does.

**You do not need an app.** The default target is the device's own Clock app,
so there is no `.apk` to build, upload, or keep credentials for — which is what
kept a native example from landing before.

Every one of the four checks this before it opens a session and tells you what
is missing, because the frameworks themselves do not: WDIO reports "make sure
browser driver is running", Nightwatch reports it could not reach _GeckoDriver_,
and selenium-webdriver reports `ECONNREFUSED` with a stack trace. All three mean
Appium is not up. `examples/mobile-preflight.cjs` is the shared check. It separates the five
states that look alike from the outside: Appium not up; Appium up but no SDK
exported here; **Appium up with no SDK in its own environment**, which is the
one that wastes the most time; SDK fine but no device attached; and a remote
Appium, for which none of the local checks apply. When an SDK is present but unexported it
prints the exact `export` lines for the path it found.

## What the examples drive

All four run the same flow against the **Clock app**, which ships with every
Android system image — so there is no `.apk` to supply, nothing to upload and no
credentials. Clock is used rather than Settings because it gives a native
session something deterministic to do:

1. open the Timers tab
2. clear any timer a previous run left behind
3. start the 5-minute preset, and check the countdown is running
4. pause it, and check the control now offers **Start**
5. delete it, and check the timer is gone

Step 2 is what makes them re-runnable. A timer **survives the session**, and
while one exists the Timers tab shows its card instead of the preset buttons —
so without it, one interrupted run breaks every later one.

**VERIFIED ON:** Android emulator `sdk_gphone64_arm64`, Android 16 (API 36),
Clock (`com.google.android.deskclock`) 9.1. The Clock app updates
**independently of the Android version**, so pinning a system image does not pin
these resource-ids. If a locator misses, re-read the tree rather than assuming
capture broke:

```sh
adb shell uiautomator dump /sdcard/ui.xml && adb shell cat /sdcard/ui.xml
```

A running countdown never reaches idle, and `uiautomator dump` fails outright
with `ERROR: could not get idle state` — so pause or clear the timer first.

### Three per-adapter details worth knowing

Each cost a debugging round when these examples were written, and none of them
points at itself:

- **Selenium** — use `getDomAttribute()`, never `getAttribute()`.
  selenium-webdriver implements the latter by executing a JavaScript atom, and a
  native session has no JS to run it in; it fails with `Method is not
  implemented`. It also does **no implicit wait**, so a tap that starts a screen
  transition needs `driver.wait(until.elementLocated(...))` where WebdriverIO
  auto-waits.
- **Nightwatch** — it rejects `-android uiautomator` with `InvalidSelectorError`
  rather than forwarding it, so these use Appium's `id` strategy against a full
  resource-id. And `findElements()` WAITS and then throws `NoSuchElementError`
  when nothing matches, which Nightwatch reports as a run error even when
  caught; the protocol-level `browser.elements()` returns an empty list instead.
- **Python** — the Appium client is an extra dependency the desktop examples do
  not need; see below.

## Choosing what to drive

| variable                                   | default              | meaning                                                                       |
| ------------------------------------------ | -------------------- | ----------------------------------------------------------------------------- |
| `DEVTOOLS_MODE`                            | `trace`              | `live` opens the dashboard and streams; `trace` writes a zip                  |
| `DEVTOOLS_MOBILE`                          | `native`             | `web` drives Chrome on the device instead of an app                           |
| `APPIUM_APP`                               | —                    | path to an `.apk`/`.app` to drive instead of Clock                            |
| `APPIUM_HOST` / `APPIUM_PORT`              | `127.0.0.1` / `4723` | where Appium is listening                                                     |
| `DEVTOOLS_MOBILE_PLATFORM`                 | `android`            | `ios` is **not supported** — the examples are Android-only, see below         |
| `IOS_DEVICE_NAME` / `IOS_PLATFORM_VERSION` | `iPhone 15` / —      | read by the capability builders only; no example has an iOS flow to use them  |

```sh
DEVTOOLS_MOBILE=web pnpm demo:nightwatch:mobile     # mobile web, not an app
APPIUM_APP=/tmp/my.apk pnpm demo:wdio:mobile        # a real app
```

**`DEVTOOLS_MOBILE=web` needs one extra thing from the server.** Chrome on the
device needs a matching chromedriver, and the emulator's Chrome is usually
newer than anything installed — the session then fails with `No Chromedriver
found that can automate Chrome '133.0.6943'`. Appium can fetch one, but that is
a **server feature**, not a capability, so it goes on the `appium` command:

```sh
appium --address 127.0.0.1 --port 4723 \
  --allow-insecure=uiautomator2:chromedriver_autodownload
```

There is no `appium:chromedriverAutodownload` capability, despite how often it
is written down — the driver only reads `chromedriverExecutable` and
`chromedriverExecutableDir`, so that name is silently ignored. Pointing at a
chromedriver you already have works too:

```js
'appium:chromedriverExecutable': '/path/to/chromedriver'
```

**Both targets are worth running**, because they take different paths through
capture and the difference is deliberate. A native app has no document, so the
adapters skip every page-side call — the DOM drain, the collector injection,
the per-action element and accessibility scripts, `url` and `title`. A mobile
**browser** session runs on the same phone and does have a page, so it keeps
all of them. Getting that distinction wrong in either direction is a bug
(`shared/src/device.ts` `isNativeAppSession` is the one place that decides).

## Python needs one extra package

The desktop Python examples need nothing beyond Selenium; an Appium session is
built through the Appium client:

```sh
pip install -r examples/selenium-py/requirements-mobile.txt
```

## What the `web` target exercises

`DEVTOOLS_MOBILE=web` drives Chrome on the same device instead of an app, and it
is worth running: a mobile browser session **has a document**, so it must keep
every page-side call a native session skips. That contrast is the whole point of
the native guards, and only the web target proves the guards did not go too far.

A mobile-web Appium session used to deadlock — the adapter issued page-side
calls from inside the hook wrapping the command being captured, and Appium
serialises commands per session, so the wrapped command never reached the
browser. That is fixed: per-action snapshots are now skipped only where Appium
has a document to probe, which is the webview half of a hybrid app. A mobile
browser and a native app are both captured normally.

The traps below are about setup rather than the adapter, and you will hit them
on the way.

## The `web` target has three separate traps

All three report as the same thing — `No Chromedriver found that can automate
Chrome 'N'` — so they are worth telling apart. Measured against a real
emulator:

1. **Autodownload is a server feature, not a capability.** Add
   `--allow-insecure=uiautomator2:chromedriver_autodownload` to the `appium`
   command. When the flag is missing the error carries the suffix "You could
   also try to enable automated chromedrivers download"; when it is present the
   suffix disappears, which is the only way to tell from the client.

2. **`appium:chromedriverAutodownload` does not exist.** The driver reads only
   `chromedriverExecutable` and `chromedriverExecutableDir`. The other spelling
   is widely copied — this repo had it in `examples/wdio/cucumber/wdio.mobile.conf.ts`
   too — and it is silently ignored.

3. **A `sudo npm i -g appium` leaves the download target root-owned.** The
   driver tree under `~/.appium` then belongs to root, autodownload fetches the
   right chromedriver and fails to _unzip_ it with `EACCES`, and reports the
   same "No Chromedriver found". Either fix the ownership:

   ```sh
   sudo chown -R "$(whoami)" ~/.appium
   ```

   or give it somewhere writable, which needs no sudo:

   ```sh
   CHROMEDRIVER_DIR=/tmp/chromedriver DEVTOOLS_MOBILE=web pnpm demo:wdio:mobile
   ```

### And the emulator has to reach the page

The default URL is public, and an emulator often cannot resolve public DNS
(corporate network or VPN). `10.0.2.2` is the emulator's alias for **this
machine's** localhost, so serving a page here is the reliable route:

```sh
# --bind and --directory are both deliberate: the default serves the CURRENT
# directory on EVERY interface, so a checkout's contents would be readable by
# anything on the LAN or VPN. The emulator only needs this machine's loopback.
python3 -m http.server 8099 --bind 127.0.0.1 --directory /tmp/mobile-page
DEVTOOLS_MOBILE_URL=http://10.0.2.2:8099/ DEVTOOLS_MOBILE=web pnpm demo:wdio:mobile
```

`DEVTOOLS_MOBILE_URL` skips the login assertions, which only exist on the
default page, and just navigates and captures.

## Observed on a real emulator

Measured on a `medium_phone` AVD, API 36 (Android 16) arm64, Appium 3.7.0 with
uiautomator2 7.6.1:

- **The tests pass and the trace is correct.** `context-options` carried
  `device: {platform: 'android', name: 'sdk_gphone64_arm64', version: '16'}` and
  the device's real portrait viewport, `1080 × 2400` — not the 1280x720
  fallback — so the player takes the device-column layout.
- **The `web` target was NOT verified on a device.** With the flag and a
  writable driver directory the session is created and chromedriver 133 is
  fetched, but every command then timed out at 180 s, including the capture's
  own `execute/sync`. That emulator's networking was independently unhealthy
  (`ping 8.8.8.8` returned 50% loss with duplicate packets), so this is
  unproven rather than broken. The **native** target on the same emulator works.
- **The UiAutomator2 instrumentation crashes partway through**, and it is not
  this repo's doing: it happens with the filmstrip poller off, and once at
  session creation (`The instrumentation process cannot be initialized`). After
  it dies every `screenshot` and `source` probe returns `cannot be proxied … the
instrumentation process is not running`, so the trace ends up with fewer
  per-action frames than commands. The assertions still pass and the zip is
  still written. The emulator's own log notes "Guest Angle is still unstable for
  API > 35", so a lower API image is the thing to try if this matters.

## Expected noise

Not failures, and not worth chasing:

- **Selenium logs three BiDi warnings per run** (`BiDi LogInspector attach
failed`, `BiDi preload unavailable`, `BiDi NetworkInspector attach failed`).
  The adapter requests `webSocketUrl` unconditionally and Appium serves no
  BiDi, so the attach fails and capture falls back to per-document injection —
  which is the correct path for a native session anyway.
- **An inherited `DEVTOOLS_MODE=live` changes what a run produces** — a
  dashboard window and no zip, instead of a zip and no window. That is correct
  behaviour for live mode and surprising when the variable is left over from an
  earlier command, so each run now logs the mode it resolved.
- **Nightwatch's `describe/it` interface collapses per-test slicing** to one
  session-scoped slice, so the config asks for `session` granularity rather
  than pretending otherwise. See CLAUDE.md § Known debt.

## iOS is not supported

`DEVTOOLS_MOBILE_PLATFORM=ios` exits immediately, with the reason. The
capability builders can shape an XCUITest session against the simulator's Clock
app (`com.apple.mobiletimer`), and that part is real — but **no example has an
iOS body**. Every flow drives Android's Clock through UiAutomator resource-ids,
which XCUITest cannot resolve, so an iOS run would build a session and then fail
on its first lookup.

Adding iOS means a flow and selectors per example, not new plumbing. It is left
out rather than half-advertised: a switch that builds a session and then cannot
find anything is worse than one that says no.

## What to look for

- The player uses the **device column** layout: the phone occupies the full
  height at the right, with the dock between it and the Actions list. Drag the
  divider between them to resize.
- The capture is framed in **device chrome** with the device's name above it,
  rather than the mock browser window a desktop trace gets.
- The filmstrip thumbnails are **portrait**.
- **Metadata** names the device (`Pixel 7 (android 14)`) and the viewport the
  device reported — not `1280 × 720`.
- On a native run **with the WDIO service**, the **A11y** tab is built from the
  app's own view hierarchy, so it lists `android.widget.*` (or
  `XCUIElementType*`) nodes rather than HTML roles. Selenium, Nightwatch and
  Python do not derive one yet and show an empty tree — see Known gaps.

## What has been verified, and what has not

The three JS examples have been run end to end against a **stub Appium server**
— a local HTTP server implementing enough of the W3C protocol to complete a
session — so the client-side half is known to work: session creation, the
capability bag on the wire, the command path, and the guards. All three pass two
tests and make **zero page-script calls** on a native session.

That is not the same as a device. It says nothing about whether the Clock app
has the views these examples look for, or whether `back()` behaves, or how a
real screenshot performs. Expect the first real run to need adjusting, and read
a failure as "the device disagreed" rather than "the example is broken".

## Known gaps

Both are tracked, and both are visible in these examples rather than hidden:

- **Selenium and Nightwatch publish no viewport** (#373). The reader then falls
  back to `1280 × 720`, which is landscape — and the player picks the stacked
  layout for a landscape capture. So a native trace from those two adapters
  does not get the device column until that is fixed. WDIO and Python do.
- **A native session gets no accessibility tree from Selenium, Nightwatch or
  Python** (#372). Only the WDIO service derives one from the app's page source.
