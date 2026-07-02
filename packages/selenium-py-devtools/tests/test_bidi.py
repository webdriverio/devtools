import unittest

from wdio_selenium_devtools import bidi
from wdio_selenium_devtools.capturer import SessionCapturer


class FakeTransport:
    connected = True

    def __init__(self):
        self.sent = []

    def send_json(self, scope, data):
        self.sent.append((scope, data))
        return True

    def close(self):
        pass


class FakeLogEntry:
    """Mimics selenium's ConsoleLogEntry/JavaScriptLogEntry dataclass."""

    def __init__(self, level, text, method=None, args=None, stacktrace=None):
        self.level = level
        self.text = text
        if method is not None:
            self.method = method
        if args is not None:
            self.args = args
        if stacktrace is not None:
            self.stacktrace = stacktrace


def _string(value):
    return {"type": "string", "value": value}


def _number(value):
    return {"type": "number", "value": value}


class TestConsoleMapping(unittest.TestCase):
    def test_normalize_level_maps_and_falls_back(self):
        self.assertEqual(bidi.normalize_level("SEVERE"), "error")
        self.assertEqual(bidi.normalize_level("warning"), "warn")
        self.assertEqual(bidi.normalize_level("info"), "info")
        self.assertEqual(bidi.normalize_level("mystery"), "log")
        self.assertEqual(bidi.normalize_level(None), "log")

    def test_console_kwargs_from_object_text_fallback(self):
        # No args on the entry -> falls back to .text as a single-element list.
        level, args = bidi.console_kwargs(FakeLogEntry("error", "boom"))
        self.assertEqual(level, "error")
        self.assertEqual(args, ["boom"])

    def test_console_kwargs_from_dict_message_fallback(self):
        level, args = bidi.console_kwargs({"level": "warning", "message": "hi"})
        self.assertEqual(level, "warn")
        self.assertEqual(args, ["hi"])

    def test_console_kwargs_captures_all_args(self):
        # console.log('a', {b:1}, 42) -> args come through as RemoteValues.
        entry = {
            "level": "info",
            "method": "log",
            "text": "a [object Object] 42",  # BiDi's flattened text
            "args": [
                _string("a"),
                {"type": "object", "value": [[_string("b"), _number(1)]]},
                _number(42),
            ],
        }
        level, args = bidi.console_kwargs(entry)
        self.assertEqual(level, "log")
        self.assertEqual(args, ["a", {"b": 1}, 42])

    def test_console_kwargs_prefers_method_over_level(self):
        # BiDi 'level' is coarse (only debug/info/warn/error); 'method' is exact.
        entry = {"level": "info", "method": "debug", "args": [_string("d")]}
        level, args = bidi.console_kwargs(entry)
        self.assertEqual(level, "debug")
        self.assertEqual(args, ["d"])

    def test_console_kwargs_each_level(self):
        cases = {
            "log": "log",
            "info": "info",
            "warn": "warn",
            "warning": "warn",
            "error": "error",
            "debug": "debug",
            "trace": "trace",
        }
        for method, expected in cases.items():
            entry = {"method": method, "args": [_string("x")]}
            level, args = bidi.console_kwargs(entry)
            self.assertEqual(level, expected, f"method={method}")
            self.assertEqual(args, ["x"])

    def test_console_kwargs_empty_args_not_replaced_by_text(self):
        # A real console.log() with no arguments -> empty list, no text fallback.
        entry = {"method": "log", "text": "should-not-appear", "args": []}
        level, args = bidi.console_kwargs(entry)
        self.assertEqual(level, "log")
        self.assertEqual(args, [])


class TestRemoteValueDeserialization(unittest.TestCase):
    def test_primitives(self):
        self.assertEqual(bidi.remote_value_to_py(_string("hi")), "hi")
        self.assertEqual(bidi.remote_value_to_py(_number(7)), 7)
        self.assertEqual(
            bidi.remote_value_to_py({"type": "boolean", "value": True}), True
        )
        self.assertIsNone(bidi.remote_value_to_py({"type": "null"}))
        self.assertIsNone(bidi.remote_value_to_py({"type": "undefined"}))

    def test_bigint_parsed(self):
        self.assertEqual(
            bidi.remote_value_to_py({"type": "bigint", "value": "12345678901234567890"}),
            12345678901234567890,
        )

    def test_array_and_object_nested(self):
        arr = {"type": "array", "value": [_string("a"), _number(1)]}
        self.assertEqual(bidi.remote_value_to_py(arr), ["a", 1])
        obj = {
            "type": "object",
            "value": [[_string("k"), {"type": "array", "value": [_number(2)]}]],
        }
        self.assertEqual(bidi.remote_value_to_py(obj), {"k": [2]})

    def test_non_remote_value_passthrough(self):
        self.assertEqual(bidi.remote_value_to_py("plain"), "plain")
        self.assertEqual(bidi.remote_value_to_py(42), 42)
        self.assertEqual(bidi.remote_value_to_py({"no": "type"}), {"no": "type"})


class TestJsErrorMapping(unittest.TestCase):
    def test_js_error_is_error_level_with_message(self):
        level, args = bidi.js_error_kwargs({"level": "error", "text": "boom"})
        self.assertEqual(level, "error")
        self.assertEqual(args, ["boom"])

    def test_js_error_includes_stacktrace(self):
        entry = {
            "text": "ReferenceError: x is not defined",
            "stacktrace": {
                "callFrames": [
                    {
                        "functionName": "doThing",
                        "url": "https://x/app.js",
                        "lineNumber": 12,
                        "columnNumber": 5,
                    }
                ]
            },
        }
        level, args = bidi.js_error_kwargs(entry)
        self.assertEqual(level, "error")
        self.assertEqual(len(args), 1)
        self.assertIn("ReferenceError: x is not defined", args[0])
        self.assertIn("at doThing (https://x/app.js:12:5)", args[0])

    def test_js_error_object_entry(self):
        level, args = bidi.js_error_kwargs(FakeLogEntry("error", "kaboom"))
        self.assertEqual(level, "error")
        self.assertEqual(args, ["kaboom"])

    def test_js_error_no_stack_is_message_only(self):
        level, args = bidi.js_error_kwargs({"text": "oops", "stacktrace": None})
        self.assertEqual(args, ["oops"])


class TestNetworkMapping(unittest.TestCase):
    def test_request_sent_kwargs_shape(self):
        params = {
            "request": {
                "request": "req-1",
                "url": "https://x/app.js",
                "method": "GET",
                "headers": [{"name": "Accept", "value": {"value": "*/*"}}],
            },
            "timestamp": 1000,
        }
        kw = bidi.request_sent_kwargs(params)
        self.assertEqual(kw["request_id"], "req-1")
        self.assertEqual(kw["url"], "https://x/app.js")
        self.assertEqual(kw["method"], "GET")
        self.assertEqual(kw["status"], None)
        self.assertEqual(kw["start_time"], 1000)
        self.assertEqual(kw["request_type"], "script")  # .js extension
        self.assertEqual(kw["request_headers"], {"accept": "*/*"})

    def test_request_sent_kwargs_none_without_id(self):
        self.assertIsNone(bidi.request_sent_kwargs({"request": {}}))

    def test_response_completed_merges_over_pending(self):
        pending = {}
        req = bidi.request_sent_kwargs(
            {"request": {"request": "req-2", "url": "https://x/api",
                         "method": "POST"}, "timestamp": 1000}
        )
        pending[req["request_id"]] = req
        resp = bidi.response_completed_kwargs(
            {
                "request": {
                    "request": "req-2",
                    "timings": {"requestTime": 0, "responseEnd": 250},
                },
                "response": {"status": 201, "statusText": "Created",
                             "mimeType": "application/json", "bytesReceived": 42},
                "timestamp": 1300,
            },
            pending,
        )
        self.assertEqual(resp["status"], 201)
        self.assertEqual(resp["status_text"], "Created")
        self.assertEqual(resp["size"], 42)
        self.assertEqual(resp["request_type"], "fetch")  # json mime
        self.assertEqual(resp["time"], 250)  # from timings, not timestamp delta
        self.assertEqual(resp["end_time"], 1000 + 250)

    def test_response_completed_none_when_unmatched(self):
        self.assertIsNone(
            bidi.response_completed_kwargs({"request": {"request": "ghost"}}, {})
        )

    def test_response_timing_falls_back_to_timestamp_delta(self):
        pending = {}
        req = bidi.request_sent_kwargs(
            {"request": {"request": "req-3", "url": "https://x"},
             "timestamp": 500}
        )
        pending[req["request_id"]] = req
        resp = bidi.response_completed_kwargs(
            {"request": {"request": "req-3"}, "response": {"status": 200},
             "timestamp": 700},
            pending,
        )
        self.assertEqual(resp["end_time"], 700)
        self.assertEqual(resp["time"], 200)

    def test_headers_to_object_handles_non_list(self):
        self.assertIsNone(bidi.headers_to_object(None))
        self.assertIsNone(bidi.headers_to_object("nope"))


class TestRequestType(unittest.TestCase):
    def test_mime_type_precedence(self):
        self.assertEqual(bidi.request_type_for("https://x/", "text/html"), "document")
        self.assertEqual(bidi.request_type_for("https://x/a", "text/css"), "stylesheet")
        self.assertEqual(bidi.request_type_for("https://x/a.js"), "script")
        self.assertEqual(bidi.request_type_for("https://x/pic.png"), "image")
        self.assertEqual(bidi.request_type_for("https://x/unknown"), "xhr")


class TestAttachDefensive(unittest.TestCase):
    """attach must degrade — never raise — when BiDi isn't available."""

    def _capturer(self):
        return SessionCapturer(FakeTransport())

    def test_attach_skips_without_websocket_capability(self):
        class Driver:
            caps = {"browserName": "chrome"}  # no webSocketUrl
        self.assertFalse(bidi.attach(Driver(), self._capturer()))

    def test_attach_survives_channel_errors(self):
        class Driver:
            caps = {"webSocketUrl": "ws://x"}

            @property
            def script(self):
                raise RuntimeError("no bidi here")

            @property
            def network(self):
                raise RuntimeError("no bidi here")

        # Both channels raise; attach returns False without propagating.
        self.assertFalse(bidi.attach(Driver(), self._capturer()))

    def test_console_handler_pushes_to_capturer(self):
        """End-to-end: a fake script channel drives capture_console."""
        cap = self._capturer()

        class Script:
            def add_console_message_handler(self, cb):
                cb(FakeLogEntry("info", "hello"))

            def add_javascript_error_handler(self, cb):
                pass

        class Driver:
            caps = {"webSocketUrl": "ws://x"}
            script = Script()

            @property
            def network(self):
                raise RuntimeError("skip network")

        self.assertTrue(bidi.attach(Driver(), cap))
        console = [d for s, d in cap._tx.sent if s == "consoleLogs"]
        self.assertEqual(len(console), 1)
        self.assertEqual(console[0][0]["type"], "info")
        self.assertEqual(console[0][0]["args"], ["hello"])
        self.assertEqual(console[0][0]["source"], "browser")

    def test_console_and_js_error_routed_separately(self):
        """console entries -> console_kwargs; JS errors -> js_error_kwargs."""
        cap = self._capturer()

        class Script:
            def add_console_message_handler(self, cb):
                cb({
                    "method": "warn",
                    "args": [{"type": "string", "value": "danger"},
                             {"type": "number", "value": 9}],
                })

            def add_javascript_error_handler(self, cb):
                cb({
                    "level": "error",
                    "text": "TypeError: boom",
                    "stacktrace": {"callFrames": [
                        {"functionName": "f", "url": "u", "lineNumber": 1,
                         "columnNumber": 2}
                    ]},
                })

        class Driver:
            caps = {"webSocketUrl": "ws://x"}
            script = Script()

            @property
            def network(self):
                raise RuntimeError("skip network")

        self.assertTrue(bidi.attach(Driver(), cap))
        console = [d[0] for s, d in cap._tx.sent if s == "consoleLogs"]
        self.assertEqual(len(console), 2)
        self.assertEqual(console[0]["type"], "warn")
        self.assertEqual(console[0]["args"], ["danger", 9])
        self.assertEqual(console[1]["type"], "error")
        self.assertIn("TypeError: boom", console[1]["args"][0])
        self.assertIn("at f (u:1:2)", console[1]["args"][0])

    def test_malformed_console_entry_is_no_op_not_raise(self):
        """A handler that trips on a bad entry must not propagate the error."""
        cap = self._capturer()

        class Script:
            def add_console_message_handler(self, cb):
                cb(object())  # no level/method/args/text attrs

            def add_javascript_error_handler(self, cb):
                pass

        class Driver:
            caps = {"webSocketUrl": "ws://x"}
            script = Script()

            @property
            def network(self):
                raise RuntimeError("skip network")

        # Must not raise; a plain object degrades to a log-level empty-text entry.
        self.assertTrue(bidi.attach(Driver(), cap))


if __name__ == "__main__":
    unittest.main()
