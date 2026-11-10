"""The state one test's capture is decided from: its initial frame and its end frame."""

from __future__ import annotations

import weakref
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class PerTestCapture:
    awaiting_initial_frame: bool = True
    initial_frame_retried: bool = False
    # The test's command rows as (command, timestamp).
    rows: List[tuple] = field(default_factory=list)
    started_ms: int = 0
    # The timestamp of the last capture attempted.
    last_captured_ts: Optional[int] = None
    final_frame_driver: Optional[weakref.ref] = None
    final_frame_taken: bool = False

    def reset(self, started_ms: int) -> None:
        self.awaiting_initial_frame = True
        self.initial_frame_retried = False
        self.rows = []
        self.started_ms = started_ms
        self.last_captured_ts = None
        self.final_frame_driver = None
        self.final_frame_taken = False
