[![npm version](https://img.shields.io/npm/v/dsh-zcf?style=flat&colorA=080f12&colorB=1fa669)](https://www.npmjs.com/package/dsh-zcf)
[![License](https://img.shields.io/badge/license-BSD--3--Clause-1fa669?style=flat&colorA=080f12&colorB=1fa669)](https://github.com/deepseek-ai/deepseek-harness)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek-Harness-1fa669?style=flat&colorA=080f12&colorB=1fa669)](https://github.com/deepseek-ai/deepseek-harness)

# `dsh-zcf`

[English](README.md) | 中文

dsh-zcf（DeepSeek Zero-Config Flow）是 DeepSeek Harness 的一键配置向导。它把一台机器从零带到可运行的 `dsh` 部署：缺 `dsh` 时装好它，把 DeepSeek API Key（以及可选的自定义端点）写入 harness 数据目录的凭据文档，并验证所选 profile 可以组装。

## 特性

- **一条命令，零配置**——把一台裸机带到可验证的 `dsh` 部署，只需一次 `npx`。
- **步骤可回退**——交互流程中任意问题按 Esc 返回上一步，已答内容保留为默认值（直接回车即可前进）；第一个问题按 Esc 取消。
- **构造即安全**——Key 在输入时掩码，写入仅属主可读的受管凭据文档，跨进程写锁内原子提交；绝不回显，摘要里始终掩码（`sk-***4321`）。
- **可验证而非假设**——向导用 `dsh --dump-default-config` 证明所选 profile 能组装，在调用任何模型前闭环已 keyless。
- **自包含 tarball**——复用的私有 `@deepseek-ai` 工具在构建期即打入 bin，`npx` 只解析公共 npm 包，绝不触碰私有 scope。
- **可脚本化**——完整的非交互模式（`--key`、`--mode`、`--yes`、`--dry-run`），适配 CI 与自动化配置。
- **双语界面**——`--lang zh-CN|en`（默认 `zh-CN`）。
- **可扩展**——按需接入 Exa/Perplexity 搜索、SQLite 历史、持久终端、LSP 符号导航、Codex/Claude 委派或 MCP 服务器。

## 快速开始

```sh
npx dsh-zcf            # interactive menu: init / plugin market / manage / advanced / credentials
npx dsh-zcf i          # full init (same as the bare command)
npx dsh-zcf n          # recommended-plugin market
dsh-zcf --help          # grammar (after a global install)
```

非交互（CI、脚本）：

```sh
dsh-zcf i --key sk-… --mode tui --yes
dsh-zcf i --key sk-… --mode web --base-url https://relay.example.com --yes
dsh-zcf n --plugin dsh-lens,dsh-spend           # install two picks (default dzcf profile)
dsh-zcf l --plugin dsh-lens                     # remove from the dzcf profile
dsh-zcf i --key sk-… --mode web --dry-run    # report the plan, write nothing
```


## 它做什么

1. **检测 `dsh`**（`dsh -V`）。不存在？向导先预告体量（`@deepseek-ai/dsh` 是完整发行版：60+ 个子包、数百个依赖，官方源约 5–15 分钟、镜像源约 1–2 分钟），交互模式实测官方源与阿里云镜像的往返延迟并把快的一方排在首位供选择；`--registry <url>` 显式指定安装源（跳过探测），非交互模式默认包管理器自己的源、绝不静默切换。安装过程逐行实时转发输出并报告耗时；`--yes` 跳过询问，没有可用包管理器则报错退出。
2. **收集输入**——DeepSeek API Key（掩码输入）、可选的 `DEEPSEEK_BASE_URL` 覆盖，以及运行形态：`tui` 终端 UI（Claude Code 风格）、`web` 浏览器 UI、或 `app` 桌面应用壳（Tauri 2，macOS/Windows）。交互模式逐项询问；非交互模式必须有 `--key` 和 `--mode`，缺失即报错退出。
3. **写入凭据**到 `$DSH_HOME/.credentials.yaml`——`dsh-credentials-local` 读取的受管文档，仅属主可读写（0700 目录下的 0600 文件）。未涉及的既有条目原样保留；写入在跨进程写锁内先重读再原子提交。Key 绝不回显：摘要里始终是掩码（`sk-***4321`）。
4. **验证 profile**：执行 `dsh --profile <mode> --dump-default-config`——内置的 `web`/`headless` profile 首次启动会自动初始化，所以一次成功的 dump 就能证明零配置闭环，无需任何模型调用。失败时输出 dsh 的 stderr；已写入的凭据保留。
5. **打印下一步**——`dsh web`，或 `dsh --profile dzcf`（tui/app 形态；profile 默认名 dzcf，可用 `--profile` 改）。

除此之外不碰任何东西：不重写 profile 文件、不生成 `cordis.yml`，向导自身也从不调用模型 API。

## 参数

| 参数 | 含义 |
|---|---|
| `i` | 完整初始化（与裸命令等价）。 |
| `n` | 推荐插件市场：多选安装 20 个精选插件（默认 dzcf profile）。 |
| `l` | 管理已装插件：列出并按选择移除（默认 dzcf profile）。 |
| `c` | 高级集成；需要 `--profile` 与 `--with`。 |
| `k` | 仅更新凭据（Key / Base URL）。 |
| `-k, --key <key>` | API Key；跳过掩码输入。 |
| `--base-url <url>` | 端点覆盖；必须是 http(s) 地址，否则退出码 1。 |
| `-m, --mode <mode>` | `tui`、`web` 或 `app`；跳过列表选择。 |
| `-l, --lang <lang>` | 界面语言：`zh-CN`（默认）或 `en`。 |
| `-y, --yes` | 对安装与写入确认一律视为同意。 |
| `-p, --profile <name>` | 集成选项所用的自定义 profile 名称。 |
| `--with <list>` | 集成 id，逗号分隔（`exa,terminal,lsp`）。 |
| `--mcp-command <cmd>` | MCP 服务器启动命令（非交互 `--with mcp`）。 |
| `--registry <url>` | dsh 安装使用的 npm 源；必须是 http(s) 地址，否则退出码 1。 |
| `--plugin <list>` | 推荐插件的 npm 包名，逗号分隔（`dsh-lens,dsh-spend`）；init 时直装、manage 时直卸。 |
| `--dry-run` | 打印计划中的写入与验证命令，不落盘。 |
| `-V, --version` | 打印版本后退出。 |

## 推荐插件（20 个精选）

`n` 市场与 init 流程的多选清单，全部取自社区雷达 [awesome-dsh-plugins](https://github.com/AdamPlatin123/awesome-dsh-plugins) 的运行级验证通过条目；更多插件见 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。

| 方向 | 插件 | 效果 |
|---|---|---|
| 编码开发 | `dsh-lens` | 文件写入即时反馈：LSP、linter、formatter、ast-grep、符号搜索。 |
| 编码开发 | `dsh-ci-doctor` | 后台盯 CI 失败并按日志签名诊断，去重台账。 |
| 编码开发 | `dsh-file-review` | 以 diff 视图审查 agent 的文件修改。 |
| Agent 能力 | `dsh-subagent-tools` | 按调用覆写子代理的模型/提供商/人设与工具过滤。 |
| Agent 能力 | `dsh-mcp-adapter` | 按需搜索/描述/调用 MCP，schema 不进上下文。 |
| Agent 能力 | `billion-context-dsh` | 模型驱动的上下文压缩与检索。 |
| Web UI | `dsh-office` | 悬浮工作台/会话仪表盘，含 token 与子代理视图。 |
| Web UI | `dsh-spend` | token 用量与估算成本悬浮窗。 |
| Web UI | `dsh-turn-index` | 逐轮问题索引侧栏，点击跳转。 |
| Web UI | `dsh-outline` | 从问题与 Markdown 标题实时生成大纲。 |
| Web UI | `dsh-genui` | 内联 GenUI：图表、表单、测验、3D 场景。 |
| 记忆 | `dsh-mnemon` | 本地三层记忆（运行时/项目/长期）配 Web UI。 |
| 记忆 | `dsh-memento` | 有界、审批门控的跨会话记忆。 |
| 消息通讯 | `dsh-lark-bot` | 飞书/Lark 桥：流式卡片、worktree 隔离。 |
| 消息通讯 | `dsh-dingtalk` | 钉钉群机器人签名 webhook 通知。 |
| 文件与安全 | `dsh-artifact` | 会话产物的组织与浏览。 |
| 文件与安全 | `dsh-security-scan` | 扫描密钥与危险模式并脱敏。 |
| 基建守护 | `dsh-plugin-guard` | 插件装卸前后快照/回滚安全网。 |
| 基建守护 | `dsh-plugin-audit` | 插件静态权限画像 + 运行时哨兵。 |
| 联网 | `dsh-web-access` | 多提供商联网搜索/抓取/源校验，带 Web 面板。 |

## 高级集成（官方接缝选项）

向导可以在内置 `web`/`headless` 形态之外扩展部署。选择任一选项会创建自定义 profile（`--profile <name>`，默认 `dzcf`），通过启动器自身的 `dsh plugin add` 安装能力，写入其 patch 行并验证组合：

| 选项 | 效果 |
|---|---|
| `exa` | 接入 Exa 搜索提供商（`EXA_API_KEY` → `$DSH_HOME/.env`）。 |
| `perplexity` | 接入 Perplexity 搜索提供商（`PERPLEXITY_API_KEY` → `$DSH_HOME/.env`）。 |
| `sqlite` | 用 SQLite 持久化会话历史（替换默认 JSONL）。 |
| `terminal` | 添加持久 PTY 终端工具。 |
| `lsp` | 添加语言服务器符号导航（service + stdio 后端 + 工具）。 |
| `codex` | 把子任务委派给本机 Codex CLI（需已安装 codex）。 |
| `claude` | 把子任务委派给本机 Claude Code（需已安装 claude）。 |
| `mcp` | 接入一个 MCP 服务器（输入其启动命令）。 |

交互模式用多选提问；非交互用 `--with exa,terminal,lsp` 与 `--profile <name>`。提供商 Key 仅在交互模式提示。

## 开发

向导是普通 Node CLI，依赖三个可注入接缝——`RunFn`（子进程）、`PromptFn`（@clack/prompts 端口）与 harness 数据目录——因此整个流程无需 TTY 即可测试。发布的 tarball 完全自包含：它复用的两个 `@deepseek-ai` 工具（`dsh-home-paths`、`dsh-atomic-write`）在构建期即被打入 bin（`noExternal`），因此 npx 运行只解析公共 npm 包，绝不触碰私有 `@deepseek-ai` scope。源码启动：仓库根目录执行 `pnpm dzcf <args...>`（tsx ESM 钩子，无需构建）。单元测试覆盖命令语法、凭据文档契约、能力目录、profile patch 写入与向导流程；keyless 快照通过 PATH 上的 fixture `dsh` 端到端重放真实入口。

## 已知限制

- Base URL 输入只校验 http(s) 格式，不检查可达性与 Key 有效性——首次真实请求才会暴露这类失败。
- 凭据写入是原子的但非崩溃持久（继承自 `dsh-atomic-write`）；文档每次启动都会重读。
- Windows 下跳过 0600/0700 权限校验，与 `dsh-credentials-local` 一致。

## 许可证

以 [BSD-3-Clause](https://github.com/deepseek-ai/deepseek-harness) 许可证发布，属于 DeepSeek Harness 的一部分。
