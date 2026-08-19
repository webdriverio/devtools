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
the regenerated layer, and CI (which resolves a newer selenium than a local 3.9
can install) failed on the first run, on a breakage that had already shipped.

`bidi.py` now has a path for each surface, so BOTH are guarded here and which
class applies is decided by the installed version. Neither is optional: whichever
one the installed selenium presents is the only thing standing between a working
Network tab and an empty one.

Skipped when selenium is absent. That is not free: the CI job must install the
adapter's own runtime dependency or these never run where they are meant to
protect. selenium is an OPTIONAL extra of this package, so the job must select it —
`pip install -e '.[test]'` in `.github/workflows/python.yml`. A plain
`pip install -e .` installs nothing and every guard here silently skips.
"""

import importlib.util
import inspect
import unittest

from selenium_devtools.constants import SELENIUM_NETWORK_SURFACE_MOVED_AT
from selenium_devtools.utils import selenium_version

_HAS_SELENIUM = importlib.util.find_spec("selenium") is not None

# The version fact itself lives in constants.py, because bidi.py needs it too —
# it is what turns the runtime degradation into a warning naming the version.
_NETWORK_SURFACE_MOVED = selenium_version() >= SELENIUM_NETWORK_SURFACE_MOVED_AT


@unittest.skipUnless(_HAS_SELENIUM, "selenium is not installed")
@unittest.skipIf(not _NETWORK_SURFACE_MOVED, "selenium predates the regenerated layer")
class TestTheRegeneratedNetworkSurface(unittest.TestCase):
    """selenium 4.44+ — what `_subscribe_via_event_manager` needs to exist.

    `EVENT_CONFIGS` is a public class attribute and `add_event_handler` a public
    method, so this is a supported-API dependency rather than reaching inside.
    What is NOT public is that one deserializer is built per BiDi event at
    `Network.__init__`, which is why registering a `dict` config wins and why it
    must happen before the first `driver.network`. That is the fragile part, and
    the shape assertions below are what would catch it changing."""

    def test_the_public_event_handler_api_is_present(self):
        from selenium.webdriver.common.bidi.network import Network

        self.assertTrue(callable(getattr(Network, "add_event_handler", None)))
        self.assertIsInstance(getattr(Network, "EVENT_CONFIGS", None), dict)

    def test_event_configs_carry_the_two_events_capture_needs(self):
        from selenium.webdriver.common.bidi.network import Network

        from selenium_devtools.constants import (
            BIDI_NET_BEFORE_REQUEST,
            BIDI_NET_RESPONSE_COMPLETED,
        )

        # Registration reuses selenium's own EventConfig shape, so the names it
        # subscribes by have to be the ones selenium routes on.
        wired = {config.bidi_event for config in Network.EVENT_CONFIGS.values()}
        self.assertIn(BIDI_NET_BEFORE_REQUEST, wired)
        self.assertIn(BIDI_NET_RESPONSE_COMPLETED, wired)

    def test_event_config_takes_the_three_fields_registration_supplies(self):
        from selenium.webdriver.common.bidi.network import EventConfig

        config = EventConfig("k", "network.responseCompleted", dict)

        self.assertEqual(config.event_key, "k")
        self.assertEqual(config.bidi_event, "network.responseCompleted")
        self.assertIs(config.event_class, dict)

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
@unittest.skipIf(_NETWORK_SURFACE_MOVED, "selenium uses the regenerated surface")
class TestThePreRegenerationNetworkInternals(unittest.TestCase):
    """selenium ≤4.43 — what `_subscribe_via_connection` needs to exist.

    It reaches through `driver.network.conn` because every selenium API that
    takes a request or response handler registers an intercept, which pauses
    each request until selenium continues it. On these versions there is no
    observe-only alternative, so the private access is the price of not
    changing the timing of the page under test.

    Gated to versions where this path actually runs. The console, preload and
    driver-channel guards below are gated on nothing, because they hold on every
    version and skipping them would drop coverage where a bump is most likely to
    move something."""

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


@unittest.skipUnless(_HAS_SELENIUM, "selenium is not installed")
class TestTheChannelsThatSurvivedTheBiDiRegeneration(unittest.TestCase):
    """Console capture and the document-start preload go through `driver.script`,
    which 4.44's regeneration left alone. Deliberately NOT gated on the cap, so
    these keep guarding on whatever selenium is installed."""

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
