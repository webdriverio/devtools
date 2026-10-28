// Copied from @opentelemetry/semantic-conventions/incubating (1.43.0), which
// is not imported: incubating names move between releases, and a consumer of
// this package should not inherit that churn. tests/attributes.test.ts pins
// each value to the installed export.
export const ATTR_TEST_CASE_NAME = 'test.case.name'
export const ATTR_TEST_SUITE_NAME = 'test.suite.name'
export const ATTR_TEST_CASE_RESULT_STATUS = 'test.case.result.status'
export const TEST_CASE_RESULT_STATUS_PASS = 'pass'
export const TEST_CASE_RESULT_STATUS_FAIL = 'fail'

export const ATTR_ERROR_MESSAGE = 'error.message'
export const ATTR_TEST_ATTEMPT = 'devtools.test.attempt'
export const ATTR_DURATION_MS = 'devtools.duration_ms'
export const ATTR_FAILED_ACTION = 'devtools.failed_action'
export const ATTR_RUN_ID = 'devtools.run.id'
export const ATTR_ARTIFACT_URL = 'devtools.artifact.url'
export const ATTR_ACTION_KEY = 'devtools.action.key'
export const ATTR_ACTION_INDEX = 'devtools.action.index'
export const ATTR_ACTION_METHOD = 'devtools.action.method'
export const ATTR_ACTION_SELECTOR = 'devtools.action.selector'
export const ATTR_TIME_SOURCE = 'devtools.time_source'
export const TIME_SOURCE_MANIFEST = 'manifest'
export const TIME_SOURCE_TRACE = 'trace'
export const TIME_SOURCE_MANIFEST_FILE = 'manifest-file'

export const EVENT_CONSOLE = 'console'
export const EVENT_REQUEST_FAILED = 'http.request.failed'
export const ATTR_MESSAGE_TYPE = 'messageType'
export const ATTR_MESSAGE = 'message'
export const ATTR_URL_PATH = 'url.path'
export const ATTR_HTTP_METHOD = 'http.request.method'
export const ATTR_NETWORK_STATUS = 'devtools.network.status'
