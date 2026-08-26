/**
 * Commander adapter for the `dsh-zcf` command-line entry. Help, version, and
 * usage errors print and exit inside {@link parseDzcfArgs}; only a valid
 * invocation reaches the wizard. The optional positional selects a flow:
 * `i` (full init), `c` (integrations only), `k` (credentials only), or the
 * interactive menu when absent.
 * @module dsh-zcf
 */

import { Command, CommanderError } from 'commander'
import { parseWithList } from './capabilities.ts'
import { parsePluginList } from './marketplace.ts'
import type { Lang } from './i18n.ts'

/** The flow the invocation selects. */
export type DzcfAction = 'menu' | 'init' | 'marketplace' | 'manage' | 'update' | 'configure' | 'credentials' | 'tui'

/** The resolved dsh-zcf invocation. */
export interface DzcfOptions {
  /** Selected flow; `menu` means the interactive menu decides. */
  action: DzcfAction
  /** Non-interactive API key (`--key sk-…`). */
  key?: string
  /** Model id pinned into the profile catalog (`--model <id>`). */
  model?: string

  /** Non-interactive endpoint override (`--base-url https://…`). */
  baseUrl?: string
  /** Non-interactive runtime surface (`--mode tui|web|app`). */
  mode?: 'tui' | 'web' | 'app'
  /** Custom profile name (`--profile <name>`). */
  profile?: string
  /** Integration option ids (`--with exa,pty,lsp`). */
  with: string[]
  /** Recommended-plugin package names (`--plugin dsh-lens,dsh-spend`). */
  plugins: string[]
  /** MCP server launch command (`--mcp-command '…'`). */
  mcpCommand?: string
  /** npm registry for the dsh install (`--registry https://…`). */
  registry?: string
  /** Active interface language. */
  lang: Lang
  /** Assume yes for confirmations (`--yes`). */
  yes: boolean
  /** Report planned actions and write nothing (`--dry-run`). */
  dryRun: boolean
}

/**
 * Whether a value parses as an http(s) URL; shared by `--base-url` and
 * `--registry` validation.
 * @param value - candidate URL string.
 * @returns true when the value is an http or https URL.
 */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const LANGS: readonly Lang[] = ['zh-CN', 'en']
const MODES: readonly string[] = ['tui', 'web', 'app']
const ACTIONS: readonly string[] = ['i', 'n', 'l', 'u', 'c', 'k', 'tui', 'init', 'marketplace', 'manage', 'update', 'configure', 'credentials']

const ACTION_TO_FLOW: Readonly<Record<string, Exclude<DzcfAction, 'menu'>>> = {
  'i': 'init',
  'init': 'init',
  'n': 'marketplace',
  'marketplace': 'marketplace',
  'l': 'manage',
  'manage': 'manage',
  'u': 'update',
  'update': 'update',
  'c': 'configure',
  'configure': 'configure',
  'k': 'credentials',
  'tui': 'tui',
  'credentials': 'credentials',
}

/**
 * Resolve argv into one invocation, or print and exit for help, version, or
 * an invalid command. Unknown options and extra positionals are usage errors;
 * an unknown `--with` id fails loud here, before any side effect.
 * @param argv - process arguments without the node executable.
 * @param version - version string for `-V`/`--version`.
 * @returns the resolved options, or never for help/version/errors.
 */
export function parseDzcfArgs(argv: readonly string[], version: string): DzcfOptions {
  let action: DzcfAction = 'menu'
  let mode: 'tui' | 'web' | 'app' | undefined
  let lang: Lang = 'zh-CN'
  let yes = false
  let dryRun = false

  const program = new Command()
    .name('dsh-zcf')
    .description('zero-config DeepSeek Harness setup')
    .version(version, '-V, --version')
    .argument('[action]', 'flow: i (init), n (marketplace), l (manage), u (update plugins), c (configure integrations), k (credentials), tui (launch the default profile)')
    .allowExcessArguments(false)
    .option('-k, --key <key>', 'DeepSeek API key (non-interactive)')
    .option('--base-url <url>', 'API base URL override (non-interactive)')
    .option('--model <id>', 'pin this model id into the profile catalog')
    .option('-m, --mode <mode>', 'runtime surface: tui, web, or app (non-interactive)')
    .option('-p, --profile <name>', 'custom profile name')
    .option('--with <list>', 'integration options: comma-separated ids (exa,perplexity,sqlite,terminal,lsp,codex,claude,mcp)')
    .option('--plugin <list>', 'recommended plugins: comma-separated npm names (dsh-lens,dsh-spend)')
    .option('--mcp-command <command>', 'MCP server launch command')
    .option('--registry <url>', 'npm registry for the dsh install (http(s) URL; interactive runs also probe and offer one)')
    .option('-l, --lang <lang>', 'interface language: zh-CN or en', 'zh-CN')
    .option('-y, --yes', 'assume yes for install and overwrite confirmations')
    .option('--dry-run', 'report planned actions and write nothing')
    .exitOverride()
    .action((arg: string | undefined) => {
      if (arg !== undefined) {
        if (!ACTIONS.includes(arg)) {
          throw new CommanderError(1, 'dsh-zcf.action', `unknown action: ${arg}`)
        }
        action = ACTION_TO_FLOW[arg] as Exclude<DzcfAction, 'menu'>
      }
    })

  program.parse(argv, { from: 'user' })

  const options = program.opts<{
    key?: string
    baseUrl?: string
    model?: string
    mode?: string
    profile?: string
    with?: string
    plugin?: string
    mcpCommand?: string
    registry?: string
    lang: string
    yes?: boolean
    dryRun?: boolean
  }>()
  yes = options.yes ?? false
  dryRun = options.dryRun ?? false

  if (options.mode !== undefined) {
    if (!MODES.includes(options.mode)) {
      throw new CommanderError(1, 'dsh-zcf.mode', `--mode must be one of: ${MODES.join(', ')}`)
    }
    mode = options.mode as 'tui' | 'web' | 'app'
  }
  if (!LANGS.includes(options.lang as Lang)) {
    throw new CommanderError(1, 'dsh-zcf.lang', `--lang must be one of: ${LANGS.join(', ')}`)
  }
  lang = options.lang as Lang
  if (options.registry !== undefined && !isHttpUrl(options.registry)) {
    throw new CommanderError(1, 'dsh-zcf.registry', '--registry must be an http:// or https:// URL')
  }

  let withList: string[]
  try {
    withList = parseWithList(options.with)
  } catch (error) {
    throw new CommanderError(1, 'dsh-zcf.with', (error as Error).message)
  }
  let pluginList: string[]
  try {
    pluginList = parsePluginList(options.plugin)
  } catch (error) {
    throw new CommanderError(1, 'dsh-zcf.plugin', (error as Error).message)
  }

  return {
    action,
    ...(options.key === undefined ? {} : { key: options.key }),
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(mode === undefined ? {} : { mode }),
    ...(options.profile === undefined ? {} : { profile: options.profile }),
    with: withList,
    plugins: pluginList,
    ...(options.mcpCommand === undefined ? {} : { mcpCommand: options.mcpCommand }),
    ...(options.registry === undefined ? {} : { registry: options.registry }),
    lang,
    yes,
    dryRun,
  }
}
