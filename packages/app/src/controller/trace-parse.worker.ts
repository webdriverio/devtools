import { createTraceReader } from './trace-parse.js'
import type { TraceReaderRequest } from './trace-parse-protocol.js'

const answer = createTraceReader((message) => postMessage(message))

addEventListener('message', (event: MessageEvent<TraceReaderRequest>) => {
  void answer(event.data)
})
