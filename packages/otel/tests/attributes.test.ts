import * as incubating from '@opentelemetry/semantic-conventions/incubating'
import { describe, expect, it } from 'vitest'
import * as attr from '../src/attributes.js'

describe('incubating semantic-convention copies', () => {
  it('match the installed incubating export', () => {
    expect(attr.ATTR_TEST_CASE_NAME).toBe(incubating.ATTR_TEST_CASE_NAME)
    expect(attr.ATTR_TEST_SUITE_NAME).toBe(incubating.ATTR_TEST_SUITE_NAME)
    expect(attr.ATTR_TEST_CASE_RESULT_STATUS).toBe(
      incubating.ATTR_TEST_CASE_RESULT_STATUS
    )
    expect(attr.TEST_CASE_RESULT_STATUS_PASS).toBe(
      incubating.TEST_CASE_RESULT_STATUS_VALUE_PASS
    )
    expect(attr.TEST_CASE_RESULT_STATUS_FAIL).toBe(
      incubating.TEST_CASE_RESULT_STATUS_VALUE_FAIL
    )
  })
})
