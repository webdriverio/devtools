import {
  MASKED_VALUE,
  secretVariants,
  type NetworkRequest
} from '@wdio/devtools-shared'

import { CREDENTIAL, RULES, SCENARIO_SECRET, SCOPES } from './constants.js'
import type {
  GroundTruth,
  RecordedStream,
  Violation,
  WireFrame
} from './types.js'

/** What a run sends as its test starts, before anything is typed: the spec's source and the suite tree, which may hold the test's own code. */
const SENT_BEFORE_TYPING: ReadonlySet<string> = new Set([
  SCOPES.sources,
  SCOPES.suites
])

/** Every string value, and the text an array of single characters spells (a W3C Send Keys payload); keys are names, not captured data. */
function textsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value)
  } else if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string' && item.length === 1)) {
      out.push(value.join(''))
    }
    value.forEach((item) => textsIn(item, out))
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => textsIn(item, out))
  }
  return out
}

function carriesPlaceholder({ scope, data }: WireFrame): boolean {
  return scope === SCOPES.commands && textsIn(data).includes(MASKED_VALUE)
}

// The scenario types a password with no `secrets` configured: from the row that typed it on, no frame may carry it in any form, and that row carries the placeholder.
export function checkSecretRedaction(
  stream: RecordedStream,
  truth: GroundTruth
): Violation[] {
  const forms = secretVariants(SCENARIO_SECRET)
  const typedAt = stream.frames.findIndex(carriesPlaceholder)
  const leaking = new Set(
    stream.frames
      .filter(
        ({ scope }, i) =>
          !(typedAt >= 0 && i < typedAt && SENT_BEFORE_TYPING.has(scope))
      )
      .filter(({ data }) =>
        textsIn(data).some((text) => forms.some((form) => text.includes(form)))
      )
      .map(({ scope }) => scope)
  )
  const typedSecret = truth.typed.some(({ text }) =>
    text.includes(SCENARIO_SECRET)
  )
  return [
    ...[...leaking].map((scope) => ({
      rule: RULES.typedPasswordNeverSent,
      message: `a ${scope} frame carries the typed password`
    })),
    ...(typedSecret && typedAt < 0
      ? [
          {
            rule: RULES.typedPasswordNeverSent,
            message:
              'no row carries the placeholder where the test typed the password'
          }
        ]
      : [])
  ]
}

/** A row's request headers, from either field a source writes them under. */
function requestHeadersOf(row: NetworkRequest): Record<string, string> {
  return { ...row.headers, ...row.requestHeaders }
}

// The fake's requests carry a credential in Authorization, Cookie and Set-Cookie: no network row may, and where BiDi served headers a row keeps Authorization with the placeholder.
export function checkCredentialHeaders(
  stream: RecordedStream,
  truth: GroundTruth
): Violation[] {
  const leaking = stream.frames.some(
    ({ scope, data }) =>
      scope === SCOPES.networkRequests &&
      textsIn(data).some((text) => text.includes(CREDENTIAL))
  )
  // A row without request headers is `request-row-carries-what-the-browser-served`'s to report.
  const withHeaders = stream.requests
    .map(requestHeadersOf)
    .filter((headers) => Object.keys(headers).length > 0)
  const kept =
    truth.bidi !== 'live' ||
    withHeaders.length === 0 ||
    withHeaders.some((headers) =>
      Object.entries(headers).some(
        ([name, value]) =>
          name.toLowerCase() === 'authorization' && value === MASKED_VALUE
      )
    )
  return [
    ...(leaking
      ? [
          {
            rule: RULES.credentialHeadersRedacted,
            message: 'a networkRequests frame carries a credential header value'
          }
        ]
      : []),
    ...(kept
      ? []
      : [
          {
            rule: RULES.credentialHeadersRedacted,
            message:
              'no network row keeps the Authorization header, with the placeholder as its value'
          }
        ])
  ]
}
