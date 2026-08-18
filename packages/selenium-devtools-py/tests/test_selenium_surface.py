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
can install) failed on the first run. `NetworkEvent` is gone from `bidi.network`
and `Network.conn` is now `_conn`, so network capture has been silently dead on
4.44+ — no error, just an empty Network tab behind one warning. The observe-only
replacement is `Network._event_manager.add_event_handler`, whose callback takes a
deserialized event object rather than `.params`, so adopting it is a port and not
a rename (issue #293). Until that lands the extra is capped below 4.44.

Skipped when selenium is absent. That is not free: the CI job must install the
adapter's own runtime dependency or these never run where they are meant to
protect. selenium is an OPTIONAL extra of this package, so the job must select it —
`pip install -e '.[selenium]'` in `.github/workflows/python.yml`. A plain
`pip install -e .` installs nothing and every guard here silently skips.
"""

import importlib.metadata
import importlib.util
import inspect
import unittest

_HAS_SELENIUM = importlib.util.find_spec("selenium") is not None

# selenium 4.44 regenerated the BiDi layer from a schema: `NetworkEvent` left
# `bidi.network` and `Network.conn` became `_conn`. `pyproject.toml` caps the
# extra below it for that reason; this is the same fact in the place a failure
# is read, so a run against a newer selenium says WHY rather than raising an
# ImportError and an AttributeError from two unrelated-looking tests.
FIRST_UNSUPPORTED_SELENIUM = (4, 44)


def _installed_selenium() -> tuple:
    """(major, minor) of the installed selenium, (0, 0) if unreadable."""
    try:
        raw = importlib.metadata.version("selenium")
    except importlib.metadata.PackageNotFoundError:
        return (0, 0)
    parts = []
    for chunk in raw.split(".")[:2]:
        digits = "".join(ch for ch in chunk if ch.isdigit())
        parts.append(int(digits) if digits else 0)
    return tuple(parts) if len(parts) == 2 else (0, 0)


_NETWORK_SURFACE_MOVED = _installed_selenium() >= FIRST_UNSUPPORTED_SELENIUM


@unittest.skipUnless(_HAS_SELENIUM, "selenium is not installed")
class TestTheSupportedSeleniumRange(unittest.TestCase):
    def test_the_installed_selenium_still_carries_the_network_surface(self):
        """One legible failure for the whole network breakage.

        The two guards below are skipped past the cap so this is the only thing
        that reports it — a reader gets the version and the reason, not two
        stack traces about a missing name and a missing attribute."""
        installed = _installed_selenium()

        self.assertLess(
            installed,
            FIRST_UNSUPPORTED_SELENIUM,
            f"selenium {'.'.join(str(p) for p in installed)} is at or past "
            f"{'.'.join(str(p) for p in FIRST_UNSUPPORTED_SELENIUM)}, which "
            "regenerated the BiDi layer: bidi.py subscribes to network events "
            "through NetworkEvent and Network.conn, and neither exists any "
            "more, so network capture silently degrades to nothing. Console "
            "capture and the preload are unaffected. Porting to the new "
            "_event_manager surface is issue #293; until then pyproject caps "
            "the selenium extra below this release.",
        )


@unittest.skipUnless(_HAS_SELENIUM, "selenium is not installed")
@unittest.skipIf(
    _NETWORK_SURFACE_MOVED,
    "selenium is past the supported range — TestTheSupportedSeleniumRange reports it",
)
class TestTheNetworkInternalsTheAdapterUses(unittest.TestCase):
    """`bidi.py` reaches through `driver.network.conn` to subscribe WITHOUT
    interception — selenium's `add_request_handler` registers an intercept even
    in its high-level style, which pauses each request until selenium continues
    it. That is a deliberate trade of public API for not stalling a user's page
    loads, and it is what these pin.

    Only this class is gated on the cap: the console, preload and driver-channel
    guards below still hold on newer selenium, and skipping them there would
    drop the coverage exactly where a bump is most likely to move something."""

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
