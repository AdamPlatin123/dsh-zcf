/**
 * Pre-change backups for existing users. Before the wizard's first mutation
 * of a machine that already carries state — credentials in the harness home,
 * or a profile with content — the small configuration files (never
 * node_modules, never sessions) are copied under
 * `$DSH_HOME/.zcf/backups/<timestamp>-<label>/`, each with a RESTORE note
 * spelling the exact copy-back commands, and only the newest
 * {@link KEEP_BACKUPS} snapshots survive. Merging stays the wizard's normal
 * semantics; the backup is the escape hatch that makes trying it free.
 * @module dsh-zcf
 */

import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** How many snapshots to keep; older ones are pruned after a new one lands. */
export const KEEP_BACKUPS = 5

/** Profile files worth snapshotting: registration, mirror choice, catalog patch. */
const PROFILE_FILES: readonly string[] = ['package.json', '.npmrc', 'cordis.patch.yml']

/** What one snapshot found worth keeping. */
export interface BackupResult {
  /** Absolute path of the snapshot directory, or undefined when there was nothing to back up. */
  dir: string | undefined
  /** Human-facing lines describing what was captured. */
  lines: readonly string[]
}

function stamp(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/**
 * Snapshot the existing credentials document and one profile's configuration
 * files. Missing inputs are skipped silently; a snapshot with nothing to copy
 * reports `dir: undefined`.
 * @param home - resolved harness home.
 * @param profile - the profile the wizard is about to touch.
 * @returns the snapshot facts for the wizard to announce.
 */
export async function backupExistingState(home: string, profile: string): Promise<BackupResult> {
  const lines: string[] = []
  const credentials = join(home, '.credentials.yaml')
  const profileDir = join(home, 'profiles', profile)
  const hasCredentials = existsSync(credentials)
  const profileFiles = PROFILE_FILES.filter(name => existsSync(join(profileDir, name)))
  if (!hasCredentials && profileFiles.length === 0) return { dir: undefined, lines }

  const dir = join(home, '.zcf', 'backups', `${stamp()}-${profile}`)
  await mkdir(dir, { recursive: true })
  if (hasCredentials) {
    await mkdir(join(dir, 'credentials'), { recursive: true })
    await cp(credentials, join(dir, 'credentials', '.credentials.yaml'))
    lines.push('.credentials.yaml')
  }
  if (profileFiles.length > 0) {
    await mkdir(join(dir, 'profiles', profile), { recursive: true })
    for (const name of profileFiles) {
      await cp(join(profileDir, name), join(dir, 'profiles', profile, name))
      lines.push(`profiles/${profile}/${name}`)
    }
  }
  writeFileSync(join(dir, 'RESTORE.md'), restoreNote(home, profile, hasCredentials, profileFiles), { mode: 0o600 })
  await pruneOldBackups(join(home, '.zcf', 'backups'))
  return { dir, lines }
}

/** The copy-back recipe, spelled exactly so restoring never needs the wizard. */
function restoreNote(home: string, profile: string, hasCredentials: boolean, profileFiles: readonly string[]): string {
  const commands: string[] = [`# 恢复此备份（profile：${profile}）`, '']
  if (hasCredentials) commands.push(`cp ./credentials/.credentials.yaml "${join(home, '.credentials.yaml')}"`)
  for (const name of profileFiles) commands.push(`cp ./profiles/${profile}/${name} "${join(home, 'profiles', profile, name)}"`)
  commands.push('', '# 在本备份目录内执行；凭据文件含密钥，恢复后建议 chmod 600。')
  return commands.join('\n')
}

/**
 * Keep only the newest {@link KEEP_BACKUPS} snapshot directories. Names sort
 * chronologically because they start with the timestamp stamp.
 * @param backupsRoot - the backups directory.
 */
async function pruneOldBackups(backupsRoot: string): Promise<void> {
  let entries
  try {
    entries = await readdir(backupsRoot, { withFileTypes: true })
  } catch {
    return
  }
  const dirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  for (const stale of dirs.slice(0, Math.max(0, dirs.length - KEEP_BACKUPS))) {
    await rm(join(backupsRoot, stale), { recursive: true, force: true })
  }
}
