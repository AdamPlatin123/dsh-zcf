/**
 * Recommended-plugin catalog for the dsh-zcf wizard: twenty-two entries from
 * the community radar (dsh-claude-move is deliberately absent: it registers
 * the same import_claude tool as dsh-chat-import and the two cannot coexist) (awesome-dsh-plugins), each passing both gates — the
 * radar's runtime-verified verdict and an npm package that actually exists —
 * spread across directions, all installable as plain npm packages — `dsh plugin add -w`
 * registers the bundle and the loader expands it, so an entry needs no patch
 * rows. Entries whose upstream npm `latest` is healthy are left unpinned; the
 * catalog is data, the engine only iterates it.
 * @module dsh-zcf
 */

import type { Lang } from './i18n.ts'

/** One recommended plugin. */
export interface RecommendedPlugin {
  /** npm package name; also the install spec and the multiselect value. */
  id: string
  /** Display label per language. */
  label: Record<Lang, string>
  /** One-line explanation per language (multiselect hint). */
  hint: Record<Lang, string>
  /** Direction key; the multiselect groups entries by it. */
  category: RecommendedCategory
  /** Credential references the wizard prompts for and stores in `$DSH_HOME/.env`. */
  envKeys?: readonly string[]
  /** When set, the only runtime surface this plugin works on (it waits for a
   * service the other surfaces never provide, which stalls profile boot). */
  surface?: 'web'
}

/** The catalog's directions, in display order. */
export type RecommendedCategory = 'coding' | 'agent' | 'web-ui' | 'memory' | 'messaging' | 'files' | 'infra' | 'web' | 'migration'

/** Direction labels per language, keyed by {@link RecommendedCategory}. */
export const CATEGORY_LABELS: Readonly<Record<RecommendedCategory, Record<Lang, string>>> = {
  'coding': { 'zh-CN': '编码开发', 'en': 'Coding' },
  'agent': { 'zh-CN': 'Agent 能力', 'en': 'Agent capability' },
  'web-ui': { 'zh-CN': 'Web UI', 'en': 'Web UI' },
  'memory': { 'zh-CN': '记忆', 'en': 'Memory' },
  'messaging': { 'zh-CN': '消息通讯', 'en': 'Messaging' },
  'files': { 'zh-CN': '文件与安全', 'en': 'Files & safety' },
  'infra': { 'zh-CN': '基建守护', 'en': 'Infra guard' },
  'web': { 'zh-CN': '联网', 'en': 'Web access' },
  'migration': { 'zh-CN': '数据迁移', 'en': 'Migration' },
}

export const RECOMMENDED_PLUGINS: readonly RecommendedPlugin[] = [
  {
    id: 'dsh-lens',
    category: 'coding',
    label: { 'zh-CN': 'dsh-lens 实时代码反馈', 'en': 'dsh-lens live code feedback' },
    hint: { 'zh-CN': '文件写入即时反馈：LSP、linter、formatter、ast-grep、符号搜索', 'en': 'Live feedback on file writes: LSP, linter, formatter, ast-grep, symbol search' },
  },
  {
    id: 'dsh-file-review',
    category: 'coding',
    label: { 'zh-CN': 'dsh-file-review 变更审查', 'en': 'dsh-file-review diff view' },
    hint: { 'zh-CN': '以 diff 视图审查 agent 的文件修改', 'en': 'Review agent file modifications in a diff view' },
  },
  {
    id: 'dsh-doublecheck',
    category: 'coding',
    label: { 'zh-CN': 'dsh-doublecheck 交付三查', 'en': 'dsh-doublecheck delivery checks' },
    hint: { 'zh-CN': '交付前需求审讯、红绿测试证据门与对抗评审', 'en': 'Pre-delivery requirement grilling, red-green test evidence gate, adversarial review' },
  },
  {
    id: 'dsh-at-file',
    category: 'coding',
    label: { 'zh-CN': 'dsh-at-file 文件引用', 'en': 'dsh-at-file file references' },
    hint: { 'zh-CN': 'Codex 风格 @file 引用：搜索并挂载工作区文件', 'en': 'Codex-style @file references: search and attach workspace files' },
  },
  {
    id: 'dsh-mcp-adapter',
    category: 'agent',
    label: { 'zh-CN': 'dsh-mcp-adapter MCP 代理', 'en': 'dsh-mcp-adapter MCP proxy' },
    hint: { 'zh-CN': '按需搜索/描述/调用 MCP，schema 不进上下文', 'en': 'On-demand MCP search/describe/call proxy that keeps schemas out of context' },
  },
  {
    id: 'billion-context-dsh',
    category: 'agent',
    label: { 'zh-CN': 'billion-context 上下文压缩', 'en': 'billion-context compression' },
    hint: { 'zh-CN': '模型驱动的上下文压缩与检索（compress/decompress/search 工具）', 'en': 'Model-driven context compression with compress/decompress/search tools' },
  },
  {
    id: 'dsh-sentinel',
    category: 'agent',
    label: { 'zh-CN': 'dsh-sentinel 事件唤醒', 'en': 'dsh-sentinel event wakeup' },
    hint: { 'zh-CN': '文件/命令/HTTP/进程/webhook 传感器事件驱动唤醒 agent loop', 'en': 'Event-driven agent-loop wakeup via file/command/HTTP/process/webhook sensors' },
  },
  {
    id: 'dsh-vision-router',
    category: 'agent',
    label: { 'zh-CN': 'dsh-vision-router 视觉路由', 'en': 'dsh-vision-router vision router' },
    hint: { 'zh-CN': '内置免费视觉模型路由，给文本 agent 加上视觉', 'en': 'Built-in free vision-model routing that gives text agents eyes' },
  },
  {
    id: 'dsh-spend',
    category: 'web-ui',
    label: { 'zh-CN': 'dsh-spend 花费浮窗', 'en': 'dsh-spend cost window' },
    hint: { 'zh-CN': 'token 用量与估算成本悬浮窗，多模型费率库', 'en': 'Token usage and estimated cost floating window with multi-model rates' },
  },
  {
    id: 'dsh-outline',
    category: 'web-ui',
    label: { 'zh-CN': 'dsh-outline 大纲树', 'en': 'dsh-outline outline tree' },
    hint: { 'zh-CN': '从用户问题与 Markdown 标题实时生成大纲', 'en': 'Live outline tree from user questions and Markdown headings' },
  },
  {
    id: 'dsh-message-edit',
    category: 'web-ui',
    surface: 'web',
    label: { 'zh-CN': 'dsh-message-edit 消息编辑', 'en': 'dsh-message-edit message edit' },
    hint: { 'zh-CN': '分支式消息编辑、reroll、重试与多版本', 'en': 'Branching message edit, reroll, retry, and multi-version' },
  },
  {
    id: 'dsh-visualize',
    category: 'web-ui',
    label: { 'zh-CN': 'dsh-visualize 可视化卡片', 'en': 'dsh-visualize visual cards' },
    hint: { 'zh-CN': '对话中生成交互式可视化卡片', 'en': 'Interactive visualization cards generated in conversation' },
  },
  {
    id: 'dsh-mnemon',
    category: 'memory',
    label: { 'zh-CN': 'dsh-mnemon 三层记忆', 'en': 'dsh-mnemon three-tier memory' },
    hint: { 'zh-CN': '本地三层记忆（运行时/项目/长期）配 8 页 Web UI', 'en': 'Three-tier local memory (runtime/project/long-term) with an 8-page web UI' },
  },
  {
    id: 'dsh-memento',
    category: 'memory',
    label: { 'zh-CN': 'dsh-memento 跨会话记忆', 'en': 'dsh-memento cross-session memory' },
    hint: { 'zh-CN': '有界、审批门控的跨会话记忆，零依赖 SQLite', 'en': 'Bounded, approval-gated cross-session memory on zero-dependency SQLite' },
  },
  {
    id: 'dsh-dingtalk',
    category: 'messaging',
    label: { 'zh-CN': 'dsh-dingtalk 钉钉通知', 'en': 'dsh-dingtalk notifications' },
    hint: { 'zh-CN': '钉钉群机器人签名 webhook 通知，零运行时依赖', 'en': 'DingTalk group-robot notifications via signed webhook, zero runtime deps' },
  },
  {
    id: 'dsh-plugin-audit',
    category: 'infra',
    label: { 'zh-CN': 'dsh-plugin-audit 权限哨兵', 'en': 'dsh-plugin-audit permission sentinel' },
    hint: { 'zh-CN': '插件静态权限画像 + 凭据访问/出网运行时哨兵', 'en': 'Static permission profiler plus runtime sentinel on credential access and egress' },
  },
  {
    id: 'dsh-full-remote',
    category: 'infra',
    surface: 'web',
    label: { 'zh-CN': 'dsh-full-remote 远程访问', 'en': 'dsh-full-remote remote access' },
    hint: { 'zh-CN': '令牌反向代理远程恢复设置/凭据/目录，扫码邀请、按设备会话', 'en': 'Token reverse proxy restoring settings/credentials/directory remotely; QR invite, per-device sessions' },
  },
  {
    id: 'dsh-plugin-check',
    category: 'infra',
    label: { 'zh-CN': 'dsh-plugin-check 插件体检', 'en': 'dsh-plugin-check plugin health' },
    hint: { 'zh-CN': '插件健康检查：清单协议、patch 格式、构建陷阱', 'en': 'Plugin health checks: manifest protocol, patch format, build pitfalls' },
  },
  {
    id: 'dsh-web-plugin-manager',
    category: 'infra',
    label: { 'zh-CN': 'dsh-web-plugin-manager 插件管理面板', 'en': 'dsh-web-plugin-manager plugin panel' },
    hint: { 'zh-CN': 'Web UI 一键管理插件：启停、装卸、环境管理', 'en': 'One-click plugin management in the web UI: toggle, install/remove, environments' },
  },
  {
    id: 'dsh-web-access',
    category: 'web',
    label: { 'zh-CN': 'dsh-web-access 联网访问', 'en': 'dsh-web-access web access' },
    hint: { 'zh-CN': '多提供商联网搜索/抓取/源校验，带 Web 面板', 'en': 'Multi-provider web search/fetch/source check with a web panel' },
  },
  {
    id: 'modsearch',
    category: 'web',
    label: { 'zh-CN': 'modsearch 搜索桥', 'en': 'modsearch search bridge' },
    hint: { 'zh-CN': '纯文本 agent 的网页搜索桥：web/X 结构化 JSON 证据', 'en': 'Web-search bridge for text-only agents: structured JSON evidence from web/X' },
  },
  {
    id: 'dsh-chat-import',
    category: 'migration',
    label: { 'zh-CN': 'dsh-chat-import 多源导入', 'en': 'dsh-chat-import multi-source import' },
    hint: { 'zh-CN': '13 源（Claude Code/Codex/ChatGPT/Cursor 等）导入为可续聊会话，支持写回', 'en': 'Import 13 sources (Claude Code/Codex/ChatGPT/Cursor/...) as resumable sessions, with write-back' },
  },
]

/**
 * Look up one recommended plugin by package name.
 * @param id - npm package name.
 * @returns the plugin, or undefined when unknown.
 */
export function recommendedPluginOf(id: string): RecommendedPlugin | undefined {
  return RECOMMENDED_PLUGINS.find(plugin => plugin.id === id)
}

/** The bundle whose presence marks a profile as the terminal (TUI) surface. */
const TUI_BUNDLE = '@deepseek-harness-tui/dsh-tui'

/**
 * Whether a profile runs the terminal surface — web-only entries stay listed
 * there with an explanatory note and are skipped at install time, because
 * they wait for the web UI's host service at boot and would stall it.
 * @param bundles - the profile's registered bundles.
 */
export function isTuiProfile(bundles: readonly string[] | undefined): boolean {
  return bundles?.includes(TUI_BUNDLE) ?? false
}

/** Validate a `--plugin` list; unknown ids fail loud with the known set. */
export function parsePluginList(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return []
  const ids = raw.split(',').map(id => id.trim()).filter(id => id !== '')
  const unknown = ids.filter(id => recommendedPluginOf(id) === undefined)
  if (unknown.length > 0) {
    const known = RECOMMENDED_PLUGINS.map(plugin => plugin.id).join(', ')
    throw new Error(`dsh-zcf: unknown recommended plugin(s): ${unknown.join(', ')} (known: ${known})`)
  }
  return [...new Set(ids)]
}
