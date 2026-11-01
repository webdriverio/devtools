import os
import threading
import unittest
from unittest import mock

from selenium_devtools._contract import ENV_RUN_ID, WORKER_QUERY_RUN_ID
from selenium_devtools.transport import WSClient


class TestClose(unittest.TestCase):
    def test_close_from_reader_thread_does_not_join_self(self):
        # close() can run ON the reader thread (a clientDisconnected control
        # frame triggering shutdown) — it must not try to join itself.
        client = WSClient("localhost", 1)
        client._reader = threading.current_thread()
        client.connected = True
        client.close()  # must not raise "cannot join current thread"
        self.assertFalse(client.connected)

    def test_close_is_safe_when_never_connected(self):
        client = WSClient("localhost", 1)
        client.close()  # no socket, no reader — no raise
        self.assertFalse(client.connected)



class _FakeSocket:
    """Records what the handshake wrote, and answers with a 101."""

    def __init__(self):
        self.sent = b""
        self._to_read = b"HTTP/1.1 101 Switching Protocols\r\n\r\n"

    def sendall(self, data):
        self.sent += data

    def recv(self, _n):
        chunk, self._to_read = self._to_read, b""
        return chunk

    def settimeout(self, _t):
        pass

    def close(self):
        pass


class TestTheHandshakeCarriesRunIdentity(unittest.TestCase):
    """The backend decides on the UPGRADE whether this socket continues the
    current run or starts a new one, and wipes the message buffer and the
    baseline store's active run when it reads a new one. A connect with no runId
    is therefore indistinguishable from a new run, which is what made accumulated
    state unable to survive a reconnect."""

    def setUp(self):
        self.previous = os.environ.get(ENV_RUN_ID)
        os.environ[ENV_RUN_ID] = "run-under-test"
        self.addCleanup(self._restore)

    def _restore(self):
        if self.previous is None:
            os.environ.pop(ENV_RUN_ID, None)
        else:
            os.environ[ENV_RUN_ID] = self.previous

    def _handshake(self):
        fake = _FakeSocket()
        with mock.patch("socket.create_connection", return_value=fake):
            client = WSClient("localhost", 1)
            client.connect()
            client._stop.set()  # stop the reader thread promptly
        return fake.sent.decode()

    def test_the_request_line_carries_the_run_id(self):
        request = self._handshake()

        self.assertIn("GET /worker?runId=run-under-test HTTP/1.1", request)

    def test_the_query_name_comes_from_the_shared_contract(self):
        # Hard-coding 'runId' here would let the adapter and the backend drift
        # apart silently — the socket would connect and simply lose run state.
        self.assertEqual(WORKER_QUERY_RUN_ID, "runId")
        self.assertIn(f"?{WORKER_QUERY_RUN_ID}=", self._handshake())

    def test_a_second_connect_in_the_same_run_sends_the_same_id(self):
        # This is what lets the backend keep accumulated state instead of
        # treating the reconnect as a new run.
        first = self._handshake()
        second = self._handshake()

        self.assertEqual(first.splitlines()[0], second.splitlines()[0])

    def test_a_non_worker_path_carries_no_run_id(self):
        # The contract scopes these params to the worker upgrade, and the backend
        # only reads them there. Attaching one to another path sends something
        # nothing reads, which reads as meaningful to whoever finds it next.
        client = WSClient("localhost", 1, path="/client")

        self.assertEqual(client.request_target(), "/client")

    def test_an_id_needing_escaping_is_percent_encoded(self):
        os.environ[ENV_RUN_ID] = "run id/with?chars"

        request = self._handshake()

        self.assertIn("runId=run%20id/with%3Fchars", request)
        self.assertNotIn("?chars", request.splitlines()[0].split("runId=")[1])


if __name__ == "__main__":
    unittest.main()
