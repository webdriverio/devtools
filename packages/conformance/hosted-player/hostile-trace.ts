import {
  TraceType,
  type CommandLog,
  type TraceMutation
} from '@wdio/devtools-shared'
import { writeTraceZip } from '@wdio/devtools-trace'

const START = 1_700_000_000_000
const PAGE_URL = 'http://127.0.0.1:4567/hostile'
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4X2UDAAQxAbbux2PpAAAAAElFTkSuQmCC'

/** Set on the player's window by any script the replay lets run; the check requires it unset. */
export const HOSTILE_FLAG = '__wdioReplayRan'
/** Rendered in the replay frame, proving the hostile page was replayed at all. */
export const HOSTILE_MARKER_ID = 'wdio-hostile-marker'

const ran = (how: string) => `top.${HOSTILE_FLAG} = '${how}'`

const node = (
  type: string,
  props: Record<string, unknown>,
  children: unknown[] = []
) => ({ type, props: { ...props, children } })

/** A recorded page that tries each way a replayed DOM could run script. */
const MUTATIONS: TraceMutation[] = [
  {
    type: 'childList',
    addedNodes: [
      node('html', { 'data-wdio-ref': 'h0' }, [
        node('head', { 'data-wdio-ref': 'h1' }),
        node('body', { 'data-wdio-ref': 'h2' }, [
          node('p', { id: HOSTILE_MARKER_ID, 'data-wdio-ref': 'h3' }, [
            'hostile trace'
          ]),
          node('img', {
            src: PNG,
            onload: ran('anchor-onload'),
            'data-wdio-ref': 'h4'
          }),
          node('img', { 'data-wdio-ref': 'h5' }),
          node(
            'a',
            { href: `javascript:${ran('anchor-href')}`, 'data-wdio-ref': 'h6' },
            ['link']
          ),
          node('div', { 'data-wdio-ref': 'h7' })
        ])
      ])
    ],
    removedNodes: [],
    timestamp: START + 100,
    url: PAGE_URL
  },
  {
    type: 'attributes',
    target: 'h5',
    attributeName: 'onload',
    attributeValue: ran('mutation-onload'),
    addedNodes: [],
    removedNodes: [],
    timestamp: START + 600
  },
  {
    type: 'attributes',
    target: 'h5',
    attributeName: 'src',
    attributeValue: PNG,
    addedNodes: [],
    removedNodes: [],
    timestamp: START + 650
  },
  {
    type: 'childList',
    target: 'h7',
    addedNodes: [
      node('script', { 'data-wdio-ref': 'h8' }, [ran('added-script')])
    ],
    removedNodes: [],
    timestamp: START + 700
  }
]

const COMMANDS: CommandLog[] = [
  {
    command: 'url',
    args: [PAGE_URL],
    startTime: START + 200,
    timestamp: START + 400
  },
  {
    command: 'click',
    args: [],
    startTime: START + 1000,
    timestamp: START + 1200
  }
]

export const HOSTILE_TRACE_TITLES: readonly string[] = [
  'Element.click()',
  `Page.navigate("${PAGE_URL}")`
]

/** Writes the hostile trace with this checkout's writer and returns the zip's path. */
export function writeHostileTrace(outputDir: string): Promise<string> {
  return writeTraceZip(
    {
      mutations: MUTATIONS,
      traceLogs: [],
      consoleLogs: [],
      networkRequests: [],
      commandsLog: COMMANDS,
      sources: new Map(),
      metadata: { type: TraceType.Standalone },
      startWallTime: START
    },
    { outputDir, sessionId: 'hostiletrace', fileStem: 'hostile' }
  )
}
