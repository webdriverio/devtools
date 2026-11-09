"""The page mask policy: what the collector is told to mask, and that command
rows still carry what the test typed. The prelude cases both languages share
are in test_mirror_vectors."""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from selenium_devtools import input_masking, instrumentation, pytest_plugin as plugin, snapshot
from selenium_devtools.capturer import SessionCapturer
from selenium_devtools.constants import ENV_MASK_INPUTS, ENV_MASK_SELECTORS

from wire_contract import RecordingTransport

SECRET = "SuperSecretPassword!"


def _clean_env():
    patcher = mock.patch.dict(os.environ, {}, clear=False)
    patcher.start()
    for name in (ENV_MASK_INPUTS, ENV_MASK_SELECTORS):
        os.environ.pop(name, None)
    return patcher


class _Masked(unittest.TestCase):
    def setUp(self):
        self.addCleanup(_clean_env().stop)
        input_masking.configure(True, [])
        self.addCleanup(input_masking.configure, True, [])


class TestPolicy(_Masked):
    def test_default_masks_password_fields_and_names_no_selectors(self):
        self.assertEqual(input_masking.configure(), {"inputs": True, "selectors": []})

    def test_environment_decides_when_no_argument_does(self):
        os.environ[ENV_MASK_INPUTS] = "off"
        os.environ[ENV_MASK_SELECTORS] = " .card , ,#ssn"
        self.assertEqual(
            input_masking.configure(), {"inputs": False, "selectors": [".card", "#ssn"]}
        )

    def test_an_argument_beats_the_environment(self):
        os.environ[ENV_MASK_INPUTS] = "0"
        os.environ[ENV_MASK_SELECTORS] = ".card"
        self.assertEqual(
            input_masking.configure(True, ["#ssn"]), {"inputs": True, "selectors": ["#ssn"]}
        )

    def test_an_empty_environment_value_keeps_masking(self):
        os.environ[ENV_MASK_INPUTS] = ""
        self.assertTrue(input_masking.configure()["inputs"])
        os.environ[ENV_MASK_INPUTS] = "  "
        self.assertTrue(input_masking.configure()["inputs"])

    def test_a_truthy_environment_value_keeps_masking(self):
        os.environ[ENV_MASK_INPUTS] = "yes"
        self.assertTrue(input_masking.configure()["inputs"])


class FakeDriver:
    def __init__(self):
        self.session_id = None
        self.caps = {"browserName": "chrome"}
        self.received = []

    def execute(self, command, params=None):
        self.received.append((command, params))
        if command == "getElementProperty":
            return {"value": SECRET}
        return {"value": None}


class TestRowsKeepTheTypedText(_Masked):
    def setUp(self):
        super().setUp()
        instrumentation.uninstall()
        self.tx = RecordingTransport()
        instrumentation.install(SessionCapturer(self.tx), FakeDriver)
        self.addCleanup(instrumentation.uninstall)
        self.driver = FakeDriver()

    def _rows(self):
        return [row for scope, data in self.tx.sent if scope == "commands" for row in data]

    def test_a_send_keys_row_carries_what_was_typed(self):
        self.driver.execute("sendKeysToElement", {"id": "e", "text": SECRET, "value": list(SECRET)})
        self.assertEqual(self._rows()[-1]["args"], [{"id": "e", "text": SECRET, "value": list(SECRET)}])

    def test_a_read_returning_the_typed_text_is_kept(self):
        self.driver.execute("sendKeysToElement", {"id": "e", "text": SECRET})
        self.driver.execute("getElementProperty", {"id": "e", "name": "value"})
        self.assertEqual(self._rows()[-1]["result"], SECRET)


class TestCollectorCarriesThePolicy(_Masked):
    def test_a_source_read_from_disk_starts_with_the_prelude(self):
        input_masking.configure(False, [".card"])
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as handle:
            handle.write("/* collector */")
        self.addCleanup(os.unlink, handle.name)
        source = snapshot.collector_source_text(handle.name)
        self.assertEqual(
            source, 'var __wdioCaptureMask = {"inputs":false,"selectors":[".card"]};\n/* collector */'
        )

    def test_a_source_the_backend_served_starts_with_the_prelude(self):
        input_masking.configure(True, [".iban"])
        with mock.patch.object(snapshot, "fetch_collector_source", return_value="/* served */") as fetch:
            source = snapshot.collector_source_text(backend=("127.0.0.1", 4000))
        fetch.assert_called_once_with("127.0.0.1", 4000)
        self.assertEqual(
            source, 'var __wdioCaptureMask = {"inputs":true,"selectors":[".iban"]};\n/* served */'
        )


class _Config:
    def __init__(self, options=None, ini=None):
        self._options = dict(options or {})
        self._ini = dict(ini or {})

    def getoption(self, name, default=None):
        return self._options.get(name, default)

    def getini(self, name):
        return self._ini.get(name)


class TestPytestOptions(unittest.TestCase):
    def test_nothing_set_leaves_it_to_enable(self):
        config = _Config()
        self.assertIsNone(plugin._resolve_mask_inputs(config))
        self.assertIsNone(plugin._resolve_mask_selectors(config))

    def test_the_flag_beats_the_ini(self):
        config = _Config({"--devtools-no-mask-inputs": True}, {"devtools_mask_inputs": True})
        self.assertFalse(plugin._resolve_mask_inputs(config))

    def test_the_ini_decides_without_a_flag(self):
        self.assertFalse(plugin._resolve_mask_inputs(_Config(ini={"devtools_mask_inputs": False})))

    def test_cli_selectors_beat_the_ini(self):
        config = _Config({"--devtools-mask-selector": [".a", "#b"]}, {"devtools_mask_selectors": [".c"]})
        self.assertEqual(plugin._resolve_mask_selectors(config), [".a", "#b"])

    def test_an_unset_ini_answered_as_an_empty_list_is_unset(self):
        # pytest 7 and early 8 answer an unset bool or linelist ini with [].
        config = _Config(ini={"devtools_mask_inputs": [], "devtools_mask_selectors": [], "devtools": [], "devtools_trace": []})
        self.assertIsNone(plugin._resolve_mask_inputs(config))
        self.assertIsNone(plugin._resolve_mask_selectors(config))
        self.assertIsNone(plugin._ini(config, "devtools"))
        self.assertIsNone(plugin._ini(config, "devtools_trace"))

    def test_ini_selectors_without_a_flag(self):
        config = _Config(ini={"devtools_mask_selectors": [".c"]})
        self.assertEqual(plugin._resolve_mask_selectors(config), [".c"])


if __name__ == "__main__":
    unittest.main()
