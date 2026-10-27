import { REUSE_ENV } from '@wdio/devtools-shared'

/** Single-quote for `sh -c`; embedded single-quotes get the `'\''` dance. */
export function shellQuote(s: string): string {
  if (s === '') {
    return "''"
  }
  if (/^[a-zA-Z0-9_\-./=:@]+$/.test(s)) {
    return s
  }
  return `'${s.replace(/'/g, "'\\''")}'`
}

/** The command that reruns this whole process: the npm script it was started by, else its own argv. */
export function captureLaunchCommand(): string {
  // `npx`/`pnpm exec` report themselves as `npm_command=exec` (npx also sets the event to `npx`): there is no script to rerun.
  const npmScript =
    process.env.npm_command === 'exec'
      ? undefined
      : process.env.npm_lifecycle_event
  const npmConfigUserAgent = process.env.npm_config_user_agent ?? ''
  if (npmScript) {
    const tool = npmConfigUserAgent.startsWith('pnpm')
      ? 'pnpm'
      : npmConfigUserAgent.startsWith('yarn')
        ? 'yarn'
        : 'npm'
    return tool === 'npm' ? `npm run ${npmScript}` : `${tool} ${npmScript}`
  }
  return [process.argv0, ...process.argv.slice(1)].map(shellQuote).join(' ')
}

// A rerun's process was launched with a narrowed selection, so Run all cannot be derived from its own arguments.
function inheritedLaunchCommand(env: NodeJS.ProcessEnv): string | undefined {
  if (env[REUSE_ENV.REUSE] !== '1') {
    return undefined
  }
  return env[REUSE_ENV.LAUNCH_COMMAND] || undefined
}

/** A rerun's inherited Run-all command, read only while the reuse handshake is live, else this process's own. */
export function resolveLaunchCommand(
  env: NodeJS.ProcessEnv = process.env
): string {
  return inheritedLaunchCommand(env) ?? captureLaunchCommand()
}
