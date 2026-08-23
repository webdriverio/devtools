"""Chrome's pushed frame stream.

No browser here: the CDP surface is a command object passed to
`connection.execute` and an event object handed to a callback, both of which a
fake models exactly. What the tests are really about is the two rules that make
a pushed stream work at all — every frame gets acknowledged, and nothing raises
out of the websocket's reader thread.
"""

import types
import unittest

from selenium_devtools import cdp_screencast
from selenium_devtools.cdp_screencast import start_push_screencast


class FakePage:
    """The generated `devtools.page` module, reduced to what we call."""

    class ScreencastFrame:
        event_class = "Page.screencastFrame"

    def start_screencast(self, **kwargs):
        return ("start_screencast", kwargs)

    def stop_screencast(self):
        return ("stop_screencast", {})

    def screencast_frame_ack(self, session_id):
        return ("ack", {"session_id": session_id})


class FakeConnection:
    def __init__(self, fail_on=None):
        self.executed = []
        self.callbacks = {}
        self.removed = []
        self._fail_on = fail_on
        self._next_id = 1

    def execute(self, command):
        name = command[0]
        if self._fail_on and name == self._fail_on:
            raise RuntimeError(f"{name} refused")
        self.executed.append(command)
        return None

    def add_callback(self, event, callback):
        self.callbacks[event.event_class] = callback
        cid, self._next_id = self._next_id, self._next_id + 1
        return cid

    def remove_callback(self, event, callback_id):
        self.removed.append((event.event_class, callback_id))

    # ── test helpers ──────────────────────────────────────────────────────────
    def push(self, data="aGk=", session_id=7):
        self.callbacks["Page.screencastFrame"](
            types.SimpleNamespace(data=data, session_id=session_id, metadata=None)
        )

    @property
    def commands(self):
        return [name for name, _ in self.executed]

    @property
    def acks(self):
        return [kw["session_id"] for name, kw in self.executed if name == "ack"]


def fake_driver(connection=None, *, raises=False, no_cdp=False):
    if no_cdp:
        return types.SimpleNamespace()
    devtools = types.SimpleNamespace(page=FakePage())
    conn = connection if connection is not None else FakeConnection()

    def start_devtools():
        if raises:
            raise RuntimeError("no CDP endpoint")
        return devtools, conn

    return types.SimpleNamespace(start_devtools=start_devtools)


class TestAvailabilityIsDiscovered(unittest.TestCase):
    """None is an ordinary answer — every non-Chromium browser gives it — so it
    must never raise and never warn."""

    def test_a_driver_without_cdp_declines(self):
        self.assertIsNone(start_push_screencast(fake_driver(no_cdp=True), print))

    def test_an_unreachable_cdp_endpoint_declines(self):
        self.assertIsNone(start_push_screencast(fake_driver(raises=True), print))

    def test_a_refused_start_declines_and_leaves_no_subscription(self):
        # Otherwise a callback stays live on a stream nobody is acking, and the
        # sink keeps taking frames the recording will never use.
        conn = FakeConnection(fail_on="start_screencast")

        self.assertIsNone(start_push_screencast(fake_driver(conn), print))
        self.assertEqual(len(conn.removed), 1)
        self.assertIn("stop_screencast", conn.commands)


class TestTheStreamStarts(unittest.TestCase):
    def test_it_subscribes_and_asks_the_browser_to_stream(self):
        conn = FakeConnection()

        recorder = start_push_screencast(fake_driver(conn), lambda d: None)

        self.assertIsNotNone(recorder)
        self.assertIn("Page.screencastFrame", conn.callbacks)
        self.assertIn("start_screencast", conn.commands)

    def test_it_throttles_and_bounds_frames_at_the_source(self):
        # Dropping frames in the browser beats buffering them here and throwing
        # them away later.
        conn = FakeConnection()

        start_push_screencast(fake_driver(conn), lambda d: None)

        (_, kwargs) = next(c for c in conn.executed if c[0] == "start_screencast")
        self.assertEqual(kwargs["every_nth_frame"], cdp_screencast.DEFAULT_EVERY_NTH_FRAME)
        self.assertEqual(kwargs["max_width"], cdp_screencast.DEFAULT_MAX_EDGE)
        self.assertEqual(kwargs["format_"], "png")


class TestEveryFrameIsAcknowledged(unittest.TestCase):
    """Chrome sends nothing more after a frame it was not told about, so a
    missed ack does not degrade the recording — it ends it."""

    def test_a_frame_reaches_the_sink_and_is_acked(self):
        conn = FakeConnection()
        seen = []
        recorder = start_push_screencast(fake_driver(conn), seen.append)

        conn.push(data="ZnJhbWU=", session_id=42)

        self.assertEqual(seen, ["ZnJhbWU="])
        self.assertEqual(conn.acks, [42])
        self.assertEqual(recorder.frame_count, 1)

    def test_an_empty_frame_is_still_acked(self):
        conn = FakeConnection()
        seen = []
        recorder = start_push_screencast(fake_driver(conn), seen.append)

        conn.push(data="")

        self.assertEqual(seen, [])
        self.assertEqual(recorder.frame_count, 0)
        self.assertEqual(len(conn.acks), 1)

    def test_a_sink_that_raises_neither_escapes_nor_stops_the_stream(self):
        # This runs on the websocket's reader thread; an exception there takes
        # the whole connection down, not just one frame.
        conn = FakeConnection()

        def boom(_data):
            raise RuntimeError("buffer full")

        start_push_screencast(fake_driver(conn), boom)

        conn.push()  # must not raise

        self.assertEqual(len(conn.acks), 1)

    def test_frames_arriving_after_a_stop_are_ignored(self):
        conn = FakeConnection()
        seen = []
        recorder = start_push_screencast(fake_driver(conn), seen.append)
        recorder.stop()

        conn.push()

        self.assertEqual(seen, [])


class TestStopping(unittest.TestCase):
    def test_stop_ends_the_stream_and_unsubscribes(self):
        conn = FakeConnection()
        recorder = start_push_screencast(fake_driver(conn), lambda d: None)

        recorder.stop()

        self.assertIn("stop_screencast", conn.commands)
        self.assertEqual(len(conn.removed), 1)

    def test_stop_is_idempotent(self):
        conn = FakeConnection()
        recorder = start_push_screencast(fake_driver(conn), lambda d: None)

        recorder.stop()
        recorder.stop()

        self.assertEqual(conn.commands.count("stop_screencast"), 1)

    def test_a_dead_session_does_not_raise_out_of_stop(self):
        conn = FakeConnection()
        recorder = start_push_screencast(fake_driver(conn), lambda d: None)
        conn._fail_on = "stop_screencast"

        recorder.stop()  # teardown must survive a session that already went away


if __name__ == "__main__":
    unittest.main()
