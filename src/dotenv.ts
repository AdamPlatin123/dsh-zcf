/**
 * Launch-environment `.env` access for the wizard. Web providers the wizard
 * integrates (Exa, Perplexity) read their keys from the launch environment —
 * `$DSH_HOME/.env` is that user layer, not the managed credentials document
 * (`dsh-credentials-local` is not involved for those providers). Writes append
 * or replace single `KEY=value` lines and commit atomically with mode 0600.
 * @module dsh-zcf
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** User launch-environment file inside the harness home. */
const ENV_FILE = '.env'

/** Absolute path of the launch-environment file for a harness home. */
export function envFilePath(home: string): string {
  return join(home, ENV_FILE)
}

/** Parse a dotenv-style document into its `KEY → value` map. */
export function parseEnvFile(text: string): Record<string, string> {
  const entries: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1)
    }
    if (value === '') continue
    entries[key] = value
  }
  return entries
}

/** Serialize a `KEY → value` map to dotenv text; values are single-quoted when they carry spaces. */
export function renderEnvFile(entries: Readonly<Record<string, string>>): string {
  return Object.entries(entries)
    .map(([key, value]) => {
      const quoted = /\s/.test(value) ? `'${value}'` : value
      return `${key}=${quoted}`
    })
    .join('\n') + '\n'
}

/**
 * Read the user launch-environment file; an absent file is empty.
 * @param home - resolved harness home.
 * @returns the parsed entries.
 */
export function readEnvFile(home: string): Record<string, string> {
  const path = envFilePath(home)
  try {
    return parseEnvFile(readFileSync(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return {}
    throw new Error(`dsh-zcf: cannot read ${path}: ${(error as Error).message}`)
  }
}

/**
 * Merge entries into the user launch-environment file, committing atomically
 * with mode 0600 under an owner-only directory. Untouched lines survive.
 * @param home - resolved harness home.
 * @param entries - `KEY → value` entries to store.
 */
export async function writeEnvFile(home: string, entries: Readonly<Record<string, string>>): Promise<void> {
  const path = envFilePath(home)
  await writeFileAtomic(path, renderEnvFile({ ...readEnvFile(home), ...entries }), { mode: 0o600, dirMode: 0o700 })
}
