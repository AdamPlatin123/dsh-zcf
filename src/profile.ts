/**
 * Custom-profile assembly for the dsh-zcf wizard. A custom profile exists only
 * when the user selects integration options: the shipped `web`/`headless`
 * templates cannot carry extra plugins. The wizard drives the same surface the
 * launcher documents — `dsh plugin --profile <name> add <pkg>` initializes the
 * profile, installs packages into its pnpm project, and joins declared bundle
 * layers — then writes its own patch rows and verifies the composition with a
 * dump. Package installation is delegated to `dsh`/`pnpm`; the wizard never
 * edits node_modules itself.
 * @module dsh-zcf
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { Capability, PatchRow, Surface } from './capabilities.ts'
import { SURFACE_BUNDLES } from './capabilities.ts'
import type { RunFn, RunResult } from './exec.ts'

/**
 * Run `dsh plugin --profile <name> add -w <pkg>`. The `-w` is required: a
 * profile directory carries `pnpm-workspace.yaml`, so an unflagged `pnpm add`
 * is rejected with `ERR_PNPM_ADDING_TO_ROOT`.
 */
function pluginAdd(run: RunFn, profile: string, pkg: string): RunResult {
  return run('dsh', ['plugin', '--profile', profile, 'add', '-w', pkg])
}

/** Run `dsh plugin --profile <name> remove -w <pkg>`; nonzero fails the run. */
function pluginRemove(run: RunFn, profile: string, pkg: string): RunResult {
  return run('dsh', ['plugin', '--profile', profile, 'remove', '-w', pkg])
}

/** Absolute path of a profile's user patch layer. */
export function profilePatchPath(home: string, profile: string): string {
  return join(home, 'profiles', profile, 'cordis.patch.yml')
}

/** Read a profile patch layer as a raw row array, or empty when absent. */
export function readPatchRows(home: string, profile: string): unknown[] {
  const path = profilePatchPath(home, profile)
  try {
    const parsed: unknown = yaml.load(readFileSync(path, 'utf8'))
    if (parsed === undefined || parsed === null) return []
    if (!Array.isArray(parsed)) throw new Error(`dsh-zcf: profile patch ${path} must be a YAML array`)
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return []
    throw new Error(`dsh-zcf: cannot read profile patch ${path}: ${(error as Error).message}`)
  }
}

/** Merge rows by id (existing rows keep their content; new rows append). */
function mergeRows(existing: unknown[], rows: readonly PatchRow[], disableRows: readonly string[]): unknown[] {
  const index = new Map<string, number>()
  existing.forEach((row, i) => {
    if (row !== null && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string') {
      index.set((row as { id: string }).id, i)
    }
  })
  const next = [...existing]
  for (const id of disableRows) {
    const at = index.get(id)
    if (at !== undefined) {
      next[at] = { ...(next[at] as Record<string, unknown>), disabled: true }
    }
  }
  for (const row of rows) {
    if (index.has(row.id)) continue
    const config = row.config === undefined ? {} : { config: row.config }
    const name = row.name === undefined ? {} : { name: row.name }
    next.push({ id: row.id, ...name, ...config })
  }
  return next
}

/**
 * Install a capability into a profile: `dsh plugin add` its packages, then
 * merge its patch rows and disables into the profile's patch layer. Fails
 * loud on any nonzero `dsh` exit, mirroring the launcher's own behavior.
 * @param run - command runner.
 * @param home - resolved harness home.
 * @param profile - profile name.
 * @param capability - capability to install.
 */
export async function installCapability(run: RunFn, home: string, profile: string, capability: Capability): Promise<void> {
  for (const pkg of capability.packages ?? []) {
    const result = pluginAdd(run, profile, pkg)
    if (result.status !== 0) {
      throw new Error(`dsh-zcf: dsh plugin add ${pkg} failed: ${result.stderr.trim()}`)
    }
  }
  const rows = capability.rows ?? []
  const disables = capability.disableRows ?? []
  if (rows.length === 0 && disables.length === 0) return
  const merged = mergeRows(readPatchRows(home, profile), rows, disables)
  await writeFileAtomic(profilePatchPath(home, profile), yaml.dump(merged, { lineWidth: -1 }), { mode: 0o600, dirMode: 0o700 })
}

/**
 * Create a custom profile for a runtime surface and verify it composes.
 * The surface bundle add initializes the profile (base + surface) through the
 * launcher's own template logic; a failed dump reports the dsh stderr.
 * @param run - command runner.
 * @param surface - runtime surface whose bundle the profile mounts.
 * @param profile - profile name.
 * @returns the verify (`--dump-config`) result.
 */
export function createProfile(run: RunFn, surface: Surface, profile: string): RunResult {
  const add = pluginAdd(run, profile, SURFACE_BUNDLES[surface])
  if (add.status !== 0) return add
  return run('dsh', ['--profile', profile, '--dump-config'])
}

/**
 * Install one recommended plugin into a profile. `dsh plugin add -w` registers
 * the bundle in the profile's package.json and the loader expands it on the
 * next boot, so no patch rows are written.
 * @param run - command runner.
 * @param profile - profile name.
 * @param pkg - npm package name of the plugin.
 * @returns the add run result.
 */
export function installPlugin(run: RunFn, profile: string, pkg: string): RunResult {
  return pluginAdd(run, profile, pkg)
}

/**
 * Remove one plugin from a profile; the launcher unregisters the bundle and
 * pnpm drops the dependency.
 * @param run - command runner.
 * @param profile - profile name.
 * @param pkg - npm package name of the plugin.
 * @returns the remove run result.
 */
export function removePlugin(run: RunFn, profile: string, pkg: string): RunResult {
  return pluginRemove(run, profile, pkg)
}

/**
 * List a profile's registered bundles from its package.json, excluding the
 * always-present base bundle.
 * @param home - resolved harness home.
 * @param profile - profile name.
 * @returns the bundle package names beyond `@deepseek-ai/dsh-base`, or undefined when the profile does not exist.
 */
export function listProfileBundles(home: string, profile: string): readonly string[] | undefined {
  const path = join(home, 'profiles', profile, 'package.json')
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(`dsh-zcf: cannot read profile package.json ${path}: ${(error as Error).message}`)
  }
  const bundles = (JSON.parse(raw) as { dsh?: { profile?: { bundles?: unknown } } }).dsh?.profile?.bundles
  if (!Array.isArray(bundles)) return []
  return bundles.filter((bundle): bundle is string => typeof bundle === 'string' && bundle !== '@deepseek-ai/dsh-base')
}
