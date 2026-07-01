#!/usr/bin/env python3
"""
Phase 0 spike — prove a non-JS client can drive the DevTools dashboard.

This script speaks the adapter side of the wire with ZERO third-party
dependencies (raw socket + RFC-6455 handshake + masked text frames). It
connects to the backend's /worker WebSocket and pushes the same
`{ "scope": ..., "data": ... }` frames the JS Selenium adapter emits.

The real Python adapter would use the `websockets` package instead of this
hand-rolled client — the point here is only to prove the boundary is
language-agnostic, with nothing to install.

Run:
    1. node packages/backend/dist/index.js      # backend + dashboard on :3000
    2. open http://localhost:3000
    3. python3 examples/python-spike/spike.py    # watch the run appear, live

Frame shapes mirror packages/shared/src/types.ts. See README.md.
"""

import base64
import json
import os
import socket
import struct
import sys
import time

HOST = os.environ.get("DEVTOOLS_HOST", "localhost")
PORT = int(os.environ.get("DEVTOOLS_PORT", "3000"))
WORKER_PATH = "/worker"
SESSION_ID = "spike-py-0001"


# ── Minimal RFC-6455 client (text frames, client→server masked) ──────────────

def ws_connect(host: str, port: int, path: str) -> socket.socket:
    sock = socket.create_connection((host, port), timeout=5)
    key = base64.b64encode(os.urandom(16)).decode()
    handshake = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "\r\n"
    )
    sock.sendall(handshake.encode())

    # Read response headers up to the blank line.
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = sock.recv(1024)
        if not chunk:
            raise ConnectionError("backend closed during handshake")
        buf += chunk
    status_line = buf.split(b"\r\n", 1)[0].decode(errors="replace")
    if "101" not in status_line:
        raise ConnectionError(f"upgrade failed: {status_line!r}")
    return sock


def ws_send_text(sock: socket.socket, text: str) -> None:
    payload = text.encode("utf-8")
    header = bytearray()
    header.append(0x81)  # FIN + opcode 0x1 (text)
    mask_bit = 0x80      # client frames MUST be masked
    n = len(payload)
    if n < 126:
        header.append(mask_bit | n)
    elif n < 65536:
        header.append(mask_bit | 126)
        header += struct.pack(">H", n)
    else:
        header.append(mask_bit | 127)
        header += struct.pack(">Q", n)
    mask = os.urandom(4)
    header += mask
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    sock.sendall(bytes(header) + masked)


def send_frame(sock: socket.socket, scope: str, data) -> None:
    ws_send_text(sock, json.dumps({"scope": scope, "data": data}))
    print(f"  → sent {scope:<16} ({json.dumps(data)[:60]}…)")


def now_ms() -> int:
    return int(time.time() * 1000)


def iso(ms: int) -> str:
    # SuiteStats.start/end are Dates in TS — they cross the wire as ISO strings.
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ms / 1000)) + \
        f".{ms % 1000:03d}Z"


# ── The golden frames (mirror packages/shared/src/types.ts) ──────────────────

def metadata_frame() -> dict:
    return {
        "type": "testrunner",  # TraceType.Testrunner
        "sessionId": SESSION_ID,
        "url": "https://example.com/",
        "capabilities": {"browserName": "chrome", "browserVersion": "126.0"},
        "desiredCapabilities": {"browserName": "chrome"},
        "viewport": {"width": 1280, "height": 720,
                     "offsetLeft": 0, "offsetTop": 0, "scale": 1},
        "testEnv": "python-spike",
    }


def suite_frame(start: int) -> list:
    test = {
        "uid": "test-1", "cid": "0-0",
        "title": "loads the homepage",
        "fullTitle": "Python spike › loads the homepage",
        "parent": "Python spike",
        "state": "passed",
        "start": iso(start), "end": iso(start + 1200),
        "type": "test", "file": "examples/python-spike/spike.py",
        "retries": 0, "_duration": 1200,
        "callSource": "spike.py:loads_the_homepage",
    }
    suite = {
        "uid": "suite-1", "cid": "0-0",
        "title": "Python spike", "fullTitle": "Python spike",
        "type": "suite", "file": "examples/python-spike/spike.py",
        "start": iso(start), "end": iso(start + 1200), "state": "passed",
        "tests": [test], "suites": [], "hooks": [], "_duration": 1200,
    }
    return [suite]


def command_frames(start: int) -> list:
    base = [
        ("navigateTo", ["https://example.com/"], None),
        ("findElement", [{"using": "css selector", "value": "h1"}],
         {"ELEMENT": "elem-h1"}),
        ("getText", [], "Example Domain"),
        ("click", [{"using": "css selector", "value": "a"}], None),
    ]
    frames = []
    for i, (cmd, args, result) in enumerate(base):
        ts = start + 100 + i * 250
        frames.append({
            "command": cmd, "args": args, "result": result,
            "timestamp": ts, "startTime": ts - 40,
            "callSource": f"spike.py:{40 + i}", "id": i + 1,
        })
    return frames


def console_frames(start: int) -> list:
    return [
        {"type": "info", "args": ["Hello from the Python spike 🐍"],
         "timestamp": start + 120, "source": "browser"},
        {"type": "warn", "args": ["this is a synthetic console line"],
         "timestamp": start + 480, "source": "browser"},
    ]


def network_frames(start: int) -> list:
    return [{
        "id": "net-1", "url": "https://example.com/", "method": "GET",
        "status": 200, "statusText": "OK",
        "timestamp": start + 90, "startTime": start + 90,
        "endTime": start + 240, "time": 150, "type": "document",
        "response": {"fromCache": False, "headers": {}, "mimeType": "text/html",
                     "status": 200},
    }]


def main() -> int:
    print(f"connecting to ws://{HOST}:{PORT}{WORKER_PATH} …")
    try:
        sock = ws_connect(HOST, PORT, WORKER_PATH)
    except OSError as exc:
        print(f"\n  ✗ could not connect: {exc}")
        print("    is the backend running?  node packages/backend/dist/index.js")
        return 1

    print("  ✓ connected — streaming a synthetic test run\n")
    start = now_ms()

    send_frame(sock, "metadata", metadata_frame())
    time.sleep(0.3)
    send_frame(sock, "suites", suite_frame(start))
    time.sleep(0.3)
    send_frame(sock, "networkRequests", network_frames(start))
    send_frame(sock, "consoleLogs", console_frames(start))
    time.sleep(0.3)

    # Stream commands one at a time so the timeline fills in "live".
    for frame in command_frames(start):
        send_frame(sock, "commands", [frame])
        time.sleep(0.4)

    # Re-send the suite with final state so the tree settles green.
    send_frame(sock, "suites", suite_frame(start))

    print("\n  ✓ done — check the dashboard at "
          f"http://{HOST}:{PORT}")
    print("    keeping the socket open for 2s so the backend flushes…")
    time.sleep(2)
    sock.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
