"""What the capabilities say about the device and the document.

Mirrors `packages/shared/tests/device.test.ts` — the two implementations answer
the same question for the same bags, and a divergence here is a divergence in
what the two ends of a trace believe about the same session.
"""

import unittest

from selenium_devtools.device import (
    driver_is_native_app,
    is_native_app_session,
    native_platform,
)

LOCAL_ANDROID = {
    "platformName": "Android",
    "appium:deviceName": "Pixel_7_API_34",
    "appium:platformVersion": "14",
}
IOS = {
    "platformName": "iOS",
    "appium:automationName": "XCUITest",
    "appium:app": "/app.app",
}
MOBILE_WEB = {
    "platformName": "Android",
    "browserName": "Chrome",
    "appium:automationName": "Chrome",
}
DESKTOP = {"browserName": "chrome", "browserVersion": "152", "platform": "mac"}
CLOUD_NESTED_APP = {
    "bstack:options": {"platformName": "Android", "deviceName": "Google Pixel 7"}
}
CLOUD_NESTED_WEB = {
    "bstack:options": {
        "platformName": "Android",
        "deviceName": "Google Pixel 7",
        "browserName": "Chrome",
    }
}


class TestNativePlatform(unittest.TestCase):
    def test_it_names_the_two_native_platforms(self):
        self.assertEqual(native_platform(LOCAL_ANDROID), "android")
        self.assertEqual(native_platform(IOS), "ios")

    def test_a_desktop_session_has_none(self):
        self.assertIsNone(native_platform(DESKTOP))

    def test_it_reads_a_vendor_bag(self):
        self.assertEqual(native_platform(CLOUD_NESTED_APP), "android")

    def test_it_survives_a_bag_it_cannot_read(self):
        self.assertIsNone(native_platform(None))
        self.assertIsNone(native_platform("android"))
        self.assertIsNone(native_platform({}))


class TestIsNativeAppSession(unittest.TestCase):
    def test_true_when_the_session_named_no_browser(self):
        self.assertTrue(is_native_app_session(LOCAL_ANDROID))
        self.assertTrue(is_native_app_session(IOS))

    def test_false_when_it_named_one(self):
        # A phone driving Chrome has a real page; skipping its DOM capture is
        # the failure this predicate exists to avoid.
        self.assertFalse(is_native_app_session(MOBILE_WEB))

    def test_false_for_a_desktop_session(self):
        self.assertFalse(is_native_app_session(DESKTOP))

    def test_it_reads_both_facts_out_of_a_vendor_bag(self):
        self.assertTrue(is_native_app_session(CLOUD_NESTED_APP))
        self.assertFalse(is_native_app_session(CLOUD_NESTED_WEB))

    def test_true_for_an_appium_session_with_no_device_platform(self):
        # Mirrors the TS side: a Mac2 or tvOS session has no document either.
        self.assertTrue(
            is_native_app_session(
                {"platformName": "mac", "appium:automationName": "Mac2"}
            )
        )

    def test_a_blank_browser_name_is_no_browser(self):
        self.assertTrue(
            is_native_app_session({"platformName": "Android", "browserName": "   "})
        )

    def test_false_for_a_bag_it_cannot_read(self):
        self.assertFalse(is_native_app_session(None))
        self.assertFalse(is_native_app_session({}))


class TestDriverIsNativeApp(unittest.TestCase):
    class _Driver:
        def __init__(self, capabilities):
            self.capabilities = capabilities

    def test_it_reads_the_live_driver(self):
        self.assertTrue(driver_is_native_app(self._Driver(LOCAL_ANDROID)))
        self.assertFalse(driver_is_native_app(self._Driver(MOBILE_WEB)))

    def test_a_driver_exposing_nothing_is_not_native(self):
        self.assertFalse(driver_is_native_app(object()))


if __name__ == "__main__":
    unittest.main()
