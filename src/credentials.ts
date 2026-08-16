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
 * Parse the credentials document. An absent file is an empty store; anything
 * else that is not a mapping of identifier keys to non-empty strings fails
 * loud, naming the file — the same rejections as the file-backed provider.
 * @param home - resolved harness home.
 * @returns the stored reference → value mapping.
 */
export function readCredentials(home: string): Record<string, string> {
  const path = credentialsPath(home)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return {}
    throw new Error(`dsh-zcf: cannot read credentials document ${path}: ${(error as Error).message}`)
  }
  const parsed: unknown = yaml.load(text)
  if (parsed === undefined || parsed === null) return {}
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`dsh-zcf: credentials document ${path} must be a YAML mapping of reference to value`)
  }
  const entries: Record<string, string> = {}
  for (const [ref, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isValidRef(ref)) {
      throw new Error(`dsh-zcf: credentials document ${path} has an invalid reference ${JSON.stringify(ref)}`)
    }
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`dsh-zcf: credentials document ${path} value for ${ref} must be a non-empty string`)
    }
    entries[ref] = value
  }
  return entries
}

/**
 * Merge `entries` into the credentials document: re-read under the writer
 * lock (folding in concurrent writes), apply the entries, and commit
 * atomically with mode 0600 under an owner-only directory. Existing entries
 * the call does not touch survive verbatim.
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
    const current = readCredentials(home)
    const next = { ...current, ...entries }
    const rendered = yaml.dump(next, { lineWidth: -1 })
    await writeFileAtomic(path, rendered, { mode: 0o600, dirMode: 0o700 })
  })
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
