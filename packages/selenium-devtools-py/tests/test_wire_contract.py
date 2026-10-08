"""The wire-contract check that every RecordingTransport applies."""

import unittest

from selenium_devtools import _wire_types, frames

from wire_contract import SCHEMA, RecordingTransport, violations


def _command(**overrides):
    row = frames.command_log(
        command="click", args=[], timestamp=2, start_time=1,
        call_source=None, command_id=1,
    )
    row.update(overrides)
    return row


class TestTheCheck(unittest.TestCase):
    def test_a_built_row_passes(self):
        self.assertEqual(violations("commands", [_command()]), [])

    def test_a_null_where_shared_expects_absence_fails(self):
        problems = violations("commands", [_command(callSource=None)])
        self.assertEqual(len(problems), 1)
        self.assertIn("callSource", problems[0])

    def test_a_field_shared_does_not_declare_fails(self):
        problems = violations("commands", [_command(colour="red")])
        self.assertIn("'colour' is not a field shared declares", problems[0])

    def test_a_missing_required_field_fails(self):
        row = _command()
        del row["args"]
        self.assertIn("missing required 'args'", violations("commands", [row])[0])

    def test_a_value_outside_an_enum_fails(self):
        entry = frames.console_log(level="shout", args=[], timestamp=1)
        self.assertIn("is not one of", violations("consoleLogs", [entry])[0])

    def test_a_scope_shared_has_no_payload_for_fails(self):
        self.assertIn("no payload type", violations("madeUp", {})[0])

    def test_a_bad_frame_fails_the_test_even_when_the_sender_swallows_errors(self):
        class Swallowing(unittest.TestCase):
            def test_it(self):
                tx = RecordingTransport()
                try:
                    tx.send_json("commands", [_command(callSource=None)])
                except Exception:  # noqa: BLE001 — what every best-effort sender does
                    pass

        result = unittest.TestResult()
        Swallowing("test_it").run(result)
        self.assertEqual(len(result.failures), 1)
        self.assertIn("callSource", result.failures[0][1])

    def test_a_clean_frame_leaves_the_test_passing(self):
        tx = RecordingTransport()
        tx.send_json("commands", [_command()])
        self.assertEqual(tx.violations, [])


class TestGeneratedTypesMatchTheSchema(unittest.TestCase):
    """`_wire_types.py` is regenerated and diffed in CI; this pins that the
    generator splits required from optional keys the way the schema does."""

    def test_every_definition_keeps_its_required_keys(self):
        for name, schema in SCHEMA["$defs"].items():
            with self.subTest(name=name):
                cls = getattr(_wire_types, name)
                self.assertEqual(cls.__required_keys__, frozenset(schema["required"]))
                self.assertEqual(
                    cls.__required_keys__ | cls.__optional_keys__,
                    frozenset(schema["properties"]),
                )


if __name__ == "__main__":
    unittest.main()
