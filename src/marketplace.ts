/**
 * Recommended-plugin catalog for the dsh-zcf wizard: thirty-two entries from
 * the community radar (awesome-dsh-plugins), each passing both gates — the
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
    id: 'dsh-doublecheck',
    category: 'coding',
    label: { 'zh-CN': 'dsh-doublecheck 交付三查', 'en': 'dsh-doublecheck delivery checks' },
    hint: { 'zh-CN': '交付前需求审讯、红绿测试证据门与对抗评审', 'en': 'Pre-delivery requirement grilling, red-green test evidence gate, adversarial review' },
  },
  {
    id: 'superpowers-dsh',
    category: 'coding',
    label: { 'zh-CN': 'superpowers-dsh 开发技能集', 'en': 'superpowers-dsh dev skills' },
    hint: { 'zh-CN': 'TDD、调试、计划等开发工作流技能集', 'en': 'Development workflow skills: TDD, debugging, planning' },
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
    id: 'dsh-vision-proxy',
    category: 'agent',
    label: { 'zh-CN': 'dsh-vision-proxy 自动识图', 'en': 'dsh-vision-proxy auto vision' },
    hint: { 'zh-CN': '无视觉主模型经视觉模型转译图片，无 key 自动探测本地 Ollama', 'en': 'Transcribes images via a VLM for visionless models; auto-detects local Ollama without a key' },
  },
  {
    id: 'dsh-vision-router',
    category: 'agent',
    label: { 'zh-CN': 'dsh-vision-router 视觉路由', 'en': 'dsh-vision-router vision router' },
    hint: { 'zh-CN': '内置免费视觉模型路由，给文本 agent 加上视觉', 'en': 'Built-in free vision-model routing that gives text agents eyes' },
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
    id: 'dsh-ui-quote-selection',
    category: 'web-ui',
    label: { 'zh-CN': 'dsh-ui-quote-selection 划词引用', 'en': 'dsh-ui-quote-selection quote selection' },
    hint: { 'zh-CN': '选中文字一键引用到输入框，发送自动附完整原文', 'en': 'One-click quote of selected text into the composer, full source attached on send' },
  },
  {
    id: 'dsh-session-pins',
    category: 'web-ui',
    label: { 'zh-CN': 'dsh-session-pins 会话置顶', 'en': 'dsh-session-pins session pins' },
    hint: { 'zh-CN': '侧边栏持久置顶常用会话，快速打开', 'en': 'Pin frequently-used sessions in the sidebar for quick access' },
  },
  {
    id: 'dsh-message-edit',
    category: 'web-ui',
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
    id: 'dsh-plugin-audit',
    category: 'infra',
    label: { 'zh-CN': 'dsh-plugin-audit 权限哨兵', 'en': 'dsh-plugin-audit permission sentinel' },
    hint: { 'zh-CN': '插件静态权限画像 + 凭据访问/出网运行时哨兵', 'en': 'Static permission profiler plus runtime sentinel on credential access and egress' },
  },
  {
    id: 'dsh-vps-hub',
    category: 'infra',
    label: { 'zh-CN': 'dsh-vps-hub SSH 台账', 'en': 'dsh-vps-hub SSH ledger' },
    hint: { 'zh-CN': '本地 VPS 台账与 8 个 vps_* 工具：发现/测试/执行/传输，密钥仅路径引用', 'en': 'Local VPS ledger with 8 vps_* tools: discover/test/exec/transfer; keys referenced by path only' },
  },
  {
    id: 'dsh-lan-access',
    category: 'infra',
    label: { 'zh-CN': 'dsh-lan-access 局域网访问', 'en': 'dsh-lan-access LAN access' },
    hint: { 'zh-CN': 'Web GUI 绑 0.0.0.0 供局域网访问，修复非安全上下文 RPC', 'en': 'Binds the web GUI to 0.0.0.0 for LAN access and fixes RPC on insecure contexts' },
  },
  {
    id: 'dsh-full-remote',
    category: 'infra',
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
    id: 'dsh-claude-move',
    category: 'migration',
    label: { 'zh-CN': 'dsh-claude-move Claude 迁移', 'en': 'dsh-claude-move Claude migration' },
    hint: { 'zh-CN': '从 Claude Code 全保真迁移历史会话/记忆/技能/CLAUDE.md，可增量同步', 'en': 'Full-fidelity migration of Claude Code sessions/memories/skills/CLAUDE.md with incremental sync' },
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
