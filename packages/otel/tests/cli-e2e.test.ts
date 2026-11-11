import { execFile, type ExecFileException } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const built = existsSync(CLI)
const TEST_TITLE = 'logs in end to end'
const RUN_ID = 'run-e2e'
const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'
const SPAN_ID = 'b7ad6b7169203331'
const START_MS = 1_750_000_000_000

interface Collector {
  server: Server
  port: number
  bodies: string[]
  status: number
}

function startCollector(status: number): Promise<Collector> {
  const collector: Collector = {
    server: createServer((request: IncomingMessage, response) => {
      if (request.method !== 'POST' || request.url !== '/v1/traces') {
        response.writeHead(404).end()
        return
      }
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        collector.bodies.push(Buffer.concat(chunks).toString('utf8'))
        response.writeHead(collector.status).end()
      })
    }),
    port: 0,
    bodies: [],
    status
  }
  return new Promise((resolve) => {
    collector.server.listen(0, '127.0.0.1', () => {
      collector.port = (collector.server.address() as AddressInfo).port
      resolve(collector)
    })
  })
}

function runCli(
  args: string[],
  env: Record<string, string>
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { env },
      (error: ExecFileException | null, _stdout, stderr) => {
        resolve({
          code:
            error === null
              ? 0
              : typeof error.code === 'number'
                ? error.code
                : 1,
          stderr
        })
      }
    )
  })
}

describe('wdio-otel push, built binary', () => {
  let dir: string
  let manifest: string
  const collectors: Collector[] = []
  const listen = async (status: number): Promise<Collector> => {
    const collector = await startCollector(status)
    collectors.push(collector)
    return collector
  }

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'otel-e2e-'))
    manifest = path.join(dir, 'manifest.json')
    await writeFile(
      manifest,
      JSON.stringify({
        sessionId: 's1',
        runId: RUN_ID,
        artifacts: [],
        tests: [
          {
            uid: 'uid-1',
            title: TEST_TITLE,
            specFile: 'specs/login.spec.ts',
            state: 'passed',
            attempt: 0,
            startTime: START_MS,
            endTime: START_MS + 1000,
            attempts: [
              {
                attempt: 0,
                state: 'passed',
                startTime: START_MS,
                endTime: START_MS + 1000,
                traceId: TRACE_ID,
                spanId: SPAN_ID,
                final: true
              }
            ]
          }
        ]
      })
    )
  })

  afterAll(async () => {
    for (const collector of collectors) {
      collector.server.close()
    }
    await rm(dir, { recursive: true, force: true })
  })

  const envFor = (port: number): Record<string, string> => ({
    PATH: process.env.PATH ?? '',
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
    GITHUB_ACTIONS: 'true',
    GITHUB_SHA: 'abc',
    GITHUB_REF_NAME: 'main',
    GITHUB_RUN_ID: '7'
  })

  it.skipIf(!built)(
    'exports the test to a collector that answers 200',
    async () => {
      const collector = await listen(200)
      const result = await runCli(['push', manifest], envFor(collector.port))

      expect(result.code).toBe(0)
      expect(collector.bodies).toHaveLength(1)
      const body = collector.bodies[0]
      expect(body).toContain(TEST_TITLE)
      expect(body).toContain(RUN_ID)
      expect(JSON.parse(body)).toMatchObject({
        resourceSpans: [
          {
            resource: {
              attributes: expect.arrayContaining([
                { key: 'vcs.ref.head.revision', value: { stringValue: 'abc' } }
              ])
            }
          }
        ]
      })
    }
  )

  it.skipIf(!built)(
    'exits 1 and names the lost spans when the collector refuses',
    async () => {
      const collector = await listen(400)
      const result = await runCli(['push', manifest], envFor(collector.port))

      expect(result.code).toBe(1)
      expect(result.stderr).toContain('export failed:')
      expect(result.stderr).toContain('0 span(s) reached the collector')
    }
  )

  it.skipIf(!built)(
    'loads the bundled trace reader when --trace-zips names no zip',
    async () => {
      const collector = await listen(200)
      const result = await runCli(
        ['push', manifest, '--trace-zips'],
        envFor(collector.port)
      )

      expect(result.code).toBe(0)
      expect(collector.bodies).toHaveLength(1)
    }
  )
})
