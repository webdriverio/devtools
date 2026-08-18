"""The selenium surface this adapter reaches past the public API for.

`tests/test_bidi.py` runs entirely on fakes, which is right for the mapping
logic but means a selenium upgrade that moves any of these attributes passes CI
green and degrades at runtime — console and network capture simply stop. Selenium
PR 17761 regenerates the BiDi layer from a shared schema, so the move is likely
rather than hypothetical.

These assert against the INSTALLED selenium, so they fail loudly on a bump. They
check shape only — no browser, no session — because the point is to detect a
rename or relocation, not to test selenium's behaviour.

Skipped when selenium is absent. That is not free: the CI job must install the
adapter's own runtime dependency or these never run where they are meant to
protect. selenium is an OPTIONAL extra of this package, so the job must select it —
`pip install -e '.[selenium]'` in `.github/workflows/python.yml`. A plain
`pip install -e .` installs nothing and every guard here silently skips.
"""

import importlib.util
import inspect
import unittest

_HAS_SELENIUM = importlib.util.find_spec("selenium") is not None


@unittest.skipUnless(_HAS_SELENIUM, "selenium is not installed")
class TestTheBiDiInternalsTheAdapterUses(unittest.TestCase):
    """`bidi.py` reaches through `driver.network.conn` to subscribe WITHOUT
    interception — selenium's high-level `add_request_handler` pauses requests,
    which would stall a user's page loads. That is a deliberate trade of public
    API for not breaking the page, and it is what these pin."""

    def test_the_driver_exposes_the_bidi_channels(self):
        from selenium.webdriver.remote.webdriver import WebDriver

        # Properties on the class, so this needs no live session.
        self.assertIsInstance(getattr(WebDriver, "script", None), property)
        self.assertIsInstance(getattr(WebDriver, "network", None), property)

    def test_the_network_channel_still_carries_the_low_level_connection(self):
        from selenium.webdriver.common.bidi.network import Network

        # `driver.network.conn` is the whole reason this module reaches inside.
        # Asserted against the constructed object rather than the source text:
        # what the adapter depends on is that `.conn` is reachable and is the
        # connection it was given, not how selenium happens to write the
        # assignment. A sentinel stands in for the connection — no session is
        # needed to answer the question.
        self.assertIn("conn", inspect.signature(Network.__init__).parameters)

        sentinel = object()
        self.assertIs(Network(sentinel).conn, sentinel)

    def test_the_event_and_session_types_are_where_the_adapter_imports_them(self):
        from selenium.webdriver.common.bidi.network import NetworkEvent
        from selenium.webdriver.common.bidi.session import Session

        # Constructed as `NetworkEvent(name)` and `Session(conn).subscribe(...)`.
        self.assertTrue(callable(NetworkEvent))
        self.assertTrue(hasattr(Session, "subscribe"))

    def test_the_console_channel_keeps_its_handler_api(self):
        from selenium.webdriver.common.bidi.script import Script

        for method in ("add_console_message_handler", "add_javascript_error_handler"):
            self.assertTrue(hasattr(Script, method), method)

    def test_pin_registers_a_preload_without_a_browsing_context(self):
        """The document-start preload depends on `pin()` registering GLOBALLY so
        documents created later are covered. Its docstring says "current
        browsing context", but it forwards no `contexts` and BiDi reads that as
        every context. Undocumented, so pinned: if selenium ever scopes `pin`,
        this fails instead of the preload silently covering only the first
        document."""
        from unittest import mock

        from selenium.webdriver.common.bidi.script import Script

        seen = {}

        def fake_add(self, function_declaration, *args, **kwargs):
            seen["args"] = args
            seen["kwargs"] = kwargs
            return "id"

        # A bare instance: constructing a real Script needs a live driver, and
        # only the dispatch from pin() to _add_preload_script is under test.
        script = Script.__new__(Script)
        with mock.patch.object(Script, "_add_preload_script", fake_add):
            script.pin("async () => {}")

        self.assertEqual(seen["args"], ())
        self.assertIsNone(seen["kwargs"].get("contexts"))


@unittest.skipUnless(_HAS_SELENIUM, "selenium is not installed")
class TestTheCapabilityTheAdapterInjects(unittest.TestCase):
    def test_the_bidi_capability_name_matches_selenium(self):
        # `_enable_bidi_capability` writes this into newSession capabilities, and
        # `options.web_socket_url = True` is how a user sets it. Both must mean
        # the same key or BiDi silently never opens.
        from selenium.webdriver.common.options import ArgOptions

        from selenium_devtools.constants import BIDI_CAPABILITY

        options = ArgOptions()
        options.web_socket_url = True

        self.assertIn(BIDI_CAPABILITY, options.to_capabilities())


if __name__ == "__main__":
    unittest.main()
