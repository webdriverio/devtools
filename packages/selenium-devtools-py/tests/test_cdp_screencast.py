"""Chrome's pushed frame stream.

No browser here: the CDP surface is a command object handed to
`connection.execute` and an event object handed to a callback, both of which a
fake models exactly, and the two seams that touch selenium are patched.

What the tests are really about is the handful of rules that make a pushed
stream work at all — it runs on a socket of its own rather than the one BiDi
took, every frame is acknowledged, and nothing raises out of the websocket's
reader thread.
"""

import types
import unittest
from unittest import mock

from selenium_devtools import cdp_screencast
from selenium_devtools.cdp_screencast import cdp_endpoint, start_push_screencast

BIDI_URL = "ws://localhost:9222/session/bidi"
CDP_URL = "ws://localhost:9222/devtools/page/1"


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


class FakeTarget:
    """`devtools.target`, for the attach handshake."""

    def get_targets(self):
        return ("get_targets", {})

    def attach_to_target(self, target_id, flatten):
        return ("attach", {"target_id": target_id})


class FakeConnection:
    def __init__(self, fail_on=None):
        self.executed = []
        self.callbacks = {}
        self.removed = []
        self.closed = 0
        self.session_id = None
        self._fail_on = fail_on
        self._next_id = 1

    def close(self):
        self.closed += 1

    def execute(self, command):
        name = command[0]
        if self._fail_on and name == self._fail_on:
            raise RuntimeError(f"{name} refused")
        self.executed.append(command)
        if name == "get_targets":
            return [
                types.SimpleNamespace(target_id="other-window"),
                types.SimpleNamespace(target_id="window-1"),
            ]
        if name == "attach":
            return "cdp-session-1"
        return None

    def add_callback(self, event, callback):
        self.callbacks[event.event_class] = callback
        cid, self._next_id = self._next_id, self._next_id + 1
        return cid

    def remove_callback(self, event, callback_id):
        self.removed.append((event.event_class, callback_id))

    # ── helpers ───────────────────────────────────────────────────────────────
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

    def args_of(self, command):
        return next(kw for name, kw in self.executed if name == command)


def fake_driver(*, cdp_url=CDP_URL, version="151.0"):
    """A driver reporting the capabilities selenium fills in for Chrome."""
    caps = {"webSocketUrl": BIDI_URL}
    if cdp_url is not None:
        caps["se:cdp"] = cdp_url
    if version is not None:
        caps["se:cdpVersion"] = version
    return types.SimpleNamespace(
        capabilities=caps,
        current_window_handle="window-1",
        command_executor=types.SimpleNamespace(client_config=None),
    )


class connected:
    """Patch the two selenium seams, so no browser and no socket are involved."""

    def __init__(self, connection, *, devtools_raises=False, connect_raises=False):
        self.connection = connection
        self.devtools_raises = devtools_raises
        self.connect_raises = connect_raises

    def __enter__(self):
        devtools = types.SimpleNamespace(page=FakePage(), target=FakeTarget())

        def load(version):
            if self.devtools_raises:
                raise RuntimeError(f"no bundled CDP for {version}")
            return devtools

        def open_conn(url, config):
            if self.connect_raises:
                raise OSError("connection refused")
            return self.connection

        self._patches = [
            mock.patch.object(cdp_screencast, "_load_devtools", load),
            mock.patch.object(cdp_screencast, "_open_connection", open_conn),
        ]
        for p in self._patches:
            p.start()
        return self

    def __exit__(self, *exc):
        for p in self._patches:
            p.stop()
        return False


def start(driver=None, sink=None, connection=None, running=True, **kwargs):
    """A started stream. `running=True` opens the pre-run gate, which the
    command hook opens for real when the test's first command begins — most
    tests here are about what happens DURING a run, so it is the default."""
    conn = connection if connection is not None else FakeConnection()
    with connected(conn, **kwargs):
        recorder = start_push_screencast(
            driver or fake_driver(), sink or (lambda d: None)
        )
    if recorder is not None and running:
        recorder.begin_run()
    return recorder


class TestItNeedsASocketOfItsOwn(unittest.TestCase):
    """The measured failure this module exists to avoid: selenium caches ONE
    websocket per driver and gives it to whichever of BiDi or CDP asks first.
    BiDi asks first (console + network), so a screencast that reused the cached
    connection sent `Page.startScreencast` to a BiDi endpoint and was told
    `unknown command`."""

    def test_the_bidi_socket_is_not_mistaken_for_a_cdp_one(self):
        driver = fake_driver(cdp_url=BIDI_URL)

        self.assertIsNone(cdp_endpoint(driver))
        self.assertIsNone(start(driver))

    def test_a_real_cdp_endpoint_is_used(self):
        version, url = cdp_endpoint(fake_driver())

        self.assertEqual((version, url), ("151", CDP_URL))

    def test_it_attaches_to_the_window_the_test_is_driving(self):
        # Not simply the first target the browser lists — Page.* would then
        # stream a tab nobody is looking at.
        conn = FakeConnection()

        start(connection=conn)

        self.assertEqual(conn.args_of("attach")["target_id"], "window-1")
        self.assertEqual(conn.session_id, "cdp-session-1")


class TestAvailabilityIsDiscovered(unittest.TestCase):
    """None is an ordinary answer — every non-Chromium browser gives it — so it
    must never raise and never warn."""

    def test_a_driver_reporting_no_cdp_declines(self):
        self.assertIsNone(start(fake_driver(cdp_url=None)))

    def test_a_driver_reporting_no_cdp_version_declines(self):
        self.assertIsNone(start(fake_driver(version=None)))

    def test_an_unbundled_protocol_version_declines(self):
        self.assertIsNone(start(devtools_raises=True))

    def test_a_socket_that_will_not_open_declines(self):
        self.assertIsNone(start(connect_raises=True))

    def test_a_refused_start_unwinds_without_asking_it_to_stop(self):
        # Leaving the callback live would keep feeding a stream nobody acks; and
        # asking the browser to stop a screencast it refused to start is what
        # turned one quiet decline into two alarming lines in the user's console.
        conn = FakeConnection(fail_on="start_screencast")

        self.assertIsNone(start(connection=conn))
        self.assertEqual(len(conn.removed), 1)
        self.assertNotIn("stop_screencast", conn.commands)
        self.assertEqual(conn.closed, 1)


class TestTheStreamStarts(unittest.TestCase):
    def test_it_subscribes_and_asks_the_browser_to_stream(self):
        conn = FakeConnection()

        recorder = start(connection=conn)

        self.assertIsNotNone(recorder)
        self.assertIn("Page.screencastFrame", conn.callbacks)
        self.assertIn("start_screencast", conn.commands)
        self.assertTrue(recorder.streaming)

    def test_it_throttles_and_bounds_frames_at_the_source(self):
        # Dropping frames in the browser beats buffering them here and throwing
        # them away later.
        conn = FakeConnection()

        start(connection=conn)
        kwargs = conn.args_of("start_screencast")

        self.assertEqual(
            kwargs["every_nth_frame"], cdp_screencast.DEFAULT_EVERY_NTH_FRAME
        )
        self.assertEqual(kwargs["max_width"], cdp_screencast.DEFAULT_MAX_EDGE)
        self.assertEqual(kwargs["format_"], "png")


class TestEveryFrameIsAcknowledged(unittest.TestCase):
    """Chrome sends nothing more after a frame it was not told about, so a
    missed ack does not degrade the recording — it ends it."""

    def test_a_frame_reaches_the_sink_and_is_acked(self):
        conn = FakeConnection()
        seen = []
        recorder = start(sink=seen.append, connection=conn)

        conn.push(data="ZnJhbWU=", session_id=42)

        self.assertEqual(seen, ["ZnJhbWU="])
        self.assertEqual(conn.acks, [42])
        self.assertEqual(recorder.frame_count, 1)

    def test_an_empty_frame_is_still_acked(self):
        conn = FakeConnection()
        seen = []
        recorder = start(sink=seen.append, connection=conn)

        conn.push(data="")

        self.assertEqual(seen, [])
        self.assertEqual(recorder.frame_count, 0)
        self.assertEqual(len(conn.acks), 1)

    def test_a_sink_that_raises_neither_escapes_nor_stops_the_stream(self):
        # This runs on the websocket's reader thread, where an exception takes
        # the whole connection down rather than one frame.
        conn = FakeConnection()

        def boom(_data):
            raise RuntimeError("buffer full")

        start(sink=boom, connection=conn)
        conn.push()  # must not raise

        self.assertEqual(len(conn.acks), 1)

    def test_frames_arriving_after_a_stop_are_ignored(self):
        conn = FakeConnection()
        seen = []
        recorder = start(sink=seen.append, connection=conn)
        recorder.stop()

        conn.push()

        self.assertEqual(seen, [])


class TestStopping(unittest.TestCase):
    def test_stop_ends_the_stream_unsubscribes_and_closes(self):
        conn = FakeConnection()
        recorder = start(connection=conn)

        recorder.stop()

        self.assertIn("stop_screencast", conn.commands)
        self.assertEqual(len(conn.removed), 1)
        self.assertEqual(conn.closed, 1)

    def test_stop_is_idempotent(self):
        conn = FakeConnection()
        recorder = start(connection=conn)

        recorder.stop()
        recorder.stop()

        self.assertEqual(conn.commands.count("stop_screencast"), 1)
        self.assertEqual(conn.closed, 1)

    def test_a_dead_session_does_not_raise_out_of_stop(self):
        conn = FakeConnection()
        recorder = start(connection=conn)
        conn._fail_on = "stop_screencast"

        recorder.stop()  # teardown must survive a session that already went away

        self.assertEqual(conn.closed, 1)


if __name__ == "__main__":
    unittest.main()


class TestALocalBrowserIsFoundThroughItsDebugger(unittest.TestCase):
    """`se:cdp` is a Grid capability. A chromedriver started on this machine
    does not set it, which is the common case — so without this route push mode
    would decline for every local run and the feature would be dead code."""

    VERSION_JSON = (
        b'{"Browser": "Chrome/151.0.7922.77",'
        b' "webSocketDebuggerUrl": "ws://127.0.0.1:53001/devtools/browser/abc"}'
    )

    def _driver(self, *, options_key="goog:chromeOptions", address="127.0.0.1:53001"):
        caps = {"webSocketUrl": BIDI_URL}
        if options_key:
            caps[options_key] = {"debuggerAddress": address} if address else {}
        return types.SimpleNamespace(
            capabilities=caps,
            current_window_handle="window-1",
            command_executor=types.SimpleNamespace(client_config=None),
        )

    def _with_debugger(self, payload=None):
        body = mock.MagicMock()
        body.read.return_value = self.VERSION_JSON if payload is None else payload
        body.__enter__ = lambda s: s
        body.__exit__ = lambda s, *a: False
        return mock.patch("urllib.request.urlopen", return_value=body)

    def test_the_endpoint_comes_from_the_debugger_address(self):
        with self._with_debugger():
            resolved = cdp_endpoint(self._driver())

        self.assertEqual(
            resolved, ("151", "ws://127.0.0.1:53001/devtools/browser/abc")
        )

    def test_edge_reports_it_under_its_own_key(self):
        with self._with_debugger():
            resolved = cdp_endpoint(self._driver(options_key="ms:edgeOptions"))

        self.assertIsNotNone(resolved)

    def test_no_debugger_address_declines_without_asking_the_network(self):
        with mock.patch("urllib.request.urlopen") as opened:
            self.assertIsNone(cdp_endpoint(self._driver(address=None)))
            self.assertIsNone(cdp_endpoint(self._driver(options_key=None)))

        opened.assert_not_called()

    def test_a_debugger_that_answers_nonsense_declines(self):
        with self._with_debugger(b'{"Browser": "?", "webSocketDebuggerUrl": null}'):
            self.assertIsNone(cdp_endpoint(self._driver()))

    def test_an_unreachable_debugger_does_not_raise_into_the_run(self):
        with mock.patch("urllib.request.urlopen", side_effect=OSError("refused")):
            self.assertIsNone(start(self._driver()))


class TestNoFrameFromBeforeTheRun(unittest.TestCase):
    """The video must start on a page the test actually drove.

    Chrome sends its current frame the moment `startScreencast` is accepted,
    and the stream is armed during session setup — before the first command
    runs — so on a fresh driver that frame is an unpainted `about:blank`.
    Nothing composites again until the destination paints, and the encoder
    holds every frame for its real inter-frame duration, so that one frame
    played for the whole opening navigation: 3-4s of blank on 4-6s videos.

    The per-command recorder hit this too and fixed it by taking no seed frame
    (`stop recording a frame of the page before the run`). A pushed stream
    cannot fix it that way, because the browser decides when to send — hence
    the gate.
    """

    def test_a_frame_pushed_before_the_first_command_is_dropped(self):
        conn = FakeConnection()
        seen = []
        recorder = start(sink=seen.append, connection=conn, running=False)

        conn.push(data="YWJvdXQ6Ymxhbms=", session_id=1)

        self.assertEqual(seen, [])
        self.assertEqual(recorder.frame_count, 0)

    # Dropping is not the same as ignoring: Chrome sends nothing further after
    # a frame it was not told about, so a dropped frame still has to be acked
    # or the recording ends here instead of skipping one frame.
    def test_a_dropped_frame_is_still_acknowledged(self):
        conn = FakeConnection()
        recorder = start(connection=conn, running=False)

        conn.push(data="YWJvdXQ6Ymxhbms=", session_id=7)

        self.assertEqual(conn.acks, [7])
        self.assertEqual(recorder.frame_count, 0)

    # The gate has to open AFTER the command, not before it. Opened before, the
    # opening navigation's own frames pass — and for those 3 seconds the page is
    # still the blank one, so the video began with exactly the blank this gate
    # exists to remove. Measured: first kept frame moved from ~0s to ~0.8s of a
    # 6s video, and the blank stayed.
    def test_the_seed_is_the_first_frame_so_the_video_starts_on_a_real_page(self):
        conn = FakeConnection()
        seen = []
        recorder = start(sink=seen.append, connection=conn, running=False)

        conn.push(data="Ymxhbms=", session_id=1)   # during the navigation
        recorder.begin_run(seed="bG9hZGVk")        # command returned
        conn.push(data="bmV4dA==", session_id=2)

        self.assertEqual(seen, ["bG9hZGVk", "bmV4dA=="])
        self.assertEqual(recorder.frame_count, 2)

    def test_only_the_first_call_seeds(self):
        # The hook calls begin_run after every command, not just the first.
        conn = FakeConnection()
        seen = []
        recorder = start(sink=seen.append, connection=conn, running=False)

        recorder.begin_run(seed="Zmlyc3Q=")
        recorder.begin_run(seed="c2Vjb25k")

        self.assertEqual(seen, ["Zmlyc3Q="])

    def test_no_seed_still_opens_the_gate(self):
        # A screenshot can fail; that must not leave the stream shut.
        conn = FakeConnection()
        seen = []
        recorder = start(sink=seen.append, connection=conn, running=False)

        recorder.begin_run(seed=None)
        conn.push(data="cGFnZQ==", session_id=1)

        self.assertEqual(seen, ["cGFnZQ=="])

    def test_frames_are_kept_once_the_first_command_begins(self):
        conn = FakeConnection()
        seen = []
        recorder = start(sink=seen.append, connection=conn, running=False)

        conn.push(data="Ymxhbms=", session_id=1)
        recorder.begin_run()
        conn.push(data="cGFnZQ==", session_id=2)

        self.assertEqual(seen, ["cGFnZQ=="])
        self.assertEqual(recorder.frame_count, 1)
        self.assertEqual(conn.acks, [1, 2])

    def test_begin_run_is_idempotent(self):
        # The command hook calls it on every command rather than tracking which
        # one was first.
        conn = FakeConnection()
        seen = []
        recorder = start(sink=seen.append, connection=conn, running=False)

        recorder.begin_run()
        recorder.begin_run()
        conn.push(data="cGFnZQ==", session_id=1)

        self.assertEqual(seen, ["cGFnZQ=="])
