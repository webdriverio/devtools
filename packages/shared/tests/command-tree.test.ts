import { describe, expect, it } from 'vitest'

import { replaceCommand } from '../src/command-replace.js'
import { nestCommands, type CommandNode } from '../src/command-tree.js'
import type { CommandLog } from '../src/types.js'

const row = (
  command: string,
  id?: number,
  parentId?: number,
  timestamp = 1
): CommandLog => ({
  command,
  args: [],
  timestamp,
  ...(id === undefined ? {} : { id }),
  ...(parentId === undefined ? {} : { parentId })
})

const shape = (nodes: CommandNode[]): unknown =>
  nodes.map((n) =>
    n.children.length
      ? { [n.command.command]: shape(n.children) }
      : n.command.command
  )

describe('nestCommands', () => {
  it('keeps a list without parentId flat and in order', () => {
    expect(shape(nestCommands([row('a', 1), row('b'), row('c', 3)]))).toEqual([
      'a',
      'b',
      'c'
    ])
  })

  it('nests children under their parent in list order, at any depth', () => {
    const rows = [
      row('wait', 1),
      row('read1', 2, 1),
      row('inner', 3, 1),
      row('poll', 4, 3),
      row('read2', 5, 1),
      row('next', 6)
    ]
    expect(shape(nestCommands(rows))).toEqual([
      { wait: ['read1', { inner: ['poll'] }, 'read2'] },
      'next'
    ])
  })

  it('keeps a child whose parent has not arrived at the top level, and nests it once it does', () => {
    const child = row('read', 2, 1)
    expect(shape(nestCommands([child]))).toEqual(['read'])
    expect(shape(nestCommands([child, row('wait', 1)]))).toEqual([
      { wait: ['read'] }
    ])
  })

  it('follows a parent replaced by id: the completed wait keeps its children', () => {
    const running = row('wait', 1, undefined, 10)
    const done = {
      ...row('wait', 1, undefined, 50),
      error: new Error('timeout')
    }
    const rows = replaceCommand(
      [running, row('read', 2, 1, 20)],
      running.timestamp,
      done
    )
    const [wait] = nestCommands(rows)
    expect(wait.command).toBe(done)
    expect(wait.children.map((c) => c.command.command)).toEqual(['read'])
  })

  it('roots a row that names itself or whose ancestry loops, without losing a row', () => {
    const rows = [
      row('self', 1, 1),
      row('a', 2, 3),
      row('b', 3, 2),
      row('c', 4, 2)
    ]
    expect(shape(nestCommands(rows))).toEqual(['self', { a: ['c'] }, 'b'])
  })

  it('names the first row holding an id as the parent', () => {
    const rows = [row('first', 1), row('dup', 1), row('child', 2, 1)]
    expect(shape(nestCommands(rows))).toEqual([{ first: ['child'] }, 'dup'])
  })
})
