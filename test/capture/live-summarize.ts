// Reduces a recorded live-mode WS stream to a deterministic summary — the value
// snapshotted per adapter for Layer A's live-mode counterpart. Live mode streams
// SocketMessage<scope> frames upstream (session-capturer sendUpstream); this
// captures which scopes streamed and the command vocabulary, the same stable
// signals the trace summary uses (no timestamps/ids/counts that drift).

import type { CommandLog } from '../../packages/shared/src/types.js'
import type { SocketMessage } from '../../packages/shared/src/ws.js'

export interface LiveSummary {
  /** Sorted distinct WS scopes that streamed (commands, consoleLogs, …). */
  scopes: string[]
  /** Sorted distinct command names seen in `commands`-scope frames. */
  commandVocabulary: string[]
}

// The projection of a live WS message that live-parity actually asserts on. Raw
// live streams are multi-MB (base64 screencast frames, DOM snapshots, network
// bodies), far too large to commit; the fixture keeps only this projection so it
// stays a few KB. projectForFixture (record-time) and summarizeLive (test-time)
// are a pair — summarizeLive reads exactly the fields projectForFixture keeps, so
// changing one without the other is a re-record, not a silent skew.
export interface LiteMessage {
  scope: string
  commands?: string[]
}

export function projectForFixture(messages: SocketMessage[]): LiteMessage[] {
  return messages.map((message) => {
    if (message.scope === 'commands' && Array.isArray(message.data)) {
      const commands = (message.data as CommandLog[])
        .filter((command) => command && typeof command.command === 'string')
        .map((command) => command.command)
      return { scope: message.scope, commands }
    }
    return { scope: message.scope }
  })
}

export function summarizeLive(messages: LiteMessage[]): LiveSummary {
  const scopes = new Set<string>()
  const commands = new Set<string>()

  for (const message of messages) {
    scopes.add(message.scope)
    message.commands?.forEach((command) => commands.add(command))
  }

  return {
    scopes: [...scopes].sort(),
    commandVocabulary: [...commands].sort()
  }
}
