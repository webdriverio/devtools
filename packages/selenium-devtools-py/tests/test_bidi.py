import sys
import types
import unittest
from unittest import mock

from selenium_devtools import bidi
from selenium_devtools.capturer import SessionCapturer


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


def fake_network_module(with_event_manager=True):
    """A stand-in for selenium 4.44+'s regenerated `bidi.network`.

    Faked rather than skipped-without-selenium: the installed selenium here is
    4.36, so the 4.44+ path has no other way to be exercised, and it is the path
    every new user is on.
    """
    module = types.ModuleType("selenium.webdriver.common.bidi.network")

    class EventConfig:
        def __init__(self, event_key, bidi_event, event_class):
            self.event_key = event_key
            self.bidi_event = bidi_event
            self.event_class = event_class

    class Network:
        EVENT_CONFIGS = {}

        def __init__(self):
            self.handlers = {}
            # selenium builds its deserializers here, from the configs that
            # exist at construction time. Mirrored because that timing is the
            # whole reason registration has to come first.
            self.deserializers = {
                config.bidi_event: config.event_class
                for config in self.EVENT_CONFIGS.values()
            }

        def add_event_handler(self, event, callback, contexts=None):
            # selenium raises for an unregistered key rather than ignoring it.
            config = self.EVENT_CONFIGS.get(event)
            if config is None:
                raise ValueError(f"Event '{event}' not found")
            self.handlers[event] = callback
            return len(self.handlers)

    if not with_event_manager:
        del Network.add_event_handler
        del Network.EVENT_CONFIGS

    module.EventConfig = EventConfig
    module.Network = Network
    return module


class NewSeleniumDriver:
    """A 4.44+ driver. Records WHEN `.network` is first touched, because the
    deserializers are built in `Network.__init__` — registering after that is
    too late, and the failure would be silent."""

    def __init__(self, network, log):
        self.caps = {"webSocketUrl": "ws://x"}
        self._network = network
        self._log = log

    @property
    def network(self):
        self._log.append("network accessed")
        return self._network

    @property
    def script(self):
        raise RuntimeError("console not under test")


class TestTheEventManagerPath(unittest.TestCase):
    """selenium 4.44+ — subscribing through the public `add_event_handler`."""

    def test_raw_params_reach_the_handlers_and_are_captured(self):
        module = fake_network_module()
        network = module.Network()
        capturer = SessionCapturer(FakeTransport())

        with mock.patch.dict(
            sys.modules, {"selenium.webdriver.common.bidi.network": module}
        ):
            self.assertTrue(bidi._attach_network(NewSeleniumDriver(network, []), capturer))

            sent = network.handlers["devtools_before_request_sent"]
            done = network.handlers["devtools_response_completed"]

        # Raw params, exactly as selenium's dict-config deserializer delivers.
        sent({"request": {"request": "R1", "url": "https://x/a.js", "method": "GET"},
              "timestamp": 1000})
        done({"request": {"request": "R1"}, "timestamp": 1200,
              "response": {"status": 200, "statusText": "OK",
                           "mimeType": "text/javascript", "bytesReceived": 12}})

        # capture_network sends one batch per call, each a list of one frame.
        frames = [
            batch[0] for scope, batch in capturer._tx.sent
            if scope == "networkRequests"
        ]
        self.assertEqual(len(frames), 2)
        self.assertEqual(frames[0]["url"], "https://x/a.js")
        self.assertEqual(frames[1]["status"], 200)  # correlated with the request

    def test_configs_are_registered_before_network_is_constructed(self):
        """The ordering IS the mechanism. `Network.__init__` builds one
        deserializer per event from the configs present at that moment, so
        registering after the first `driver.network` silently keeps the lossy
        typed path and every entry loses its request id."""
        log = []

        class RecordingConfigs(dict):
            def setdefault(self, *args, **kwargs):
                log.append("registered")
                return super().setdefault(*args, **kwargs)

        module = fake_network_module()
        module.Network.EVENT_CONFIGS = RecordingConfigs()

        with mock.patch.dict(
            sys.modules, {"selenium.webdriver.common.bidi.network": module}
        ):
            bidi._attach_network(
                NewSeleniumDriver(module.Network(), log), SessionCapturer(FakeTransport())
            )

        self.assertEqual(log[0], "registered")
        self.assertIn("network accessed", log)

    def test_both_events_register_a_raw_config(self):
        module = fake_network_module()
        with mock.patch.dict(
            sys.modules, {"selenium.webdriver.common.bidi.network": module}
        ):
            self.assertTrue(bidi.register_raw_event_configs())

        configs = module.Network.EVENT_CONFIGS
        for bidi_event, key in bidi.BIDI_NET_EVENT_KEYS.items():
            self.assertEqual(configs[key].bidi_event, bidi_event)
            # dict is what makes selenium pass the params through untouched.
            self.assertIs(configs[key].event_class, dict)

    def test_legacy_selenium_keeps_the_connection_path(self):
        module = fake_network_module(with_event_manager=False)
        with mock.patch.dict(
            sys.modules, {"selenium.webdriver.common.bidi.network": module}
        ):
            self.assertFalse(bidi.register_raw_event_configs())


class TestEventParams(unittest.TestCase):
    def test_a_raw_dict_is_its_own_params(self):
        self.assertEqual(bidi.event_params({"request": {}}), {"request": {}})

    def test_a_legacy_event_object_is_unwrapped(self):
        event = types.SimpleNamespace(params={"request": {"url": "u"}})
        self.assertEqual(bidi.event_params(event), {"request": {"url": "u"}})

    def test_anything_else_degrades_to_empty(self):
        self.assertEqual(bidi.event_params(object()), {})


class TestADegradedEventIsReported(unittest.TestCase):
    """If a future selenium reinstates a typed class for these events, the
    request is stripped and nothing can be correlated. That must not look like
    a quiet network-free page — it is the failure this port exists to end."""

    def setUp(self):
        bidi._reported_incomplete.clear()

    def test_an_event_without_a_request_warns(self):
        with self.assertLogs("selenium_devtools.bidi", level="WARNING") as logs:
            self.assertTrue(bidi._incomplete_event({"initiator": {}}, "network.x"))

        self.assertIn("cannot be correlated", "\n".join(logs.output))

    def test_it_warns_once_per_event_not_once_per_request(self):
        # The condition is a property of the selenium build, not of a request:
        # warning per event would put one line per HTTP request into the user's
        # console and bury the message.
        with self.assertLogs("selenium_devtools.bidi", level="WARNING") as logs:
            for _ in range(5):
                self.assertTrue(bidi._incomplete_event({}, "network.x"))

        self.assertEqual(len(logs.output), 1)

    def test_each_event_type_reports_separately(self):
        with self.assertLogs("selenium_devtools.bidi", level="WARNING") as logs:
            bidi._incomplete_event({}, "network.beforeRequestSent")
            bidi._incomplete_event({}, "network.responseCompleted")

        self.assertEqual(len(logs.output), 2)

    def test_a_complete_event_is_silent(self):
        self.assertFalse(bidi._incomplete_event({"request": {"request": "R"}}, "network.x"))


class TestWhyNetworkCaptureIsOff(unittest.TestCase):
    """The connection path is unreachable on 4.44+, so arriving there means the
    regenerated layer is installed but did not present the API that defines it.
    That is a combination the adapter does not know about, and the warning has to
    say so rather than echo an ImportError that reads like a broken install."""

    def test_a_moved_surface_is_reported_as_a_version_gap(self):
        major, minor = bidi.SELENIUM_NETWORK_SURFACE_MOVED_AT
        with mock.patch.object(
            bidi, "selenium_version", return_value=(major, minor + 1)
        ):
            reason = bidi.network_unavailable_reason(
                ImportError("cannot import name 'NetworkEvent'")
            )

        # BOTH versions, and they are different things: what the user has, and
        # where the surface moved. Asserted on the ATTRIBUTION, not on the
        # version appearing somewhere — the moved-at version is also named in
        # the "selenium < X captures network" advice, so a bare assertIn passes
        # even when the sentence blames the installed version for the move.
        self.assertIn(f"on selenium {major}.{minor + 1}", reason)
        self.assertIn(f"{major}.{minor}+ event-handler API", reason)
        # The underlying error, and the half that still works — without it this
        # reads as total loss.
        self.assertIn("cannot import name", reason)
        self.assertIn("Console", reason)
        self.assertIn("report", reason)

    def test_an_ordinary_failure_still_reports_the_exception(self):
        # Below the moved version the connection path is the ONLY path, so a
        # failure there is ordinary and blaming the selenium release would send
        # the reader somewhere with no answer.
        with mock.patch.object(bidi, "selenium_version", return_value=(4, 36)):
            reason = bidi.network_unavailable_reason(RuntimeError("no bidi socket"))

        self.assertIn("no bidi socket", reason)
        self.assertNotIn("event-handler API", reason)


if __name__ == "__main__":
    unittest.main()
