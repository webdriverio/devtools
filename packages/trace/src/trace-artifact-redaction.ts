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

const RESOURCES_PREFIX = 'resources/'

/** Keys the writer stores an archive entry's name under: a screenshot or frame's `sha1`, a HAR body's `_sha1`. */
const REFERENCE_KEYS: ReadonlySet<string> = new Set(['sha1', '_sha1'])

/** Every name an entry can be referenced by: its archive path, and under `resources/` its bare name. */
function referenceNames(entryNames: Iterable<string>): Set<string> {
  const names = new Set<string>()
  for (const name of entryNames) {
    names.add(name)
    if (name.startsWith(RESOURCES_PREFIX)) {
      names.add(name.slice(RESOURCES_PREFIX.length))
    }
  }
  return names
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `redacted` with each reference field that names an archive entry put back, since its file keeps its name; captured text is never put back. */
function keepReferences(
  original: unknown,
  redacted: unknown,
  references: ReadonlySet<string>,
  key?: string
): unknown {
  if (original === redacted) {
    return redacted
  }
  if (typeof original === 'string') {
    const isReference =
      key !== undefined && REFERENCE_KEYS.has(key) && references.has(original)
    return isReference ? original : redacted
  }
  if (Array.isArray(original) && Array.isArray(redacted)) {
    if (original.length !== redacted.length) {
      return redacted
    }
    return redacted.map((item, i) =>
      keepReferences(original[i], item, references)
    )
  }
  if (isPlainRecord(original) && isPlainRecord(redacted)) {
    const out: Record<string, unknown> = { ...redacted }
    for (const field of Object.keys(redacted)) {
      out[field] = keepReferences(
        original[field],
        redacted[field],
        references,
        field
      )
    }
    return out
  }
  return redacted
}

/** A JSON line is walked as a value, so a screenshot or other base64 field and an entry reference keep their bytes; any other line is redacted as text. */
function redactLine(
  line: string,
  redactor: SecretRedactor,
  references: ReadonlySet<string>
): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return redactor.redactString(line)
  }
  const redacted = keepReferences(parsed, redactor.redact(parsed), references)
  const text = JSON.stringify(redacted)
  return text === JSON.stringify(parsed) ? line : text
}

/** The entry's redacted bytes, or undefined when nothing in it changed. */
function redactEntry(
  bytes: Uint8Array,
  redactor: SecretRedactor,
  references: ReadonlySet<string>
): Uint8Array | undefined {
  const text = decodeText(bytes)
  if (text === undefined) {
    return undefined
  }
  const redacted = text
    .split('\n')
    .map((line) => redactLine(line, redactor, references))
    .join('\n')
  return redacted === text ? undefined : new TextEncoder().encode(redacted)
}

async function redactZip(
  zipPath: string,
  redactor: SecretRedactor
): Promise<boolean> {
  const entries = unzipSync(new Uint8Array(await fs.readFile(zipPath)))
  const references = referenceNames(Object.keys(entries))
  let changed = false
  const out: Zippable = {}
  for (const [name, bytes] of Object.entries(entries)) {
    const redacted = redactEntry(bytes, redactor, references)
    changed ||= redacted !== undefined
    out[name] = redacted ?? bytes
  }
  if (changed) {
    await fs.writeFile(zipPath, zipSync(out))
  }
  return changed
}

async function listFiles(dir: string, root = dir): Promise<string[]> {
  const files: string[] = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(file, root)))
    } else if (entry.isFile()) {
      files.push(path.relative(root, file).split(path.sep).join('/'))
    }
  }
  return files
}

async function redactDirectory(
  dir: string,
  redactor: SecretRedactor
): Promise<boolean> {
  const files = await listFiles(dir)
  const references = referenceNames(files)
  let changed = false
  for (const name of files) {
    const file = path.join(dir, name)
    const redacted = redactEntry(
      new Uint8Array(await fs.readFile(file)),
      redactor,
      references
    )
    if (redacted) {
      await fs.writeFile(file, redacted)
      changed = true
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
