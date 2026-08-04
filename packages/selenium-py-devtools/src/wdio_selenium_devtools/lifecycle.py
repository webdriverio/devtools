"""Dashboard browser-window lifecycle — mirror the JS adapters' behavior.

Three flows, matching `packages/selenium-devtools`:

1. On capture start, open an external browser window at the dashboard URL and
   keep a closable handle to it.
2. When the backend sends a ``clientDisconnected`` control frame (the user
   closed the dashboard window/tab), shut capture down and exit the process.
3. When the Python process ends (normal exit / SIGINT / SIGTERM), close the
   browser window we opened.

Everything here is best-effort: a failure to open or close the browser must
never crash the user's test run. All side effects (signal handlers, atexit,
real subprocess spawning) happen only through :func:`register_exit_handlers`
and :func:`open_dashboard`, never at import time, so importing this module is
inert (important for unittest).
"""

from __future__ import annotations

import atexit
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
from typing import Callable, Optional

from .constants import ENV_OPEN

# ── Local timing constants (lifecycle-specific) ──────────────────────────────
# These live here because constants.py is owned elsewhere; they could move there
# alongside ENV_OPEN if a second module ever needs them.
SHUTDOWN_EXIT_CODE = 0
SHUTDOWN_GRACE_S = 1.5  # let the WS reader thread unwind before the hard exit
BROWSER_TERM_TIMEOUT_S = 3.0
DASHBOARD_WINDOW_SIZE = "1600,1200"

# macOS Chrome/Chromium binaries, most-preferred first.
_MACOS_CHROME_CANDIDATES = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    os.path.expanduser(
        "~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    ),
)


def _log(msg: str) -> None:
    print(f"[wdio-devtools] {msg}", file=sys.stderr)


# ── Browser handle ───────────────────────────────────────────────────────────


class BrowserHandle:
    """A closable reference to the browser window we opened for the dashboard.

    Holds the launched subprocess plus its throwaway ``--user-data-dir`` so
    :meth:`close` can terminate exactly this window and clean the profile up —
    the JS adapter uses ``pkill -f`` on a unique dir; we hold the handle
    directly, which is both more precise and unit-testable.
    """

    def __init__(
        self,
        proc: Optional[subprocess.Popen] = None,
        user_data_dir: Optional[str] = None,
    ) -> None:
        self.proc = proc
        self.user_data_dir = user_data_dir
        self._closed = False

    def close(self) -> None:
        """Terminate the dashboard window and remove its temp profile. Idempotent."""
        if self._closed:
            return
        self._closed = True
        proc = self.proc
        if proc is not None and proc.poll() is None:
            try:
                proc.terminate()
                try:
                    proc.wait(timeout=BROWSER_TERM_TIMEOUT_S)
                except subprocess.TimeoutExpired:
                    proc.kill()
            except OSError:
                pass  # best-effort: never crash on browser teardown
        if self.user_data_dir:
            shutil.rmtree(self.user_data_dir, ignore_errors=True)


# ── Opening the dashboard window ─────────────────────────────────────────────


def _find_chrome() -> Optional[str]:
    """Path to a Chrome/Chromium binary on this machine, or None."""
    for candidate in _MACOS_CHROME_CANDIDATES:
        if os.path.exists(candidate):
            return candidate
    return None


def _default_opener(url: str) -> BrowserHandle:
    """Open ``url`` in a dedicated, isolated Chrome window we can later close.

    We spawn the Chrome binary directly rather than stdlib ``webbrowser`` or
    macOS ``open``: both hand the URL to the user's already-running Chrome,
    which then shows the dashboard as a tab among all their other tabs and
    gives us no handle to close it — exactly the bug this avoids.

    The isolation guarantee is the throwaway ``--user-data-dir``: launching the
    Chrome binary with a distinct profile dir forces a brand-new Chrome
    *instance* (a separate process that cannot merge into the user's running
    Chrome), so the dashboard always gets its own window. ``--app`` makes that
    window chrome-less (no tab strip/omnibox) and ``--new-window`` is a belt-
    and-suspenders hint. Holding the subprocess handle lets :meth:`close`
    terminate exactly this window — more precise than the JS adapter's
    ``pkill -f`` on the profile dir, and unit-testable.
    """
    chrome = _find_chrome()
    if chrome is None:
        _log(f"Chrome not found; open the dashboard manually: {url}")
        return BrowserHandle()

    user_data_dir = tempfile.mkdtemp(prefix="selenium-py-devtools-ui-")
    args = [
        chrome,
        f"--user-data-dir={user_data_dir}",  # forces a separate Chrome instance
        "--no-first-run",
        "--no-default-browser-check",
        f"--window-size={DASHBOARD_WINDOW_SIZE}",
        "--new-window",
        f"--app={url}",  # dedicated dashboard window, chrome-less
    ]
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    _log(f"Opened DevTools UI in a dedicated window: {url}")
    return BrowserHandle(proc=proc, user_data_dir=user_data_dir)


_FALSY = ("0", "false", "no", "off", "")


def auto_open_enabled() -> bool:
    """Whether the dashboard window should auto-open. Default ON, opt-out only.

    Rule: open unless ``WDIO_DEVTOOLS_OPEN`` is set to a falsy value
    (``0``/``false``/``no``/``off``/empty). This matches the JS adapters, whose
    ``openUi`` option defaults true regardless of TTY.

    The previous "default off when stdout isn't a TTY" gate silently disabled
    auto-open for the common case — running from an IDE or ``python demo.py``
    with no attached TTY — so the user opened the URL in their main Chrome
    instead. CI/headless runs disable it explicitly with ``WDIO_DEVTOOLS_OPEN=0``.
    """
    val = os.environ.get(ENV_OPEN)
    if val is None:
        return True
    return val.strip().lower() not in _FALSY


def open_dashboard(
    url: Optional[str],
    *,
    opener: Callable[[str], BrowserHandle] = _default_opener,
) -> Optional[BrowserHandle]:
    """Open ``url`` in a closable browser window; return its handle or None.

    ``opener`` is injectable so tests can assert behavior without a real
    browser. Never raises — a failed open logs one line and returns None.
    """
    if not url:
        return None
    try:
        return opener(url)
    except (OSError, ValueError) as exc:
        _log(f"could not open dashboard window ({exc}); open manually: {url}")
        return None


# ── Shutdown wiring ──────────────────────────────────────────────────────────

# Set by register_exit_handlers so the control-frame handler and signal handlers
# can reach the package's disable() and the open window without an import cycle.
_disable: Optional[Callable[[], None]] = None
_handle: Optional[BrowserHandle] = None
_handlers_registered = False
_prev_sigint = None
_prev_sigterm = None
_shutting_down = False
_shutdown_lock = threading.Lock()
# Set when the dashboard is closed / a shutdown is triggered — lets a caller
# (e.g. the pytest plugin) block after a run to keep the dashboard open for
# inspection, then exit when the user closes it.
_shutdown_event = threading.Event()
_has_waiter = False


def dashboard_window_open() -> bool:
    """True if we opened a dashboard window and its process is still alive."""
    h = _handle
    return h is not None and h.proc is not None and h.proc.poll() is None


def wait_for_shutdown(timeout: Optional[float] = None) -> bool:
    """Block until the dashboard is closed (clientDisconnected) or a signal.

    Used to keep the dashboard open for inspection after a run. Returns True on
    shutdown, False on timeout. Registers a waiter so the WS handler hands
    teardown back to the caller instead of hard-exiting out from under it."""
    global _has_waiter
    _has_waiter = True
    return _shutdown_event.wait(timeout)


def _run_disable() -> None:
    """Call the registered disable() once, swallowing errors."""
    fn = _disable
    if fn is None:
        return
    try:
        fn()
    except Exception as exc:  # disable must never re-raise into a handler
        _log(f"error during disable(): {exc}")


def _close_handle() -> None:
    """Close the opened browser window if any."""
    handle = _handle
    if handle is not None:
        handle.close()


def on_control(scope: str, data: dict) -> None:
    """WS control-frame handler: shut down when the dashboard client leaves.

    ``clientDisconnected`` means the user closed the dashboard window, so we
    tear capture down and exit the process (on a short timer, off the WS reader
    thread, so that thread can unwind cleanly). ``clientConnected`` is a no-op.
    """
    if scope == "clientDisconnected":
        _log("dashboard closed; shutting down")
        _trigger_shutdown(exit_after=True)


def _trigger_shutdown(*, exit_after: bool, exit_code: int = SHUTDOWN_EXIT_CODE) -> None:
    """Run disable() + close the window once; optionally hard-exit afterwards."""
    global _shutting_down
    with _shutdown_lock:
        if _shutting_down:
            return
        _shutting_down = True

    _shutdown_event.set()  # unblock any wait_for_shutdown()
    if _has_waiter:
        # A caller is blocked in wait_for_shutdown() and owns teardown — don't
        # hard-exit out from under it.
        return

    _run_disable()
    _close_handle()

    if exit_after:
        # Defer the hard exit to a daemon timer so the WS reader thread (which
        # may be the caller) unwinds first; os._exit avoids re-entering atexit.
        def _exit() -> None:
            os._exit(exit_code)

        timer = threading.Timer(SHUTDOWN_GRACE_S, _exit)
        timer.daemon = True
        timer.start()


def _on_signal(signum, _frame) -> None:
    """SIGINT/SIGTERM: close the window + disable, then re-raise the default."""
    _trigger_shutdown(exit_after=False)
    prev = _prev_sigint if signum == signal.SIGINT else _prev_sigterm
    if callable(prev):
        prev(signum, _frame)
    else:
        # Restore default disposition and re-raise so the process dies normally.
        try:
            signal.signal(signum, signal.SIG_DFL)
            os.kill(os.getpid(), signum)
        except OSError:
            os._exit(128 + signum)


def register_exit_handlers(
    disable: Callable[[], None],
    handle: Optional[BrowserHandle],
) -> None:
    """Register atexit + SIGINT/SIGTERM handlers to close the window on exit.

    Idempotent: called from enable(). Signal handlers are only installed on the
    main thread (Python forbids otherwise) and the previous handlers are chained
    so we don't swallow the runner's own Ctrl-C behavior.
    """
    global _disable, _handle, _handlers_registered, _prev_sigint, _prev_sigterm
    global _shutting_down, _has_waiter
    _disable = disable
    _handle = handle
    # Fresh shutdown state each run (supports enable→disable→enable).
    _shutdown_event.clear()
    _shutting_down = False
    _has_waiter = False
    if _handlers_registered:
        return
    _handlers_registered = True

    atexit.register(_close_handle)

    if threading.current_thread() is threading.main_thread():
        try:
            _prev_sigint = signal.getsignal(signal.SIGINT)
            _prev_sigterm = signal.getsignal(signal.SIGTERM)
            signal.signal(signal.SIGINT, _on_signal)
            signal.signal(signal.SIGTERM, _on_signal)
        except (ValueError, OSError) as exc:
            _log(f"could not install signal handlers ({exc})")


def unregister_exit_handlers() -> None:
    """Undo register_exit_handlers; close the window. Idempotent — for disable()."""
    global _disable, _handle, _handlers_registered, _prev_sigint, _prev_sigterm
    _close_handle()
    if _handlers_registered:
        try:
            atexit.unregister(_close_handle)
        except Exception:
            pass
        if threading.current_thread() is threading.main_thread():
            for sig, prev in (
                (signal.SIGINT, _prev_sigint),
                (signal.SIGTERM, _prev_sigterm),
            ):
                if prev is not None:
                    try:
                        signal.signal(sig, prev)
                    except (ValueError, OSError):
                        pass
    _disable = None
    _handle = None
    _handlers_registered = False
    _prev_sigint = None
    _prev_sigterm = None


def _reset_for_tests() -> None:
    """Reset module state between unit tests (never used in production)."""
    global _disable, _handle, _handlers_registered
    global _prev_sigint, _prev_sigterm, _shutting_down, _has_waiter
    _disable = None
    _handle = None
    _handlers_registered = False
    _prev_sigint = None
    _prev_sigterm = None
    _shutting_down = False
    _has_waiter = False
    _shutdown_event.clear()
