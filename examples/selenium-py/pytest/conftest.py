"""``DEVTOOLS_MODE=trace`` switches this example to trace mode, as it does every JS demo.

The adapter itself does not read ``DEVTOOLS_MODE``; this hook turns it into the
plugin's own options before the plugin resolves them. Each default yields to
anything already chosen on the command line, in ``pytest.ini`` or through
``DEVTOOLS_TRACE_POLICY`` / ``DEVTOOLS_TRACE_GRANULARITY``, so CI's
``-o devtools_trace_policy=on`` still wins.
"""

import os

import pytest

#: (CLI option dest, ini name, environment variable, value this example defaults to)
TRACE_DEFAULTS = (
    ("devtools_trace", "devtools_trace", None, True),
    ("devtools_trace_granularity", "devtools_trace_granularity",
     "DEVTOOLS_TRACE_GRANULARITY", "test"),
    ("devtools_trace_policy", "devtools_trace_policy",
     "DEVTOOLS_TRACE_POLICY", "retain-on-failure"),
)


@pytest.hookimpl(tryfirst=True)
def pytest_configure(config):
    if os.environ.get("DEVTOOLS_MODE") != "trace":
        return
    for dest, ini, env, value in TRACE_DEFAULTS:
        # Not registered means the adapter is not installed; nothing to configure.
        if not hasattr(config.option, dest):
            return
        if getattr(config.option, dest) is not None or config.getini(ini) not in (None, ""):
            continue
        if env and os.environ.get(env):
            continue
        setattr(config.option, dest, value)
