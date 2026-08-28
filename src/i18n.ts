/**
 * Bilingual user-facing strings for the dsh-zcf wizard. One table, two
 * languages; `--lang` picks the active column and `translate()` interpolates
 * `{name}` parameters. No i18n framework: the surface is small and the table
 * is the whole contract.
 * @module dsh-zcf
 */

/** Active interface language. */
export type Lang = 'zh-CN' | 'en'

/** Message key → per-language text. */
export type MessageTable = Readonly<Record<string, Readonly<Record<Lang, string>>>>

/**
 * Render one message in `lang`, substituting `{key}` placeholders from
 * `params`. Unknown keys are the literal placeholder, so a message can never
 * claim a value it was not given.
 * @param table - message table.
 * @param lang - active language.
 * @param key - message key.
 * @param params - placeholder values.
 * @returns the rendered text.
 */
export function translate(table: MessageTable, lang: Lang, key: string, params: Readonly<Record<string, string>> = {}): string {
  const text = table[key]?.[lang] ?? table[key]?.en ?? key
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : value
  })
}

export const MESSAGES: MessageTable = {
  banner: {
    'zh-CN': 'dsh-zcf — DeepSeek Harness 零配置引导（数据目录：{home}）',
    'en': 'dsh-zcf — zero-config DeepSeek Harness setup (data home: {home})',
  },
  dshFound: {
    'zh-CN': '✓ 已找到 dsh 命令',
    'en': '✓ dsh command found',
  },
  dshMissing: {
    'zh-CN': '未找到 dsh 命令，需要先安装 @deepseek-ai/dsh。',
    'en': 'dsh command not found; @deepseek-ai/dsh must be installed first.',
  },
  dshMissingNoTty: {
    'zh-CN': '未找到 dsh 命令。请先安装（如 `npm install -g @deepseek-ai/dsh`），或加 `--yes` 让 dsh-zcf 代为安装。',
    'en': 'dsh command not found. Install it first (e.g. `npm install -g @deepseek-ai/dsh`), or pass `--yes` to let dsh-zcf install it.',
  },
  installConfirm: {
    'zh-CN': '现在用 {pm} 全局安装 @deepseek-ai/dsh 吗？',
    'en': 'Install @deepseek-ai/dsh globally with {pm} now?',
  },
  pnpmPrivateNotice: {
    'zh-CN': '未找到 pnpm：dsh 的插件管理需要它。将安装一份 zcf 私有的 pnpm（不影响系统环境）……',
    'en': 'pnpm not found: the launcher needs it for plugin management. Installing a zcf-private pnpm (your system stays untouched)…',
  },
  pnpmPrivateWrongMajorNotice: {
    'zh-CN': '检测到系统 pnpm {major}：dsh 的插件管理按 pnpm 10 的行为设计（pnpm 11 会把被拒构建脚本当作安装失败）。将安装一份 zcf 私有的 pnpm 10，系统 pnpm 保持不变……',
    'en': 'System pnpm {major} detected: the launcher expects pnpm 10 semantics (pnpm 11 treats refused build scripts as a hard failure). Installing a zcf-private pnpm 10; your system pnpm stays as-is…',
  },
  pnpmPrivateReady: {
    'zh-CN': '✓ zcf 私有 pnpm 10 已就绪（仅向导内部使用）',
    'en': '✓ zcf-private pnpm 10 ready (wizard-internal only)',
  },
  pnpmInstalling: {
    'zh-CN': '正在安装 pnpm：{command}',
    'en': 'Installing pnpm: {command}',
  },
  pnpmInstallFailed: {
    'zh-CN': 'pnpm 安装失败：{stderr}',
    'en': 'pnpm install failed: {stderr}',
  },
  installSizeNotice: {
    'zh-CN': '@deepseek-ai/dsh 是完整发行版：60+ 个子包、数百个依赖。官方源安装约需 5–15 分钟，镜像源约 1–2 分钟；安装过程会实时输出进度。',
    'en': '@deepseek-ai/dsh is a full distribution: 60+ sub-packages and hundreds of dependencies. Expect roughly 5–15 minutes from the official registry, 1–2 minutes from a mirror; install progress streams live.',
  },
  registryPrompt: {
    'zh-CN': '选择 npm 安装源（括号为实测往返延迟）：',
    'en': 'Pick an npm registry (measured round-trip latency in parentheses):',
  },
  registryOfficial: {
    'zh-CN': '官方源 registry.npmjs.org（{ms}）',
    'en': 'Official registry.npmjs.org ({ms})',
  },
  registryAliyun: {
    'zh-CN': '阿里云镜像 registry.npmmirror.com（{ms}）',
    'en': 'Aliyun mirror registry.npmmirror.com ({ms})',
  },
  registryHuawei: {
    'zh-CN': '华为云镜像 repo.huaweicloud.com（{ms}，全量同步）',
    'en': 'Huawei mirror repo.huaweicloud.com ({ms}, full sync)',
  },
  registryUnreachable: {
    'zh-CN': '不可达',
    'en': 'unreachable',
  },
  registryGiven: {
    'zh-CN': '使用指定安装源：{registry}',
    'en': 'Using the configured registry: {registry}',
  },
  registryProbeNone: {
    'zh-CN': '（所有安装源都未在 3 秒内应答，使用官方源安装）',
    'en': '(No registry answered within 3 s; installing from the official one)',
  },
  installElapsed: {
    'zh-CN': '安装耗时 {seconds} 秒',
    'en': 'Install finished in {seconds}s',
  },
  noPackageManager: {
    'zh-CN': '没有可用的包管理器（需要 npm 或 pnpm）来安装 dsh。',
    'en': 'No package manager available (npm or pnpm required) to install dsh.',
  },
  installing: {
    'zh-CN': '正在安装：{command}',
    'en': 'Installing: {command}',
  },
  installFailed: {
    'zh-CN': '安装 dsh 失败：{stderr}',
    'en': 'Installing dsh failed: {stderr}',
  },
  installNoDsh: {
    'zh-CN': '安装命令结束但 dsh 仍然不可用，请检查 PATH。',
    'en': 'The install command finished but dsh is still unavailable; check your PATH.',
  },
  dshInstalled: {
    'zh-CN': '✓ dsh 安装完成',
    'en': '✓ dsh installed',
  },
  keyChoicePrompt: {
    'zh-CN': '选择要使用的凭据（已保存在本机）：',
    'en': 'Pick a stored credential to use (saved on this machine):',
  },
  credentialReenter: {
    'zh-CN': '重新输入一个新的 API Key',
    'en': 'Enter a new API key instead',
  },
  modelPrompt: {
    'zh-CN': '选择要固定到 profile 目录的上游模型：',
    'en': 'Pick the upstream model to pin into the profile catalog:',
  },
  modelSkip: {
    'zh-CN': '跳过（保留发行版默认模型目录）',
    'en': 'Skip (keep the shipped model catalog)',
  },
  modelFetchFailed: {
    'zh-CN': '未能从上游获取模型列表（网络或鉴权失败），可手动输入模型 id：',
    'en': 'Could not list models from the upstream (network or auth failure); enter a model id manually:',
  },
  modelManualPrompt: {
    'zh-CN': '模型 id（留空跳过）',
    'en': 'Model id (empty to skip)',
  },
  modelSkipped: {
    'zh-CN': '未选择模型，目录保持不变。',
    'en': 'No model picked; the catalog is unchanged.',
  },
  modelCatalogWritten: {
    'zh-CN': '✓ 模型 {model} 已写入 {profile} 的模型目录',
    'en': '✓ Model {model} written into the {profile} catalog',
  },
  modelCatalogFailed: {
    'zh-CN': '模型目录写入失败：{reason}',
    'en': 'Writing the model catalog failed: {reason}',
  },
  pluginsBatchInstalling: {
    'zh-CN': '一次性批量安装 {count} 个插件（pnpm 并行下载，进度行实时显示）……',
    'en': 'Batch-installing {count} plugins in one pnpm pass (parallel downloads, live progress lines)…',
  },
  pluginsBatchElapsed: {
    'zh-CN': '批量安装耗时 {seconds} 秒',
    'en': 'Batch install finished in {seconds}s',
  },
  pluginsBatchFellBack: {
    'zh-CN': '批量安装未全部成功，转为逐个安装以定位问题……',
    'en': 'The batch install did not fully succeed; falling back to per-plugin installs to locate the failure…',
  },
  buildsAllowlisted: {
    'zh-CN': '检测到被拒构建脚本：{deps}。已加入 {plugin} 所在 profile 的白名单并重试……',
    'en': 'Refused build scripts detected: {deps}. Added to the profile allowlist for {plugin} and retrying…',
  },
  profileRecoveryAsk: {
    'zh-CN': 'profile 组装失败（可能残留损坏的安装状态）。删除并重建 {profile} 吗？（凭据不受影响；手动改过的 patch 配置会重置）',
    'en': 'Profile composition failed (likely broken leftover install state). Remove and rebuild {profile}? (credentials unaffected; manual patch edits reset)',
  },
  profileRecovering: {
    'zh-CN': '正在清除并重建 {profile}……',
    'en': 'Clearing and rebuilding {profile}…',
  },
  profileRecovered: {
    'zh-CN': '✓ {profile} 已重建',
    'en': '✓ {profile} rebuilt',
  },
  profileBrokenHint: {
    'zh-CN': 'profile 可能残留了上一次失败安装的损坏状态。可删除 {path} 后重跑本向导重建，或换一个 profile 名（--profile <名字>）。',
    'en': 'The profile may hold a broken state from an earlier failed install. Remove {path} and rerun this wizard to rebuild it, or pick another profile name (--profile <name>).',
  },
  npmrcWritten: {
    'zh-CN': '✓ 已为 {profile} 设置插件安装源：{registry}（写入 profile 的 .npmrc）',
    'en': '✓ Plugin registry for {profile} set to {registry} (profile .npmrc)',
  },
  returnToMenu: {
    'zh-CN': '操作完成。回到主页选择其它操作吗？',
    'en': 'Done. Return to the main menu to pick another action?',
  },
  kMenuPrompt: {
    'zh-CN': '凭据管理 — 要更新哪一项？',
    'en': 'Credential management — what to update?',
  },
  kMenuKey: {
    'zh-CN': '更新 API Key',
    'en': 'Update the API key',
  },
  kMenuBaseUrl: {
    'zh-CN': '更新 Base URL（endpoint）',
    'en': 'Update the base URL (endpoint)',
  },
  kMenuModel: {
    'zh-CN': '从上游选择模型（curl 模型列表后选择）',
    'en': 'Pick a model from the upstream listing',
  },
  kMenuAll: {
    'zh-CN': '全部重配（Base URL → Key → 模型）',
    'en': 'Reconfigure everything (base URL, key, model)',
  },
  apiKeyPrompt: {
    'zh-CN': 'DeepSeek API Key（sk-…，输入不回显）：',
    'en': 'DeepSeek API key (sk-…, hidden input):',
  },
  baseUrlPrompt: {
    'zh-CN': 'API Base URL（留空使用官方地址 {default}）：',
    'en': 'API base URL (leave empty for the official endpoint {default}):',
  },
  modePrompt: {
    'zh-CN': '选择运行形态：',
    'en': 'Pick a runtime surface:',
  },
  modeTui: {
    'zh-CN': 'tui — 终端 UI（Claude Code 风格，`dsh --profile <名字>` 启动）',
    'en': 'tui — terminal UI (Claude Code style, launched as `dsh --profile <name>`)',
  },
  modeWeb: {
    'zh-CN': 'web — 浏览器 UI（`dsh web`，默认 http://127.0.0.1:3080）',
    'en': 'web — browser UI (`dsh web`, default http://127.0.0.1:3080)',
  },
  modeApp: {
    'zh-CN': 'app — DSH Desktop 桌面客户端（anywhere-labs 的 Electron 应用，macOS/Windows；向导自动下载安装包并引导）',
    'en': 'app — DSH Desktop client (the anywhere-labs Electron app, macOS/Windows; the wizard downloads the installer and guides you)',
  },
  missingKey: {
    'zh-CN': '缺少 API Key：请用 `--key sk-…` 传入，或在交互模式下输入。',
    'en': 'Missing API key: pass `--key sk-…` or enter it interactively.',
  },
  badBaseUrl: {
    'zh-CN': '无效的 Base URL：{url}（需要 http:// 或 https:// 地址）。',
    'en': 'Invalid base URL: {url} (an http:// or https:// URL is required).',
  },
  missingMode: {
    'zh-CN': '缺少运行形态：请用 `--mode headless|web` 指定，或在交互模式下选择。',
    'en': 'Missing mode: pass `--mode headless|web` or pick it interactively.',
  },
  credentialsReadFailed: {
    'zh-CN': '读取凭据文件失败：{path}（{reason}）。修好或删除该文件后重试。',
    'en': 'Reading the credentials file failed: {path} ({reason}). Fix or remove it and retry.',
  },
  summary: {
    'zh-CN': '即将执行：\n{lines}',
    'en': 'About to run:\n{lines}',
  },
  summarySurfaceLine: {
    'zh-CN': '运行形态：{surface}（将保存为 profile：{profile}，之后 `dsh --profile {profile}` 即按此形态启动）',
    'en': 'surface: {surface} (saved as the profile: {profile}; `dsh --profile {profile}` starts it later)',
  },
  proceedConfirm: {
    'zh-CN': '继续吗？',
    'en': 'Proceed?',
  },
  cancelled: {
    'zh-CN': '已取消，未做任何修改。',
    'en': 'Cancelled; nothing was changed.',
  },
  dryRunNotice: {
    'zh-CN': '（dry-run：以下操作不会真正执行）',
    'en': '(dry run: the actions below are not executed)',
  },
  credentialsWritten: {
    'zh-CN': '✓ 凭据已写入 {path}（0600）：{refs}',
    'en': '✓ Credentials written to {path} (0600): {refs}',
  },
  verifying: {
    'zh-CN': '正在验证 {mode} profile 可以组装……',
    'en': 'Verifying the {mode} profile composes…',
  },
  verifyFailed: {
    'zh-CN': '验证失败：dsh 无法组装 {mode} profile（{stderr}）。凭据已写入，profile 需自行排查。',
    'en': 'Verification failed: dsh cannot compose the {mode} profile ({stderr}). Credentials were written; the profile needs manual repair.',
  },
  verified: {
    'zh-CN': '✓ {mode} profile 组装成功',
    'en': '✓ {mode} profile composes',
  },
  versionLine: {
    'zh-CN': 'dsh-zcf v{version}（新版见 https://www.npmjs.com/package/dsh-zcf）',
    'en': 'dsh-zcf v{version} (see https://www.npmjs.com/package/dsh-zcf for newer releases)',
  },
  onboardingTitle: {
    'zh-CN': '✓ 一切就绪！上手指引：',
    'en': '✓ All set! Getting started:',
  },
  protectHeader: {
    'zh-CN': '检测到既有配置（profile：{profile}）——本次采用合并语义，不做覆盖：',
    'en': 'Existing configuration detected (profile: {profile}) — this run merges, it never overwrites:',
  },
  protectMergeFacts: {
    'zh-CN': '  - 凭据按条目合并：{foreignRefs} 个非 DeepSeek 条目原样保留；插件只增不减：现有 {plugins} 个{list}',
    'en': '  - credentials merge per entry: {foreignRefs} non-DeepSeek entries stay; plugins only ever get added: {plugins} present{list}',
  },
  protectBackupDone: {
    'zh-CN': '  - 已备份原配置：{path}（目录内有 RESTORE.md 恢复说明，最近 5 份自动保留）',
    'en': '  - original configuration backed up: {path} (RESTORE.md inside explains recovery; the newest 5 snapshots are kept)',
  },
  protectBackupFailed: {
    'zh-CN': '× 备份未能完成：{reason}（未做任何修改，已停止）',
    'en': '× the backup could not be completed: {reason} (nothing was changed; stopped)',
  },
  protectConfirm: {
    'zh-CN': '按上述合并语义继续吗？',
    'en': 'Continue with the merge semantics above?',
  },
  protectAborted: {
    'zh-CN': '已取消，未做任何修改。备份仍在：{path}',
    'en': 'Cancelled; nothing was changed. The backup remains at {path}',
  },
  legacyDesktopBundleRemoving: {
    'zh-CN': '正在移除旧版桌面文档包 dsh-desktop-app（0.5.3 起桌面壳改由 DSH Desktop 安装包提供）……',
    'en': 'Removing the legacy dsh-desktop-app doc bundle (since 0.5.3 the desktop shell comes from the DSH Desktop installer)…',
  },
  shortcutForeign: {
    'zh-CN': '检测到其它来源的 dsh-tui 命令：zcf 的自愈启动器不接管它（安装也会因命令名冲突失败）。可继续用 `dsh --profile <名字>` 启动任意 profile；如需 zcf 启动器，移除外来命令后重跑向导。',
    'en': 'A foreign dsh-tui command is on PATH: the wizard\'s self-healing launcher will not take it over (an install would also fail on the name conflict). Launch any profile with `dsh --profile <name>`; to get the wizard\'s launcher, remove the foreign command and rerun.',
  },
  keptHint: {
    'zh-CN': '（留空=保留此值）',
    'en': ' (empty input keeps this value)',
  },
  onboardingOtherProfiles: {
    'zh-CN': '本机其它已有 profile 可用其它命令启动：{list}',
    'en': 'Other profiles on this machine start with their own commands: {list}',
  },
  desktopNoInstaller: {
    'zh-CN': '当前平台没有 DSH Desktop 安装包（仅提供 macOS Universal 与 Windows x64）。已按 web 组合准备好 profile，本机可用 `dsh web`；需要 `--desktop-platform mac|win` 为其它机器代下安装包。',
    'en': 'No DSH Desktop installer for this platform (macOS Universal and Windows x64 only). The profile is composed for the web surface, so `dsh web` works here; pass `--desktop-platform mac|win` to fetch an installer for another machine.',
  },
  planDesktopInstaller: {
    'zh-CN': '下载 DSH Desktop 安装包（{platform}，来源 {source}）',
    'en': 'download the DSH Desktop installer ({platform}, source {source})',
  },
  desktopSourceFallback: {
    'zh-CN': '官网下载入口不可用（{reason}），改用 GitHub Release……',
    'en': 'The project download endpoint is unreachable ({reason}); falling back to the GitHub release…',
  },
  desktopResolveFailed: {
    'zh-CN': '× 无法解析 DSH Desktop 安装包地址：{reason}',
    'en': '× Could not resolve a DSH Desktop installer: {reason}',
  },
  desktopDownloadAsk: {
    'zh-CN': '下载 DSH Desktop 安装包到 ~/Downloads 吗？{file}，约 {size}MB',
    'en': 'Download the DSH Desktop installer into ~/Downloads? {file}, about {size} MB',
  },
  desktopDownloadSkipped: {
    'zh-CN': '已跳过下载；之后可重跑向导或自行到 https://www.dshdesktop.cn 下载。',
    'en': 'Skipped the download; rerun the wizard later or fetch it yourself from https://www.dshdesktop.cn.',
  },
  desktopDownloading: {
    'zh-CN': '正在下载 {file}（约 {size}MB）……',
    'en': 'Downloading {file} (about {size} MB)…',
  },
  desktopProgress: {
    'zh-CN': '  ↓ 已下载 {received}MB / {total}MB{percent}',
    'en': '  ↓ downloaded {received} MB / {total} MB{percent}',
  },
  desktopDownloaded: {
    'zh-CN': '✓ 安装包已保存：{path}',
    'en': '✓ Installer saved: {path}',
  },
  desktopDownloadFailed: {
    'zh-CN': '× 下载失败：{reason}（可重跑向导重试，或到 https://www.dshdesktop.cn 手动下载）',
    'en': '× Download failed: {reason} (rerun the wizard to retry, or download manually from https://www.dshdesktop.cn)',
  },
  onboardingProfileBridge: {
    'zh-CN': '（本次选择的运行形态已保存为 profile：{profile}——下面的启动命令都基于它）',
    'en': '(The surface you picked is saved as the profile: {profile} — the launch commands below all use it)',
  },
  onboardingLaunchTui: {
    'zh-CN': '启动终端 UI：`dsh --profile {profile}`（全局安装 dsh-zcf 后可简写 `dsh-tui`；直接提问即可）',
    'en': 'Launch the terminal UI: `dsh --profile {profile}` (shortens to `dsh-tui` after a global dsh-zcf install; just ask)',
  },
  onboardingLaunchTuiShortcut: {
    'zh-CN': '启动终端 UI：`dsh-tui`（已全局就绪；Claude Code 风格交互，直接提问即可）',
    'en': 'Launch the terminal UI: `dsh-tui` (globally ready; Claude Code-style chat; just ask)',
  },
  globalShortcutAsk: {
    'zh-CN': '把 dsh-tui 启动命令装到全局吗？（npm install -g dsh-zcf，之后任何位置输入 dsh-tui 即可启动）',
    'en': 'Install the dsh-tui launcher globally? (npm install -g dsh-zcf; then dsh-tui works from anywhere)',
  },
  globalShortcutInstalling: {
    'zh-CN': '正在全局安装 dsh-tui 启动命令……',
    'en': 'Installing the dsh-tui launcher globally…',
  },
  globalShortcutReady: {
    'zh-CN': '✓ dsh-tui 已全局就绪',
    'en': '✓ dsh-tui is globally ready',
  },
  globalShortcutHint: {
    'zh-CN': '提示：之后可运行 `{command}` 让 dsh-tui 命令全局可用。',
    'en': 'Hint: run `{command}` later to make the dsh-tui command globally available.',
  },
  webOnlySuffix: {
    'zh-CN': '【Web UI 专属 · TUI 形态自动跳过】',
    'en': '[Web UI only — skipped on TUI]',
  },
  webOnlySkipped: {
    'zh-CN': '跳过 {plugin}：Web UI 专属插件（依赖 Web 界面宿主服务），TUI 形态下不可用',
    'en': 'Skipping {plugin}: a Web-UI-only plugin (it depends on the web host service); not usable on the TUI surface',
  },
  preflightWebOnlyRemoved: {
    'zh-CN': '检测到 {plugin} 为 Web UI 专属插件（在 TUI 形态会卡住启动）——正在自动移除……',
    'en': '{plugin} is a Web-UI-only plugin (it stalls boot on the TUI surface) — removing it automatically…',
  },
  preflightConflictRemoved: {
    'zh-CN': '检测到 dsh-claude-move 与 dsh-chat-import 工具名冲突（同注册 import_claude，二者无法共存）——正在自动移除 dsh-claude-move……',
    'en': 'dsh-claude-move conflicts with dsh-chat-import (both register import_claude; they cannot coexist) — removing dsh-claude-move automatically…',
  },
  preflightCredentialsMigrating: {
    'zh-CN': '凭据文件为旧版扁平格式——正在迁移为当前版本格式（值不变）……',
    'en': 'Credentials file uses the pre-release flat layout — migrating to the current versioned layout (values unchanged)…',
  },
  launchTuiNotice: {
    'zh-CN': '正在从 {path} 的配置启动 dsh-tui……',
    'en': 'Starting dsh-tui from the configuration at {path}…',
  },
  launchTuiMissing: {
    'zh-CN': '默认 profile 不存在（{path}）。先运行 npx dsh-zcf 完成初始化。',
    'en': 'The default profile does not exist ({path}). Run npx dsh-zcf to initialize first.',
  },
  onboardingLaunchWeb: {
    'zh-CN': '启动 Web 界面：`dsh web`，然后浏览器打开 http://127.0.0.1:3080',
    'en': 'Launch the web UI: `dsh web`, then open http://127.0.0.1:3080',
  },
  onboardingLaunchDesktop: {
    'zh-CN': '安装 DSH Desktop：打开下载的安装包（DMG 拖入 Applications / NSIS 按提示安装），首启自动就绪——本向导写入的凭据与 profile 在同一 DSH 主目录，打开即可对话。安装包位置：{path}（托盘常驻；「退出」才会结束应用和后台服务）',
    'en': 'Install DSH Desktop: open the downloaded installer (drag the DMG into Applications / follow the NSIS prompts); the first launch sets itself up — the credentials and profile this wizard wrote share the same DSH home, so you can chat right away. Installer at: {path} (tray-resident; only Quit ends the app and its host)',
  },
  onboardingLaunchDesktopNone: {
    'zh-CN': '本机暂无 DSH Desktop 安装包（仅 macOS Universal 与 Windows x64）：可直接 `dsh web` 使用网页版，或把 profile `{profile}` 带到 mac/Windows 机器上配合 DSH Desktop。',
    'en': 'No DSH Desktop installer for this machine (macOS Universal and Windows x64 only): use `dsh web` here, or take profile `{profile}` to a mac/Windows machine with DSH Desktop.',
  },
  onboardingFirstRun: {
    'zh-CN': '首次启动直接对话即可；',
    'en': 'First run: just start chatting;',
  },
  onboardingModel: {
    'zh-CN': '已固定模型 {model}（在模型选择器中可见）。',
    'en': 'model {model} is pinned (visible in the model picker).',
  },
  onboardingManage: {
    'zh-CN': '日常管理随时 `npx dsh-zcf`：u 更新插件 / k 凭据与模型 / l 卸载插件 / n 逛插件市场。',
    'en': 'Day-to-day, rerun `npx dsh-zcf` anytime: u update plugins / k credentials & model / l uninstall / n browse the market.',
  },
  onboardingDocs: {
    'zh-CN': '文档与示例：https://github.com/AdamPlatin123/dsh-zcf',
    'en': 'Docs & examples: https://github.com/AdamPlatin123/dsh-zcf',
  },
  noWrites: {
    'zh-CN': '（本次没有需要写入的变化，凭据已是最新）',
    'en': '(no changes to write; credentials are already current)',
  },
  menuTitle: {
    'zh-CN': '请选择操作：',
    'en': 'Pick an action:',
  },
  menuInit: {
    'zh-CN': '1. 完整初始化 — 凭据 + 运行形态 + 推荐插件（推荐）',
    'en': '1. Full init — credentials + runtime surface + recommended plugins (recommended)',
  },
  menuMarketplace: {
    'zh-CN': '2. 推荐插件市场 — 浏览 20 个精选插件并安装到 profile',
    'en': '2. Recommended plugins — browse the 20 curated picks and install into a profile',
  },
  menuManage: {
    'zh-CN': '3. 管理已装插件 — 列出 profile 的插件并选择移除',
    'en': '3. Manage installed plugins — list a profile\'s plugins and pick ones to remove',
  },
  menuUpdate: {
    'zh-CN': '4. 更新已装插件 — 升级到 npm 最新版',
    'en': '4. Update installed plugins — refresh entries to npm latest',
  },
  menuConfigure: {
    'zh-CN': '5. 高级集成 — 官方接缝选项（搜索提供商、SQLite、MCP 等）',
    'en': '5. Advanced integrations — official seam options (search providers, SQLite, MCP, …)',
  },
  menuCredentials: {
    'zh-CN': '6. 更新凭据 — 仅更新 Key / Base URL',
    'en': '6. Update credentials — refresh only the key / base URL',
  },
  profileNamePrompt: {
    'zh-CN': '给这个定制形态起个名字（之后用 `dsh --profile <名字>` 启动，默认 dzcf）：',
    'en': 'Name this custom deployment (launched later as `dsh --profile <name>`, default dzcf):',
  },
  integrationPrompt: {
    'zh-CN': '选择要集成的能力（空格选择，回车确认）：',
    'en': 'Select capabilities to integrate (space to pick, enter to confirm):',
  },
  mcpCommandPrompt: {
    'zh-CN': 'MCP 服务器启动命令（如 npx -y @modelcontextprotocol/server-filesystem /tmp）：',
    'en': 'MCP server launch command (e.g. npx -y @modelcontextprotocol/server-filesystem /tmp):',
  },
  addingCapability: {
    'zh-CN': '正在集成 {capability}……',
    'en': 'Integrating {capability}…',
  },
  profileCreated: {
    'zh-CN': '✓ 已创建 profile：{profile}',
    'en': '✓ Profile created: {profile}',
  },
  capabilityInstalled: {
    'zh-CN': '✓ {capability} 已集成',
    'en': '✓ {capability} integrated',
  },
  envWritten: {
    'zh-CN': '✓ 环境变量已写入 {path}：{refs}',
    'en': '✓ Environment written to {path}: {refs}',
  },
  noIntegration: {
    'zh-CN': '未选择集成选项，使用内置 {mode} profile。',
    'en': 'No integrations selected; using the shipped {mode} profile.',
  },
  missingProfile: {
    'zh-CN': '缺少 profile 名称：请用 `--profile <name>` 指定。',
    'en': 'Missing profile name: pass `--profile <name>`.',
  },
  missingWith: {
    'zh-CN': '缺少集成选项：请用 `--with exa,pty,lsp,...` 指定。',
    'en': 'Missing integration options: pass `--with exa,pty,lsp,...`.',
  },
  envKeyPrompt: {
    'zh-CN': '{ref}（输入不回显，留空跳过）：',
    'en': '{ref} (hidden input, leave empty to skip):',
  },
  backHint: {
    'zh-CN': '（提示：任意问题按 Esc 返回上一步，已答内容会保留为默认值；第一个问题按 Esc 取消）',
    'en': '(Tip: press Esc on any question to step back — prior answers are kept as defaults; Esc on the first question cancels.)',
  },
  pluginPrompt: {
    'zh-CN': '选择推荐插件（空格选择，回车确认，可多选）：',
    'en': 'Select recommended plugins (space to pick, enter to confirm, multi-select):',
  },
  pluginInstalling: {
    'zh-CN': '正在安装插件 {plugin}……',
    'en': 'Installing plugin {plugin}…',
  },
  pluginInstalled: {
    'zh-CN': '✓ {plugin} 已安装并登记',
    'en': '✓ {plugin} installed and registered',
  },
  pluginInstallFailed: {
    'zh-CN': '安装 {plugin} 失败：{stderr}',
    'en': 'Installing {plugin} failed: {stderr}',
  },
  marketplaceNone: {
    'zh-CN': '未选择任何插件，未做修改。',
    'en': 'No plugins selected; nothing changed.',
  },
  marketplaceSource: {
    'zh-CN': '精选自社区雷达 awesome-dsh-plugins（运行级验证通过）；更多插件见 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin',
    'en': 'Curated from the community radar awesome-dsh-plugins (runtime-verified); more at https://github.com/awesome-dsh-plugin/awesome-dsh-plugin',
  },
  manageMissing: {
    'zh-CN': 'profile 不存在：{profile}。先运行完整初始化或插件市场创建它。',
    'en': 'Profile not found: {profile}. Create it with full init or the marketplace first.',
  },
  manageEmpty: {
    'zh-CN': '该 profile 没有已登记的插件（仅基础 bundle）。',
    'en': 'This profile has no registered plugins (base bundle only).',
  },
  manageListHeader: {
    'zh-CN': '已登记的插件：',
    'en': 'Registered plugins:',
  },
  manageRemovePrompt: {
    'zh-CN': '选择要移除的插件（首项 (全部) 即全选；空格选择，回车确认；不选则保留全部）：',
    'en': 'Pick plugins to remove (first entry (All) selects all; space to pick, enter to confirm; none keeps everything):',
  },
  manageRemoveSummary: {
    'zh-CN': '即将从 {profile} 移除：\n{lines}',
    'en': 'About to remove from {profile}:\n{lines}',
  },
  manageRemoveConfirm: {
    'zh-CN': '继续移除吗？（移除后需重新安装才能恢复）',
    'en': 'Proceed with the removal? (a reinstall is needed to restore them)',
  },
  selectAll: {
    'zh-CN': '(全部)',
    'en': '(All)',
  },
  updatePrompt: {
    'zh-CN': '选择要更新的插件（默认全选；空格取消，回车确认；首项 (全部) 可一键恢复全选）：',
    'en': 'Pick plugins to update (all preselected; space to untick, enter to confirm; first entry (All) restores all):',
  },
  pluginUpdating: {
    'zh-CN': '正在更新插件 {plugin}……',
    'en': 'Updating plugin {plugin}…',
  },
  pluginUpdated: {
    'zh-CN': '插件 {plugin} 已更新到最新版。',
    'en': 'Plugin {plugin} updated to the latest version.',
  },
  pluginUpdateFailed: {
    'zh-CN': '插件 {plugin} 更新失败：{stderr}',
    'en': 'Plugin {plugin} update failed: {stderr}',
  },
  updateFailedSummary: {
    'zh-CN': '以下插件更新失败：{plugins}。其余已完成；可重跑 u 命令重试失败项。',
    'en': 'These plugins failed to update: {plugins}. The rest completed; rerun the update flow to retry the failures.',
  },
  pluginRemoving: {
    'zh-CN': '正在移除插件 {plugin}……',
    'en': 'Removing plugin {plugin}…',
  },
  pluginRemoved: {
    'zh-CN': '✓ {plugin} 已移除',
    'en': '✓ {plugin} removed',
  },
  pluginRemoveFailed: {
    'zh-CN': '移除 {plugin} 失败：{stderr}',
    'en': 'Removing {plugin} failed: {stderr}',
  },
} as const

/** Official DeepSeek API endpoint the base bundle defaults to. */
export const PUBLIC_BASE_URL = 'https://api.deepseek.com'

/** Credential reference the shipped llm-deepseek adapter resolves per request. */
export const API_KEY_REF = 'DEEPSEEK_API_KEY'

/** Environment variable naming the adapter's endpoint override. */
export const BASE_URL_REF = 'DEEPSEEK_BASE_URL'
