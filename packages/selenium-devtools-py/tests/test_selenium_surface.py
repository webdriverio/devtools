"""The selenium surface this adapter reaches past the public API for.

`tests/test_bidi.py` runs entirely on fakes, which is right for the mapping
logic but means a selenium upgrade that moves any of these attributes passes CI
green and degrades at runtime — console and network capture simply stop. Selenium
PR 17761 regenerates the BiDi layer from a shared schema, so the move is likely
rather than hypothetical.

These assert against the INSTALLED selenium, so they fail loudly on a bump. They
check shape only — no browser, no session — because the point is to detect a
rename or relocation, not to test selenium's behaviour.

That prediction was already history when these first ran: selenium 4.44 shipped
the regenerated layer, and CI (which resolves a newer selenium than the local
python could install) failed on the first run, on a breakage that had already
shipped. The adapter now targets that layer, and these guard it.

Skipped below the version the package requires, rather than failing: the floor
is declared in `pyproject.toml`, and a developer whose environment predates it
should be told these did not run, not handed a wall of failures about attributes
their selenium was never going to have. CI installs from that floor, so they run
where they matter.

Skipped when selenium is absent. That is not free: the CI job must install the
adapter's own runtime dependency or these never run where they are meant to
protect. selenium is an OPTIONAL extra of this package, so the job must select it —
`pip install -e '.[test]'` in `.github/workflows/python.yml`. A plain
`pip install -e .` installs nothing and every guard here silently skips.
"""

import importlib.util
import inspect
import unittest

from selenium_devtools.constants import SELENIUM_MINIMUM_VERSION
from selenium_devtools.utils import selenium_version

_HAS_SELENIUM = importlib.util.find_spec("selenium") is not None
_BELOW_MINIMUM = selenium_version() < SELENIUM_MINIMUM_VERSION
_TOO_OLD = (
    f"selenium is below the {'.'.join(str(p) for p in SELENIUM_MINIMUM_VERSION)} "
    "this package requires"
)


@unittest.skipUnless(_HAS_SELENIUM, "selenium is not installed")
@unittest.skipIf(_BELOW_MINIMUM, _TOO_OLD)
class TestTheRegeneratedNetworkSurface(unittest.TestCase):
    """What `_subscribe_via_event_manager` needs to exist.

    `EVENT_CONFIGS` is a public class attribute and `add_event_handler` a public
    method, so this is a supported-API dependency rather than reaching inside.
    What is NOT public is that one deserializer is built per BiDi event and held
    in a map, which is what `_add_raw_event_handler` swaps and restores. That is
    the fragile part, and the shape assertions below are what would catch it
    changing."""

    def test_the_public_event_handler_api_is_present(self):
        from selenium.webdriver.common.bidi.network import Network

        self.assertTrue(callable(getattr(Network, "add_event_handler", None)))
        self.assertIsInstance(getattr(Network, "EVENT_CONFIGS", None), dict)

    def test_the_event_manager_carries_what_registration_calls(self):
        from selenium.webdriver.common.bidi._event_manager import _EventManager

        # `_add_raw_event_handler` is this class's own add_event_handler body
        # with the deserializer passed in rather than looked up, so it calls
        # exactly these. Private, and pinned for that reason.
        self.assertIn("conn", inspect.signature(_EventManager.__init__).parameters)
        for method in ("subscribe_to_event", "add_callback_to_tracking"):
            self.assertTrue(callable(getattr(_EventManager, method, None)), method)

    def test_the_connection_deserializes_per_callback(self):
        """The property the whole design rests on: `add_callback` closes over the
        deserializer it is HANDED. If it ever resolved one per event instead, the
        adapter could no longer keep raw params to itself and would be back to
        publishing its own into shared state."""
        from selenium.webdriver.remote.websocket_connection import WebSocketConnection

        source = inspect.getsource(WebSocketConnection.add_callback)

        # The callback body must call from_json on the passed-in event object.
        self.assertIn("event.from_json", source)
        self.assertIn("event.event_class", source)

    def test_the_generated_event_classes_are_still_lossy(self):
        """The reason raw `dict` configs are registered at all.

        If selenium ever models the full event, this fails and the registration
        can go — the typed object would then carry the request and timestamp. It
        failing is good news, not a break."""
        import dataclasses

        from selenium.webdriver.common.bidi.network import (
            BeforeRequestSentParameters,
        )

        if not dataclasses.is_dataclass(BeforeRequestSentParameters):
            self.skipTest("no longer a dataclass — registration needs rechecking")
        declared = {f.name for f in dataclasses.fields(BeforeRequestSentParameters)}
        self.assertNotIn("request", declared)
        self.assertNotIn("timestamp", declared)


@unittest.skipUnless(_HAS_SELENIUM, "selenium is not installed")
class TestTheChannelsThatSurvivedTheBiDiRegeneration(unittest.TestCase):
    """Console capture and the document-start preload go through `driver.script`,
    which 4.44's regeneration left alone. Deliberately NOT gated on the version
    floor, so these keep guarding on whatever selenium is installed."""

    def test_the_driver_exposes_the_bidi_channels(self):
        from selenium.webdriver.remote.webdriver import WebDriver

        # Properties on the class, so this needs no live session.
        self.assertIsInstance(getattr(WebDriver, "script", None), property)
        self.assertIsInstance(getattr(WebDriver, "network", None), property)

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
