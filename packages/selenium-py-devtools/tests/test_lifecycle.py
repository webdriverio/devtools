"""Unit tests for the dashboard browser-window lifecycle.

These never spawn a real browser or exit the process: the opener is injected,
and the shutdown path's hard-exit timer is asserted on rather than run.
"""

import os
import threading
import unittest
from unittest import mock

from wdio_selenium_devtools import lifecycle
from wdio_selenium_devtools.lifecycle import BrowserHandle


class FakeProc:
    """Minimal subprocess.Popen stand-in for BrowserHandle.close()."""

    def __init__(self, alive=True):
        self._alive = alive
        self.terminated = False
        self.killed = False

    def poll(self):
        return None if self._alive else 0

    def terminate(self):
        self.terminated = True
        self._alive = False

    def wait(self, timeout=None):
        return 0

    def kill(self):
        self.killed = True
        self._alive = False


class TestBrowserHandle(unittest.TestCase):
    def test_close_terminates_proc_and_removes_profile(self):
        proc = FakeProc()
        with mock.patch.object(lifecycle.shutil, "rmtree") as rmtree:
            handle = BrowserHandle(proc=proc, user_data_dir="/tmp/fake-dir")
            handle.close()
        self.assertTrue(proc.terminated)
        rmtree.assert_called_once_with("/tmp/fake-dir", ignore_errors=True)

    def test_close_is_idempotent(self):
        proc = FakeProc()
        handle = BrowserHandle(proc=proc)
        handle.close()
        proc.terminated = False
        handle.close()  # second call is a no-op
        self.assertFalse(proc.terminated)

    def test_close_on_empty_handle_is_safe(self):
        BrowserHandle().close()  # no proc, no dir — must not raise


class TestOpenDashboard(unittest.TestCase):
    def test_uses_injected_opener(self):
        sentinel = BrowserHandle()
        opener = mock.Mock(return_value=sentinel)
        result = lifecycle.open_dashboard("http://localhost:3000", opener=opener)
        opener.assert_called_once_with("http://localhost:3000")
        self.assertIs(result, sentinel)

    def test_none_url_returns_none_without_opening(self):
        opener = mock.Mock()
        self.assertIsNone(lifecycle.open_dashboard(None, opener=opener))
        opener.assert_not_called()

    def test_opener_failure_is_swallowed(self):
        opener = mock.Mock(side_effect=OSError("boom"))
        self.assertIsNone(
            lifecycle.open_dashboard("http://x", opener=opener)
        )


class TestDefaultOpener(unittest.TestCase):
    """Guard the launch flags that keep the dashboard in its own Chrome window.

    Never spawns a real browser: Popen, mkdtemp, and Chrome discovery are mocked.
    """

    def test_launches_isolated_dedicated_window(self):
        fake_proc = FakeProc()
        with mock.patch.object(
                lifecycle, "_find_chrome", return_value="/fake/Chrome"), \
                mock.patch.object(
                    lifecycle.tempfile, "mkdtemp",
                    return_value="/tmp/selenium-py-devtools-ui-x"), \
                mock.patch.object(
                    lifecycle.subprocess, "Popen",
                    return_value=fake_proc) as popen:
            handle = lifecycle._default_opener("http://localhost:3000")

        args = popen.call_args.args[0]
        # A distinct --user-data-dir is what forces a separate Chrome instance
        # (cannot merge into the user's running Chrome).
        self.assertIn(
            "--user-data-dir=/tmp/selenium-py-devtools-ui-x", args)
        self.assertIn("--new-window", args)
        self.assertIn("--app=http://localhost:3000", args)
        self.assertEqual(args[0], "/fake/Chrome")
        # The URL is not passed as a bare arg (that would open an extra tab).
        self.assertNotIn("http://localhost:3000", args)
        self.assertIs(handle.proc, fake_proc)
        self.assertEqual(
            handle.user_data_dir, "/tmp/selenium-py-devtools-ui-x")

    def test_chrome_not_found_returns_empty_handle_without_spawning(self):
        with mock.patch.object(lifecycle, "_find_chrome", return_value=None), \
                mock.patch.object(lifecycle.subprocess, "Popen") as popen:
            handle = lifecycle._default_opener("http://localhost:3000")
        popen.assert_not_called()  # never crash, never spawn
        self.assertIsNone(handle.proc)
        self.assertIsNone(handle.user_data_dir)
        handle.close()  # empty handle stays safe to close


class TestAutoOpenEnabled(unittest.TestCase):
    def setUp(self):
        self._saved = os.environ.get(lifecycle.ENV_OPEN)
        os.environ.pop(lifecycle.ENV_OPEN, None)

    def tearDown(self):
        if self._saved is None:
            os.environ.pop(lifecycle.ENV_OPEN, None)
        else:
            os.environ[lifecycle.ENV_OPEN] = self._saved

    def test_env_falsy_disables(self):
        for val in ("0", "false", "no", "off", ""):
            os.environ[lifecycle.ENV_OPEN] = val
            self.assertFalse(lifecycle.auto_open_enabled(), val)

    def test_env_truthy_enables(self):
        for val in ("1", "true", "yes", "on", "  YES  "):
            os.environ[lifecycle.ENV_OPEN] = val
            self.assertTrue(lifecycle.auto_open_enabled(), val)

    def test_defaults_on_when_unset(self):
        # Regardless of TTY: unset means open (opt-out design). A non-TTY IDE /
        # `python demo.py` run must still auto-open into a dedicated window.
        os.environ.pop(lifecycle.ENV_OPEN, None)
        with mock.patch.object(lifecycle.sys.stdout, "isatty", return_value=False):
            self.assertTrue(lifecycle.auto_open_enabled())
        with mock.patch.object(lifecycle.sys.stdout, "isatty", return_value=True):
            self.assertTrue(lifecycle.auto_open_enabled())


class TestShutdownFlow(unittest.TestCase):
    def setUp(self):
        lifecycle._reset_for_tests()

    def tearDown(self):
        lifecycle._reset_for_tests()

    def test_client_disconnected_disables_and_schedules_exit(self):
        disable = mock.Mock()
        handle = BrowserHandle(proc=FakeProc())
        # register without touching real signals: not on the main thread guard
        # not needed here — we call the internals directly.
        lifecycle._disable = disable
        lifecycle._handle = handle

        with mock.patch.object(lifecycle.threading, "Timer") as Timer:
            lifecycle.on_control("clientDisconnected", {})
            Timer.assert_called_once()  # a hard-exit was scheduled
            timer = Timer.return_value
            self.assertTrue(timer.start.called)

        disable.assert_called_once()  # capture torn down
        self.assertTrue(handle._closed)  # window closed

    def test_client_connected_is_noop(self):
        disable = mock.Mock()
        lifecycle._disable = disable
        with mock.patch.object(lifecycle.threading, "Timer") as Timer:
            lifecycle.on_control("clientConnected", {})
            Timer.assert_not_called()
        disable.assert_not_called()

    def test_shutdown_runs_once(self):
        disable = mock.Mock()
        lifecycle._disable = disable
        with mock.patch.object(lifecycle.threading, "Timer"):
            lifecycle.on_control("clientDisconnected", {})
            lifecycle.on_control("clientDisconnected", {})
        disable.assert_called_once()  # guard prevents re-entry

    def test_disable_errors_do_not_propagate(self):
        lifecycle._disable = mock.Mock(side_effect=RuntimeError("bad"))
        with mock.patch.object(lifecycle.threading, "Timer"):
            lifecycle.on_control("clientDisconnected", {})  # must not raise


class TestWaitForShutdown(unittest.TestCase):
    def setUp(self):
        lifecycle._reset_for_tests()

    def tearDown(self):
        lifecycle._reset_for_tests()

    def test_dashboard_window_open(self):
        self.assertFalse(lifecycle.dashboard_window_open())  # no handle
        lifecycle._handle = BrowserHandle(proc=FakeProc(alive=True))
        self.assertTrue(lifecycle.dashboard_window_open())
        lifecycle._handle = BrowserHandle(proc=FakeProc(alive=False))
        self.assertFalse(lifecycle.dashboard_window_open())

    def test_wait_returns_false_on_timeout(self):
        self.assertFalse(lifecycle.wait_for_shutdown(timeout=0.01))

    def test_wait_unblocks_on_close_without_hard_exit(self):
        # With a waiter registered, clientDisconnected releases it instead of
        # hard-exiting or tearing down from the WS thread.
        import time

        disable = mock.Mock()
        lifecycle._disable = disable
        unblocked = threading.Event()

        def waiter():
            lifecycle.wait_for_shutdown(timeout=2)
            unblocked.set()

        t = threading.Thread(target=waiter)
        t.start()
        time.sleep(0.05)  # let the waiter register
        with mock.patch.object(lifecycle.threading, "Timer") as Timer:
            lifecycle.on_control("clientDisconnected", {})
            Timer.assert_not_called()  # no hard-exit scheduled
        self.assertTrue(unblocked.wait(2))  # waiter released
        disable.assert_not_called()  # handler left teardown to the waiter
        t.join(2)


class TestExitHandlerRegistration(unittest.TestCase):
    def setUp(self):
        lifecycle._reset_for_tests()

    def tearDown(self):
        lifecycle._reset_for_tests()

    def test_register_off_main_thread_skips_signals_but_wires_atexit(self):
        disable = mock.Mock()
        handle = BrowserHandle(proc=FakeProc())
        results = {}

        def worker():
            with mock.patch.object(lifecycle.atexit, "register") as reg, \
                    mock.patch.object(lifecycle.signal, "signal") as sig:
                lifecycle.register_exit_handlers(disable, handle)
                results["atexit"] = reg.called
                results["signal"] = sig.called

        t = threading.Thread(target=worker)
        t.start()
        t.join()
        self.assertTrue(results["atexit"])
        self.assertFalse(results["signal"])  # signals only on main thread

    def test_register_is_idempotent(self):
        disable = mock.Mock()
        with mock.patch.object(lifecycle.atexit, "register") as reg, \
                mock.patch.object(lifecycle.signal, "signal"), \
                mock.patch.object(lifecycle.signal, "getsignal"), \
                mock.patch.object(
                    lifecycle.threading, "main_thread",
                    return_value=threading.current_thread()):
            lifecycle.register_exit_handlers(disable, None)
            lifecycle.register_exit_handlers(disable, None)
        self.assertEqual(reg.call_count, 1)

    def test_unregister_closes_handle_and_restores(self):
        disable = mock.Mock()
        handle = BrowserHandle(proc=FakeProc())
        with mock.patch.object(lifecycle.atexit, "register"), \
                mock.patch.object(lifecycle.atexit, "unregister") as unreg, \
                mock.patch.object(lifecycle.signal, "signal"), \
                mock.patch.object(lifecycle.signal, "getsignal"), \
                mock.patch.object(
                    lifecycle.threading, "main_thread",
                    return_value=threading.current_thread()):
            lifecycle.register_exit_handlers(disable, handle)
            lifecycle.unregister_exit_handlers()
            self.assertTrue(unreg.called)
        self.assertTrue(handle._closed)  # window closed on unregister
        self.assertFalse(lifecycle._handlers_registered)


if __name__ == "__main__":
    unittest.main()
