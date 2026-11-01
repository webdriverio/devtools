import { describe, it, expect } from 'vitest'
import { parseServerArgs, SERVER_USAGE } from '../src/server-args.js'

describe('parseServerArgs', () => {
  it('reads a port given as two arguments', () => {
    expect(parseServerArgs(['--port', '4123'])).toEqual({
      help: false,
      port: 4123
    })
  })

  it('reads a port given with an equals sign', () => {
    expect(parseServerArgs(['--port=4123'])).toEqual({
      help: false,
      port: 4123
    })
  })

  it('reads a hostname in either form', () => {
    expect(parseServerArgs(['--hostname', '0.0.0.0'])).toEqual({
      help: false,
      hostname: '0.0.0.0'
    })
    expect(parseServerArgs(['--hostname=0.0.0.0'])).toEqual({
      help: false,
      hostname: '0.0.0.0'
    })
  })

  it('takes both together, in any order', () => {
    expect(
      parseServerArgs(['--hostname', '127.0.0.1', '--port', '5000'])
    ).toEqual({ help: false, hostname: '127.0.0.1', port: 5000 })
  })

  it('omits the port when it is absent, so the server keeps its default', () => {
    expect(parseServerArgs([])).toEqual({ help: false })
  })

  // `--port` as the final argument reads `undefined`, and a flag as its value
  // must not be swallowed as a port either.
  it.each([
    ['no value', ['--port']],
    ['the next flag as its value', ['--port', '--hostname', 'localhost']],
    ['a non-numeric value', ['--port', 'abc']],
    ['a fractional value', ['--port', '80.5']],
    ['zero', ['--port', '0']],
    ['a negative value', ['--port', '-1']]
  ])('drops a port given as %s', (_label, args) => {
    expect(parseServerArgs(args as string[]).port).toBeUndefined()
  })

  it('reports help for -h and --help', () => {
    expect(parseServerArgs(['-h']).help).toBe(true)
    expect(parseServerArgs(['--help']).help).toBe(true)
    expect(parseServerArgs(['--port', '3000']).help).toBe(false)
  })

  it('documents every flag it parses', () => {
    for (const flag of ['--port', '--hostname', '-h', '--help']) {
      expect(SERVER_USAGE).toContain(flag)
    }
  })
})
