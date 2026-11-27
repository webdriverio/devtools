"""The run's secrets: how they are configured, and that no frame leaves with one."""

from __future__ import annotations

import json
import os
import time
import unittest
from unittest import mock

from selenium_devtools import pytest_plugin as plugin
from selenium_devtools import instrumentation, secret_redaction
from selenium_devtools.capturer import SessionCapturer
from selenium_devtools.constants import ENV_SECRET_ENVS
from selenium_devtools.transport import WSClient

from wire_contract import RecordingTransport

SECRET = "SuperSecretPassword!"


class _Configured(unittest.TestCase):
    def tearDown(self):
        # Turning input masking off is what forgets learned passwords.
        secret_redaction.configure([], automatic=False)
        secret_redaction.configure([])
        secret_redaction._state["stalled"].clear()


class TestConfigure(_Configured):
    def test_nothing_listed_and_no_masking_sends_the_value_as_it_is(self):
        secret_redaction.configure([], automatic=False)
        value = {"args": [SECRET], "headers": {"Authorization": "Bearer t0ken"}}
        self.assertIs(secret_redaction.redact(value), value)

    def test_credential_headers_are_redacted_by_default(self):
        secret_redaction.configure([])
        # The shape frames.network_request and the interceptor rows send.
        self.assertEqual(
            secret_redaction.redact(
                {"requestHeaders": {"Authorization": "Bearer t0ken", "Accept": "*/*"},
                 "responseHeaders": {"Set-Cookie": "a=1"},
                 "response": {"headers": {"Set-Cookie": ["a=1", "b=2"]}},
                 "cookies": "sid=abc"}
            ),
            {"requestHeaders": {"Authorization": "••••", "Accept": "*/*"},
             "responseHeaders": {"Set-Cookie": "••••"},
             "response": {"headers": {"Set-Cookie": ["••••", "••••"]}},
             "cookies": "sid=••••"},
        )

    def test_a_frame_with_nothing_to_redact_is_not_copied(self):
        secret_redaction.configure([])
        frame = [{"command": "click", "args": [f"#el-{i}"], "result": {"n": [i, "x"]}} for i in range(2000)]
        self.assertIs(secret_redaction.redact(frame), frame)

    def test_an_argument_and_an_env_entry(self):
        with mock.patch.dict(os.environ, {"LOGIN_PASSWORD": "hunter22"}):
            secret_redaction.configure([SECRET, {"env": "LOGIN_PASSWORD"}])
        self.assertEqual(
            secret_redaction.redact(["x " + SECRET, "hunter22"]), ["x ••••", "••••"]
        )

    def test_none_reads_the_names_in_the_environment(self):
        with mock.patch.dict(os.environ, {ENV_SECRET_ENVS: "A_SECRET, B_SECRET", "A_SECRET": SECRET, "B_SECRET": "tomsmith"}):
            secret_redaction.configure(None)
        self.assertEqual(secret_redaction.redact("tomsmith / " + SECRET), "•••• / ••••")

    def test_warnings_are_logged_without_the_value(self):
        with self.assertLogs("selenium_devtools.secrets", level="WARNING") as logs:
            warnings = secret_redaction.configure(["abc", {"env": "NOT_SET_ANYWHERE"}])
        self.assertEqual(len(warnings), 2)
        self.assertNotIn("abc", "\n".join(logs.output))
        self.assertNotIn("NOT_SET_ANYWHERE", "\n".join(logs.output))
        self.assertIn("2 entries skipped", "\n".join(logs.output))

    def test_a_cookie_string_of_many_spaces_is_redacted_in_linear_time(self):
        secret_redaction.configure([])
        text = "a=1;" + " " * 200_000 + "b"
        started = time.monotonic()
        self.assertEqual(secret_redaction.redact({"cookies": text})["cookies"], "a=••••;" + " " * 200_000 + "b")
        self.assertLess(time.monotonic() - started, 1.0)


class _RecordingClient(WSClient):
    def __init__(self):
        super().__init__("127.0.0.1", 1)
        self.connected = True
        self._sock = object()
        self.payloads = []

    def _send_frame(self, opcode, payload):
        self.payloads.append(json.loads(payload.decode()))


class TestTransport(_Configured):
    def test_a_frame_leaves_with_the_secret_redacted_and_the_value_untouched(self):
        secret_redaction.configure([SECRET])
        client = _RecordingClient()
        row = {"command": "sendKeysToElement", "args": ["#password", SECRET]}
        self.assertTrue(client.send_json("commands", [row]))
        self.assertEqual(
            client.payloads,
            [{"scope": "commands", "data": [{"command": "sendKeysToElement", "args": ["#password", "••••"]}]}],
        )
        self.assertEqual(row["args"][1], SECRET)


class _RedactingTransport(RecordingTransport):
    """Redacts as ``WSClient.send_json`` does, so a row reads as it would on the wire when it was sent."""

    def send_json(self, scope, data):  # noqa: ANN001, ANN201
        return super().send_json(scope, secret_redaction.redact(data))


class _FormDriver:
    """A login form: element ``pw`` is a password field, ``user`` a text field."""

    def __init__(self):
        self.session_id = None
        self.caps = {"browserName": "chrome"}
        self.received = []

    def execute(self, command, params=None):  # noqa: ANN001, ANN201
        self.received.append(command)
        if command == "getElementProperty" and params.get("name") == "type":
            return {"value": "password" if params.get("id") == "pw" else "text"}
        return {"value": None}


class TestTypedPasswords(_Configured):
    def setUp(self):
        secret_redaction.configure([])
        instrumentation.uninstall()
        self.tx = _RedactingTransport()
        instrumentation.install(SessionCapturer(self.tx), _FormDriver)
        self.addCleanup(instrumentation.uninstall)
        self.driver = _FormDriver()

    def _type(self, element_id, text):
        self.driver.execute("sendKeysToElement", {"id": element_id, "text": text, "value": list(text)})

    def _rows(self):
        return [row for scope, data in self.tx.sent if scope == "commands" for row in data]

    def test_the_row_that_typed_a_password_is_already_redacted(self):
        self._type("pw", SECRET)
        self.assertEqual(self._rows()[-1]["args"][0]["text"], "••••")
        self.assertEqual(self._rows()[-1]["args"][0]["value"], list("••••"))
        self.assertEqual(self.driver.received[:2], ["getElementProperty", "sendKeysToElement"])

    def test_a_source_sent_before_the_password_was_learned_is_sent_again_redacted(self):
        self._type("user", "tomsmith")
        self._type("pw", SECRET)
        sources = [data for scope, data in self.tx.sent if scope == "sources"]
        self.assertEqual(len(sources), 2)
        self.assertIn(SECRET, next(iter(sources[0].values())))
        self.assertNotIn(SECRET, next(iter(sources[-1].values())))
        self.assertEqual(sources[0].keys(), sources[-1].keys())

    def test_text_typed_into_another_field_is_kept(self):
        self._type("user", "tomsmith")
        self.assertEqual(self._rows()[-1]["args"][0]["text"], "tomsmith")

    def test_a_short_value_or_a_known_password_reads_no_field_type(self):
        self._type("pw", "abc")
        self._type("pw", SECRET)
        self._type("pw", SECRET)
        self.assertEqual(self.driver.received.count("getElementProperty"), 1)

    def test_mask_inputs_off_reads_nothing_and_keeps_the_text(self):
        secret_redaction.configure([], automatic=False)
        self._type("pw", SECRET)
        self.assertNotIn("getElementProperty", self.driver.received)
        self.assertEqual(self._rows()[-1]["args"][0]["text"], SECRET)

    def test_a_read_past_its_ceiling_is_abandoned(self):
        def slow():
            time.sleep(0.5)
            return "password"

        with mock.patch.object(secret_redaction, "FIELD_TYPE_PROBE_TIMEOUT_S", 0.05):
            started = time.monotonic()
            secret_redaction.note_typed_input(SECRET, slow)
        self.assertLess(time.monotonic() - started, 0.4)
        self.assertEqual(secret_redaction.redact(SECRET), "••••")

    def test_a_session_whose_read_timed_out_reads_no_more_and_redacts_what_it_types(self):
        calls = []

        def slow():
            calls.append(1)
            time.sleep(0.3)
            return "password"

        with mock.patch.object(secret_redaction, "FIELD_TYPE_PROBE_TIMEOUT_S", 0.05):
            secret_redaction.note_typed_input(SECRET, slow, session="s1")
            secret_redaction.note_typed_input("another-secret", slow, session="s1")
            secret_redaction.note_typed_input("third-secret", lambda: "password", session="s2")
        self.assertEqual(len(calls), 1)
        self.assertEqual(secret_redaction.redact("another-secret third-secret"), "•••• ••••")

    def test_learned_passwords_survive_a_reconfigure_unless_masking_is_turned_off(self):
        secret_redaction.note_typed_input(SECRET, lambda: "password")
        secret_redaction.configure(["another-secret"])
        self.assertEqual(secret_redaction.redact(SECRET), "••••")
        secret_redaction.configure([], automatic=False)
        self.assertEqual(secret_redaction.redact(SECRET), SECRET)

    def test_a_failed_read_leaves_the_command_running_and_redacts_what_it_types(self):
        def broken():
            raise RuntimeError("no such element")

        secret_redaction.note_typed_input(SECRET, broken)
        self.assertEqual(secret_redaction.redact(SECRET), "••••")

    def test_an_unanswered_read_warns_once_per_configure_without_the_value(self):
        def broken():
            raise RuntimeError("no such element")

        with self.assertLogs(secret_redaction._log, level="WARNING") as logs:
            secret_redaction.note_typed_input(SECRET, broken)
            secret_redaction.note_typed_input("another-secret", broken)
            secret_redaction.configure([])
            secret_redaction.note_typed_input("third-secret", broken)
        warnings = [line for line in logs.output if "could not be checked" in line]
        self.assertEqual(len(warnings), 2)
        for value in (SECRET, "another-secret", "third-secret"):
            self.assertFalse(any(value in line for line in warnings))

    def test_a_field_that_answered_with_no_type_keeps_the_text(self):
        secret_redaction.note_typed_input("tomsmith", lambda: None)
        self.assertEqual(secret_redaction.redact("tomsmith"), "tomsmith")


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
        self.assertIsNone(plugin._resolve_secrets(_Config()))
        self.assertIsNone(plugin._resolve_secrets(_Config(ini={"devtools_secret_envs": []})))

    def test_the_command_line_beats_the_ini(self):
        config = _Config(
            {"--devtools-secret": [SECRET], "--devtools-secret-env": ["LOGIN_PASSWORD"]},
            {"devtools_secret_envs": ["OTHER"]},
        )
        self.assertEqual(plugin._resolve_secrets(config), [SECRET, {"env": "LOGIN_PASSWORD"}])

    def test_the_ini_names_variables(self):
        config = _Config(ini={"devtools_secret_envs": ["LOGIN_PASSWORD", "API_TOKEN"]})
        self.assertEqual(
            plugin._resolve_secrets(config), [{"env": "LOGIN_PASSWORD"}, {"env": "API_TOKEN"}]
        )


if __name__ == "__main__":
    unittest.main()


class TestSpecialKeysBetweenParts(unittest.TestCase):
    def test_redacts_a_typed_password_with_a_key_between_its_parts(self) -> None:
        redactor = secret_redaction.create_secret_redactor([], typed=["SuperSecret"])
        shift = ""
        row = redactor.redact({"args": ["#password", f"Super{shift}Secret"]})
        self.assertEqual(row["args"], ["#password", secret_redaction.REDACTED_SECRET])
        self.assertEqual(redactor.redact_string(f"Super{shift}"), f"Super{shift}")

    def test_matches_in_linear_time(self) -> None:
        redactor = secret_redaction.create_secret_redactor([], typed=["abcdefgh"])
        text = "abcdefg" + "" * 100_000 + "x"
        started = time.perf_counter()
        self.assertEqual(redactor.redact_string(text), text)
        self.assertLess(time.perf_counter() - started, 1.0)
