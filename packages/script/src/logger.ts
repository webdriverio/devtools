let logs: string[] = []

export function log(...args: unknown[]) {
  logs.push(args.map((a) => JSON.stringify(a)).join(' '))
}

export function getLogs() {
  return logs
}

export function clearLogs() {
  logs = []
}
