"""Forward Python ``logging`` output to the dashboard Console — the 'runner' log
stream, the analogue of the JS adapter surfacing ``@wdio/logger`` output
(webdriver/BiDi lines, the adapter's own '✓ Script injected' events, etc.).

Attaches a handler to the root logger and raises the adapter's + selenium's
loggers to a useful level so their records reach the dashboard. Restores
everything on stop.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

#: The adapter's logger name — operational events are logged under it.
LOGGER_NAME = "wdio_selenium_devtools"

_LEVEL_MAP = {
    logging.DEBUG: "debug",
    logging.INFO: "info",
    logging.WARNING: "warn",
    logging.ERROR: "error",
    logging.CRITICAL: "error",
}

# Loggers raised to a useful level so their records reach the dashboard: the
# adapter's own (verbose) and selenium's (info: session/BiDi lines).
_WATCH = {LOGGER_NAME: logging.DEBUG, "selenium": logging.INFO}


class _DashboardHandler(logging.Handler):
    def __init__(self, capturer: Any) -> None:
        super().__init__(level=logging.DEBUG)
        self._capturer = capturer
        self._reentrant = False

    def emit(self, record: logging.LogRecord) -> None:
        if self._reentrant:  # forwarding must not re-enter via its own logging
            return
        self._reentrant = True
        try:
            level = _LEVEL_MAP.get(record.levelno, "log")
            message = f"{record.name}: {record.getMessage()}"
            self._capturer.capture_console(level, [message], source="terminal")
        except Exception:  # noqa: BLE001 — logging must never break the test
            pass
        finally:
            self._reentrant = False


class LogCapturer:
    """Streams Python logging into the dashboard Console for the run's duration."""

    def __init__(self, capturer: Any) -> None:
        self._handler = _DashboardHandler(capturer)
        self._prev_levels: Dict[str, int] = {}

    def start(self) -> None:
        logging.getLogger().addHandler(self._handler)
        for name, level in _WATCH.items():
            logger = logging.getLogger(name)
            self._prev_levels[name] = logger.level
            if logger.level == logging.NOTSET or logger.level > level:
                logger.setLevel(level)

    def stop(self) -> None:
        logging.getLogger().removeHandler(self._handler)
        for name, prev in self._prev_levels.items():
            logging.getLogger(name).setLevel(prev)
        self._prev_levels.clear()
