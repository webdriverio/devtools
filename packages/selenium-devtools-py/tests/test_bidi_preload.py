"""Document-start registration of the collector, and the channel it pushes down.

A `<script>`-append can only instrument the document that exists when it runs,
and dies with it — so every navigation yields a document we learn about after the
fact. A preload runs in EVERY document before that document's own script, which
removes the whole class of "when do we re-inject / who owns this DOM" races.

The same registration can hand the page a BiDi channel to emit its mutations on.
That is what removes the per-command drain: a drain is a synchronous round trip
on the user's command path, and the buffer it reads is empty once the page pushes.
"""

import unittest
from unittest import mock

from selenium_devtools import bidi_preload
from selenium_devtools._contract import (
    COLLECTOR_MUTATION_CHANNEL,
    COLLECTOR_SINK_GLOBAL,
)
from selenium_devtools.snapshot import SnapshotCapturer

#: Stands in for the built collector. It carries the sink global's NAME because
#: that is what marks a build able to push — the adapter refuses to open a
#: channel a collector would never claim, and keeps draining instead.
COLLECTOR = f'window["{COLLECTOR_SINK_GLOBAL}"]; COLLECTOR'
#: A collector built before the channel existed.
OLD_COLLECTOR = "COLLECTOR"


class FakeScript:
    def __init__(self, raises=None, subscribe_raises=None):
        self.preloads = []  # (declaration, arguments)
        self.handlers = {}  # callback id -> (event, callback)
        self.removed = []
        self._raises = raises
        self._subscribe_raises = subscribe_raises
        self._next_id = 0  # selenium numbers callbacks from zero

    def add_preload_script(self, function_declaration=None, arguments=None, **_kw):
        if self._raises:
            raise self._raises
        self.preloads.append((function_declaration, arguments))
        return {"script": "preload-id"}

    def add_event_handler(self, event, callback, contexts=None):
        if self._subscribe_raises:
            raise self._subscribe_raises
        callback_id = self._next_id
        self._next_id += 1
        self.handlers[callback_id] = (event, callback)
        return callback_id

    def remove_event_handler(self, event, callback_id):
        self.removed.append((event, callback_id))
        self.handlers.pop(callback_id, None)

    def emit(self, message):
        """Deliver one script.message to every subscriber, as selenium does."""
        for _event, callback in list(self.handlers.values()):
            callback(message)


class FakeDriver:
    def __init__(self, caps=None, script=None):
        self.caps = caps if caps is not None else {"webSocketUrl": "ws://x"}
        self._script = script or FakeScript()

    @property
    def script(self):
        return self._script


class Message:
    """A `script.message` as selenium hands it over: attributes, not keys."""

    def __init__(self, channel, value):
        self.channel = channel
        self.data = {"type": "string", "value": value}
        self.source = {}


class TestRegistering(unittest.TestCase):
    def test_registers_the_collector_as_a_function_declaration(self):
        # A preload script IS a function, so the bundle's top-level await works
        # in its body — unlike the `<script>` path, which needs the async IIFE.
        driver = FakeDriver()

        result = bidi_preload.register_collector_preload(driver, "COLLECTOR")

        self.assertTrue(result.registered)
        self.assertFalse(result.pushing)  # no sink asked for, so no channel
        self.assertEqual(
            driver.script.preloads, [("async () => { COLLECTOR }", None)]
        )

    def test_a_session_without_the_bidi_capability_falls_back(self):
        # No webSocketUrl means driver.script cannot open. The `<script>` path
        # still captures DOM, just with the races the preload removes.
        driver = FakeDriver(caps={})

        result = bidi_preload.register_collector_preload(
            driver, COLLECTOR, lambda _m: None
        )

        self.assertFalse(result.registered)
        self.assertFalse(result.pushing)
        self.assertEqual(driver.script.handlers, {})  # nothing subscribed either

    def test_a_selenium_failure_falls_back_with_a_reason(self):
        driver = FakeDriver(script=FakeScript(raises=RuntimeError("no bidi")))

        with self.assertLogs("selenium_devtools.preload", level="WARNING") as logs:
            result = bidi_preload.register_collector_preload(driver, "COLLECTOR")

        self.assertFalse(result.registered)
        self.assertIn("falling back to per-document injection", "\n".join(logs.output))


class TestTheChannelTheCollectorPushesDown(unittest.TestCase):
    def test_the_sink_is_parked_before_the_source_runs(self):
        # The collector claims the sink in its own module body, which runs before
        # the observer setup and the document anchor. Handed to the source as an
        # argument instead, the anchor — the first and largest payload of a
        # document's life — would already have been buffered.
        driver = FakeDriver()

        result = bidi_preload.register_collector_preload(
            driver, COLLECTOR, lambda _m: None
        )

        self.assertTrue(result.pushing)
        declaration, arguments = driver.script.preloads[0]
        self.assertEqual(
            declaration,
            f'async (emit) => {{ window["{COLLECTOR_SINK_GLOBAL}"] = emit; '
            f"{COLLECTOR} }}",
        )
        self.assertEqual(
            arguments,
            [{"type": "channel", "value": {"channel": COLLECTOR_MUTATION_CHANNEL}}],
        )

    def test_a_zero_callback_id_still_counts_as_subscribed(self):
        # Selenium numbers callbacks from zero, so the first subscription's id is
        # falsy. Read as a boolean it would report a session as non-pushing and
        # keep draining a buffer nothing writes to.
        driver = FakeDriver()

        result = bidi_preload.register_collector_preload(
            driver, COLLECTOR, lambda _m: None
        )

        self.assertEqual(sorted(driver.script.handlers), [0])
        self.assertTrue(result.pushing)

    def test_a_failed_subscribe_keeps_the_preload_and_the_drain(self):
        # Losing the push costs a round trip per command; losing the preload
        # would bring back the whole race class it exists to remove.
        driver = FakeDriver(
            script=FakeScript(subscribe_raises=RuntimeError("no channel"))
        )

        with self.assertLogs("selenium_devtools.preload", level="WARNING") as logs:
            result = bidi_preload.register_collector_preload(
                driver, COLLECTOR, lambda _m: None
            )

        self.assertTrue(result.registered)
        self.assertFalse(result.pushing)
        self.assertEqual(
            driver.script.preloads, [(f"async () => {{ {COLLECTOR} }}", None)]
        )
        self.assertIn("draining instead", "\n".join(logs.output))

    def test_a_collector_that_cannot_push_is_never_given_a_channel(self):
        # The caller stops draining once a channel is open, so a build that never
        # claims the sink must not get one: every mutation would sit in a buffer
        # nobody reads and DOM replay would go silent.
        driver = FakeDriver()

        with self.assertLogs("selenium_devtools.preload", level="INFO") as logs:
            result = bidi_preload.register_collector_preload(
                driver, OLD_COLLECTOR, lambda _m: None
            )

        self.assertTrue(result.registered)
        self.assertFalse(result.pushing)
        self.assertEqual(driver.script.handlers, {})
        self.assertEqual(
            driver.script.preloads, [(f"async () => {{ {OLD_COLLECTOR} }}", None)]
        )
        self.assertIn("cannot push", "\n".join(logs.output))

    def test_a_failed_registration_unwinds_its_subscription(self):
        # Left behind it is not inert: selenium counts callbacks per event to
        # decide when a subscription is still needed, so an abandoned one keeps
        # script.message flowing to a handler that can never receive anything.
        driver = FakeDriver(script=FakeScript(raises=RuntimeError("no preload")))

        with self.assertLogs("selenium_devtools.preload", level="WARNING"):
            result = bidi_preload.register_collector_preload(
                driver, COLLECTOR, lambda _m: None
            )

        self.assertFalse(result.registered)
        self.assertEqual(driver.script.removed, [("message", 0)])
        self.assertEqual(driver.script.handlers, {})


class TestCanPush(unittest.TestCase):
    """The predicate alone — the wheel and the backend that serves the collector
    version independently, so this is what keeps an older pairing on the drain."""

    def test_a_build_that_names_the_sink_can_push(self):
        self.assertTrue(bidi_preload.can_push(COLLECTOR))

    def test_a_build_that_does_not_cannot(self):
        self.assertFalse(bidi_preload.can_push(OLD_COLLECTOR))


class TestPushedBatches(unittest.TestCase):
    """What arrives on the channel, and what must not be mistaken for it."""

    def setUp(self):
        self.seen = []
        self.driver = FakeDriver()
        bidi_preload.register_collector_preload(
            self.driver, COLLECTOR, self.seen.append
        )

    def test_a_batch_on_our_channel_is_forwarded(self):
        self.driver.script.emit(
            Message(COLLECTOR_MUTATION_CHANNEL, '[{"type":"childList"}]')
        )

        self.assertEqual(self.seen, [[{"type": "childList"}]])

    def test_a_dict_shaped_message_is_read_the_same_way(self):
        # Selenium builds a dataclass and falls back to the raw params dict when
        # that fails, so both shapes reach the handler.
        self.driver.script.emit(
            {
                "channel": COLLECTOR_MUTATION_CHANNEL,
                "data": {"type": "string", "value": '[{"type":"attributes"}]'},
            }
        )

        self.assertEqual(self.seen, [[{"type": "attributes"}]])

    def test_another_subscriber_channel_is_ignored(self):
        # Every subscriber on a session sees every script.message, so the channel
        # name is what makes one ours.
        self.driver.script.emit(Message("selenium.domMutation.abc", "[{}]"))

        self.assertEqual(self.seen, [])

    def test_an_empty_batch_is_not_forwarded(self):
        self.driver.script.emit(Message(COLLECTOR_MUTATION_CHANNEL, "[]"))

        self.assertEqual(self.seen, [])

    def test_a_non_string_payload_is_ignored(self):
        # The payload is a JSON string by design: BiDi serializes a channel
        # argument as a RemoteValue under an object-depth limit, which would
        # truncate the document anchor. Anything else is not ours to read.
        message = Message(COLLECTOR_MUTATION_CHANNEL, None)
        message.data = {"type": "array", "value": [{"type": "number", "value": 1}]}

        self.driver.script.emit(message)

        self.assertEqual(self.seen, [])

    def test_an_unparseable_payload_warns_and_drops(self):
        with self.assertLogs("selenium_devtools.preload", level="WARNING") as logs:
            self.driver.script.emit(Message(COLLECTOR_MUTATION_CHANNEL, "{not json"))

        self.assertEqual(self.seen, [])
        self.assertIn("unparseable mutation payload", "\n".join(logs.output))

    def test_a_payload_that_is_not_a_batch_is_ignored(self):
        self.driver.script.emit(
            Message(COLLECTOR_MUTATION_CHANNEL, '{"mutations":[]}')
        )

        self.assertEqual(self.seen, [])

    def test_a_throwing_sink_does_not_escape_the_handler(self):
        # This runs on selenium's WebSocket reader thread, which also dispatches
        # console and network events — an exception there would take those down.
        driver = FakeDriver()

        def explode(_mutations):
            raise RuntimeError("transport gone")

        bidi_preload.register_collector_preload(driver, COLLECTOR, explode)

        with self.assertLogs("selenium_devtools.preload", level="WARNING") as logs:
            driver.script.emit(Message(COLLECTOR_MUTATION_CHANNEL, "[{}]"))

        self.assertIn("transport gone", "\n".join(logs.output))


class TestTheScriptPathIsGatedNotDeleted(unittest.TestCase):
    """The `<script>` path is the only capture without BiDi, so it stays — it is
    simply not used when a preload already installed the collector everywhere."""

    def test_a_preloaded_capturer_injects_nothing(self):
        calls = {"n": 0}

        def execute(*_args):
            calls["n"] += 1
            return True

        capturer = SnapshotCapturer(execute, preloaded=True)

        self.assertTrue(capturer.injected)  # present from document-start
        self.assertTrue(capturer.inject())
        self.assertEqual(calls["n"], 0)  # no probe, no injection

    def test_without_a_preload_the_script_path_still_runs(self):
        calls = {"n": 0}

        def execute(*_args):
            calls["n"] += 1
            return True

        capturer = SnapshotCapturer(execute, script_path=None, preloaded=False)
        with mock.patch(
            "selenium_devtools.snapshot.load_injectable_script", return_value="SRC"
        ):
            self.assertTrue(capturer.inject())

        self.assertGreater(calls["n"], 0)


class TestADocumentThePreloadMissed(unittest.TestCase):
    """A preload covers every document in principle, but its script can throw,
    and a document can predate registration. With the preload registered nothing
    probes any more, so the drain's own null is the only signal that a document
    has no collector — and it has to act on it."""

    def test_the_drain_recovers_a_document_without_a_collector(self):
        state = {"present": False}
        seen = []

        def execute(script, *_args):
            seen.append(script)
            if "createElement" in script:
                state["present"] = True
                return True
            if "getTraceData" in script:
                return {"mutations": [{"type": "childList"}]} if state["present"] else None
            return state["present"]  # readiness probe

        capturer = SnapshotCapturer(execute, preloaded=True)
        with mock.patch(
            "selenium_devtools.snapshot.load_injectable_script", return_value="SRC"
        ):
            mutations = capturer.pull_mutations()

        self.assertEqual(len(mutations), 1)  # recovered rather than silently empty
        self.assertTrue(any("createElement" in s for s in seen))

    def test_a_healthy_preloaded_document_is_not_reinstalled(self):
        # Recovery must cost nothing on the happy path — the drain already
        # happens, and a document that answers needs no <script> at all.
        seen = []

        def execute(script, *_args):
            seen.append(script)
            return {"mutations": []}

        capturer = SnapshotCapturer(execute, preloaded=True)
        capturer.pull_mutations()

        self.assertEqual([s for s in seen if "createElement" in s], [])


# The global-registration guard this depends on lives with the rest of the
# selenium surface, in test_selenium_surface.py.


if __name__ == "__main__":
    unittest.main()
