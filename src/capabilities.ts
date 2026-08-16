/**
 * Integration-option catalog for the dsh-zcf wizard. Each capability declares
 * exactly what makes it work inside a dsh profile: the packages to install
 * into the profile (`dsh plugin add`), the patch rows to append (or disable),
 * and any credential references the provider reads from the launch
 * environment (`$DSH_HOME/.env`). The catalog is data — the wizard's engine
 * only iterates it.
 * @module dsh-zcf
 */

import type { Lang } from './i18n.ts'

/** One loader patch row the wizard appends to the profile's patch layer. */
export interface PatchRow {
  /** Row id; stable, so re-runs merge instead of duplicating. */
  id: string
  /** Plugin package name (omit for pure disables). */
  name?: string
  /** Row config value (omit when the plugin needs none). */
  config?: Record<string, unknown>
  /** `disabled: true` rows deactivate a bundle row the capability replaces. */
  disabled?: boolean
}

/** One integration option. */
export interface Capability {
  /** Stable id, used by `--with` and the multiselect values. */
  id: string
  /** Display label per language. */
  label: Record<Lang, string>
  /** One-line explanation per language (multiselect hint). */
  hint: Record<Lang, string>
  /** Packages to install into the profile via `dsh plugin add`. */
  packages?: readonly string[]
  /** Rows appended to the profile patch layer. */
  rows?: readonly PatchRow[]
  /** Existing bundle row ids this capability replaces (disabled first). */
  disableRows?: readonly string[]
  /** Credential references the wizard prompts for and stores in `$DSH_HOME/.env`. */
  envKeys?: readonly string[]
}

/**
 * The runtime surfaces the wizard offers. The official web bundle's npm
 * `latest` tag currently points at a broken 0.0.1-rc.1 build (missing
 * private dependencies), so it pins a caret range on the working line; the
 * tui and app community bundles keep healthy `latest` tags and are left
 * unpinned to track newest releases. The app surface is the Tauri 2 desktop
 * shell (macOS/Windows; Linux users should pick tui or web).
 */
export const SURFACE_BUNDLES = {
  tui: '@deepseek-harness-tui/dsh-tui',
  web: '@deepseek-ai/dsh-web-app@^0.1.0-rc.6',
  app: 'dsh-desktop-app@^0.4.0',
} as const

/** The wizard's runtime surfaces. */
export type Surface = keyof typeof SURFACE_BUNDLES

export const CAPABILITIES: readonly Capability[] = [
  {
    id: 'exa',
    label: { 'zh-CN': 'Exa 联网搜索', 'en': 'Exa web search' },
    hint: { 'zh-CN': '接入 Exa 搜索提供商（需要 EXA_API_KEY）', 'en': 'Register the Exa search provider (needs EXA_API_KEY)' },
    packages: ['@deepseek-ai/dsh-web-search-exa'],
    rows: [{ id: 'web-search-exa', name: '@deepseek-ai/dsh-web-search-exa' }],
    envKeys: ['EXA_API_KEY'],
  },
  {
    id: 'perplexity',
    label: { 'zh-CN': 'Perplexity 联网搜索', 'en': 'Perplexity web search' },
    hint: { 'zh-CN': '接入 Perplexity 搜索提供商（需要 PERPLEXITY_API_KEY）', 'en': 'Register the Perplexity search provider (needs PERPLEXITY_API_KEY)' },
    packages: ['@deepseek-ai/dsh-web-search-perplexity'],
    rows: [{ id: 'web-search-perplexity', name: '@deepseek-ai/dsh-web-search-perplexity' }],
    envKeys: ['PERPLEXITY_API_KEY'],
  },
  {
    id: 'sqlite',
    label: { 'zh-CN': 'SQLite 会话持久化', 'en': 'SQLite session persistence' },
    hint: { 'zh-CN': '改用 SQLite 存储会话历史（替换默认 JSONL）', 'en': 'Store session history in SQLite (replaces the JSONL default)' },
    packages: ['@deepseek-ai/dsh-session-persistence-sqlite'],
    rows: [{ id: 'session-persistence-sqlite', name: '@deepseek-ai/dsh-session-persistence-sqlite' }],
    disableRows: ['session-persistence-jsonl'],
  },
  {
    id: 'terminal',
    label: { 'zh-CN': '持久终端工具', 'en': 'Persistent terminal tool' },
    hint: { 'zh-CN': '跨轮次的持久 PTY 终端', 'en': 'A persistent PTY terminal across turns' },
    packages: ['@deepseek-ai/dsh-tool-terminal'],
    rows: [{ id: 'tool-terminal', name: '@deepseek-ai/dsh-tool-terminal' }],
  },
  {
    id: 'lsp',
    label: { 'zh-CN': 'LSP 语义工具', 'en': 'LSP semantic tool' },
    hint: { 'zh-CN': '语言服务器符号导航（service + stdio 后端 + 工具）', 'en': 'Language-server symbol navigation (service + stdio backend + tool)' },
    packages: ['@deepseek-ai/dsh-lsp', '@deepseek-ai/dsh-lsp-stdio', '@deepseek-ai/dsh-tool-lsp'],
    rows: [
      { id: 'lsp', name: '@deepseek-ai/dsh-lsp' },
      { id: 'lsp-stdio', name: '@deepseek-ai/dsh-lsp-stdio' },
      { id: 'tool-lsp', name: '@deepseek-ai/dsh-tool-lsp' },
    ],
  },
  {
    id: 'codex',
    label: { 'zh-CN': 'Codex 子代理桥', 'en': 'Codex subagent bridge' },
    hint: { 'zh-CN': '委派子任务给本机的 Codex CLI（需已安装 codex）', 'en': 'Delegate subtasks to a local Codex CLI (requires codex installed)' },
    packages: ['@deepseek-ai/dsh-subagent-codex'],
    rows: [{ id: 'subagent-codex', name: '@deepseek-ai/dsh-subagent-codex' }],
  },
  {
    id: 'claude',
    label: { 'zh-CN': 'Claude Code 子代理桥', 'en': 'Claude Code subagent bridge' },
    hint: { 'zh-CN': '委派子任务给本机的 Claude Code（需已安装 claude）', 'en': 'Delegate subtasks to a local Claude Code (requires claude installed)' },
    packages: ['@deepseek-ai/dsh-subagent-claude-code'],
    rows: [{ id: 'subagent-claude-code', name: '@deepseek-ai/dsh-subagent-claude-code' }],
  },
  {
    id: 'mcp',
    label: { 'zh-CN': 'MCP 服务器', 'en': 'MCP server' },
    hint: { 'zh-CN': '接入一个 MCP 服务器（输入启动命令，如 `npx -y @modelcontextprotocol/server-filesystem /tmp`）', 'en': 'Attach an MCP server (enter its launch command, e.g. `npx -y @modelcontextprotocol/server-filesystem /tmp`)' },
    rows: [{ id: 'mcp-1', name: '@deepseek-ai/dsh-mcp-client' }],
  },
]

/**
 * Look up one capability by id.
 * @param id - capability id.
 * @returns the capability, or undefined when unknown.
 */
export function capabilityOf(id: string): Capability | undefined {
  return CAPABILITIES.find(capability => capability.id === id)
}

/** Validate a `--with` list; unknown ids fail loud with the known set. */
export function parseWithList(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return []
  const ids = raw.split(',').map(id => id.trim()).filter(id => id !== '')
  const unknown = ids.filter(id => capabilityOf(id) === undefined)
  if (unknown.length > 0) {
    const known = CAPABILITIES.map(capability => capability.id).join(', ')
    throw new Error(`dsh-zcf: unknown integration option(s): ${unknown.join(', ')} (known: ${known})`)
  }
  return [...new Set(ids)]
}
