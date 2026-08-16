/**
 * Recommended-plugin catalog for the dsh-zcf wizard: twenty runtime-verified
 * entries from the community radar (awesome-dsh-plugins), spread across
 * directions, all installable as plain npm packages — `dsh plugin add -w`
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
}

/** The catalog's directions, in display order. */
export type RecommendedCategory = 'coding' | 'agent' | 'web-ui' | 'memory' | 'messaging' | 'files' | 'infra' | 'web'

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
}

export const RECOMMENDED_PLUGINS: readonly RecommendedPlugin[] = [
  {
    id: 'dsh-lens',
    category: 'coding',
    label: { 'zh-CN': 'dsh-lens 实时代码反馈', 'en': 'dsh-lens live code feedback' },
    hint: { 'zh-CN': '文件写入即时反馈：LSP、linter、formatter、ast-grep、符号搜索', 'en': 'Live feedback on file writes: LSP, linter, formatter, ast-grep, symbol search' },
  },
  {
    id: 'dsh-ci-doctor',
    category: 'coding',
    label: { 'zh-CN': 'dsh-ci-doctor CI 医生', 'en': 'dsh-ci-doctor CI doctor' },
    hint: { 'zh-CN': '后台盯 CI 失败并按日志签名诊断，去重台账', 'en': 'Background CI failure watcher with log-signature diagnosis and dedupe ledger' },
  },
  {
    id: 'dsh-file-review',
    category: 'coding',
    label: { 'zh-CN': 'dsh-file-review 变更审查', 'en': 'dsh-file-review diff view' },
    hint: { 'zh-CN': '以 diff 视图审查 agent 的文件修改', 'en': 'Review agent file modifications in a diff view' },
  },
  {
    id: 'dsh-subagent-tools',
    category: 'agent',
    label: { 'zh-CN': 'dsh-subagent-tools 子代理增强', 'en': 'dsh-subagent-tools subagent controls' },
    hint: { 'zh-CN': '按调用覆写子代理的模型/提供商/人设与工具过滤', 'en': 'Per-call overrides for subagent model/provider/persona and tool filter' },
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
    id: 'dsh-office',
    category: 'web-ui',
    label: { 'zh-CN': 'dsh-office 工作台仪表盘', 'en': 'dsh-office workspace dashboard' },
    hint: { 'zh-CN': '悬浮工作台/会话仪表盘，含 token 与子代理视图', 'en': 'Floating workspace/session dashboard with token and subagent views' },
  },
  {
    id: 'dsh-spend',
    category: 'web-ui',
    label: { 'zh-CN': 'dsh-spend 花费浮窗', 'en': 'dsh-spend cost window' },
    hint: { 'zh-CN': 'token 用量与估算成本悬浮窗，多模型费率库', 'en': 'Token usage and estimated cost floating window with multi-model rates' },
  },
  {
    id: 'dsh-turn-index',
    category: 'web-ui',
    label: { 'zh-CN': 'dsh-turn-index 轮次索引', 'en': 'dsh-turn-index turn index' },
    hint: { 'zh-CN': '逐轮问题索引侧栏，点击跳转', 'en': 'Turn-by-turn question index sidebar with click-to-jump' },
  },
  {
    id: 'dsh-outline',
    category: 'web-ui',
    label: { 'zh-CN': 'dsh-outline 大纲树', 'en': 'dsh-outline outline tree' },
    hint: { 'zh-CN': '从用户问题与 Markdown 标题实时生成大纲', 'en': 'Live outline tree from user questions and Markdown headings' },
  },
  {
    id: 'dsh-genui',
    category: 'web-ui',
    label: { 'zh-CN': 'dsh-genui 内联组件', 'en': 'dsh-genui inline components' },
    hint: { 'zh-CN': '内联 GenUI：图表、表单、测验、3D 场景与动作回路', 'en': 'Inline GenUI: charts, forms, quizzes, 3D scenes with an action loop' },
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
    id: 'dsh-lark-bot',
    category: 'messaging',
    label: { 'zh-CN': 'dsh-lark-bot 飞书桥', 'en': 'dsh-lark-bot Feishu bridge' },
    hint: { 'zh-CN': '飞书/Lark 桥：流式卡片、worktree 隔离、并行 scope', 'en': 'Feishu/Lark bridge with streaming cards, worktree isolation, parallel scopes' },
  },
  {
    id: 'dsh-dingtalk',
    category: 'messaging',
    label: { 'zh-CN': 'dsh-dingtalk 钉钉通知', 'en': 'dsh-dingtalk notifications' },
    hint: { 'zh-CN': '钉钉群机器人签名 webhook 通知，零运行时依赖', 'en': 'DingTalk group-robot notifications via signed webhook, zero runtime deps' },
  },
  {
    id: 'dsh-artifact',
    category: 'files',
    label: { 'zh-CN': 'dsh-artifact 制品管理', 'en': 'dsh-artifact artifact management' },
    hint: { 'zh-CN': '会话产物的组织与浏览', 'en': 'Organize and browse session artifacts' },
  },
  {
    id: 'dsh-security-scan',
    category: 'files',
    label: { 'zh-CN': 'dsh-security-scan 密钥防护', 'en': 'dsh-security-scan secret scanner' },
    hint: { 'zh-CN': '扫描密钥与危险模式并脱敏（key/token 打码）', 'en': 'Scans secrets and dangerous patterns, redacts keys/tokens' },
  },
  {
    id: 'dsh-plugin-guard',
    category: 'infra',
    label: { 'zh-CN': 'dsh-plugin-guard 插件快照', 'en': 'dsh-plugin-guard snapshot net' },
    hint: { 'zh-CN': '插件装卸前后快照/回滚安全网，损坏自动恢复', 'en': 'Snapshot/rollback safety net for plugin install/uninstall with auto-recovery' },
  },
  {
    id: 'dsh-plugin-audit',
    category: 'infra',
    label: { 'zh-CN': 'dsh-plugin-audit 权限哨兵', 'en': 'dsh-plugin-audit permission sentinel' },
    hint: { 'zh-CN': '插件静态权限画像 + 凭据访问/出网运行时哨兵', 'en': 'Static permission profiler plus runtime sentinel on credential access and egress' },
  },
  {
    id: 'dsh-web-access',
    category: 'web',
    label: { 'zh-CN': 'dsh-web-access 联网访问', 'en': 'dsh-web-access web access' },
    hint: { 'zh-CN': '多提供商联网搜索/抓取/源校验，带 Web 面板', 'en': 'Multi-provider web search/fetch/source check with a web panel' },
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
