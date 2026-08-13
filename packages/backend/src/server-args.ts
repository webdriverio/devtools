/**
 * Argv parsing for the `devtools-backend` bin. Split from `server.ts` because
 * that file starts a server as its module body, so a unit test cannot import it.
 */

export const SERVER_USAGE = `
  Usage: devtools-backend [options]

  Options:
    --port <number>     Preferred port; a free one is chosen if it is taken
    --hostname <host>   Host to bind (default: localhost)
    -h, --help          Show this message
`

export interface ServerArgs {
  help: boolean
  port?: number
  hostname?: string
}

/** Read `--name value` or `--name=value`, whichever the caller used. */
function option(args: string[], name: string): string | undefined {
  const flag = `--${name}`
  const at = args.indexOf(flag)
  if (at !== -1) {
    return args[at + 1]
  }
  return args.find((arg) => arg.startsWith(`${flag}=`))?.slice(flag.length + 1)
}

/**
 * A port is kept only when it parses as a positive integer, so `--port` with no
 * value, `--port abc` and `--port 0` all fall through to the server's own
 * default rather than binding something the caller did not ask for.
 */
export function parseServerArgs(args: string[]): ServerArgs {
  const port = Number(option(args, 'port'))
  const hostname = option(args, 'hostname')
  return {
    help: args.includes('-h') || args.includes('--help'),
    ...(Number.isInteger(port) && port > 0 ? { port } : {}),
    ...(hostname ? { hostname } : {})
  }
}
