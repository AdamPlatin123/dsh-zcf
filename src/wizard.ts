/**
 * The dsh-zcf wizard: a menu-driven, ZCF-style setup surface. Three flows share
 * one engine — install dsh, collect credentials, choose a runtime surface,
 * select integration options — and every side effect (subprocesses, prompts,
 * output, file writes) arrives through the injectable {@link WizardContext},
 * so the whole flow is testable without a TTY, a PATH, or a real harness home.
 * @module dsh-zcf
 */

import { dshHomeDisplay } from '@deepseek-ai/dsh-home-paths'
import { renderBanner, renderMenuLines, type MenuAction } from './banner.ts'
import { CAPABILITIES, capabilityOf, type Capability, type PatchRow, type Surface } from './capabilities.ts'
import { CATEGORY_LABELS, RECOMMENDED_PLUGINS, recommendedPluginOf, type RecommendedPlugin } from './marketplace.ts'
import { isHttpUrl, type DzcfAction, type DzcfOptions } from './args.ts'
import { API_KEY_REF, BASE_URL_REF, MESSAGES, PUBLIC_BASE_URL, translate, type Lang } from './i18n.ts'
import type { PromptFn, PromptOutcome, PromptQuestion } from './ui.ts'
import type { RunFn, RunResult } from './exec.ts'
import { detectPackageManager, dshAvailable, installDshArgs, REGISTRY_OPTIONS } from './exec.ts'
import { ensureHomeDirectory, maskKey, readCredentials, writeCredentials } from './credentials.ts'
import { writeEnvFile } from './dotenv.ts'
import { createProfile, installCapability, installPlugin, listProfileBundles, removePlugin } from './profile.ts'

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

const nextStepsCommand = (surface: Surface, profile: string, t: T): string => {
  if (surface === 'web') return 'dsh web  # http://127.0.0.1:3080'
  if (surface === 'tui') return t('nextStepsTui', { profile })
  return t('nextStepsApp', { profile })
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
async function setupIntegrations(context: WizardContext, t: T, home: string, surface: Surface, plan: IntegrationPlan): Promise<boolean> {
  const { run, out, err } = context
  const create = createProfile(run, surface, plan.profile)
  if (create.status !== 0) {
    err(t('verifyFailed', { mode: plan.profile, stderr: create.stderr.trim() }))
    return false
  }
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
): string[] {
  const lines: string[] = [`surface: ${surface} (profile: ${profile})`]
  if (key !== undefined) lines.push(`${API_KEY_REF} = ${maskKey(key)}`)
  if (baseUrl !== '') lines.push(`${BASE_URL_REF} = ${baseUrl}`)
  for (const plugin of plugins) lines.push(`plugin ${plugin.id}`)
  return lines
}

/** Install recommended plugins into a profile; false on first failure. */
function installPlugins(context: WizardContext, t: T, profile: string, plugins: readonly RecommendedPlugin[]): boolean {
  for (const plugin of plugins) {
    context.out(t('pluginInstalling', { plugin: plugin.id }))
    const result = installPlugin(context.run, profile, plugin.id)
    if (result.status !== 0) {
      context.err(t('pluginInstallFailed', { plugin: plugin.id, stderr: result.stderr.trim() }))
      return false
    }
    context.out(t('pluginInstalled', { plugin: plugin.id }))
  }
  return true
}

/** Fully-collected init state after the step loop resolves. */
interface InitState {
  key: string
  baseUrl: string
  surface: Surface
  plugins: readonly RecommendedPlugin[]
}

/**
 * Collect the init answers as a navigable step loop: Esc on any question
 * steps back to the previous one (the prior answer becomes the default, so
 * enter alone moves forward even with no input); Esc on the first question
 * cancels the run. Non-interactive runs keep the fallback/fail-loud path.
 */
async function collectInitState(context: WizardContext, t: T, options: DzcfOptions): Promise<{ status: 'done'; state: InitState } | { status: 'cancelled' } | { status: 'abort' }> {
  if (!context.interactive) {
    if (options.key === undefined) {
      context.err(t('missingKey'))
      return { status: 'abort' }
    }
    const baseUrl = options.baseUrl ?? ''
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
        key: options.key,
        baseUrl,
        surface: options.mode,
        plugins: options.plugins.map(id => recommendedPluginOf(id)).filter((plugin): plugin is RecommendedPlugin => plugin !== undefined),
      },
    }
  }
  context.out(t('backHint'))
  let key = options.key
  let baseUrl = options.baseUrl ?? ''
  let surface = options.mode
  let plugins = options.plugins.map(id => recommendedPluginOf(id)).filter((plugin): plugin is RecommendedPlugin => plugin !== undefined)
  type InitStep = 'key' | 'baseUrl' | 'surface' | 'plugins' | 'proceed'
  const steps: readonly InitStep[] = [
    ...(key === undefined ? ['key' as const] : []),
    'baseUrl' as const,
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
        context.out(t('summary', { lines: initPlanLines(key, baseUrl, surface ?? 'tui', profile, plugins).map(line => `  - ${line}`).join('\n') }))
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
  return { status: 'done', state: { key, baseUrl, surface, plugins } }
}

/** The full-init flow. */
async function runInit(context: WizardContext, t: T, options: DzcfOptions): Promise<number> {
  const { home, out } = context
  if (!await ensureDsh(context, t, options)) return 1

  const collected = await collectInitState(context, t, options)
  if (collected.status === 'abort') return 1
  if (collected.status === 'cancelled') return 0
  const { key, baseUrl, surface, plugins } = collected.state
  const profile = options.profile ?? 'dzcf'

  if (options.dryRun) {
    out(t('dryRunNotice'))
    for (const line of initPlanLines(key, baseUrl, surface, profile, plugins)) out(`  - ${line}`)
    return 0
  }

  if (!await storeCredentials(context, t, home, key, baseUrl)) return 1

  const create = createProfile(context.run, surface, profile)
  if (create.status !== 0) {
    context.err(t('verifyFailed', { mode: profile, stderr: create.stderr.trim() }))
    return 1
  }
  out(t('profileCreated', { profile }))
  if (!installPlugins(context, t, profile, plugins)) return 1

  const verify = context.run('dsh', ['--profile', profile, '--dump-config'])
  if (verify.status !== 0) {
    context.err(t('verifyFailed', { mode: profile, stderr: verify.stderr.trim() }))
    return 1
  }
  out(t('verified', { mode: profile }))

  out('')
  out(t('nextSteps', { command: nextStepsCommand(surface, profile, t) }))
  return 0
}

/** The marketplace flow: browse the curated picks and install into a profile. */
async function runMarketplace(context: WizardContext, t: T, options: DzcfOptions): Promise<number> {
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
  if (listProfileBundles(home, profile) === undefined) {
    const create = createProfile(run, 'web', profile)
    if (create.status !== 0) {
      err(t('verifyFailed', { mode: profile, stderr: create.stderr.trim() }))
      return 1
    }
    out(t('profileCreated', { profile }))
  }
  if (!installPlugins(context, t, profile, plugins)) return 1
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

  if (!await setupIntegrations(context, t, home, surface, plan)) return 1
  out('')
  out(t('nextSteps', { command: nextStepsCommand(surface, plan.profile, t) }))
  return 0
}

/** The credentials-only flow, as a navigable key -> base URL -> confirm loop. */
async function runCredentials(context: WizardContext, t: T, options: DzcfOptions): Promise<number> {
  const { home, out, err } = context
  let key = options.key
  let baseUrl = options.baseUrl ?? ''
  if (context.interactive) {
    context.out(t('backHint'))
    type CredentialStep = 'key' | 'baseUrl' | 'proceed'
    const steps: readonly CredentialStep[] = [
      ...(key === undefined ? ['key' as const] : []),
      ...(options.baseUrl === undefined ? (['baseUrl'] as const) : ([] as const)),
      ...(options.yes ? ([] as const) : (['proceed'] as const)),
    ]
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
        case 'proceed': {
          out(t('summary', { lines: `  - ${API_KEY_REF} = ${maskKey(key ?? '')}` }))
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
    if (key === undefined) {
      err(t('missingKey'))
      return 1
    }
    if (baseUrl !== '' && !isHttpUrl(baseUrl)) {
      err(t('badBaseUrl', { url: baseUrl }))
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
  const action = await pickAction(context, t, options)
  switch (action) {
    case 'init': return runInit(context, t, options)
    case 'marketplace': return runMarketplace(context, t, options)
    case 'manage': return runManage(context, t, options)
    case 'update': return runUpdate(context, t, options)
    case 'configure': return runConfigure(context, t, options)
    case 'credentials': return runCredentials(context, t, options)
    case 'exit': return 0
  }
}
