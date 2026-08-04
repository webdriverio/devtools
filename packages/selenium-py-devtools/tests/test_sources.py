import os
import tempfile
import unittest

from wdio_selenium_devtools import sources


class TestReadSource(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.root = self._dir.name

    def _write(self, name, data, mode="w"):
        path = os.path.join(self.root, name)
        with open(path, mode) as handle:
            handle.write(data)
        return path

    def test_reads_utf8_text(self):
        path = self._write("t.py", "def test_x():\n    assert True\n")
        self.assertEqual(sources.read_source(path), "def test_x():\n    assert True\n")

    def test_missing_file_returns_none(self):
        self.assertIsNone(sources.read_source(os.path.join(self.root, "nope.py")))

    def test_directory_returns_none(self):
        self.assertIsNone(sources.read_source(self.root))

    def test_oversize_file_returns_none(self):
        path = self._write("big.py", "x" * (sources.MAX_SOURCE_BYTES + 1))
        self.assertIsNone(sources.read_source(path))

    def test_at_cap_is_read(self):
        path = self._write("ok.py", "y" * sources.MAX_SOURCE_BYTES)
        result = sources.read_source(path)
        self.assertIsNotNone(result)
        self.assertEqual(len(result), sources.MAX_SOURCE_BYTES)

    def test_invalid_bytes_do_not_raise(self):
        path = self._write("bad.py", b"\xff\xfe not utf8", mode="wb")
        # errors="replace" keeps the read total; the point is it never raises.
        self.assertIsNotNone(sources.read_source(path))


class TestCollectSources(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.root = self._dir.name

    def _write(self, name, data):
        path = os.path.join(self.root, name)
        with open(path, "w") as handle:
            handle.write(data)
        return path

    def test_maps_readable_paths_by_absolute_key(self):
        a = self._write("a.py", "AAA")
        b = self._write("b.py", "BBB")
        result = sources.collect_sources([a, b])
        self.assertEqual(result, {a: "AAA", b: "BBB"})
        self.assertTrue(all(os.path.isabs(k) for k in result))

    def test_skips_unreadable_and_dedupes(self):
        a = self._write("a.py", "AAA")
        missing = os.path.join(self.root, "gone.py")
        result = sources.collect_sources([a, a, missing, ""])
        self.assertEqual(result, {a: "AAA"})


if __name__ == "__main__":
    unittest.main()
