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
/** Milliseconds a profile pnpm operation may run before counting as hung. */
const PLUGIN_TIMEOUT_MS = 180_000

/**
 * Private pnpm-10 bin directory prepended to every launcher subprocess PATH.
 * Set by the wizard when the system pnpm is missing or a wrong major; a
 * private copy keeps the user's own global pnpm untouched while the launcher
 * still sees pnpm-10 semantics.
 */
let pnpmBinOverride: string | undefined

/** Point launcher subprocesses at a private pnpm bin directory. */
export function setPnpmBinOverride(dir: string | undefined): void {
  pnpmBinOverride = dir
}

/** Environment for launcher runs: the private pnpm bin leads the PATH. */
function launcherEnv(): Readonly<Record<string, string | undefined>> | undefined {
  if (pnpmBinOverride === undefined) return undefined
  return { PATH: `${pnpmBinOverride}:${process.env.PATH ?? ''}` }
}

function pluginAdd(run: RunFn, profile: string, pkg: string): RunResult {
  return run('dsh', ['plugin', '--profile', profile, 'add', '-w', pkg], launcherEnv(), PLUGIN_TIMEOUT_MS)
}

/**
 * Persist the chosen npm registry into the profile directory's `.npmrc`, so
 * every later pnpm run inside the profile — the wizard's plugin installs and
 * the launcher's own `dsh plugin` calls alike — resolves through it. An
 * existing `registry=` line is replaced; other lines survive.
 * @param home - resolved harness home.
 * @param profile - profile name.
 * @param registry - registry base URL.
 */
export async function writeProfileNpmrc(home: string, profile: string, registry: string): Promise<void> {
  const path = join(home, 'profiles', profile, '.npmrc')
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    // absent file is the common case on a fresh profile
  }
  const lines = text.split('\n').filter(line => line !== '' && !line.startsWith('registry='))
  lines.push(`registry=${registry}`)
  await writeFileAtomic(path, `${lines.join('\n')}\n`, { mode: 0o600, dirMode: 0o700 })
}

/**
 * Build-script allowlist seed. pnpm 10 refuses to run dependency build
 * scripts unless whitelisted (`ERR_PNPM_IGNORED_BUILDS` fails the whole
 * `plugin add`), so the profile pre-approves the known set; anything else
 * the wizard discovers in pnpm's failure output is appended at runtime.
 */
const PROFILE_BUILT_DEPENDENCIES: readonly string[] = ['@ast-grep/cli']

/**
 * Merge build-script approvals into the profile's `pnpm-workspace.yaml`.
 * A missing file (older profiles) is created; an existing
 * `onlyBuiltDependencies` list is unioned with the incoming names.
 * @param home - resolved harness home.
 * @param profile - profile name.
 * @param extra - additional package names to approve, discovered at runtime.
 */
export async function allowProfileBuilds(home: string, profile: string, extra: readonly string[] = []): Promise<void> {
  const path = join(home, 'profiles', profile, 'pnpm-workspace.yaml')
  let doc: Record<string, unknown> = {}
  try {
    const parsed: unknown = yaml.load(readFileSync(path, 'utf8'))
    if (parsed !== null && parsed !== undefined && typeof parsed === 'object') doc = parsed as Record<string, unknown>
  } catch {
    // unreadable or absent: rewrite from the template below
  }
  const existing = Array.isArray(doc.onlyBuiltDependencies) ? doc.onlyBuiltDependencies.filter((name): name is string => typeof name === 'string') : []
  const merged = [...new Set([...existing, ...PROFILE_BUILT_DEPENDENCIES, ...extra])].sort()
  if (merged.length === existing.length && extra.length === 0) return
  doc.onlyBuiltDependencies = merged
  await writeFileAtomic(path, `${yaml.dump(doc)}\n`, { mode: 0o600, dirMode: 0o700 })
}

/** Run `dsh plugin --profile <name> remove -w <pkg>`; nonzero fails the run. */
function pluginRemove(run: RunFn, profile: string, pkg: string): RunResult {
  return run('dsh', ['plugin', '--profile', profile, 'remove', '-w', pkg], launcherEnv(), PLUGIN_TIMEOUT_MS)
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
    const config = row.config === undefined ? {} : { config: row.config }
    const name = row.name === undefined ? {} : { name: row.name }
    const composed = { id: row.id, ...name, ...config }
    // Upsert: a re-run with the same row id replaces the row (catalog updates)
    // instead of being silently dropped as a duplicate.
    const at = index.get(row.id)
    if (at === undefined) next.push(composed)
    else next[at] = composed
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



/** Row id the wizard's model-catalog write owns inside the profile patch layer. */
const MODEL_ROW_ID = 'zcf-model'

/**
 * Write the picked upstream model into the profile's `llm-deepseek` catalog:
 * one upsert patch row carrying the custom endpoint (when set) and a single
 * `models` entry, so the choice surfaces in dsh's model picker. The plugin
 * ships with the official distribution, so no package install is needed.
 * @param run - command runner.
 * @param home - resolved harness home.
 * @param profile - profile name.
 * @param picked - chosen model id from the upstream `/models` listing.
 * @param baseUrl - custom endpoint base; omitted for the public API.
 */
export async function installModelCatalog(run: RunFn, home: string, profile: string, picked: string, baseUrl: string): Promise<void> {
  await installCapability(run, home, profile, {
    id: 'model-catalog',
    label: { 'zh-CN': '模型目录', 'en': 'Model catalog' },
    hint: { 'zh-CN': '', 'en': '' },
    rows: [{
      id: MODEL_ROW_ID,
      name: '@deepseek-ai/dsh-llm-deepseek',
      config: {
        ...(baseUrl === '' ? {} : { baseURL: baseUrl }),
        models: [{ id: picked, name: picked }],
      },
    }],
  })
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
