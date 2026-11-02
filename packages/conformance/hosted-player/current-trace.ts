import { TraceType, type CommandLog } from '@wdio/devtools-shared'
import { writeTraceZip } from '@wdio/devtools-trace'

// Two distinct 1x1 PNGs: the writer drops a frame whose bytes repeat the previous one.
const FRAME_PNGS = [
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4X2UDAAQxAbbux2PpAAAAAElFTkSuQmCC',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQqLgDAAJIAX2aqSu/AAAAAElFTkSuQmCC'
]

const START = 1_700_000_000_000
const PAGE_URL = 'http://127.0.0.1:4567/login'

/** A short run with a wait that issued a read, so the zip carries the nesting the current writer adds. */
const COMMANDS: CommandLog[] = [
  {
    command: 'url',
    args: [PAGE_URL],
    startTime: START + 100,
    timestamp: START + 400
  },
  {
    command: 'waitUntil',
    args: [],
    id: 1,
    startTime: START + 500,
    timestamp: START + 900
  },
  {
    command: 'getTitle',
    args: [],
    id: 2,
    parentId: 1,
    result: 'Login Page',
    startTime: START + 600,
    timestamp: START + 650
  },
  {
    command: 'click',
    args: [],
    startTime: START + 1000,
    timestamp: START + 1200
  }
]

/** What the player's action rows read for that run, sorted; `current-trace.test.ts` holds the reader to it. */
export const CURRENT_TRACE_TITLES: readonly string[] = [
  'Browser.waitForFunction()',
  'Element.click()',
  'Page.getTitle()',
  `Page.navigate("${PAGE_URL}")`
]

/** Writes that run with this checkout's trace writer and returns the zip's path. */
export function writeCurrentTrace(outputDir: string): Promise<string> {
  return writeTraceZip(
    {
      mutations: [],
      traceLogs: [],
      consoleLogs: [],
      networkRequests: [],
      commandsLog: COMMANDS,
      sources: new Map(),
      metadata: { type: TraceType.Standalone },
      startWallTime: START
    },
    {
      outputDir,
      sessionId: 'hostedplayer',
      fileStem: 'current-writer',
      screencastFrames: FRAME_PNGS.map((data, i) => ({
        data,
        timestamp: START + 200 + i * 800
      }))
    }
  )
}
