import type {
  ActionSnapshot,
  CommandLog,
  TestMetadataMap
} from '@wdio/devtools-shared'

/** A stream carrying no `parentId`: groups, a dropped row, a deferred assert and per-action captures. */
export const FLAT_COMMANDS: CommandLog[] = [
  {
    command: 'url',
    args: ['https://example.com/login'],
    startTime: 1000,
    timestamp: 1040,
    testUid: 't1',
    callSource: '/spec.js:3:5',
    id: 11
  },
  {
    command: 'findElement',
    args: ['#username'],
    startTime: 1041,
    timestamp: 1042,
    testUid: 't1',
    id: 12
  },
  {
    command: 'setValue',
    args: ['#username', 'tom'],
    startTime: 1043,
    timestamp: 1050,
    testUid: 't1',
    selector: '#username',
    id: 13
  },
  {
    command: 'click',
    args: ['button'],
    startTime: 1051,
    timestamp: 1090,
    testUid: 't1',
    selector: 'button',
    id: 14
  },
  {
    command: 'assert.equal',
    args: ['a', 'b'],
    startTime: 1045,
    timestamp: 1046,
    sequence: 2,
    testUid: 't1',
    error: { name: 'AssertionError', message: 'a != b' },
    id: 15
  },
  {
    command: 'waitForExist',
    args: [{ timeout: 2000 }],
    startTime: 1100,
    timestamp: 1300,
    testUid: 't2',
    selector: '#flash',
    id: 16
  },
  {
    command: 'getText',
    args: ['#flash'],
    startTime: 1301,
    timestamp: 1302,
    testUid: 't2',
    result: 'hello',
    id: 17
  }
]

export const FLAT_TEST_METADATA: TestMetadataMap = new Map([
  ['t1', { title: 'logs in', specFile: '/spec.js' }],
  ['t2', { title: 'waits', specFile: '/spec.js' }]
])

export const FLAT_SNAPSHOTS: ActionSnapshot[] = [
  { timestamp: 1040, command: 'url', screenshot: 'AAAA' },
  { timestamp: 1090, command: 'click', screenshot: 'BBBB' }
]
