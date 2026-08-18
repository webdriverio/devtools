"""DOM snapshot capture — the Python analogue of core's page-side trace path.

The dashboard's center "browser preview" panel replays the page by applying a
stream of DOM mutations captured in the browser. Those mutations come from the
``packages/script`` runtime (``window.wdioTraceCollector``): we inject it once,
then periodically read the buffered ``getTraceData()`` back and forward the
``mutations`` array via ``capturer.send_mutations``.

Mirrors ``core/script-loader.ts`` (``loadInjectableScript``) and
``selenium-devtools/session.ts`` (``injectScript`` / ``captureTrace``). The JS
adapter injects via ``document.createElement('script')`` rather than a BiDi
preload, and reads back with a single atomic ``executeScript`` — we do the same.

The script-path resolution and ``execute_script`` calls are injectable so the
pure logic (path resolution, IIFE wrapping, payload normalization) unit-tests
without selenium or a real browser. Everything is defensive: an injection or
readback failure is a logged no-op — capture never breaks the user's test.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Callable, List, Optional

from .collector_source import fetch_collector_source
from .constants import LOGGER_NAME

#: A ``driver.execute_script(script, *args)`` shaped callable — injectable so
#: tests drive injection/readback without a real driver.
ExecuteFn = Callable[..., Any]

#: Installs the collector: append a <script> whose body is the injected IIFE,
#: matching selenium-devtools/session.ts. ``arguments[0]`` is the script text.
_INJECT_SCRIPT = (
    "var s=document.createElement('script');"
    "s.textContent=arguments[0];"
    "document.head.appendChild(s);"
    "return true;"
)

#: Atomic check+read: the collector may vanish (navigation) between an
#: existence check and the read, so both happen in one eval — mirrors the
#: TOCTOU fix in selenium-devtools/session.ts.
_READ_TRACE_SCRIPT = (
    'return typeof window.wdioTraceCollector !== "undefined"'
    " ? window.wdioTraceCollector.getTraceData() : null;"
)

#: Cheap readiness probe used after injection.
_READY_SCRIPT = 'return typeof window.wdioTraceCollector !== "undefined";'

#: Session-lost signatures — expected during teardown, so silenced rather than
#: logged (matches the JS adapter's error filter).
_QUIET_ERRORS = ("ECONNREFUSED", "no such session", "invalid session id")


_log = logging.getLogger(f"{LOGGER_NAME}.snapshot")


def _warn(message: str) -> None:
    _log.warning(message)


def _is_quiet_error(exc: BaseException) -> bool:
    text = str(exc)
    return any(marker in text for marker in _QUIET_ERRORS)


def resolve_script_path() -> Optional[str]:
    """Locate ``packages/script/dist/script.js`` in the monorepo, or None.

    There's no cross-ecosystem resolver from Python, so walk up from this file
    to the repo root and look for the built browser runtime. Returns None when
    it isn't built yet — injection then becomes a no-op rather than an error.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    directory = here
    while True:
        candidate = os.path.join(directory, "packages", "script", "dist", "script.js")
        if os.path.isfile(candidate):
            return candidate
        parent = os.path.dirname(directory)
        if parent == directory:
            return None
        directory = parent


def wrap_injectable(script_content: str) -> str:
    """Wrap the raw script body in an async IIFE so its top-level ``await``
    works inside a plain ``<script>`` element — mirrors core's
    ``loadInjectableScript``."""
    return f"(async function() {{ {script_content} }})()"


def collector_source_text(
    path: Optional[str] = None,
    *,
    backend: Optional[tuple] = None,
) -> Optional[str]:
    """The collector's RAW source, or None if it cannot be obtained.

    Raw rather than wrapped, because the two ways of installing it need
    different envelopes: a ``<script>`` body needs the async IIFE
    (`wrap_injectable`), while a BiDi preload script is itself a function
    declaration and takes the source in its body.

    ``backend`` is the ``(host, port)`` of the connected backend, which serves
    the collector out of the package it depends on — the only route that works
    for an installed wheel, since `packages/script/dist/script.js` exists solely
    in a monorepo checkout. An explicit ``path`` wins so tests can avoid both,
    and the filesystem walk remains the fallback for a checkout running against
    a backend older than the route.
    """
    if path is None and backend is not None:
        source = fetch_collector_source(*backend)
        if source is not None:
            return source
    resolved = path or resolve_script_path()
    if not resolved:
        _warn(
            "collector unavailable from the backend and not found on disk — "
            "DOM replay is disabled for this run"
        )
        return None
    try:
        with open(resolved, "r", encoding="utf-8") as handle:
            return handle.read()
    except OSError as exc:
        _warn(f"could not read injected script ({resolved}): {exc}")
        return None


def load_injectable_script(
    path: Optional[str] = None,
    *,
    backend: Optional[tuple] = None,
) -> Optional[str]:
    """The IIFE-wrapped collector source for the ``<script>`` path, or None."""
    source = collector_source_text(path, backend=backend)
    return None if source is None else wrap_injectable(source)


def normalize_mutations(trace_data: Any) -> List[Any]:
    """Extract the ``mutations`` list from a ``getTraceData()`` payload.

    The page-side collector returns ``{errors, mutations, consoleLogs,
    networkRequests, traceLogs, metadata}``; the snapshot panel only needs
    ``mutations``. Anything else (None, missing key, non-list) normalizes to an
    empty list so callers never have to guard.
    """
    if not isinstance(trace_data, dict):
        return []
    mutations = trace_data.get("mutations")
    return mutations if isinstance(mutations, list) else []


class SnapshotCapturer:
    """Injects the page-side collector and pulls buffered DOM mutations.

    ``execute_fn`` is injectable (defaults to ``driver.execute_script``) so the
    injection/readback wrappers test without a real browser. State is minimal:
    a one-shot "already injected" flag mirroring the JS adapter.
    """

    def __init__(
        self,
        execute_fn: ExecuteFn,
        *,
        script_path: Optional[str] = None,
        backend: Optional[tuple] = None,
        preloaded: bool = False,
    ) -> None:
        self._execute = execute_fn
        self._script_path = script_path
        self._backend = backend
        # A document-start preload already installed the collector in every
        # document of this session, so there is nothing to inject — but the
        # capturer is still what DRAINS the buffer, so it is still needed.
        self._preloaded = preloaded
        self._injected = preloaded

    @property
    def injected(self) -> bool:
        return self._injected

    def inject(self) -> bool:
        """Ensure ``window.wdioTraceCollector`` is present on the CURRENT page.

        Navigation wipes the injected collector, so we probe the live page each
        call and re-install if it's gone (matching the JS adapter, which injects
        per navigation) rather than trusting a one-time flag. Failures are logged
        no-ops. A no-op when a document-start preload is registered: the
        collector is present in every document before any of its script runs,
        which is the whole point of the preload."""
        if self._preloaded:
            return True
        wrapped = load_injectable_script(self._script_path, backend=self._backend)
        if wrapped is None:
            return False
        try:
            if self._execute(_READY_SCRIPT) is True:
                self._injected = True
                return True
        except BaseException as exc:  # noqa: BLE001 — probe failure → try install
            if not _is_quiet_error(exc):
                _warn(f"readiness probe failed: {exc}")
        try:
            self._execute(_INJECT_SCRIPT, wrapped)
            ready = self._execute(_READY_SCRIPT)
        except BaseException as exc:  # noqa: BLE001 — capture must never break the test
            if not _is_quiet_error(exc):
                _warn(f"injection failed: {exc}")
            return False
        self._injected = ready is True
        if ready is not True:
            _warn("collector not detected immediately after injection")
        return self._injected

    def pull_mutations(self) -> List[Any]:
        """Read and drain the buffered mutations (``getTraceData()`` resets the
        page-side buffer). Returns [] on any failure or when nothing's buffered."""
        try:
            trace_data = self._execute(_READ_TRACE_SCRIPT)
        except BaseException as exc:  # noqa: BLE001
            if not _is_quiet_error(exc):
                _warn(f"trace read failed: {exc}")
            return []
        return normalize_mutations(trace_data)


def start_snapshot_capture(
    driver: Any,
    *,
    script_path: Optional[str] = None,
    execute_fn: Optional[ExecuteFn] = None,
    backend: Optional[tuple] = None,
    preloaded: bool = False,
) -> Optional[SnapshotCapturer]:
    """Build a ``SnapshotCapturer`` and attempt the first injection. Returns the
    capturer — including when that injection fails, so a later command can retry
    it — or None only when the driver cannot run scripts at all. Never raises.

    ``execute_fn`` overrides ``driver.execute_script`` — the adapter passes a
    capture-bypassing variant so injection/readback don't appear as commands."""
    run = execute_fn or getattr(driver, "execute_script", None)
    if not callable(run):
        _warn("driver has no execute_script — snapshot capture skipped")
        return None
    capturer = SnapshotCapturer(
        run, script_path=script_path, backend=backend, preloaded=preloaded
    )
    # The capturer is returned even when this first injection fails. It used to
    # return None, which made the failure terminal: the caller stores None, its
    # post-command refresh skips a missing capturer, and `inject()` is never
    # called again — so a collector fetch that failed once could never be
    # retried, and the page's own navigations could never re-install it either.
    capturer.inject()
    return capturer
