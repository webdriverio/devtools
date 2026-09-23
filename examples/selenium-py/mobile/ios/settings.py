"""Mobile example for the Python adapter, iOS.

The Android example is a sibling script in ../android -- a separate file rather
than a branch, because the two platforms ship different apps and share no
selectors.

Drives **Settings**, not Clock. Clock is simply not installed on the iOS
simulator: `xcrun simctl listapps` lists Settings, Calendar, Reminders, Maps,
Safari and a handful more, and no `com.apple.mobiletimer`. Settings is on every
simulator and every real device, so this needs no .app, no upload and no
credentials -- the same property that makes Clock the Android choice.

VERIFIED ON: iOS Simulator `iPhone 17 Pro`, iOS 26.5 (23F77), Xcode 26.

    DEVTOOLS_MOBILE_PLATFORM=ios pnpm demo:python:mobile

Needs the Appium Python client, which the desktop examples do not:

    pip install -r examples/selenium-py/requirements-mobile.txt
"""

import json
import os
import re
import subprocess
import time

import selenium_devtools as devtools

try:
    from appium import webdriver
    from appium.options.ios import XCUITestOptions
except ImportError:  # noqa: BLE001 -- a missing optional dep, not a failure
    raise SystemExit(
        "this example needs the Appium client:\n"
        "    pip install -r examples/selenium-py/requirements-mobile.txt"
    )

APP_ID = "com.apple.Preferences"
APPIUM = "http://%s:%s" % (
    os.environ.get("APPIUM_HOST", "127.0.0.1"),
    os.environ.get("APPIUM_PORT", "4723"),
)


def booted_simulators():
    """Booted simulators as (name, udid). The JS examples read this through
    examples/mobile-preflight.cjs; reaching across languages for it costs more
    than the six lines it takes here."""
    try:
        out = subprocess.run(
            ["xcrun", "simctl", "list", "devices", "booted"],
            capture_output=True, text=True, timeout=15,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    pattern = re.compile(r"^\s*(.+?)\s+\(([0-9A-Fa-f-]{36})\)\s+\(Booted\)")
    return [
        (m.group(1), m.group(2))
        for m in (pattern.match(line) for line in out.splitlines())
        if m
    ]


def ios_device():
    """The simulator to drive, as a udid.

    By udid rather than by name, because naming one that does not exist does
    NOT fail: the XCUITest driver CREATES it and boots it, every run, beside
    the simulator already running. Defaults to whatever is already booted.
    """
    if os.environ.get("IOS_UDID"):
        return {"appium:udid": os.environ["IOS_UDID"]}
    booted = booted_simulators()
    wanted = os.environ.get("IOS_DEVICE_NAME")
    match = None
    if wanted:
        match = next((d for d in booted if d[0] == wanted), None)
    elif booted:
        match = booted[0]
    if match:
        return {"appium:udid": match[1], "appium:deviceName": match[0]}
    return {"appium:deviceName": wanted or "iPhone 17 Pro"}


def require_simulator():
    """A booted simulator, or say what is missing and stop."""
    if not booted_simulators():
        raise SystemExit(
            "\nNo iOS simulator is booted, so there is nothing to drive.\n\n"
            "  xcrun simctl list devices available\n"
            '  xcrun simctl boot "<device name>"\n'
        )


def capabilities():
    base = {
        "platformName": "iOS",
        "appium:automationName": "XCUITest",
        "appium:bundleId": APP_ID,
        "appium:noReset": True,
        "appium:newCommandTimeout": 300,
    }
    base.update(ios_device())
    version = os.environ.get("IOS_PLATFORM_VERSION")
    if version:
        base["appium:platformVersion"] = version
    return base


require_simulator()

# Trace by default, matching the desktop demos. The Python adapter takes a
# boolean rather than a mode name; DEVTOOLS_MODE=live is the shared switch.
devtools.enable(trace=os.environ.get("DEVTOOLS_MODE") != "live")

driver = webdriver.Remote(
    APPIUM, options=XCUITestOptions().load_capabilities(capabilities())
)


def nav_bar_title():
    """The navigation bar's title, which is how Settings says where it is."""
    bars = driver.find_elements("class name", "XCUIElementTypeNavigationBar")
    return bars[0].get_dom_attribute("name") or "" if bars else ""


try:
    # Terminated before activating, not merely activated: Settings remembers
    # the page the last run drilled into, so activating alone would start
    # somewhere unpredictable. This is what makes the script re-runnable.
    driver.execute_script("mobile: terminateApp", {"bundleId": APP_ID})
    driver.execute_script("mobile: activateApp", {"bundleId": APP_ID})
    opened = nav_bar_title()
    assert "Settings" in opened, 'Settings opened at "%s"' % opened

    driver.find_element("accessibility id", "General").click()
    for _ in range(30):
        if "General" in nav_bar_title():
            break
        time.sleep(0.5)
    assert "General" in nav_bar_title(), "Settings did not navigate to General"

    # Back through the navigation stack rather than a tap on the back button:
    # that button's accessibility id is the PARENT page's title, so tapping by
    # name hits whichever row happens to share it -- measured, it opened About.
    driver.back()
    for _ in range(30):
        if "Settings" in nav_bar_title():
            break
        time.sleep(0.5)
    assert "Settings" in nav_bar_title(), "Settings did not navigate back"
    print("navigated into General and back")
finally:
    driver.quit()
    devtools.wait_for_dashboard_close()  # hold the UI open to inspect
