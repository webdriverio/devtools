"""Dependency-free WebSocket client for the adapter→backend ``/worker`` link.

A hardened version of the Phase-0 spike's client: RFC-6455 handshake, masked
client text frames, plus a background reader thread that handles ping/pong and
surfaces the backend's control frames (``clientConnected`` / ``clientDisconnected``)
to a callback. No third-party dependency — the only runtime requirement the
adapter adds on top of selenium itself.
"""

from __future__ import annotations

import base64
import json
import os
import socket
import struct
import threading
from typing import Callable, Optional

from .constants import CONNECT_TIMEOUT_S, WORKER_PATH


class WSClient:
    def __init__(
        self,
        host: str,
        port: int,
        path: str = WORKER_PATH,
        on_control: Optional[Callable[[str, dict], None]] = None,
    ) -> None:
        self.host = host
        self.port = port
        self.path = path
        self._on_control = on_control
        self._sock: Optional[socket.socket] = None
        self._send_lock = threading.Lock()
        self._reader: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self.connected = False

    # ── lifecycle ────────────────────────────────────────────────────────────

    def connect(self, timeout: float = CONNECT_TIMEOUT_S) -> None:
        sock = socket.create_connection((self.host, self.port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        sock.sendall(
            (
                f"GET {self.path} HTTP/1.1\r\n"
                f"Host: {self.host}:{self.port}\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\n"
                "Sec-WebSocket-Version: 13\r\n"
                "\r\n"
            ).encode()
        )
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = sock.recv(1024)
            if not chunk:
                raise ConnectionError("backend closed during handshake")
            buf += chunk
        status = buf.split(b"\r\n", 1)[0].decode(errors="replace")
        if "101" not in status:
            raise ConnectionError(f"websocket upgrade failed: {status!r}")

        sock.settimeout(1.0)  # so the reader can poll the stop flag
        self._sock = sock
        self.connected = True
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()

    def close(self) -> None:
        self._stop.set()
        sock = self._sock
        if sock is not None:
            try:
                self._send_frame(0x8, b"")  # close
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass
        if self._reader is not None:
            self._reader.join(timeout=2.0)
        self.connected = False

    # ── sending ──────────────────────────────────────────────────────────────

    def send_json(self, scope: str, data) -> bool:
        """Send one ``{scope, data}`` frame. Returns False if not connected —
        mirrors the JS capturer's silent-drop-on-disconnect behavior."""
        if not self.connected or self._sock is None:
            return False
        try:
            self._send_frame(0x1, json.dumps({"scope": scope, "data": data}).encode())
            return True
        except OSError:
            self.connected = False
            return False

    def _send_frame(self, opcode: int, payload: bytes) -> None:
        header = bytearray([0x80 | opcode])
        n = len(payload)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        mask = os.urandom(4)
        header += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        with self._send_lock:
            assert self._sock is not None
            self._sock.sendall(bytes(header) + masked)

    # ── receiving ──────────────────────────────────────────────────────────────

    def _recv_exact(self, n: int) -> Optional[bytes]:
        buf = b""
        while len(buf) < n:
            if self._stop.is_set():
                return None
            try:
                chunk = self._sock.recv(n - len(buf))  # type: ignore[union-attr]
            except socket.timeout:
                continue
            except OSError:
                return None
            if not chunk:
                return None
            buf += chunk
        return buf

    def _read_loop(self) -> None:
        while not self._stop.is_set():
            head = self._recv_exact(2)
            if head is None:
                break
            opcode = head[0] & 0x0F
            masked = bool(head[1] & 0x80)
            length = head[1] & 0x7F
            if length == 126:
                ext = self._recv_exact(2)
                if ext is None:
                    break
                length = struct.unpack(">H", ext)[0]
            elif length == 127:
                ext = self._recv_exact(8)
                if ext is None:
                    break
                length = struct.unpack(">Q", ext)[0]
            mask = self._recv_exact(4) if masked else None
            payload = self._recv_exact(length) if length else b""
            if payload is None:
                break
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))

            if opcode == 0x8:  # close
                break
            if opcode == 0x9:  # ping → pong
                try:
                    self._send_frame(0xA, payload)
                except OSError:
                    break
                continue
            if opcode in (0x1, 0x2):  # text / binary
                self._dispatch(payload)
        self.connected = False

    def _dispatch(self, payload: bytes) -> None:
        if self._on_control is None:
            return
        try:
            msg = json.loads(payload.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return
        scope = msg.get("scope")
        if isinstance(scope, str):
            self._on_control(scope, msg.get("data") or {})
