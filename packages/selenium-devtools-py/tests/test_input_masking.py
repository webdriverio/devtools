"""Typed-text masking: the policy, the payload masking, the scrub, and where the
adapter applies them. The cases both languages share are in test_mirror_vectors."""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from selenium_devtools import input_masking, instrumentation, pytest_plugin as plugin, snapshot
from selenium_devtools.capturer import SessionCapturer
from selenium_devtools.constants import ENV_MASK_INPUTS, ENV_MASK_SELECTORS
from selenium_devtools.input_masking import MASKED_VALUE

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
        input_masking.clear_typed()
        self.addCleanup(input_masking.clear_typed)
        self.addCleanup(input_masking.configure, True, [])


class TestPolicy(_Masked):
    def test_default_masks_inputs_and_names_no_selectors(self):
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

    def test_a_truthy_environment_value_keeps_masking(self):
        os.environ[ENV_MASK_INPUTS] = "yes"
        self.assertTrue(input_masking.configure()["inputs"])

    def test_configure_keeps_what_was_typed_unless_the_policy_changes(self):
        input_masking.mask_command_params("sendKeysToElement", {"text": SECRET})
        input_masking.configure(True, [])
        self.assertEqual(input_masking.scrub_text(SECRET), MASKED_VALUE)
        input_masking.configure(True, [".iban"])
        self.assertEqual(input_masking.scrub_text(SECRET), SECRET)

    def test_clear_typed_forgets_what_was_typed(self):
        input_masking.mask_command_params("sendKeysToElement", {"text": SECRET})
        input_masking.clear_typed()
        self.assertEqual(input_masking.scrub_text(SECRET), SECRET)

    def test_a_single_typed_character_is_never_remembered(self):
        input_masking.mask_command_params("sendKeysToElement", {"text": "a"})
        self.assertEqual(input_masking.scrub_text("a"), "a")

    def test_scrubbing_reads_a_copy_while_another_thread_types(self):
        input_masking.mask_command_params("sendKeysToElement", {"text": "first-value"})
        input_masking.mask_command_params("sendKeysToElement", {"text": "second-value"})
        real_forms = input_masking._forms

        def forms_while_typing(value):
            # What a send_keys on the test thread does while a BiDi thread is building the pattern.
            input_masking.mask_command_params("sendKeysToElement", {"text": f"{value}-again"})
            return real_forms(value)

        with mock.patch.object(input_masking, "_forms", forms_while_typing):
            self.assertEqual(input_masking.scrub_text("x first-value"), "x " + MASKED_VALUE)


    def test_a_value_typed_while_the_pattern_is_built_is_scrubbed_next_time(self):
        input_masking.mask_command_params("sendKeysToElement", {"text": "first-value"})
        real_forms = input_masking._forms
        typed_during_build = {"done": False}

        def forms_while_typing(value):
            if not typed_during_build["done"]:
                typed_during_build["done"] = True
                input_masking.mask_command_params("sendKeysToElement", {"text": "late-value"})
            return real_forms(value)

        with mock.patch.object(input_masking, "_forms", forms_while_typing):
            input_masking.scrub_text("x first-value")
        self.assertEqual(input_masking.scrub_text("x late-value"), "x " + MASKED_VALUE)

class TestMaskAndScrub(_Masked):
    def test_masking_never_changes_the_callers_params(self):
        params = {"id": "e", "text": SECRET, "value": list(SECRET)}
        masked = input_masking.mask_command_params("sendKeysToElement", params)
        self.assertEqual(params, {"id": "e", "text": SECRET, "value": list(SECRET)})
        self.assertEqual(masked["text"], MASKED_VALUE)

    def test_the_opt_out_keeps_the_text_and_remembers_nothing(self):
        input_masking.configure(False, [])
        params = {"text": SECRET}
        self.assertIs(input_masking.mask_command_params("sendKeysToElement", params), params)
        self.assertEqual(input_masking.scrub_text(SECRET), SECRET)

    def test_the_registry_keeps_only_the_newest_values(self):
        for i in range(201):
            input_masking.mask_command_params("sendKeysToElement", {"text": f"value-{i:04d}"})
        self.assertEqual(input_masking.scrub_text("value-0000"), "value-0000")
        self.assertEqual(input_masking.scrub_text("value-0200"), MASKED_VALUE)

    def test_retyping_a_value_keeps_it_from_being_evicted(self):
        input_masking.mask_command_params("sendKeysToElement", {"text": "first-value"})
        for i in range(199):
            input_masking.mask_command_params("sendKeysToElement", {"text": f"value-{i:04d}"})
        input_masking.mask_command_params("sendKeysToElement", {"text": "first-value"})
        input_masking.mask_command_params("sendKeysToElement", {"text": "one-more"})
        self.assertEqual(input_masking.scrub_text("first-value"), MASKED_VALUE)

    def test_deep_scrub_copies_and_reaches_nested_strings(self):
        input_masking.mask_command_params("sendKeysToElement", {"text": SECRET})
        value = {"a": [SECRET, {"b": f"pw={SECRET}"}], "n": 3}
        self.assertEqual(
            input_masking.scrub(value),
            {"a": [MASKED_VALUE, {"b": f"pw={MASKED_VALUE}"}], "n": 3},
        )
        self.assertEqual(value["a"][0], SECRET)


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


class TestInstrumentationMasks(_Masked):
    def setUp(self):
        super().setUp()
        instrumentation.uninstall()
        self.tx = RecordingTransport()
        instrumentation.install(SessionCapturer(self.tx), FakeDriver)
        self.addCleanup(instrumentation.uninstall)
        self.driver = FakeDriver()

    def _rows(self):
        return [row for scope, data in self.tx.sent if scope == "commands" for row in data]

    def test_the_driver_gets_the_text_and_the_row_gets_the_mask(self):
        self.driver.execute("sendKeysToElement", {"id": "e", "text": SECRET, "value": list(SECRET)})
        self.assertEqual(self.driver.received[-1][1]["text"], SECRET)
        row = self._rows()[-1]
        self.assertEqual(row["args"], [{"id": "e", "text": MASKED_VALUE, "value": [MASKED_VALUE]}])

    def test_a_read_returning_the_typed_text_is_scrubbed(self):
        self.driver.execute("sendKeysToElement", {"id": "e", "text": SECRET})
        self.driver.execute("getElementProperty", {"id": "e", "name": "value"})
        self.assertEqual(self._rows()[-1]["result"], MASKED_VALUE)

    def test_the_opt_out_captures_the_text(self):
        input_masking.configure(False, [])
        self.driver.execute("sendKeysToElement", {"id": "e", "text": SECRET})
        self.assertEqual(self._rows()[-1]["args"], [{"id": "e", "text": SECRET}])


class TestCapturerScrubs(_Masked):
    def setUp(self):
        super().setUp()
        self.tx = RecordingTransport()
        self.cap = SessionCapturer(self.tx)
        input_masking.mask_command_params("sendKeysToElement", {"text": SECRET})

    def _sent(self, scope):
        return [d for s, d in self.tx.sent if s == scope]

    def test_console_lines(self):
        self.cap.capture_console("info", [f"typed {SECRET}"], source="terminal")
        self.assertEqual(self._sent("consoleLogs")[0][0]["args"], [f"typed {MASKED_VALUE}"])

    def test_page_request_bodies(self):
        self.cap.send_network_requests(
            [{
                "id": "1", "url": "https://x/login", "method": "POST", "type": "fetch",
                "timestamp": 1, "startTime": 1, "requestBody": f"password={SECRET}",
            }]
        )
        self.assertEqual(self._sent("networkRequests")[0][0]["requestBody"], f"password={MASKED_VALUE}")

    def test_replaced_rows(self):
        row = self.cap.capture_command(command="x", args=[], result=None, start_time=0, call_source=None)
        row["result"] = SECRET
        self.cap.send_replace_command(row["timestamp"], row)
        self.assertEqual(self._sent("replaceCommand")[0]["command"]["result"], MASKED_VALUE)

    def test_assertion_errors(self):
        self.cap.capture_command(
            command="assert", args=[SECRET], error=AssertionError(f"{SECRET} != x"),
            start_time=0, call_source=None,
        )
        row = self._sent("commands")[-1][0]
        self.assertEqual(row["args"], [MASKED_VALUE])
        self.assertNotIn(SECRET, row["error"]["message"])


class TestCollectorCarriesThePolicy(_Masked):
    def test_the_source_starts_with_the_prelude(self):
        input_masking.configure(False, [".card"])
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as handle:
            handle.write("/* collector */")
        self.addCleanup(os.unlink, handle.name)
        source = snapshot.collector_source_text(handle.name)
        self.assertEqual(
            source, 'var __wdioCaptureMask = {"inputs":false,"selectors":[".card"]};\n/* collector */'
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

    def test_ini_selectors_without_a_flag(self):
        config = _Config(ini={"devtools_mask_selectors": [".c"]})
        self.assertEqual(plugin._resolve_mask_selectors(config), [".c"])




class TestTestScope(_Masked):
    def test_a_test_start_forgets_the_previous_test_s_typing(self):
        input_masking.mask_command_params("sendKeysToElement", {"text": SECRET})
        with mock.patch.object(plugin, "_opted_in", return_value=True), mock.patch.object(
            plugin.devtools, "get_capturer", return_value=None
        ):
            plugin.pytest_runtest_logstart("test_x.py::test_two", ("test_x.py", 5, "test_two"))
        self.assertEqual(input_masking.scrub_text(SECRET), SECRET)


if __name__ == "__main__":
    unittest.main()
