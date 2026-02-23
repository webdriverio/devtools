let logs: string[] = []

export function log(...args: any[]) {
  logs.push(args.map((a) => JSON.stringify(a)).join(' '))
}

export function getLogs() {
  return logs
}

export function clearLogs() {
  logs = []
}
