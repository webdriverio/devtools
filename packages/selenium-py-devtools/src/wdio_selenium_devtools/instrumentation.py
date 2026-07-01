"""Driver instrumentation — the one genuinely per-language piece.

Every Selenium command (driver- *and* element-level, since element methods
delegate to ``self._parent.execute``) funnels through
``WebDriver.execute(driver_command, params)``. Wrapping that single chokepoint
captures the whole command stream from one place — cleaner than the JS
adapter's prototype patching.

The patch target is injected so the module imports and unit-tests without
selenium present; ``install`` defaults to the real selenium class.
"""

from __future__ import annotations

from typing import Any, Optional

from .capturer import SessionCapturer
from .constants import SKIP_COMMANDS, SKIP_STACK_FRAMES
from .utils import call_source, now_ms

_state: dict = {"installed": False, "cls": None, "orig": None}


def install(capturer: SessionCapturer, webdriver_cls: Optional[type] = None) -> None:
    if _state["installed"]:
        return
    if webdriver_cls is None:
        from selenium.webdriver.remote.webdriver import WebDriver  # lazy

        webdriver_cls = WebDriver

    orig_execute = webdriver_cls.execute

    def patched_execute(self, driver_command: str, params: Any = None):  # noqa: ANN001
        # Skip capture for noise, but never alter behavior.
        if driver_command in SKIP_COMMANDS:
            result = orig_execute(self, driver_command, params)
            if driver_command == "newSession":
                capturer.ensure_metadata(
                    getattr(self, "session_id", None),
                    getattr(self, "caps", None),
                    None,
                )
            return result

        start = now_ms()
        src = call_source(SKIP_STACK_FRAMES)
        try:
            result = orig_execute(self, driver_command, params)
        except BaseException as exc:  # capture then re-raise unchanged
            capturer.capture_command(
                command=driver_command,
                args=params,
                error=exc,
                start_time=start,
                call_source=src,
            )
            raise

        capturer.ensure_metadata(
            getattr(self, "session_id", None), getattr(self, "caps", None), None
        )
        # WebDriver.execute returns the full response dict; the useful payload
        # is response["value"].
        value = result.get("value") if isinstance(result, dict) else result
        capturer.capture_command(
            command=driver_command,
            args=params,
            result=value,
            start_time=start,
            call_source=src,
        )
        return result

    webdriver_cls.execute = patched_execute  # type: ignore[assignment]
    _state.update(installed=True, cls=webdriver_cls, orig=orig_execute)


def uninstall() -> None:
    if not _state["installed"]:
        return
    _state["cls"].execute = _state["orig"]  # type: ignore[union-attr]
    _state.update(installed=False, cls=None, orig=None)
