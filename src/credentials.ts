/**
 * Credentials-document access for the dsh-zcf wizard, matching the file contract
 * of `dsh-credentials-local`: a YAML mapping of credential reference to
 * string value at `$DSH_HOME/.credentials.yaml`, owner-only (0600) under an
 * owner-only (0700) directory. Reads fail loud on a malformed document —
 * overwriting content the provider could not understand would silently drop
 * credentials; writes re-read under the cross-process writer lock and commit
 * atomically.
 * @module dsh-zcf
 */

import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write'

/** Credentials document filename inside the harness home. */
const CREDENTIALS_FILE = '.credentials.yaml'

/** A credential reference must be a POSIX identifier (an environment-variable name). */
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Absolute path of the credentials document for a harness home.
 * @param home - resolved harness home.
 * @returns the document path.
 */
export function credentialsPath(home: string): string {
  return join(home, CREDENTIALS_FILE)
}

/** Whether a credential reference is a valid POSIX identifier. */
export function isValidRef(ref: string): boolean {
  return REF_PATTERN.test(ref)
}

/**
 * Parse the credentials document. The current provider layout is versioned
 * (`version: 1` with entries nested under `refs:`); the pre-release flat
 * layout (bare reference → value at the top level) and the mixed state the
 * wizard itself could leave behind (a `version` marker beside flat entries)
 * are read too, so an upgrade never loses stored keys. Only a structurally
 * broken file fails loud.
 * @param home - resolved harness home.
 * @returns the stored reference → value mapping.
 */
export function readCredentials(home: string): Record<string, string> {
  const raw = readParsedDocument(home)
  const entries: Record<string, string> = {}
  const refs = raw.refs
  if (refs !== undefined && typeof refs === 'object' && !Array.isArray(refs)) {
    for (const [ref, value] of Object.entries(refs as Record<string, unknown>)) {
      if (isValidRef(ref) && typeof value === 'string' && value.length > 0) entries[ref] = value
    }
  }
  // Flat entries (pre-release layout, or the mixed state after earlier
  // wizard writes) count as credentials as well.
  for (const [key, value] of Object.entries(raw.document)) {
    if (key !== 'version' && key !== 'refs' && key !== 'records' && isValidRef(key) && typeof value === 'string' && value.length > 0) {
      entries[key] = value
    }
  }
  return entries
}

/** Parsed raw document plus the parsed `refs:` mapping, absent meaning none. */
interface ParsedDocument {
  document: Record<string, unknown>
  refs: unknown
}

/** Parse and validate the raw document shape; absent files are empty. */
function readParsedDocument(home: string): ParsedDocument {
  const path = credentialsPath(home)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return { document: {}, refs: undefined }
    throw new Error(`dsh-zcf: cannot read credentials document ${path}: ${(error as Error).message}`)
  }
  const parsed: unknown = yaml.load(text)
  if (parsed === undefined || parsed === null) return { document: {}, refs: undefined }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`dsh-zcf: credentials document ${path} must be a YAML mapping of reference to value`)
  }
  return { document: parsed as Record<string, unknown>, refs: (parsed as Record<string, unknown>).refs }
}

/**
 * Merge `entries` into the credentials document: re-read under the writer
 * lock (folding in concurrent writes), apply the entries, and commit
 * atomically with mode 0600 under an owner-only directory. The commit is
 * always in the current provider layout — `version: 1` with everything
 * under `refs:` — which also migrates flat or mixed files on save; a
 * `records:` section and any foreign top-level keys survive verbatim, and an
 * unparseable document refuses the write instead of being overwritten.
 * @param home - resolved harness home.
 * @param entries - reference → value entries to store.
 */
export async function writeCredentials(home: string, entries: Readonly<Record<string, string>>): Promise<void> {
  for (const ref of Object.keys(entries)) {
    if (!isValidRef(ref)) {
      throw new Error(`dsh-zcf: refusing to store invalid credential reference ${JSON.stringify(ref)}`)
    }
    if (entries[ref] === undefined || entries[ref].length === 0) {
      throw new Error(`dsh-zcf: refusing to store an empty value for ${ref}`)
    }
  }
  const path = credentialsPath(home)
  await withFileLock(path, async () => {
    const raw = readParsedDocument(home)
    // Normalize every readable credential (versioned refs plus stray flat
    // entries) into the versioned layout.
    const merged: Record<string, string> = {}
    const refs = raw.refs
    if (refs !== undefined && typeof refs === 'object' && !Array.isArray(refs)) {
      for (const [ref, value] of Object.entries(refs as Record<string, unknown>)) {
        if (isValidRef(ref) && typeof value === 'string' && value.length > 0) merged[ref] = value
      }
    }
    for (const [key, value] of Object.entries(raw.document)) {
      if (key !== 'version' && key !== 'refs' && key !== 'records' && isValidRef(key) && typeof value === 'string' && value.length > 0) {
        merged[key] = value
      }
    }
    Object.assign(merged, entries)
    const next: Record<string, unknown> = { version: 1, refs: merged }
    if (raw.document.records !== undefined) next.records = raw.document.records
    // Foreign top-level keys the wizard does not understand are preserved
    // verbatim rather than silently dropped.
    for (const [key, value] of Object.entries(raw.document)) {
      if (key !== 'version' && key !== 'refs' && key !== 'records' && !(isValidRef(key) && typeof value === 'string' && value.length > 0)) {
        next[key] = value
      }
    }
    const rendered = yaml.dump(next, { lineWidth: -1 })
    await writeFileAtomic(path, rendered, { mode: 0o600, dirMode: 0o700 })
  })
}

/**
 * Whether the credentials document still carries flat top-level entries the
 * current provider rejects (pre-release layout, or the mixed state earlier
 * wizard writes could leave); a save would migrate them into `refs:`.
 * @param home - resolved harness home.
 * @returns true when a migration write is pending.
 */
export function needsV1Migration(home: string): boolean {
  let raw: ParsedDocument
  try {
    raw = readParsedDocument(home)
  } catch {
    return false
  }
  return Object.entries(raw.document).some(([key]) => key !== 'version' && key !== 'refs' && key !== 'records' && isValidRef(key))
}

/**
 * Migrate the credentials document into the versioned layout when needed.
 * Values never change — only the wrapper does.
 * @param home - resolved harness home.
 * @returns true when a migration write happened.
 */
export async function migrateCredentialsIfNeeded(home: string): Promise<boolean> {
  if (!needsV1Migration(home)) return false
  await writeCredentials(home, {})
  return true
}

/**
 * Ensure the harness-home directory exists owner-only (0700). Existing
 * directories keep their mode; the credential document itself still commits
 * 0600 through the atomic write.
 * @param home - resolved harness home.
 */
export async function ensureHomeDirectory(home: string): Promise<void> {
  await mkdir(dirname(credentialsPath(home)), { recursive: true, mode: 0o700 })
}

/**
 * Short masked display form of an API key: `sk-…abcd` keeps the last four
 * characters so a user can recognize which key was stored.
 * @param key - full key.
 * @returns the masked form.
 */
export function maskKey(key: string): string {
  if (key.length <= 8) return `${key.slice(0, 2)}***`
  return `${key.slice(0, 3)}***${key.slice(-4)}`
}
