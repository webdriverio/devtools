import threading
import unittest

from wdio_selenium_devtools.transport import WSClient


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


if __name__ == "__main__":
    unittest.main()
