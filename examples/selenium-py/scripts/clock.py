"""Mobile example for the Python adapter.

The WebdriverIO, Selenium and Nightwatch mobile examples drive the SAME flow,
so a difference between two dashboards is a difference in the adapter rather
than in the test.

Drives the Clock app, which ships with every Android system image, so it needs
no .apk. Clock also gives a native session something deterministic to do: a
timer can be started, paused and cleared, and each step changes the screen in a
way the trace can be checked against. See examples/MOBILE.md for prerequisites
and the DEVTOOLS_MOBILE / APPIUM_APP switches.

VERIFIED ON: Android emulator `sdk_gphone64_arm64`, Android 16 (API 36), Clock
(com.google.android.deskclock) 9.1. The Clock app updates independently of the
Android version, so pinning a system image does not pin these resource-ids --
re-read the tree with `adb shell uiautomator dump` if one misses.

    pnpm demo:python:mobile
    DEVTOOLS_MODE=live pnpm demo:python:mobile

``enable()`` starts the dashboard itself, so nothing needs a backend run by
hand. Trace output lands in ``test-results/`` beside this file.

Needs the Appium Python client, which the desktop examples do not:

    pip install -r examples/selenium-py/requirements-mobile.txt
"""

import os
import re
import time

import selenium_devtools as devtools

try:
    from appium import webdriver
    from appium.options.android import UiAutomator2Options
    from appium.options.ios import XCUITestOptions
except ImportError:  # noqa: BLE001 — a missing optional dep, not a failure
    raise SystemExit(
        "this example needs the Appium client:\n"
        "    pip install -r examples/selenium-py/requirements-mobile.txt"
    )
from selenium.webdriver.common.by import By

def require_appium(host: str, port: str) -> None:
    """Appium up, or say what is missing and stop. The JS examples share
    examples/mobile-preflight.cjs for this; ten lines is cheaper than reaching
    across languages for it."""
    import urllib.error
    import urllib.request

    try:
        with urllib.request.urlopen(
            "http://%s:%s/status" % (host, port), timeout=2.5
        ) as res:
            if res.status == 200:
                return
    except (urllib.error.URLError, OSError):
        pass
    raise SystemExit(
        "\nNothing is listening on %s:%s, so Appium is not up.\n\n"
        "Mobile examples need a device and Appium; between the Android SDK and\n"
        "a system image that is a multi-gigabyte setup, so it is opt-in:\n\n"
        "  1. Android SDK + an emulator (Android Studio installs both), then\n"
        "     check it is visible:  adb devices\n"
        "  2. npm i -g appium && appium driver install uiautomator2\n"
        "     appium --address %s --port %s\n\n"
        "See examples/MOBILE.md.\n" % (host, port, host, port)
    )


APP_ID = "com.google.android.deskclock"
# APPIUM_APP replaces Clock, so the Clock flow does not apply to it.
CUSTOM_APP = bool(os.environ.get("APPIUM_APP"))
IS_WEB = os.environ.get("DEVTOOLS_MOBILE") == "web"
IS_IOS = os.environ.get("DEVTOOLS_MOBILE_PLATFORM") == "ios"
APPIUM = "http://%s:%s" % (
    os.environ.get("APPIUM_HOST", "127.0.0.1"),
    os.environ.get("APPIUM_PORT", "4723"),
)


def capabilities() -> dict:
    """The same bag the other three mobile examples build; see
    examples/wdio/mobile/capabilities.ts for the annotated original."""
    base = {
        "platformName": "iOS" if IS_IOS else "Android",
        "appium:automationName": "XCUITest" if IS_IOS else "UiAutomator2",
        "appium:noReset": True,
        "appium:newCommandTimeout": 300,
    }
    if IS_IOS:
        # The simulator name is per-machine: `xcrun simctl list devices`.
        base["appium:deviceName"] = os.environ.get("IOS_DEVICE_NAME", "iPhone 15")
        version = os.environ.get("IOS_PLATFORM_VERSION")
        if version:
            base["appium:platformVersion"] = version
    if IS_WEB:
        # Names a browser, so this session HAS a document and keeps its
        # page-side capture — the distinction the native guards turn on.
        # Chrome on the device needs a matching chromedriver. Appium can
        # fetch one, but that is a SERVER feature, not a capability:
        # --allow-insecure=uiautomator2:chromedriver_autodownload
        base["browserName"] = "Safari" if IS_IOS else "Chrome"
        return base
    app = os.environ.get("APPIUM_APP")
    if app:
        base["appium:app"] = app
        return base
    if IS_IOS:
        base["appium:bundleId"] = "com.apple.mobiletimer"
        return base
    base["appium:appPackage"] = APP_ID
    base["appium:appActivity"] = "com.android.deskclock.DeskClock"
    return base


require_appium(
    os.environ.get("APPIUM_HOST", "127.0.0.1"),
    os.environ.get("APPIUM_PORT", "4723"),
)

# Trace by default, matching the desktop demos. The Python adapter takes a
# boolean rather than a mode name; DEVTOOLS_MODE=live is the shared switch.
devtools.enable(trace=os.environ.get("DEVTOOLS_MODE") != "live")

# The options class is per-platform: handing iOS capabilities to
# UiAutomator2Options builds an Android session request out of them.
_options = XCUITestOptions() if IS_IOS else UiAutomator2Options()
driver = webdriver.Remote(APPIUM, options=_options.load_capabilities(capabilities()))
try:
    if IS_WEB:
        driver.get("https://the-internet.herokuapp.com/login")
        driver.find_element(By.ID, "username").send_keys("tomsmith")
        driver.find_element(By.ID, "password").send_keys("SuperSecretPassword!")
        driver.find_element(By.CSS_SELECTOR, 'button[type="submit"]').click()
        print(driver.find_element(By.ID, "flash").text.strip())
    elif CUSTOM_APP:
        # A supplied app has none of Clock's screens, so driving the Clock flow
        # against it would look for ids that cannot exist. Capture its
        # hierarchy instead -- which is what a custom app is set here to
        # exercise.
        assert driver.page_source, "the view hierarchy was empty"
        print("captured the supplied app's hierarchy")
    else:
        # Re-activated rather than relying on the launch capability alone, so
        # the script re-runs against a session left on another screen.
        driver.execute_script("mobile: activateApp", {"appId": APP_ID})

        def by_id(name):
            return driver.find_element(
                "-android uiautomator",
                'new UiSelector().resourceId("%s:id/%s")' % (APP_ID, name),
            )

        by_id("tab_menu_timer").click()

        # Clear anything a previous run left behind. A timer SURVIVES the
        # session, and while one exists the Timers tab shows its card instead
        # of the preset buttons -- so without this, one interrupted run breaks
        # every later one.
        for _ in range(5):
            left = driver.find_elements(
                "-android uiautomator",
                'new UiSelector().resourceId("%s:id/delete_button")' % APP_ID,
            )
            if not left:
                break
            left[0].click()
            time.sleep(0.3)

        # This build starts the timer straight from the preset, so the running
        # countdown is the evidence the tap landed.
        by_id("timer_preset_2").click()
        running = by_id("timer_text").text
        assert re.match(r"^\d{2}:\d{2}$", running), 'timer_text was "%s"' % running

        by_id("play_pause_button").click()
        # The control's accessibility label flips with the timer's state, so
        # asserting on it keeps this step off the countdown's own clock.
        label = by_id("play_pause_button").get_dom_attribute("content-desc")
        assert label.startswith("Start"), 'paused control read "%s"' % label

        # Clearing the timer is what makes the script re-runnable: it ends on
        # the same screen it started from.
        by_id("delete_button").click()
        time.sleep(0.5)
        assert not driver.find_elements(
            "-android uiautomator",
            'new UiSelector().resourceId("%s:id/timer_text")' % APP_ID,
        ), "the cleared timer is still on screen"
        print("timer started, paused and cleared")
finally:
    driver.quit()
    devtools.wait_for_dashboard_close()  # hold the UI open to inspect
