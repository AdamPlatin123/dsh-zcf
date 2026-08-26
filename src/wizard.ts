/**
 * The dsh-zcf wizard: a menu-driven, ZCF-style setup surface. Three flows share
 * one engine — install dsh, collect credentials, choose a runtime surface,
 * select integration options — and every side effect (subprocesses, prompts,
 * output, file writes) arrives through the injectable {@link WizardContext},
 * so the whole flow is testable without a TTY, a PATH, or a real harness home.
 * @module dsh-zcf
 */

import { tmpdir } from 'node:os'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHomeDisplay } from '@deepseek-ai/dsh-home-paths'
import { renderBanner, renderMenuLines, type MenuAction } from './banner.ts'
import { CAPABILITIES, capabilityOf, type Capability, type PatchRow, type Surface } from './capabilities.ts'
import { CATEGORY_LABELS, RECOMMENDED_PLUGINS, recommendedPluginOf, type RecommendedPlugin } from './marketplace.ts'
import { isHttpUrl, type DzcfAction, type DzcfOptions } from './args.ts'
import { API_KEY_REF, BASE_URL_REF, MESSAGES, PUBLIC_BASE_URL, translate, type Lang } from './i18n.ts'
import type { PromptFn, PromptOutcome, PromptQuestion } from './ui.ts'
import type { RunFn, RunResult } from './exec.ts'
import { detectPackageManager, dshAvailable, installDshArgs, runInteractive, REGISTRY_OPTIONS } from './exec.ts'
import { ensureHomeDirectory, maskKey, readCredentials, writeCredentials } from './credentials.ts'
import { writeEnvFile } from './dotenv.ts'
import { allowProfileBuilds, createProfile, installCapability, installModelCatalog, installPlugin, listProfileBundles, readDefaultProfile, removePlugin, setPnpmBinOverride, writeDefaultProfile, writeProfileNpmrc } from './profile.ts'

/** Everything the wizard touches that an environment can provide. */
export interface WizardContext {
  /** Resolved harness home the wizard reads and writes. */
  home: string
  /** Active interface language. */
  lang: Lang
  /** Synchronous command runner. */
  run: RunFn
  /** Streaming global installer; forwards installer stdout lines as they arrive. */
  installDsh: (pm: string, args: readonly string[], onLine: (line: string) => void) => Promise<RunResult>
  /** Registry latency probe in milliseconds; undefined when unreachable. */
  probeRegistry: (url: string) => Promise<number | undefined>
  /** Upstream `GET /models` listing; undefined when the endpoint does not answer. */
  fetchModels: (baseUrl: string, key: string) => Promise<readonly string[] | undefined>
  /** Interactive prompt implementation. */
  prompt: PromptFn
  /** True when stdin and stdout are both a TTY. */
  interactive: boolean
  /** Progress output (stdout). */
  out: (text: string) => void
  /** Failure output (stderr). */
  err: (text: string) => void
}

/** Selected integration state for one run. */
interface IntegrationPlan {
  capabilities: Capability[]
  profile: string
  mcpCommand?: string
  envEntries: Record<string, string>
}

type T = (key: string, params?: Readonly<Record<string, string>>) => string

/** The post-init onboarding block: launch, first run, daily management, docs. */
function onboardingBlock(surface: Surface, profile: string, model: string | undefined, t: T): string {
  const launch = surface === 'web' ? t('onboardingLaunchWeb') : surface === 'tui' ? t('onboardingLaunchTui', { profile }) : t('onboardingLaunchApp', { profile })
  return [
    t('onboardingTitle'),
    `  1. ${launch}`,
    `  2. ${t('onboardingFirstRun')}${model === undefined ? '' : ` ${t('onboardingModel', { model })}`}`,
    `  3. ${t('onboardingManage')}`,
    `  4. ${t('onboardingDocs')}`,
  ].join('\n')
}

async function askOne(prompt: PromptFn, question: PromptQuestion): Promise<PromptOutcome> {
  return prompt([question])
}

/** Ask a question, or fail loud when a non-interactive run lacks the value. */
async function askValue(
  context: WizardContext,
  t: T,
  question: PromptQuestion,
  fallback: string | undefined,
): Promise<{ status: 'value'; value: string } | { status: 'cancelled' } | { status: 'abort' }> {
  if (fallback !== undefined) return { status: 'value', value: fallback }
  if (!context.interactive) {
    if (question.name === 'key') context.err(t('missingKey'))
    else if (question.name === 'mode') context.err(t('missingMode'))
    return { status: 'abort' }
  }
  const outcome = await askOne(context.prompt, question)
  if (outcome.status === 'cancelled') {
    context.out(t('cancelled'))
    return { status: 'cancelled' }
  }
  const raw = outcome.value[question.name]
  return { status: 'value', value: typeof raw === 'string' ? raw.trim() : '' }
}

/** Outcome of the registry pick: a registry to pin, or a user cancellation. */
type RegistryChoice = { status: 'picked'; registry: string | undefined } | { status: 'cancelled' }

/**
 * Resolve the registry for the dsh install. An explicit `--registry` wins
 * without probing; interactive runs measure both candidates and ask, fastest
 * first; non-interactive runs stay on the package manager's default rather
 * than switching registries on the user's behalf.
 */
async function pickRegistry(context: WizardContext, t: T, options: DzcfOptions): Promise<RegistryChoice> {
  if (options.registry !== undefined) {
    context.out(t('registryGiven', { registry: options.registry }))
    return { status: 'picked', registry: options.registry }
  }
  if (!context.interactive) return { status: 'picked', registry: undefined }
  const probes = await Promise.all(REGISTRY_OPTIONS.map(async option => ({
    option,
    ms: await context.probeRegistry(option.url),
  })))
  const ordered = [...probes].sort((a, b) => {
    if (a.ms === undefined) return 1
    if (b.ms === undefined) return -1
    return a.ms - b.ms
  })
  if (!ordered.some(probe => probe.ms !== undefined)) {
    context.out(t('registryProbeNone'))
    return { status: 'picked', registry: undefined }
  }
  const choiceLabel = (probe: (typeof probes)[number]): string => {
    const ms = probe.ms === undefined ? t('registryUnreachable') : `${probe.ms}ms`
    return t(probe.option.id === 'official' ? 'registryOfficial' : 'registryMirror', { ms })
  }
  const outcome = await askOne(context.prompt, {
    type: 'list',
    name: 'registry',
    message: t('registryPrompt'),
    choices: ordered.map(probe => ({ name: choiceLabel(probe), value: probe.option.url })),
  })
  if (outcome.status === 'cancelled') {
    return { status: 'cancelled' }
  }
  return { status: 'picked', registry: typeof outcome.value.registry === 'string' ? outcome.value.registry : undefined }
}

/** The pinned pnpm major. pnpm 10 treats refused dependency build scripts as
 * a warning; pnpm 11 turns them into a hard install failure the launcher
 * reports as a broken profile, and its allowlist keys do not change that. */
const PNPM_MAJOR = 10

/** Parse a major version out of `pnpm -v` stdout. */
function parseMajor(stdout: string): number | undefined {
  const major = Number.parseInt(stdout.trim().split('.')[0] ?? '', 10)
  return Number.isNaN(major) ? undefined : major
}

/** The PATH pnpm's major version, or undefined when pnpm does not answer. */
function pnpmMajorVersion(run: RunFn): number | undefined {
  // Probe from a neutral directory: pnpm 11 reads a `packageManager` field
  // from the nearest package.json and self-switches to that version, which
  // would shadow whatever the wizard installs for a user running inside such
  // a project.
  const result = run('pnpm', ['-v'], undefined, undefined, tmpdir())
  if (result.status !== 0) return undefined
  return parseMajor(result.stdout)
}

/**
 * Bring in pnpm when the harness would need it: `dsh plugin` is a pnpm
 * passthrough, so a machine that just gained dsh through npm still cannot
 * manage profile plugins until pnpm exists. Installs with the wizard's own
 * package manager and `--registry` when given; a dry run only reports.
 * @param context - injected environment.
 * @param t - translator.
 * @param options - resolved command-line options.
 * @returns true when pnpm is (now) available.
 */
function ensurePnpm(context: WizardContext, t: T, options: DzcfOptions): boolean {
  const { run, out, err } = context
  const currentMajor = pnpmMajorVersion(run)
  if (currentMajor === PNPM_MAJOR) return true
  // A wrong-major pnpm must be replaced through npm: `pm` may resolve to that
  // very pnpm, and the uninstall below would remove it out from under us.
  if (currentMajor === PNPM_MAJOR) return true
  // Compatibility over modification: the user's own pnpm stays untouched.
  // A private pnpm@10 is installed under the harness home and only its bin
  // directory is prepended to launcher subprocess PATHs, so `dsh plugin`
  // sees pnpm-10 semantics while the system pnpm keeps whatever major the
  // user chose.
  const npm = run('npm', ['-v']).status === 0 ? 'npm' : undefined
  if (npm === undefined) {
    err(t('noPackageManager'))
    return false
  }
  const privateRoot = join(context.home, '.zcf', `pnpm${PNPM_MAJOR}`)
  const privateBin = join(privateRoot, 'node_modules', '.bin')
  const registryArgs = options.registry === undefined ? [] : [`--registry=${options.registry}`]
  const args = ['install', '--prefix', privateRoot, `pnpm@${PNPM_MAJOR}`, '--no-audit', '--no-fund', ...registryArgs]
  const installed = run(join(privateBin, 'pnpm'), ['-v'], undefined, undefined, tmpdir())
  if (installed.status !== 0 && currentMajor === undefined) {
    out(t('pnpmPrivateNotice'))
  } else if (installed.status !== 0) {
    out(t('pnpmPrivateWrongMajorNotice', { major: String(currentMajor) }))
  }
  if (installed.status !== 0 || options.dryRun) {
    if (options.dryRun) {
      out(t('dryRunNotice'))
      out(`  - ${npm} ${args.join(' ')}`)
      setPnpmBinOverride(privateBin)
      return true
    }
    out(t('pnpmInstalling', { command: `${npm} ${args.join(' ')}` }))
    const install = run(npm, args)
    // Judge by the result: the private binary answering at the right major.
    const verify = run(join(privateBin, 'pnpm'), ['-v'], undefined, undefined, tmpdir())
    if (verify.status !== 0 || parseMajor(verify.stdout) !== PNPM_MAJOR) {
      err(t('pnpmInstallFailed', { stderr: install.stderr.trim() }))
      return false
    }
  }
  setPnpmBinOverride(privateBin)
  out(t('pnpmPrivateReady'))
  return true
}

/** Ensure `dsh` answers on the PATH, offering an install otherwise. */
async function ensureDsh(context: WizardContext, t: T, options: DzcfOptions): Promise<boolean> {
  const { run, interactive, prompt, out, err } = context
  if (dshAvailable(run)) {
    out(t('dshFound'))
    return true
  }
  out(t('dshMissing'))
  out(t('installSizeNotice'))
  const pm = detectPackageManager(run)
  if (pm === undefined) {
    err(t('noPackageManager'))
    return false
  }
  if (!interactive && !options.yes) {
    err(t('dshMissingNoTty'))
    return false
  }
  const registryChoice = await pickRegistry(context, t, options)
  if (registryChoice.status === 'cancelled') {
    out(t('cancelled'))
    return false
  }
  const registry = registryChoice.registry
  if (interactive && !options.yes) {
    const outcome = await askOne(prompt, { type: 'confirm', name: 'install', message: t('installConfirm', { pm }), default: true })
    if (outcome.status === 'cancelled') {
      out(t('cancelled'))
      return false
    }
    if (outcome.value.install !== true) {
      err(t('dshMissingNoTty'))
      return false
    }
  }
  const args = installDshArgs(pm, registry)
  out(t('installing', { command: `${pm} ${args.join(' ')}` }))
  const started = Date.now()
  const install = await context.installDsh(pm, args, (line) => { if (line !== '') out(line) })
  out(t('installElapsed', { seconds: String(Math.round((Date.now() - started) / 1000)) }))
  if (install.status !== 0) {
    err(t('installFailed', { stderr: install.stderr.trim() }))
    return false
  }
  if (!dshAvailable(run)) {
    err(t('installNoDsh'))
    return false
  }
  out(t('dshInstalled'))
  return true
}

/** Resolve the recommended-plugin selection for init; null on abort. */
async function collectPlugins(context: WizardContext, t: T, options: DzcfOptions): Promise<readonly RecommendedPlugin[] | null> {
  if (options.plugins.length > 0) {
    return options.plugins.map(id => recommendedPluginOf(id)).filter((plugin): plugin is RecommendedPlugin => plugin !== undefined)
  }
  if (!context.interactive) return []
  const outcome = await askOne(context.prompt, {
    type: 'multiselect',
    name: 'plugins',
    message: t('pluginPrompt'),
    choices: [
      { name: t('selectAll'), value: SELECT_ALL },
      ...RECOMMENDED_PLUGINS.map(plugin => ({
        name: `[${CATEGORY_LABELS[plugin.category][context.lang]}] ${plugin.label[context.lang]} — ${plugin.hint[context.lang]}`,
        value: plugin.id,
      })),
    ],
  })
  if (outcome.status === 'cancelled') {
    context.out(t('cancelled'))
    return null
  }
  const picked = (outcome.value.plugins as readonly string[] | undefined) ?? []
  const ids = expandSelectAll(picked, RECOMMENDED_PLUGINS.map(plugin => plugin.id))
  return ids.map(id => recommendedPluginOf(id)).filter((plugin): plugin is RecommendedPlugin => plugin !== undefined)
}

/** Sentinel multiselect choice standing for "every entry in this list". */
const SELECT_ALL = '__ALL__'

/**
 * Expand a multiselect result: picking the sentinel equals picking every
 * concrete value the question offered.
 * @param picked - raw picked values, possibly containing the sentinel.
 * @param all - every concrete value the question offered.
 * @returns the effective picked values.
 */
function expandSelectAll(picked: readonly string[], all: readonly string[]): readonly string[] {
  return picked.includes(SELECT_ALL) ? all : picked.filter(value => value !== SELECT_ALL)
}

/** Resolve the integration selection into a plan; null on abort. */
async function collectIntegrations(context: WizardContext, t: T, options: DzcfOptions, surface: Surface): Promise<IntegrationPlan | null> {
  let ids: readonly string[]
  if (options.with.length > 0) {
    ids = options.with
  } else if (context.interactive) {
    const outcome = await askOne(context.prompt, {
      type: 'multiselect',
      name: 'with',
      message: t('integrationPrompt'),
      choices: [
        { name: t('selectAll'), value: SELECT_ALL },
        ...CAPABILITIES.map(capability => ({ name: `${capability.label[context.lang]} — ${capability.hint[context.lang]}`, value: capability.id })),
      ],
    })
    if (outcome.status === 'cancelled') {
      context.out(t('cancelled'))
      return null
    }
    const pickedWith = (outcome.value.with as readonly string[] | undefined) ?? []
    ids = expandSelectAll(pickedWith, CAPABILITIES.map(capability => capability.id))
  } else {
    ids = []
  }

  const capabilities = ids.map(id => capabilityOf(id)).filter((capability): capability is Capability => capability !== undefined)
  if (capabilities.length === 0) {
    return { capabilities: [], profile: surface, envEntries: {} }
  }

  let profile = options.profile
  if (profile === undefined && context.interactive) {
    const answer = await askValue(context, t, { type: 'input', name: 'profile', message: t('profileNamePrompt'), default: 'dzcf' }, undefined)
    if (answer.status !== 'value') return null
    profile = answer.value || 'dzcf'
  }
  if (profile === undefined || profile === '') {
    context.err(t('missingProfile'))
    return null
  }

  const envEntries: Record<string, string> = {}
  const envKeys = [...new Set(capabilities.flatMap(capability => capability.envKeys ?? []))]
  for (const ref of envKeys) {
    if (context.interactive) {
      const answer = await askValue(context, t, { type: 'password', name: ref, message: t('envKeyPrompt', { ref }) }, undefined)
      if (answer.status === 'cancelled') return null
      if (answer.status === 'value' && answer.value !== '') envEntries[ref] = answer.value
    }
  }

  let mcpCommand: string | undefined
  if (ids.includes('mcp')) {
    if (context.interactive) {
      const answer = await askValue(context, t, { type: 'input', name: 'mcpCommand', message: t('mcpCommandPrompt') }, options.mcpCommand)
      if (answer.status === 'cancelled') return null
      if (answer.status === 'abort') {
        context.err(t('missingWith'))
        return null
      }
      mcpCommand = answer.value
    } else {
      mcpCommand = options.mcpCommand
      if (mcpCommand === undefined || mcpCommand === '') {
        context.err(t('missingWith'))
        return null
      }
    }
  }
  return {
    capabilities,
    profile,
    ...(mcpCommand === undefined ? {} : { mcpCommand }),
    envEntries,
  }
}

/** Effective patch rows for a capability, with per-run config injected. */
function effectiveRows(capability: Capability, mcpCommand: string | undefined): readonly PatchRow[] {
  if (capability.id === 'mcp' && mcpCommand !== undefined) {
    return (capability.rows ?? []).map(row => ({ ...row, config: { command: mcpCommand } }))
  }
  return capability.rows ?? []
}

/** Store the DeepSeek credentials; false on failure. */
async function storeCredentials(context: WizardContext, t: T, home: string, key: string, baseUrl: string): Promise<boolean> {
  const { out, err } = context
  let existing: Record<string, string>
  try {
    existing = readCredentials(home)
  } catch (error) {
    err(t('credentialsReadFailed', { path: `${dshHomeDisplay(home)}/.credentials.yaml`, reason: (error as Error).message }))
    return false
  }
  const entries: Record<string, string> = { [API_KEY_REF]: key }
  if (baseUrl !== '') entries[BASE_URL_REF] = baseUrl
  const writes = Object.entries(entries).filter(([ref, value]) => existing[ref] !== value)
  if (writes.length === 0) {
    out(t('noWrites'))
    return true
  }
  try {
    await ensureHomeDirectory(home)
    await writeCredentials(home, entries)
  } catch (error) {
    err(t('credentialsReadFailed', { path: `${dshHomeDisplay(home)}/.credentials.yaml`, reason: (error as Error).message }))
    return false
  }
  out(t('credentialsWritten', { path: `${dshHomeDisplay(home)}/.credentials.yaml`, refs: Object.keys(entries).join(', ') }))
  return true
}

/** Create/install the integration plan into a custom profile and verify. */
async function setupIntegrations(
  context: WizardContext,
  t: T,
  home: string,
  surface: Surface,
  plan: IntegrationPlan,
  options: DzcfOptions,
): Promise<boolean> {
  const { run, out, err } = context
  if (!await createProfileWithRecovery(context, t, options, surface, plan.profile)) return false
  out(t('profileCreated', { profile: plan.profile }))

  if (Object.keys(plan.envEntries).length > 0) {
    try {
      await writeEnvFile(home, plan.envEntries)
    } catch (error) {
      err(t('credentialsReadFailed', { path: `${dshHomeDisplay(home)}/.env`, reason: (error as Error).message }))
      return false
    }
    out(t('envWritten', { path: `${dshHomeDisplay(home)}/.env`, refs: Object.keys(plan.envEntries).join(', ') }))
  }

  for (const capability of plan.capabilities) {
    out(t('addingCapability', { capability: capability.label[context.lang] }))
    try {
      await installCapability(run, home, plan.profile, { ...capability, rows: effectiveRows(capability, plan.mcpCommand) })
    } catch (error) {
      err((error as Error).message)
      return false
    }
    out(t('capabilityInstalled', { capability: capability.label[context.lang] }))
  }

  const finalVerify = run('dsh', ['--profile', plan.profile, '--dump-config'])
  if (finalVerify.status !== 0) {
    err(t('verifyFailed', { mode: plan.profile, stderr: finalVerify.stderr.trim() }))
    return false
  }
  out(t('verified', { mode: plan.profile }))
  return true
}

/** Render a summary of what the wizard is about to do. */
function planLines(key: string | undefined, baseUrl: string, plan: IntegrationPlan): string[] {
  const lines: string[] = []
  if (key !== undefined) lines.push(`${API_KEY_REF} = ${maskKey(key)}`)
  if (baseUrl !== '') lines.push(`${BASE_URL_REF} = ${baseUrl}`)
  for (const capability of plan.capabilities) {
    for (const pkg of capability.packages ?? []) lines.push(`add ${pkg}`)
    for (const row of capability.rows ?? []) lines.push(`row ${row.id}`)
    for (const ref of capability.envKeys ?? []) lines.push(`${ref} = ***`)
  }
  if (plan.profile !== 'headless' && plan.profile !== 'web') lines.push(`verify: dsh --profile ${plan.profile} --dump-config`)
  return lines
}

/** Lines describing what the init flow is about to do. */
function initPlanLines(
  key: string | undefined,
  baseUrl: string,
  surface: Surface,
  profile: string,
  plugins: readonly RecommendedPlugin[],
  model: string | undefined,
): string[] {
  const lines: string[] = [`surface: ${surface} (profile: ${profile})`]
  if (key !== undefined) lines.push(`${API_KEY_REF} = ${maskKey(key)}`)
  if (baseUrl !== '') lines.push(`${BASE_URL_REF} = ${baseUrl}`)
  if (model !== undefined) lines.push(`model ${model} -> ${profile} catalog`)
  for (const plugin of plugins) lines.push(`plugin ${plugin.id}`)
  return lines
}

/** Registry decision per wizard context, so the mirror question is asked once per session. */
const registryDecisions = new WeakMap<WizardContext, { asked: boolean; registry: string | undefined }>()

/**
 * Make the profile's plugin installs resolve through a registry the user
 * picked: `--registry` wins; an interactive run with plugins to install asks
 * once per process (with measured candidates); non-interactive runs keep the
 * package manager default. The decision lands in the profile's `.npmrc`, so
 * the launcher's own later pnpm calls inherit it too.
 * @param context - injected environment.
 * @param t - translator.
 * @param options - resolved command-line options.
 * @param profile - profile name.
 * @param pluginCount - how many plugin installs are about to run.
 */
async function ensureProfileRegistry(
  context: WizardContext,
  t: T,
  options: DzcfOptions,
  profile: string,
  pluginCount: number,
): Promise<void> {
  const { out } = context
  if (pluginCount === 0) return
  const decision = registryDecisions.get(context)
  let registry = options.registry
  if (registry === undefined && context.interactive && decision?.asked !== true) {
    const choice = await pickRegistry(context, t, options)
    if (choice.status === 'cancelled') return
    // Only a made decision is remembered; an Esc leaves the question open
    // for the next flow in this same session.
    registryDecisions.set(context, { asked: true, registry: choice.registry })
    registry = choice.registry
  } else if (registry === undefined) {
    registry = decision?.registry
  }
  if (registry === undefined || registry === '') return
  if (options.dryRun) {
    out(t('dryRunNotice'))
    out(`  - ${profile} .npmrc registry=${registry}`)
    return
  }
  await writeProfileNpmrc(context.home, profile, registry)
  out(t('npmrcWritten', { profile, registry }))
}

/**
 * Create (or verify) a profile, and when the first attempt fails — typically
 * a leftover broken pnpm state from an earlier interrupted install — offer to
 * wipe the profile directory and rebuild it once. Interactive runs are asked
 * (default yes); `--yes` recovers automatically; plain non-interactive runs
 * keep the loud failure with the manual hint.
 * @param context - injected environment.
 * @param t - translator.
 * @param options - resolved command-line options.
 * @param surface - runtime surface for the profile.
 * @param profile - profile name.
 * @returns true when the profile composes.
 */
async function createProfileWithRecovery(
  context: WizardContext,
  t: T,
  options: DzcfOptions,
  surface: Surface,
  profile: string,
): Promise<boolean> {
  const { run, out, err, home } = context
  const fail = (result: RunResult): void => {
    const detail = [result.stderr.trim(), result.stdout.trim()].filter(part => part !== '').join('\n')
    err(t('verifyFailed', { mode: profile, stderr: detail }))
    err(t('profileBrokenHint', { path: `${dshHomeDisplay(home)}/profiles/${profile}` }))
  }
  let create = createProfile(run, surface, profile)
  if (create.status === 0) {
    await writeDefaultProfile(home, profile)
    return true
  }
  if (!(context.interactive || options.yes)) {
    fail(create)
    return false
  }
  if (context.interactive && !options.yes) {
    const outcome = await askOne(context.prompt, { type: 'confirm', name: 'rebuildProfile', message: t('profileRecoveryAsk', { profile }), default: true })
    if (outcome.status === 'cancelled' || outcome.value.rebuildProfile !== true) {
      fail(create)
      return false
    }
  }
  out(t('profileRecovering', { profile }))
  await rm(join(home, 'profiles', profile), { recursive: true, force: true })
  create = createProfile(run, surface, profile)
  if (create.status !== 0) {
    fail(create)
    return false
  }
  await allowProfileBuilds(home, profile)
  await writeDefaultProfile(home, profile)
  out(t('profileRecovered', { profile }))
  return true
}

/**
 * Parse package names out of pnpm's ignored-builds notice. The line reads
 * `Ignored build scripts: @scope/pkg@1.2.3, plain-pkg@2.0.0`.
 * @param text - captured pnpm output.
 * @returns package names (without versions) worth approving.
 */
function parseIgnoredBuilds(text: string): readonly string[] {
  const names: string[] = []
  for (const match of text.matchAll(/Ignored build scripts?:[^\n]*\n?((?:[ \t@][^\n]*)*)/g)) {
    const candidates = match[0].split(/[,\n]/).map(part => part.trim())
    for (const candidate of candidates) {
      const name = candidate.replace(/^Ignored build scripts?:/, '').trim().replace(/@[^@]+$/, '')
      if (name !== '' && (/^@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-._~]+$/i.test(name) || /^[a-z0-9-._~]+$/i.test(name))) names.push(name)
    }
  }
  return [...new Set(names)]
}

/** Install recommended plugins into a profile; false on first failure. */
async function installPlugins(context: WizardContext, t: T, profile: string, plugins: readonly RecommendedPlugin[]): Promise<boolean> {
  const { home } = context
  if (plugins.length > 1) {
    // One batched pnpm run installs every pick in a single resolution pass
    // (measured ~2.4x over per-plugin runs on three plugins); pnpm's own
    // Progress lines stream through as the progress display. A batch failure
    // falls back to the per-plugin loop below, which also self-heals refused
    // build scripts.
    context.out(t('pluginsBatchInstalling', { count: String(plugins.length) }))
    const started = Date.now()
    const batch = await context.installDsh('dsh', ['plugin', '--profile', profile, 'add', '-w', ...plugins.map(plugin => plugin.id)], (line) => {
      if (line !== '') context.out(line)
    })
    context.out(t('pluginsBatchElapsed', { seconds: String(Math.round((Date.now() - started) / 1000)) }))
    if (batch.status === 0) {
      for (const plugin of plugins) context.out(t('pluginInstalled', { plugin: plugin.id }))
      return true
    }
    const refused = parseIgnoredBuilds([batch.stderr.trim(), batch.stdout.trim()].filter(part => part !== '').join('\n'))
    if (refused.length > 0) {
      try {
        await allowProfileBuilds(home, profile, refused)
        context.out(t('buildsAllowlisted', { deps: refused.join(', '), plugin: profile }))
      } catch {
        // the per-plugin fallback below reports loudly
      }
    }
    context.out(t('pluginsBatchFellBack'))
  }
  for (const plugin of plugins) {
    context.out(t('pluginInstalling', { plugin: plugin.id }))
    let result = installPlugin(context.run, profile, plugin.id)
    if (result.status !== 0) {
      const detail = [result.stderr.trim(), result.stdout.trim()].filter(part => part !== '').join('\n')
      // pnpm 10 refuses dependency build scripts unless whitelisted; the
      // refused names ride along in the notice line, so approve them and
      // retry once — the plugin itself usually installed fine.
      const refused = parseIgnoredBuilds(detail)
      if (refused.length > 0) {
        try {
          await allowProfileBuilds(home, profile, refused)
          context.out(t('buildsAllowlisted', { deps: refused.join(', '), plugin: plugin.id }))
          result = installPlugin(context.run, profile, plugin.id)
        } catch {
          // fall through to the loud failure below
        }
      }
      if (result.status !== 0) {
        // The launcher folds pnpm's own failure into one line, while the real
        // cause (peer conflicts, fetch errors) usually lands on captured
        // stdout — surface the tail of both so the user can diagnose.
        context.err(t('pluginInstallFailed', { plugin: plugin.id, stderr: [result.stderr.trim(), result.stdout.trim()].filter(part => part !== '').join('\n') }))
        return false
      }
    }
    context.out(t('pluginInstalled', { plugin: plugin.id }))
  }
  return true
}

/** Fully-collected init state after the step loop resolves. */
/**
 * Ask which upstream model to pin into the profile catalog. The listing is
 * fetched live from the endpoint with the key; a failed fetch falls back to a
 * manual id entry, and an empty answer leaves the catalog untouched.
 * @param context - injected environment.
 * @param t - translator.
 * @param baseUrl - endpoint base; empty uses the public DeepSeek API.
 * @param key - bearer credential for the listing.
 * @returns the picked model id, or undefined when skipped.
 */
type ModelAnswer = { status: 'picked'; model: string } | { status: 'skipped' } | { status: 'cancelled' }

async function askModel(context: WizardContext, t: T, baseUrl: string, key: string): Promise<ModelAnswer> {
  const ids = await context.fetchModels(baseUrl, key)
  if (ids !== undefined) {
    const outcome = await askOne(context.prompt, {
      type: 'list',
      name: 'model',
      message: t('modelPrompt'),
      choices: [{ name: t('modelSkip'), value: '__SKIP__' }, ...ids.map(id => ({ name: id, value: id }))],
    })
    if (outcome.status === 'cancelled') return { status: 'cancelled' }
    const picked = outcome.value.model
    return typeof picked === 'string' && picked !== '__SKIP__' ? { status: 'picked', model: picked } : { status: 'skipped' }
  }
  context.out(t('modelFetchFailed'))
  const outcome = await askOne(context.prompt, { type: 'input', name: 'modelManual', message: t('modelManualPrompt') })
  if (outcome.status === 'cancelled') return { status: 'cancelled' }
  const typed = typeof outcome.value.modelManual === 'string' ? outcome.value.modelManual.trim() : ''
  return typed === '' ? { status: 'skipped' } : { status: 'picked', model: typed }
}

interface InitState {
  key: string
  baseUrl: string
  surface: Surface
  plugins: readonly RecommendedPlugin[]
  /** Model id pinned into the profile catalog; undefined keeps the shipped catalog. */
  model?: string
}

/**
 * Collect the init answers as a navigable step loop: Esc on any question
 * steps back to the previous one (the prior answer becomes the default, so
 * enter alone moves forward even with no input); Esc on the first question
 * cancels the run. Non-interactive runs keep the fallback/fail-loud path.
 */
async function collectInitState(context: WizardContext, t: T, options: DzcfOptions): Promise<{ status: 'done'; state: InitState } | { status: 'cancelled' } | { status: 'abort' }> {
  let stored: Record<string, string>
  try {
    stored = readCredentials(context.home)
  } catch (error) {
    context.err(t('credentialsReadFailed', { path: `${dshHomeDisplay(context.home)}/.credentials.yaml`, reason: (error as Error).message }))
    return { status: 'abort' }
  }
  if (!context.interactive) {
    // A key already on disk satisfies the run: explicit --key wins, the
    // stored document is the fallback, and only a machine with neither aborts.
    const key = options.key ?? stored[API_KEY_REF]
    if (key === undefined || key === '') {
      context.err(t('missingKey'))
      return { status: 'abort' }
    }
    const baseUrl = options.baseUrl ?? stored[BASE_URL_REF] ?? ''
    if (baseUrl !== '' && !isHttpUrl(baseUrl)) {
      context.err(t('badBaseUrl', { url: baseUrl }))
      return { status: 'abort' }
    }
    if (options.mode === undefined) {
      context.err(t('missingMode'))
      return { status: 'abort' }
    }
    return {
      status: 'done',
      state: {
        key,
        baseUrl,
        surface: options.mode,
        plugins: options.plugins.map(id => recommendedPluginOf(id)).filter((plugin): plugin is RecommendedPlugin => plugin !== undefined),
        ...(options.model === undefined ? {} : { model: options.model }),
      },
    }
  }
  context.out(t('backHint'))
  let key = options.key
  let baseUrl = options.baseUrl ?? stored[BASE_URL_REF] ?? ''
  let surface = options.mode
  let plugins = options.plugins.map(id => recommendedPluginOf(id)).filter((plugin): plugin is RecommendedPlugin => plugin !== undefined)
  let model = options.model
  type InitStep = 'baseUrl' | 'key' | 'model' | 'surface' | 'plugins' | 'proceed'
  const steps: readonly InitStep[] = [
    'baseUrl' as const,
    ...(key === undefined ? ['key' as const] : []),
    ...(model === undefined ? ['model' as const] : []),
    ...(surface === undefined ? ['surface' as const] : []),
    ...(options.plugins.length === 0 ? ['plugins' as const] : []),
    ...(options.yes ? ([] as const) : ['proceed' as const]),
  ]
  let index = 0
  while (index < steps.length) {
    const step = steps[index]
    if (step === undefined) break
    index += 1
    let steppedBack = false
    switch (step) {
      case 'key': {
        const credentialRefs = Object.keys(stored).filter(ref => stored[ref] !== '').sort((a, b) => (a === API_KEY_REF ? -1 : 0) - (b === API_KEY_REF ? -1 : 0))
        if (credentialRefs.length > 0) {
          const pick = await askOne(context.prompt, {
            type: 'list',
            name: 'keyChoice',
            message: t('keyChoicePrompt'),
            choices: [
              ...credentialRefs.map(ref => ({ name: `${ref}（${maskKey(stored[ref] ?? '')}）`, value: ref })),
              { name: t('credentialReenter'), value: '__NEW__' },
            ],
          })
          if (pick.status === 'cancelled') { steppedBack = true; break }
          const ref = pick.value.keyChoice
          if (typeof ref === 'string' && ref !== '__NEW__') {
            key = stored[ref]
            break
          }
        }
        const outcome = await askOne(context.prompt, { type: 'password', name: 'key', message: t('apiKeyPrompt') })
        if (outcome.status === 'cancelled') { steppedBack = true; break }
        const typed = typeof outcome.value.key === 'string' ? outcome.value.key.trim() : ''
        if (typed === '' && key === undefined) {
          context.err(t('missingKey'))
          return { status: 'abort' }
        }
        if (typed !== '') key = typed
        break
      }
      case 'baseUrl': {
        const outcome = await askOne(context.prompt, {
          type: 'input',
          name: 'baseUrl',
          message: t('baseUrlPrompt', { default: PUBLIC_BASE_URL }),
          ...(baseUrl === '' ? {} : { default: baseUrl }),
        })
        if (outcome.status === 'cancelled') { steppedBack = true; break }
        const typed = typeof outcome.value.baseUrl === 'string' ? outcome.value.baseUrl.trim() : ''
        if (typed !== '' && !isHttpUrl(typed)) {
          context.err(t('badBaseUrl', { url: typed }))
          return { status: 'abort' }
        }
        baseUrl = typed
        break
      }
      case 'model': {
        const answer = await askModel(context, t, baseUrl, key ?? stored[API_KEY_REF] ?? '')
        if (answer.status === 'cancelled') { steppedBack = true; break }
        if (answer.status === 'picked') model = answer.model
        break
      }
      case 'surface': {
        const outcome = await askOne(context.prompt, {
          type: 'list',
          name: 'mode',
          message: t('modePrompt'),
          choices: [
            { name: t('modeTui'), value: 'tui' },
            { name: t('modeWeb'), value: 'web' },
            { name: t('modeApp'), value: 'app' },
          ],
          ...(surface === undefined ? {} : { initial: surface }),
        })
        if (outcome.status === 'cancelled') { steppedBack = true; break }
        const picked = outcome.value.mode
        surface = picked === 'web' ? 'web' : picked === 'app' ? 'app' : 'tui'
        break
      }
      case 'plugins': {
        const outcome = await askOne(context.prompt, {
          type: 'multiselect',
          name: 'plugins',
          message: t('pluginPrompt'),
          choices: [
            { name: t('selectAll'), value: SELECT_ALL },
            ...RECOMMENDED_PLUGINS.map(plugin => ({
              name: `[${CATEGORY_LABELS[plugin.category][context.lang]}] ${plugin.label[context.lang]} — ${plugin.hint[context.lang]}`,
              value: plugin.id,
            })),
          ],
          ...(plugins.length === 0 ? {} : { initial: plugins.map(plugin => plugin.id) }),
        })
        if (outcome.status === 'cancelled') { steppedBack = true; break }
        const pickedPlugins = (outcome.value.plugins as readonly string[] | undefined) ?? []
        const ids = expandSelectAll(pickedPlugins, RECOMMENDED_PLUGINS.map(plugin => plugin.id))
        plugins = ids.map(id => recommendedPluginOf(id)).filter((plugin): plugin is RecommendedPlugin => plugin !== undefined)
        break
      }
      case 'proceed': {
        const profile = options.profile ?? 'dzcf'
        context.out(t('summary', { lines: initPlanLines(key, baseUrl, surface ?? 'tui', profile, plugins, model).map(line => `  - ${line}`).join('\n') }))
        const outcome = await askOne(context.prompt, { type: 'confirm', name: 'proceed', message: t('proceedConfirm'), default: true })
        if (outcome.status === 'cancelled') { steppedBack = true; break }
        if (outcome.value.proceed !== true) {
          context.out(t('cancelled'))
          return { status: 'cancelled' }
        }
        break
      }
    }
    if (steppedBack) {
      if (step === steps[0]) {
        context.out(t('cancelled'))
        return { status: 'cancelled' }
      }
      index = steps.indexOf(step) - 1
    }
  }
  if (key === undefined || surface === undefined) {
    context.err(key === undefined ? t('missingKey') : t('missingMode'))
    return { status: 'abort' }
  }
  return { status: 'done', state: { key, baseUrl, surface, plugins, ...(model === undefined ? {} : { model }) } }
}

/** The full-init flow. */
async function runInit(context: WizardContext, t: T, options: DzcfOptions): Promise<number> {
  const { home, out } = context
  if (!await ensureDsh(context, t, options)) return 1
  if (!ensurePnpm(context, t, options)) return 1

  const collected = await collectInitState(context, t, options)
  if (collected.status === 'abort') return 1
  if (collected.status === 'cancelled') return 0
  const { key, baseUrl, surface, plugins } = collected.state
  const profile = options.profile ?? 'dzcf'

  if (options.dryRun) {
    out(t('dryRunNotice'))
    for (const line of initPlanLines(key, baseUrl, surface, profile, plugins, collected.state.model)) out(`  - ${line}`)
    return 0
  }

  if (!await storeCredentials(context, t, home, key, baseUrl)) return 1

  // The registry decision must precede profile creation: the surface bundle
  // install itself runs pnpm inside the profile and needs the mirror as much
  // as the plugin installs do.
  await ensureProfileRegistry(context, t, options, profile, plugins.length > 0 || listProfileBundles(home, profile) === undefined ? 1 : 0)
  await allowProfileBuilds(home, profile)
  if (!await createProfileWithRecovery(context, t, options, surface, profile)) return 1
  out(t('profileCreated', { profile }))
  if (!await installPlugins(context, t, profile, plugins)) return 1

  if (collected.state.model !== undefined) {
    try {
      await installModelCatalog(context.run, home, profile, collected.state.model, baseUrl)
      out(t('modelCatalogWritten', { model: collected.state.model, profile }))
    } catch (error) {
      context.err(t('modelCatalogFailed', { reason: (error as Error).message }))
      return 1
    }
  }
  const verify = context.run('dsh', ['--profile', profile, '--dump-config'])
  if (verify.status !== 0) {
    context.err(t('verifyFailed', { mode: profile, stderr: verify.stderr.trim() }))
    return 1
  }
  out(t('verified', { mode: profile }))

  out('')
  out(onboardingBlock(surface, profile, collected.state.model, t))
  return 0
}

/** The marketplace flow: browse the curated picks and install into a profile. */
async function runMarketplace(context: WizardContext, t: T, options: DzcfOptions): Promise<number> {
  if (!ensurePnpm(context, t, options)) return 1

  const { run, out, err, home } = context
  out(t('marketplaceSource'))
  const profile = options.profile ?? 'dzcf'
  const plugins = await collectPlugins(context, t, options)
  if (plugins === null) return 1
  if (plugins.length === 0) {
    out(t('marketplaceNone'))
    return 0
  }
  if (options.dryRun) {
    out(t('dryRunNotice'))
    for (const plugin of plugins) out(`  - plugin ${plugin.id} -> ${profile}`)
    return 0
  }
  await ensureProfileRegistry(context, t, options, profile, plugins.length)
  await allowProfileBuilds(home, profile)
  if (listProfileBundles(home, profile) === undefined) {
    if (!await createProfileWithRecovery(context, t, options, 'web', profile)) return 1
    out(t('profileCreated', { profile }))
  }
  if (!await installPlugins(context, t, profile, plugins)) return 1
  const verify = run('dsh', ['--profile', profile, '--dump-config'])
  if (verify.status !== 0) {
    err(t('verifyFailed', { mode: profile, stderr: verify.stderr.trim() }))
    return 1
  }
  out(t('verified', { mode: profile }))
  return 0
}

/** The manage flow: list a profile's plugins and remove picked ones. */
async function runManage(context: WizardContext, t: T, options: DzcfOptions): Promise<number> {
  const { run, out, err, home } = context
  const profile = options.profile ?? 'dzcf'
  const installed = listProfileBundles(home, profile)
  if (installed === undefined) {
    err(t('manageMissing', { profile }))
    return 1
  }
  if (installed.length === 0) {
    out(t('manageEmpty'))
    return 0
  }
  out(t('manageListHeader'))
  for (const pkg of installed) out(`  - ${pkg}`)

  let toRemove: readonly string[]
  if (context.interactive) {
    const outcome = await askOne(context.prompt, {
      type: 'multiselect',
      name: 'remove',
      message: t('manageRemovePrompt'),
      choices: [{ name: t('selectAll'), value: SELECT_ALL }, ...installed.map(pkg => ({ name: pkg, value: pkg }))],
    })
    if (outcome.status === 'cancelled') {
      out(t('cancelled'))
      return 0
    }
    toRemove = expandSelectAll((outcome.value.remove as readonly string[] | undefined) ?? [], installed)
  } else {
    toRemove = options.plugins.filter(pkg => installed.includes(pkg))
  }
  if (toRemove.length === 0) {
    out(t('marketplaceNone'))
    return 0
  }
  if (options.dryRun) {
    out(t('dryRunNotice'))
    for (const pkg of toRemove) out(`  - remove ${pkg}`)
    return 0
  }
  for (const pkg of toRemove) {
    out(t('pluginRemoving', { plugin: pkg }))
    const result = removePlugin(run, profile, pkg)
    if (result.status !== 0) {
      err(t('pluginRemoveFailed', { plugin: pkg, stderr: result.stderr.trim() }))
      return 1
    }
    out(t('pluginRemoved', { plugin: pkg }))
  }
  return 0
}

/**
 * The update flow: refresh picked installed plugins to npm latest. `plugin
 * add` over an installed package is the package manager's upgrade, so the
 * update path reuses it verbatim.
 */
async function runUpdate(context: WizardContext, t: T, options: DzcfOptions): Promise<number> {
  const { run, out, err, home } = context
  const profile = options.profile ?? 'dzcf'
  const installed = listProfileBundles(home, profile)
  if (installed === undefined) {
    err(t('manageMissing', { profile }))
    return 1
  }
  if (installed.length === 0) {
    out(t('manageEmpty'))
    return 0
  }
  out(t('manageListHeader'))
  for (const pkg of installed) out(`  - ${pkg}`)

  let toUpdate: readonly string[]
  if (context.interactive) {
    const outcome = await askOne(context.prompt, {
      type: 'multiselect',
      name: 'update',
      message: t('updatePrompt'),
      choices: [{ name: t('selectAll'), value: SELECT_ALL }, ...installed.map(pkg => ({ name: pkg, value: pkg }))],
      initial: installed,
    })
    if (outcome.status === 'cancelled') {
      out(t('cancelled'))
      return 0
    }
    toUpdate = expandSelectAll((outcome.value.update as readonly string[] | undefined) ?? [], installed)
  } else {
    // No explicit --plugin list in a non-interactive run updates everything.
    toUpdate = options.plugins.length > 0 ? options.plugins.filter(pkg => installed.includes(pkg)) : installed
  }
  if (toUpdate.length === 0) {
    out(t('marketplaceNone'))
    return 0
  }
  if (options.dryRun) {
    out(t('dryRunNotice'))
    for (const pkg of toUpdate) out(`  - update ${pkg} -> latest`)
    return 0
  }
  const failed: string[] = []
  for (const pkg of toUpdate) {
    out(t('pluginUpdating', { plugin: pkg }))
    const result = installPlugin(run, profile, pkg)
    if (result.status !== 0) {
      err(t('pluginUpdateFailed', { plugin: pkg, stderr: result.stderr.trim() }))
      failed.push(pkg)
      continue
    }
    out(t('pluginUpdated', { plugin: pkg }))
  }
  if (failed.length > 0) {
    err(t('updateFailedSummary', { plugins: failed.join(', ') }))
    return 1
  }
  return 0
}

/**
 * The `dsh-tui` launcher: start the default profile's terminal UI with the
 * terminal attached, announcing which profile configuration is loading
 * before handing over.
 * @param context - injected environment.
 * @param t - translator.
 * @returns the launcher's exit code.
 */
function runLaunchTui(context: WizardContext, t: T): number {
  const { home, out, err } = context
  const profile = readDefaultProfile(home)
  const configPath = `${dshHomeDisplay(home)}/profiles/${profile}`
  if (listProfileBundles(home, profile) === undefined) {
    err(t('launchTuiMissing', { path: configPath }))
    return 1
  }
  out(t('launchTuiNotice', { path: configPath }))
  return runInteractive('dsh', ['--profile', profile])
}

/** The integrations-only flow. */
async function runConfigure(context: WizardContext, t: T, options: DzcfOptions): Promise<number> {
  const { home, out, err } = context
  const surface = options.mode ?? 'web'

  let profile = options.profile
  if (profile === undefined && context.interactive) {
    const answer = await askValue(context, t, { type: 'input', name: 'profile', message: t('profileNamePrompt'), default: 'dzcf' }, undefined)
    if (answer.status !== 'value') return 1
    profile = answer.value || 'dzcf'
  }
  if (profile === undefined || profile === '') {
    err(t('missingProfile'))
    return 1
  }

  const plan = await collectIntegrations(context, t, options, surface)
  if (plan === null) return 1
  plan.profile = profile
  if (plan.capabilities.length === 0) {
    err(t('missingWith'))
    return 1
  }

  if (options.dryRun) {
    out(t('dryRunNotice'))
    for (const line of planLines(undefined, '', plan)) out(`  - ${line}`)
    return 0
  }

  if (!await setupIntegrations(context, t, home, surface, plan, options)) return 1
  out('')
  out(onboardingBlock(surface, plan.profile, undefined, t))
  return 0
}

/** The credentials-only flow, as a navigable key -> base URL -> confirm loop. */
async function runCredentials(context: WizardContext, t: T, options: DzcfOptions): Promise<number> {
  const { home, out, err, run } = context
  let stored: Record<string, string> = {}
  try {
    stored = readCredentials(home)
  } catch (error) {
    err(t('credentialsReadFailed', { path: `${dshHomeDisplay(home)}/.credentials.yaml`, reason: (error as Error).message }))
    return 1
  }
  let key = options.key ?? stored[API_KEY_REF]
  let baseUrl = options.baseUrl ?? stored[BASE_URL_REF] ?? ''
  let model: string | undefined = options.model
  if (context.interactive) {
    context.out(t('backHint'))
    const menu = await askOne(context.prompt, {
      type: 'list',
      name: 'kmenu',
      message: t('kMenuPrompt'),
      choices: [
        { name: t('kMenuKey'), value: 'key' },
        { name: t('kMenuBaseUrl'), value: 'baseUrl' },
        { name: t('kMenuModel'), value: 'model' },
        { name: t('kMenuAll'), value: 'all' },
      ],
    })
    if (menu.status === 'cancelled') {
      out(t('cancelled'))
      return 0
    }
    const scope = typeof menu.value.kmenu === 'string' ? menu.value.kmenu : 'all'
    type CredentialStep = 'key' | 'baseUrl' | 'model' | 'proceed'
    const scopeSteps: Readonly<Record<string, readonly CredentialStep[]>> = {
      key: ['key', 'proceed'],
      baseUrl: ['baseUrl', 'proceed'],
      model: ['model', 'proceed'],
      all: ['baseUrl', 'key', 'model', 'proceed'],
    }
    const steps: readonly CredentialStep[] = scopeSteps[scope] ?? scopeSteps.all ?? []
    let index = 0
    while (index < steps.length) {
      const step = steps[index]
      if (step === undefined) break
      index += 1
      let steppedBack = false
      switch (step) {
        case 'key': {
          const outcome = await askOne(context.prompt, { type: 'password', name: 'key', message: t('apiKeyPrompt') })
          if (outcome.status === 'cancelled') { steppedBack = true; break }
          const typed = typeof outcome.value.key === 'string' ? outcome.value.key.trim() : ''
          if (typed === '' && key === undefined) {
            err(t('missingKey'))
            return 1
          }
          if (typed !== '') key = typed
          break
        }
        case 'baseUrl': {
          const outcome = await askOne(context.prompt, {
            type: 'input',
            name: 'baseUrl',
            message: t('baseUrlPrompt', { default: PUBLIC_BASE_URL }),
            ...(baseUrl === '' ? {} : { default: baseUrl }),
          })
          if (outcome.status === 'cancelled') { steppedBack = true; break }
          const typed = typeof outcome.value.baseUrl === 'string' ? outcome.value.baseUrl.trim() : ''
          if (typed !== '' && !isHttpUrl(typed)) {
            err(t('badBaseUrl', { url: typed }))
            return 1
          }
          baseUrl = typed
          break
        }
        case 'model': {
          const answer = await askModel(context, t, baseUrl, key ?? '')
          if (answer.status !== 'picked') {
            out(t('modelSkipped'))
            return 0
          }
          model = answer.model
          break
        }
        case 'proceed': {
          out(t('summary', { lines: [`  - ${API_KEY_REF} = ${maskKey(key ?? '')}`, ...(model === undefined ? [] : [`  - model ${model}`])].join('\n') }))
          const outcome = await askOne(context.prompt, { type: 'confirm', name: 'proceed', message: t('proceedConfirm'), default: true })
          if (outcome.status === 'cancelled') { steppedBack = true; break }
          if (outcome.value.proceed !== true) {
            out(t('cancelled'))
            return 0
          }
          break
        }
      }
      if (steppedBack) {
        if (step === steps[0]) {
          out(t('cancelled'))
          return 0
        }
        index = steps.indexOf(step) - 1
      }
    }
  } else {
    if (key === undefined || key === '') {
      err(t('missingKey'))
      return 1
    }
    if (baseUrl !== '' && !isHttpUrl(baseUrl)) {
      err(t('badBaseUrl', { url: baseUrl }))
      return 1
    }
  }
  if (model !== undefined) {
    const profile = options.profile ?? 'dzcf'
    if (listProfileBundles(home, profile) === undefined) {
      err(t('manageMissing', { profile }))
      return 1
    }
    if (options.dryRun) {
      out(t('dryRunNotice'))
      out(`  - model ${model} -> ${profile} catalog`)
      return 0
    }
    try {
      await installModelCatalog(run, home, profile, model, baseUrl)
      out(t('modelCatalogWritten', { model, profile }))
    } catch (error) {
      err(t('modelCatalogFailed', { reason: (error as Error).message }))
      return 1
    }
  }
  if (options.dryRun) {
    out(t('dryRunNotice'))
    out(`  - ${API_KEY_REF} = ${maskKey(key ?? '')}`)
    return 0
  }
  return await storeCredentials(context, t, home, key ?? '', baseUrl) ? 0 : 1
}

/** Render the banner and resolve the flow. */
async function pickAction(context: WizardContext, t: T, options: DzcfOptions): Promise<Exclude<DzcfAction, 'menu'> | 'exit'> {
  const menuOptions: readonly { action: MenuAction; label: string }[] = [
    { action: 'init', label: t('menuInit') },
    { action: 'marketplace', label: t('menuMarketplace') },
    { action: 'manage', label: t('menuManage') },
    { action: 'update', label: t('menuUpdate') },
    { action: 'configure', label: t('menuConfigure') },
    { action: 'credentials', label: t('menuCredentials') },
    { action: 'exit', label: t('menuExit') },
  ]
  context.out(renderBanner())
  context.out('')
  if (options.action !== 'menu') return options.action
  if (!context.interactive) {
    context.out(renderMenuLines(t('menuTitle'), menuOptions))
    return 'init'
  }
  const outcome = await askOne(context.prompt, {
    type: 'list',
    name: 'action',
    message: t('menuTitle'),
    choices: menuOptions.map(option => ({ name: option.label, value: option.action })),
  })
  if (outcome.status === 'cancelled') return 'exit'
  const value = outcome.value.action
  return value === 'init' || value === 'marketplace' || value === 'manage' || value === 'update' || value === 'configure' || value === 'credentials' ? value : 'exit'
}

/**
 * Run the wizard end to end and return the process exit code (0 success).
 * @param context - injected environment.
 * @param options - resolved command-line options.
 * @returns the exit code.
 */
export async function runWizard(context: WizardContext, options: DzcfOptions): Promise<number> {
  const t: T = (key, params) => translate(MESSAGES, context.lang, key, params)
  let action = await pickAction(context, t, options)
  while (true) {
    let code: number
    switch (action) {
      case 'init': code = await runInit(context, t, options); break
      case 'marketplace': code = await runMarketplace(context, t, options); break
      case 'manage': code = await runManage(context, t, options); break
      case 'update': code = await runUpdate(context, t, options); break
      case 'configure': code = await runConfigure(context, t, options); break
      case 'credentials': code = await runCredentials(context, t, options); break
      case 'tui': code = runLaunchTui(context, t); break
      default: code = 0
    }
    // A finished flow only loops back to the menu when the interactive user
    // asks for it; non-interactive and --yes runs exit straight away, and a
    // failed flow exits with its code instead of offering another round.
    if (code !== 0 || !context.interactive || options.yes) return code
    const again = await askOne(context.prompt, { type: 'confirm', name: 'returnToMenu', message: t('returnToMenu'), default: false })
    if (again.status === 'cancelled' || again.value.returnToMenu !== true) return code
    const next = await pickAction(context, t, { ...options, action: 'menu' })
    if (next === 'exit') return code
    action = next
  }
}
