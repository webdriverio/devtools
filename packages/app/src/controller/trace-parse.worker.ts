import { answerParseRequest } from './trace-parse.js'
import type { TraceParseRequest } from './trace-parse-protocol.js'

addEventListener('message', (event: MessageEvent<TraceParseRequest>) => {
  answerParseRequest(event.data.bytes, (message) => postMessage(message))
})
