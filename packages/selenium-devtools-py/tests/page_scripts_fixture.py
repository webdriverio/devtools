"""Stand-ins for the page scripts the backend serves (`page_scripts.fetch`).

Not copies of shared's source: each carries only the marker the fakes in these
tests dispatch on, so a test that passes proves the adapter ran what it was
handed rather than a string of its own.
"""

PAGE_SCRIPTS = {
    "collectorReady": "return wdioTraceCollector /* ready */;",
    "collectorInject": "createElement('script') /* inject arguments[0] */",
    "collectorDrain": "/* drain */ captureCurrentDom(); return getTraceData();",
    "capturePerformance": "return /* performance */ {};",
}
