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

    class TypedWrapper:
        """selenium's own deserializer: builds the generated dataclass, which
        for these events keeps only its one declared field."""

        def __init__(self, bidi_event, event_class):
            self.event_class = bidi_event
            self._python_class = event_class

        def from_json(self, params):
            if self._python_class is dict:
                return params
            declared = getattr(self._python_class, "DECLARED", ())
            return self._python_class(
                **{k: v for k, v in params.items() if k in declared}
            )

    class BeforeRequestSentParameters:
        DECLARED = ("initiator",)

        def __init__(self, initiator=None):
            self.initiator = initiator

    class Conn:
        """The websocket connection. `add_callback` CLOSES OVER the deserializer
        it is handed, which is what lets the adapter pass its own in rather than
        publish it to a shared map."""

        def __init__(self):
            self.callbacks = {}  # event name -> [(callback_id, fn)]
            self.next_id = 0

        def add_callback(self, event, callback):
            self.next_id += 1
            self.callbacks.setdefault(event.event_class, []).append(
                (self.next_id, lambda params: callback(event.from_json(params)))
            )
            return self.next_id

        def remove_callback(self, event, callback_id):
            entries = self.callbacks.get(event.event_class, [])
            self.callbacks[event.event_class] = [
                entry for entry in entries if entry[0] != callback_id
            ]

    class EventManager:
        def __init__(self, configs):
            self.conn = Conn()
            self.subscribed = []
            self.tracked = []
            # One deserializer per BiDi event, shared by every subscriber.
            self._event_wrappers = {
                config.bidi_event: TypedWrapper(config.bidi_event, config.event_class)
                for config in configs.values()
            }

        def subscribe_to_event(self, bidi_event, contexts=None):
            self.subscribed.append(bidi_event)

        def add_callback_to_tracking(self, bidi_event, callback_id):
            self.tracked.append((bidi_event, callback_id))

        def remove_callback_from_tracking(self, bidi_event, callback_id):
            self.tracked.remove((bidi_event, callback_id))

        def unsubscribe_from_event(self, bidi_event):
            # Selenium only unsubscribes when no callbacks remain, so a live
            # consumer's subscription cannot be taken down by someone else's
            # unwind. Mirrored, or the test would pass on a wrong implementation.
            if any(event == bidi_event for event, _ in self.tracked):
                return
            while bidi_event in self.subscribed:
                self.subscribed.remove(bidi_event)

    class Network:
        EVENT_CONFIGS = {
            "before_request_sent": EventConfig(
                "before_request_sent",
                "network.beforeRequestSent",
                BeforeRequestSentParameters,
            ),
            "response_completed": EventConfig(
                "response_completed", "network.responseCompleted", dict
            ),
        }

        def __init__(self):
            self._event_manager = EventManager(self.EVENT_CONFIGS)

        def add_event_handler(self, event, callback, contexts=None):
            """Selenium's own registration, which the adapter does NOT use: it
            takes the deserializer from the shared map. Kept so a test can
            register through it and prove it still gets selenium's own."""
            config = self.EVENT_CONFIGS.get(event)
            if config is None:
                raise ValueError(f"Event '{event}' not found")
            wrapper = self._event_manager._event_wrappers[config.bidi_event]
            return self._event_manager.conn.add_callback(wrapper, callback)

    if not with_event_manager:
        del Network.add_event_handler
        Network.EVENT_CONFIGS = None

    module.EventConfig = EventConfig
    module.Network = Network
    module.BeforeRequestSentParameters = BeforeRequestSentParameters
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
    """selenium 4.44+ — registering against the regenerated BiDi layer."""

    @staticmethod
    def _dispatch(network, bidi_event, params):
        """Deliver an event the way selenium's connection does."""
        for _callback_id, fn in network._event_manager.conn.callbacks[bidi_event]:
            fn(params)

    def test_raw_params_reach_the_handlers_and_are_captured(self):
        module = fake_network_module()
        network = module.Network()
        capturer = SessionCapturer(FakeTransport())

        with mock.patch.dict(
            sys.modules, {"selenium.webdriver.common.bidi.network": module}
        ):
            self.assertTrue(
                bidi._attach_network(NewSeleniumDriver(network, []), capturer)
            )

        self._dispatch(network, "network.beforeRequestSent", {
            "request": {"request": "R1", "url": "https://x/a.js", "method": "GET"},
            "timestamp": 1000,
        })
        self._dispatch(network, "network.responseCompleted", {
            "request": {"request": "R1"}, "timestamp": 1200,
            "response": {"status": 200, "statusText": "OK",
                         "mimeType": "text/javascript", "bytesReceived": 12},
        })

        # capture_network sends one batch per call, each a list of one frame.
        frames = [
            batch[0] for scope, batch in capturer._tx.sent
            if scope == "networkRequests"
        ]
        self.assertEqual(len(frames), 2)
        self.assertEqual(frames[0]["url"], "https://x/a.js")
        self.assertEqual(frames[1]["status"], 200)  # correlated with the request

    def test_both_events_are_subscribed_and_counted(self):
        # Registering on the connection directly bypasses selenium's own
        # bookkeeping, so the subscribe and the callback count are done
        # explicitly — without the count, another consumer removing their
        # handler would unsubscribe the event out from under us.
        module = fake_network_module()
        network = module.Network()

        with mock.patch.dict(
            sys.modules, {"selenium.webdriver.common.bidi.network": module}
        ):
            bidi._attach_network(
                NewSeleniumDriver(network, []), SessionCapturer(FakeTransport())
            )

        manager = network._event_manager
        self.assertEqual(
            sorted(manager.subscribed),
            ["network.beforeRequestSent", "network.responseCompleted"],
        )
        self.assertEqual(
            sorted(event for event, _ in manager.tracked),
            ["network.beforeRequestSent", "network.responseCompleted"],
        )

    def test_nothing_another_subscriber_reads_is_written(self):
        """The adapter's deserializer must never be visible to anyone else.

        Publishing it into the shared per-event map would be the public-API
        route, but there is no safe window: the swap has to span the websocket
        subscribe inside `add_event_handler`, and any handler registered during
        that round trip would close over ours and receive dicts where it expects
        selenium's generated objects.
        """
        module = fake_network_module()
        network = module.Network()

        configs_before = dict(module.Network.EVENT_CONFIGS)
        wrappers = network._event_manager._event_wrappers
        wrappers_before = dict(wrappers)

        with mock.patch.dict(
            sys.modules, {"selenium.webdriver.common.bidi.network": module}
        ):
            self.assertTrue(
                bidi._attach_network(
                    NewSeleniumDriver(network, []), SessionCapturer(FakeTransport())
                )
            )

        self.assertEqual(module.Network.EVENT_CONFIGS, configs_before)
        # Identity, not equality: the very objects are untouched, so a handler
        # registered at ANY time behaves exactly as it would have.
        self.assertEqual(wrappers, wrappers_before)
        for event, wrapper in wrappers_before.items():
            self.assertIs(wrappers[event], wrapper)

    def test_a_concurrent_subscriber_still_gets_selenium_deserializer(self):
        """The race Greptile raised, made concrete: someone else registering for
        the SAME event still gets the generated object, not our dict."""
        module = fake_network_module()
        network = module.Network()
        seen = []

        with mock.patch.dict(
            sys.modules, {"selenium.webdriver.common.bidi.network": module}
        ):
            bidi._attach_network(
                NewSeleniumDriver(network, []), SessionCapturer(FakeTransport())
            )
            # Selenium's own registration, for an event the adapter also holds.
            network.add_event_handler("before_request_sent", seen.append)

        self._dispatch(network, "network.beforeRequestSent", {
            "request": {"request": "R1", "url": "https://x/a.js", "method": "GET"},
            "initiator": {"type": "script"}, "timestamp": 1000,
        })

        self.assertEqual(len(seen), 1)
        # The generated dataclass, with attribute access intact — NOT a dict.
        self.assertIsInstance(seen[0], module.BeforeRequestSentParameters)
        self.assertEqual(seen[0].initiator, {"type": "script"})

    def test_a_half_subscribed_pair_captures_nothing(self):
        """The first registration succeeding and the second failing must not
        leave capture half-on.

        beforeRequestSent alone emits a pending frame per request that only
        responseCompleted finalizes, so the Network tab would fill with requests
        stuck pending and the pending map would grow for the rest of the session
        — while attach() reported failure and the caller believed nothing was
        capturing.
        """
        module = fake_network_module()
        network = module.Network()
        capturer = SessionCapturer(FakeTransport())

        real_subscribe = network._event_manager.subscribe_to_event

        def failing_subscribe(bidi_event, contexts=None):
            if bidi_event == "network.responseCompleted":
                raise RuntimeError("websocket went away")
            return real_subscribe(bidi_event, contexts)

        network._event_manager.subscribe_to_event = failing_subscribe

        with mock.patch.dict(
            sys.modules, {"selenium.webdriver.common.bidi.network": module}
        ):
            with self.assertLogs("selenium_devtools.bidi", level="WARNING"):
                attached = bidi._attach_network(
                    NewSeleniumDriver(network, []), capturer
                )

        self.assertFalse(attached)

        manager = network._event_manager
        # Nothing left behind. An abandoned callback would keep the event's
        # callback count above zero, so a later consumer removing THEIR handler
        # would no longer unsubscribe and the browser would keep sending it.
        self.assertEqual(manager.conn.callbacks.get("network.beforeRequestSent"), [])
        self.assertEqual(manager.tracked, [])
        self.assertNotIn("network.beforeRequestSent", manager.subscribed)

        # And no data even if something did survive: the flag is the guarantee,
        # the unwind is best-effort.
        self._dispatch(network, "network.beforeRequestSent", {
            "request": {"request": "R1", "url": "https://x/a.js", "method": "GET"},
            "timestamp": 1000,
        })
        frames = [s for s, _ in capturer._tx.sent if s == "networkRequests"]
        self.assertEqual(frames, [])

    def test_an_unwind_never_takes_down_a_live_subscription(self):
        """`unsubscribe_from_event` only fires with no callbacks left, so another
        consumer already listening to the same event keeps theirs."""
        module = fake_network_module()
        network = module.Network()
        manager = network._event_manager

        # A consumer subscribed before the adapter attaches.
        manager.subscribe_to_event("network.beforeRequestSent")
        manager.add_callback_to_tracking("network.beforeRequestSent", 999)

        def failing_subscribe(bidi_event, contexts=None):
            if bidi_event == "network.responseCompleted":
                raise RuntimeError("websocket went away")
            manager.subscribed.append(bidi_event)

        manager.subscribe_to_event = failing_subscribe

        with mock.patch.dict(
            sys.modules, {"selenium.webdriver.common.bidi.network": module}
        ):
            with self.assertLogs("selenium_devtools.bidi", level="WARNING"):
                bidi._attach_network(
                    NewSeleniumDriver(network, []), SessionCapturer(FakeTransport())
                )

        self.assertIn("network.beforeRequestSent", manager.subscribed)
        self.assertIn(("network.beforeRequestSent", 999), manager.tracked)

    def test_a_selenium_without_the_event_api_is_reported_not_silent(self):
        """There is no second path to fall back to, so a selenium that cannot
        provide this has to say so. Silence here is an empty Network tab with no
        stated cause, which is the failure this whole port exists to end."""
        module = fake_network_module(with_event_manager=False)

        with mock.patch.dict(
            sys.modules, {"selenium.webdriver.common.bidi.network": module}
        ):
            self.assertFalse(bidi.supports_event_handler_api())
            with self.assertLogs("selenium_devtools.bidi", level="WARNING") as logs:
                # `.network` is never reached: the check happens before it.
                attached = bidi._attach_network(
                    NewSeleniumDriver(None, []), SessionCapturer(FakeTransport())
                )

        self.assertFalse(attached)
        self.assertIn("network capture", "\n".join(logs.output))

    def test_the_regenerated_layer_selects_the_event_handler_path(self):
        module = fake_network_module()
        with mock.patch.dict(
            sys.modules, {"selenium.webdriver.common.bidi.network": module}
        ):
            self.assertTrue(bidi.supports_event_handler_api())

        # Detection alone must not touch anything — the caller uses it to pick.
        self.assertNotIn("devtools_before_request_sent", module.Network.EVENT_CONFIGS)


class TestTheTeardownSummary(unittest.TestCase):
    """One line at the end instead of one per request.

    `_WATCH` raises this package's logger to DEBUG so its records reach the
    dashboard Console, which means a per-event debug line is a Console line per
    request — beside a Network tab already listing every one of them."""

    def test_a_clean_run_reports_only_the_count(self):
        self.assertEqual(
            bidi.network_summary({"captured": 13, "pending": {}}),
            "network: 13 request(s) captured",
        )

    def test_requests_without_a_response_are_called_out(self):
        # The count is the cheap half. This is the half the Network tab cannot
        # show: a request whose response never arrived.
        summary = bidi.network_summary({"captured": 5, "pending": {"R7": {}, "R8": {}}})

        self.assertIn("5 request(s) captured", summary)
        self.assertIn("2 still awaiting a response", summary)

    def test_nothing_captured_and_nothing_pending_says_nothing(self):
        # A session that made no requests should not add a line to the Console.
        self.assertIsNone(bidi.network_summary({"captured": 0, "pending": {}}))
        self.assertIsNone(bidi.network_summary({}))
        self.assertIsNone(bidi.network_summary(None))

    def test_the_counts_come_from_real_capture(self):
        module = fake_network_module()
        network = module.Network()
        stats = {}

        with mock.patch.dict(
            sys.modules, {"selenium.webdriver.common.bidi.network": module}
        ):
            bidi._attach_network(
                NewSeleniumDriver(network, []), SessionCapturer(FakeTransport()), stats
            )

        for request_id in ("R1", "R2"):
            TestTheEventManagerPath._dispatch(
                network, "network.beforeRequestSent",
                {"request": {"request": request_id, "url": "https://x/a", "method": "GET"},
                 "timestamp": 1000},
            )
        # Only one of the two answers.
        TestTheEventManagerPath._dispatch(
            network, "network.responseCompleted",
            {"request": {"request": "R1"}, "timestamp": 1200,
             "response": {"status": 200}},
        )

        self.assertEqual(bidi.network_summary(stats),
                         "network: 1 request(s) captured, 1 still awaiting a response "
                         "at teardown")


class TestEventParams(unittest.TestCase):
    def test_a_raw_dict_is_its_own_params(self):
        self.assertEqual(bidi.event_params({"request": {}}), {"request": {}})

    def test_anything_else_degrades_to_empty(self):
        # The value comes from selenium's dispatch, so a release that hands the
        # callback an object must become a warning from _incomplete_event, not
        # an AttributeError raised inside the handler.
        self.assertEqual(bidi.event_params(object()), {})
        self.assertEqual(
            bidi.event_params(types.SimpleNamespace(params={"request": {}})), {}
        )


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
    """pyproject requires the selenium that carries the BiDi event API, but a
    user can still be below it — an existing environment, a transitive pin, a
    resolver that backed off. The bare failure is then an AttributeError about a
    generated attribute, which reads like a broken install rather than a floor."""

    def test_a_selenium_below_the_floor_is_named_as_the_cause(self):
        major, minor = bidi.SELENIUM_MINIMUM_VERSION
        with mock.patch.object(
            bidi, "selenium_version", return_value=(major, minor - 1)
        ):
            reason = bidi.network_unavailable_reason(AttributeError("no attribute"))

        self.assertIn(f"{major}.{minor - 1} is installed", reason)  # what they have
        self.assertIn(f">= {major}.{minor}", reason)  # what is needed
        self.assertIn("pip install --upgrade", reason)  # how to fix it
        # The half that still works, or this reads as total loss.
        self.assertIn("Console", reason)

    def test_a_failure_on_a_supported_selenium_reports_the_exception(self):
        # At or above the floor the version is NOT the cause, so blaming it would
        # send the reader somewhere with no answer.
        with mock.patch.object(
            bidi, "selenium_version", return_value=bidi.SELENIUM_MINIMUM_VERSION
        ):
            reason = bidi.network_unavailable_reason(RuntimeError("no bidi socket"))

        self.assertIn("no bidi socket", reason)
        self.assertNotIn("pip install --upgrade", reason)


if __name__ == "__main__":
    unittest.main()
