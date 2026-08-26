# Agent Note: dzcf — dsh CLI 的零配置引导向导

Status: implemented

[English](2026-08-13-dzcf-zero-config-setup-wizard.md) | 中文

## Problem

`dsh` CLI 缺少命令行侧的零配置入口。Web 端通过模型页无需密钥即可完成 onboarding，但终端用户必须手工拼装产品已经拥有的各个部件：安装 `@deepseek-ai/dsh`、把 `DEEPSEEK_API_KEY` 存到 `dsh-credentials-local` 读取的位置、再选一个可运行的形态。ZCF 式的一键向导正是针对这一缺口的成熟需求信号；而[已移除的 SDK 项目工具链](../simplification/2026-08-11-remove-sdk-project-toolchain.md)划定了它必须尊重的边界：那次删除砍掉的是**开发者项目初始化器**（生成可编辑 Cordis 项目、特性树、启动器遥测），原因是缺乏消费者。本向导是这条线另一侧的另一种产品——**用户运行时配置**，扎根于 CLI 用户首次使用的工作流，只消费现有机制（凭据文档、内置 profile 模板、启动器的 dump 表面）。

## Decision

新增应用包 `@deepseek-ai/dzcf`（bin `dzcf`，发布权限 `restricted`），位于 `apps/dzcf`，通过 `npx @deepseek-ai/dzcf` 运行。一条闭环，五步：

1. **检测 dsh**（`dsh -V`）；缺失 → 提议用 pnpm/npm 中可用的那个全局安装。非交互且无 `--yes` 时不安装、报错退出。
2. **收集输入**：Key（掩码输入或 `--key`）、可选 `DEEPSEEK_BASE_URL`（校验 http(s) 格式）、运行形态（`headless` | `web`，提示选择或 `--mode`）。
3. **写入 `$DSH_HOME/.credentials.yaml`**——受管文档而非 `.env` 层：它优先于两个 `.env` 层，是 provider 的可写存储，并拥有 0600/0700 与文档损坏即报错的契约。写入复用 `dsh-atomic-write` 的跨进程锁与原子重命名，未触及的条目原样保留；Key 绝不出现在输出中（摘要只显示掩码）。
4. **验证**：执行 `dsh --profile <mode> --dump-default-config`——内置 profile 首次启动自动初始化，一次成功的组装即可无密钥证明闭环；失败时输出 dsh 的 stderr，已写入的凭据保留。
5. **按形态打印下一步**。

向导是菜单驱动的 CLI（ASCII 横幅 + 三个流程——`i` 完整初始化、`c` 仅集成、`k` 仅凭据），依赖三个可注入接缝——`RunFn`（子进程）、`PromptFn`（绑定可注入流的 @clack/prompts 端口）与 harness 数据目录——因此单元测试无需 TTY 即可覆盖全部分支，keyless 快照通过 PATH 上的 fixture `dsh` 端到端重放真实 tsx 入口。全部用户可见字符串集中在同一张双语表中（`--lang zh-CN|en`，默认 `zh-CN`）。选择任一集成选项（`exa`、`perplexity`、`sqlite`、`terminal`、`lsp`、`codex`、`claude`、`mcp`）会通过启动器自身的 `dsh plugin add` 创建自定义 profile，追加该能力的 patch 行（单提供者的 seam 会先禁用被替换的行），把环境变量类提供商凭据存入 `$DSH_HOME/.env`，并以 `--dump-config` 重新验证。

## Alternatives considered

**inquirer（ZCF 所用的库）。** 不予采纳：表面更大；@clack/prompts 是本仓库已确立的交互式命令先例，且 prompt 端口将其收敛在单一接缝之后。

**改写 `$DSH_HOME/.env` 而非受管文档。** 不予采纳：`.credentials.yaml` 是 provider 通过 `set`/`unset` 写入的存储，优先于两个 `.env` 层，且是唯一具备 0600/0700 与拒绝语义契约的一层。

**在启动器内加 `dsh setup` 子命令。** v1 不予采纳：它要求先装好 `dsh`，恰好丢失了对目标用户最有价值的引导能力；独立 npx 包既能装 dsh 又能配置它。

**v1 内生成自定义 profile（bundles 清单 + `cordis.patch.yml`）。** 推迟：`web`/`headless` 自带自动初始化的模板，足以覆盖核心闭环；能力勾选（MCP、搜索提供商、持久化后端）与幂等的 `dzcf u` 是在同一组接缝之上的 v2 表面。

## Consequences

一台机器从零开始，无需任何模型调用，一条命令即可到达可验证的 `dsh web` / `dsh --profile headless "任务"`。向导只写一个文件（`$DSH_HOME/.credentials.yaml`）；profile 文件、`cordis.yml` 与 `.env` 均不触碰。发布的 tarball 具备 npx 形态且完全自包含：复用的两个 `@deepseek-ai` 工具在构建期被打入 bin（`noExternal`）并声明为 devDependencies，因此 `npx @deepseek-ai/dzcf` 只解析公共 npm 包，绝不触碰私有 `@deepseek-ai` scope（已通过全新 VM 上的真实 `npx --package <tarball>` 运行端到端验证）。工作区注册开销极小：根 tsdown workspace 列表、`tsconfig.host.json` 的 include 与 reference、knip 条目、快照 include、`appPackageFiles` 策略、两个 util 依赖的源码平面 paths 条目，以及 `dzcf` 源码启动脚本。已记录的缺口见包 README：Base URL 可达性与 Key 有效性是首次请求才会暴露的失败，崩溃持久性继承自 `dsh-atomic-write`。
