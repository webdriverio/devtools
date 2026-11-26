"""Ceilings on BiDi setup calls on Chrome 156/157 (crbug 571161446); mirrors ``core/capture-call-guard.ts``."""

from __future__ import annotations

import logging
import re
import threading
from typing import Any, Callable, Dict, Optional, Protocol, Set, TypeVar

from .constants import LOGGER_NAME

_log = logging.getLogger(f"{LOGGER_NAME}.capture")

T = TypeVar("T")

#: Mirrors core's ``BIDI_SETUP_TIMEOUT_MS``.
BIDI_SETUP_TIMEOUT_S = 10.0

POPUP_BIDI_HANG_CHROME_MAJORS = (156, 157)
POPUP_BIDI_HANG_FIXED_IN = "158.0.8106.0"

class Cancellation(Protocol):
    def is_set(self) -> bool: ...


class _NeverCancelled:
    def is_set(self) -> bool:
        return False


#: Handed to a call that runs without a ceiling; nothing can set it.
NEVER_CANCELLED: Cancellation = _NeverCancelled()

_CHROME_BROWSER_NAMES = {"chrome", "chromium", "chrome-headless-shell"}
_NATIVE_PLATFORMS = {"android", "ios"}
_MAJOR = re.compile(r"^(\d+)\.")

_reported: Set[str] = set()
_reported_lock = threading.Lock()


def chrome_major_version(capabilities: Any) -> Optional[int]:
    """The Chrome major a session runs, or None for any other browser or an unreadable version."""
    if not isinstance(capabilities, dict):
        return None
    if str(capabilities.get("browserName") or "").lower() not in _CHROME_BROWSER_NAMES:
        return None
    version = capabilities.get("browserVersion") or capabilities.get("version") or ""
    match = _MAJOR.match(str(version))
    return int(match.group(1)) if match else None


def has_popup_bidi_hang(capabilities: Any) -> bool:
    """Whether the session runs a Chrome that leaves BiDi commands to a popup tab unanswered."""
    return chrome_major_version(capabilities) in POPUP_BIDI_HANG_CHROME_MAJORS


def capture_ceilings_apply(capabilities: Any) -> bool:
    """Whether capture calls get ceilings: Chrome 156/157 on a desktop session, never an Appium one."""
    if not has_popup_bidi_hang(capabilities):
        return False
    appium = str(capabilities.get("platformName") or "").lower() in _NATIVE_PLATFORMS or any(
        str(key).startswith("appium:") for key in capabilities
    )
    return not appium


def popup_bidi_hang_warning(what: str, major: int) -> str:
    return (
        f"DevTools capture: {what} timed out on Chrome {major}, which hangs WebDriver "
        "BiDi commands to tabs opened by window.open() (crbug 571161446, fixed in "
        f"Chrome {POPUP_BIDI_HANG_FIXED_IN}). This session falls back to per-document "
        "injection and the page's own console and network; run popup flows on "
        "Chrome 155 or 158+."
    )


def _report_timeout(driver: Any, what: str, major: int) -> None:
    key = str(getattr(driver, "session_id", "") or "")
    with _reported_lock:
        if key in _reported:
            return
        _reported.add(key)
    _log.warning(popup_bidi_hang_warning(what, major))


def call_with_timeout(
    driver: Any,
    call: Callable[[Cancellation], T],
    seconds: float,
    fallback: T,
    what: str,
    undo: Optional[Callable[[T], None]] = None,
) -> T:
    """``call`` as is on an unaffected browser; on Chrome 156/157 abandoned after ``seconds``, with ``undo`` run on a value that lands late."""
    capabilities = getattr(driver, "caps", None)
    if not capture_ceilings_apply(capabilities):
        return call(NEVER_CANCELLED)
    cancelled = threading.Event()
    settle = threading.Lock()
    outcome: Dict[str, Any] = {}

    def run() -> None:
        try:
            value = call(cancelled)
        except BaseException as exc:  # noqa: BLE001, handed back to the caller thread
            with settle:
                late = cancelled.is_set()
                if not late:
                    outcome["error"] = exc
            if late:
                _log.debug("%s failed after its ceiling, already fallen back: %s", what, exc)
            return
        with settle:
            late = cancelled.is_set()
            if not late:
                outcome["value"] = value
        if late and undo is not None:
            undo(value)

    worker = threading.Thread(target=run, name=f"devtools-{what}", daemon=True)
    worker.start()
    worker.join(seconds)
    with settle:
        if not outcome:
            cancelled.set()
    if cancelled.is_set():
        _report_timeout(driver, what, chrome_major_version(capabilities) or 0)
        return fallback
    if "error" in outcome:
        raise outcome["error"]
    return outcome["value"]


def reset() -> None:
    """Forget which sessions were reported; for tests."""
    with _reported_lock:
        _reported.clear()
