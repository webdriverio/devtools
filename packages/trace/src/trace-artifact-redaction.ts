// Re-redacts a trace artifact already on disk, for a secret learned after it was written.

import fs from 'node:fs/promises'
import path from 'node:path'

import type { SecretRedactor } from '@wdio/devtools-shared'
import { unzipSync, zipSync, type Zippable } from 'fflate'

const UTF8 = new TextDecoder('utf-8', { fatal: true })

function decodeText(bytes: Uint8Array): string | undefined {
  try {
    return UTF8.decode(bytes)
  } catch {
    // Not UTF-8, so an image, font or video: there is no text to redact.
    return undefined
  }
}

/** A JSON line is walked as a value, so a screenshot or other base64 field keeps its bytes; any other line is redacted as text. */
function redactLine(line: string, redactor: SecretRedactor): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return redactor.redactString(line)
  }
  const redacted = redactor.redact(parsed)
  return redacted === parsed ? line : JSON.stringify(redacted)
}

/** The entry's redacted bytes, or undefined when nothing in it changed. */
export function redactEntry(
  bytes: Uint8Array,
  redactor: SecretRedactor
): Uint8Array | undefined {
  const text = decodeText(bytes)
  if (text === undefined) {
    return undefined
  }
  const redacted = text
    .split('\n')
    .map((line) => redactLine(line, redactor))
    .join('\n')
  return redacted === text ? undefined : new TextEncoder().encode(redacted)
}

async function redactZip(
  zipPath: string,
  redactor: SecretRedactor
): Promise<boolean> {
  const entries = unzipSync(new Uint8Array(await fs.readFile(zipPath)))
  let changed = false
  const out: Zippable = {}
  for (const [name, bytes] of Object.entries(entries)) {
    const redacted = redactEntry(bytes, redactor)
    changed ||= redacted !== undefined
    out[name] = redacted ?? bytes
  }
  if (changed) {
    await fs.writeFile(zipPath, zipSync(out))
  }
  return changed
}

async function redactDirectory(
  dir: string,
  redactor: SecretRedactor
): Promise<boolean> {
  let changed = false
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      changed = (await redactDirectory(file, redactor)) || changed
    } else if (entry.isFile()) {
      const redacted = redactEntry(
        new Uint8Array(await fs.readFile(file)),
        redactor
      )
      if (redacted) {
        await fs.writeFile(file, redacted)
        changed = true
      }
    }
  }
  return changed
}

/** Rewrites a trace zip or ndjson directory with `redactor` applied to every text entry; false when it is gone or nothing changed. */
export async function redactTraceArtifact(
  artifactPath: string,
  redactor: SecretRedactor
): Promise<boolean> {
  const stat = await fs.stat(artifactPath).catch(() => undefined)
  if (!stat) {
    return false
  }
  return stat.isDirectory()
    ? redactDirectory(artifactPath, redactor)
    : redactZip(artifactPath, redactor)
}
