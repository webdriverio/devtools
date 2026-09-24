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
# APPIUM_APP replaces Settings, so the Settings flow does not apply to it.
CUSTOM_APP = bool(os.environ.get("APPIUM_APP"))
IS_WEB = os.environ.get("DEVTOOLS_MOBILE") == "web"
# A simulator shares the host's network stack, so `localhost` here is this
# machine -- no `10.0.2.2` alias like the Android emulator needs.
WEB_URL = os.environ.get(
    "DEVTOOLS_MOBILE_URL", "https://the-internet.herokuapp.com/login"
)
APPIUM_HOST = os.environ.get("APPIUM_HOST", "127.0.0.1")
APPIUM = "http://%s:%s" % (APPIUM_HOST, os.environ.get("APPIUM_PORT", "4723"))
# Hosts whose devices this machine is expected to be able to see. A remote or
# cloud Appium drives devices `xcrun simctl` cannot enumerate, so the local
# checks below do not apply to it. Mirrors LOCAL_HOSTS in mobile-preflight.cjs.
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", "0.0.0.0"}


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

    Always a udid, never a bare name. Naming a simulator that does not exist
    does NOT fail: the XCUITest driver CREATES it and boots it, every run,
    beside the one already running. So an unmatched IOS_DEVICE_NAME is refused
    here rather than passed through -- a typo would otherwise pass the
    preflight (which only asks whether SOME simulator is booted) and quietly
    leave a new simulator behind on every run.

    Defaults to whatever is already booted. IOS_UDID names one outright and is
    not checked against the booted list, so a remote device, a real one, or a
    freshly created simulator can still be targeted deliberately.

    All of that is LOCAL policy. A remote or cloud Appium drives devices this
    machine cannot enumerate -- `xcrun simctl` lists local simulators and
    nothing else -- and naming one is how such a service selects it, so a name
    is passed straight through there. This mirrors `resolveIosDevice` in
    examples/mobile-preflight.cjs, which the three JS examples share.
    """
    if os.environ.get("IOS_UDID"):
        return {"appium:udid": os.environ["IOS_UDID"]}
    wanted = os.environ.get("IOS_DEVICE_NAME")
    if APPIUM_HOST not in LOCAL_HOSTS:
        return {"appium:deviceName": wanted} if wanted else {}
    booted = booted_simulators()
    if not booted:
        raise SystemExit(
            "\nNo iOS simulator is booted.\n"
            "  xcrun simctl list devices available\n"
            '  xcrun simctl boot "<device name>"\n'
        )
    if wanted:
        match = next((d for d in booted if d[0] == wanted), None)
        if not match:
            raise SystemExit(
                '\nIOS_DEVICE_NAME="%s" is not booted, and naming a simulator '
                "that does not exist makes Appium create one rather than "
                "fail.\n  booted now: %s\n"
                "  boot it first, or set IOS_UDID to target it deliberately.\n"
                % (wanted, ", ".join(d[0] for d in booted))
            )
        return {"appium:udid": match[1], "appium:deviceName": match[0]}
    return {"appium:udid": booted[0][1], "appium:deviceName": booted[0][0]}


def require_appium():
    """Appium answering, or say so and stop. `/status` is unauthenticated and
    cheap. Without this a server that is down arrives as a urllib stack trace
    from inside the client, which names neither the cause nor the fix -- the
    same reason the JS examples share examples/mobile-preflight.cjs."""
    import urllib.error
    import urllib.request

    try:
        with urllib.request.urlopen("%s/status" % APPIUM, timeout=2.5) as res:
            if res.status == 200:
                return
    except (urllib.error.URLError, OSError):
        pass
    raise SystemExit(
        "\nNothing is listening on %s, so Appium is not up.\n\n"
        "  appium --address %s --port %s\n\n"
        "iOS also needs the XCUITest driver, and Appium loads drivers at\n"
        "STARTUP -- so install it before starting the server:\n\n"
        "  appium driver install xcuitest\n"
        % (
            APPIUM,
            APPIUM_HOST,
            os.environ.get("APPIUM_PORT", "4723"),
        )
    )


def require_simulator():
    """A booted simulator, or say what is missing and stop.

    Skipped when the run names a device outright or drives a remote Appium:
    IOS_UDID may name a real device or one this machine cannot see at all, and
    `xcrun simctl` lists local simulators and nothing else -- so requiring one
    would refuse a run that is correctly configured.
    """
    if os.environ.get("IOS_UDID") or APPIUM_HOST not in LOCAL_HOSTS:
        return
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
        "appium:noReset": True,
        "appium:newCommandTimeout": 300,
    }
    base.update(ios_device())
    version = os.environ.get("IOS_PLATFORM_VERSION")
    if version:
        base["appium:platformVersion"] = version
    if IS_WEB:
        # Names a browser, so this session HAS a document and keeps its
        # page-side capture -- the distinction the native guards turn on.
        # Safari is driven by the XCUITest driver itself, where Chrome on
        # Android needs a matching chromedriver.
        base["browserName"] = "Safari"
    elif CUSTOM_APP:
        base["appium:app"] = os.environ["APPIUM_APP"]
    else:
        base["appium:bundleId"] = APP_ID
    return base


require_appium()
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
    if IS_WEB:
        # A mobile BROWSER session: it has a document, so every page-side call
        # a native session skips must still happen. That contrast is the point.
        driver.get(WEB_URL)
        assert driver.current_url.startswith("http"), driver.current_url
        print("loaded %s" % driver.current_url)
    elif CUSTOM_APP:
        # A supplied app has none of Settings' screens, so capture its
        # hierarchy rather than looking for ids that cannot exist.
        assert driver.page_source, "the view hierarchy was empty"
        print("captured the supplied app's hierarchy")
    else:
        # Terminated before activating, not merely activated: Settings
        # remembers the page the last run drilled into, so activating alone
        # would start somewhere unpredictable. This makes the script
        # re-runnable.
        driver.execute_script("mobile: terminateApp", {"bundleId": APP_ID})
        driver.execute_script("mobile: activateApp", {"bundleId": APP_ID})
        opened = nav_bar_title()
        assert "Settings" in opened, 'Settings opened at "%s"' % opened

        driver.find_element("accessibility id", "General").click()
        for _ in range(30):
            if "General" in nav_bar_title():
                break
            time.sleep(0.5)
        assert "General" in nav_bar_title(), "Settings did not reach General"

        # Back through the navigation stack rather than a tap on the back
        # button: that button's accessibility id is the PARENT page's title, so
        # tapping by name hits whichever row shares it -- measured, it opened
        # About.
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
