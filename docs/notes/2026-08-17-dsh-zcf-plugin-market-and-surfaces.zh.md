# Agent Note: dsh-zcf — 插件市场、管理流程与 tui/web/app 三形态

Status: implemented

[English](2026-08-17-dsh-zcf-plugin-market-and-surfaces.md) | 中文

## 问题

向导只提供八个官方接缝集成，没有通向社区雷达已验证插件生态的入口；运行形态也只有一次性 `headless` 和 `web`。同时真机探针暴露了安装路径上两个静默破坏点：`dsh plugin add` 不带 `-w` 会被 `ERR_PNPM_ADDING_TO_ROOT` 拒绝（每个 profile 目录都自带 `pnpm-workspace.yaml`）；官方 surface bundle 的 npm `latest` 标签指向依赖从未发布的 0.0.1-rc.1 坏构建——向导不带版本号的 `plugin add` 拉到整条 404 链。

## 决策

在临时 profile 上的实验表明 `dsh plugin add -w <pkg>` 是自包含的：装包、在 profile 的 package.json 登记 bundle、加载器自动展开——无需 patch row；移除对称。基于该事实：

- `pluginAdd`/`pluginRemove` 现在透传 `-w`，`SURFACE_BUNDLES` 固定插入符区间（官方 `@^0.1.0-rc.6`、tui `@^0.7.4`、app `@^0.4.0`），两个破坏点同时修复。
- 运行形态变为 `tui`（`@deepseek-harness-tui/dsh-tui`）、`web`、`app`（`dsh-desktop-app`，Tauri 2 桌面壳；macOS/Windows，Linux 用户被引导到 tui/web）。一次性 `headless` 从选择器中移除。
- 主菜单扩为五项；init 的多选清单换为雷达二十个运行级验证插件（新 `marketplace.ts` 目录，按方向分组），`n`/`l` 动作提供安装与列举/移除流程（默认 profile `dzcf`，不再询问命名，非交互用 `--plugin`）。八个官方接缝选项原样移入高级 `c` 流程。
- 失败仍输出 dsh 的 stderr，但启动器会把 pnpm 的真实错误截断成一行 deprecation；带陈旧依赖（指向未发布包）的 pin 前旧 profile 在删除前会让所有 add 失败——记录为已知缺口，留待未来恢复提示。

## 备选方案

**给第三方插件写 patch row。** 不必要：加载器自行展开 bundle manifest；row 只为官方单提供商接缝保留。

**社区清单里的 GitHub 型插件。** 暂缓：`pnpm add github:owner/repo` 慢且版本漂移；README 指向社区清单。

**保留 `headless` 作第四形态。** 按产品方向移除：一次性流程不需要向导脚手架（凭据加 `dsh --profile` 即可），三选更干净。

## 后果

`--mode` 接受 tui/web/app；测试覆盖市场安装（既有与自动创建 profile）、移除、profile 缺失失败、tui 形态 init 顺序、以及 `-w`/固定版本 bundle 的参数契约（70 个单测，快照已重放）。本机实测：`dsh-web-access` 市场安装可组装、移除即注销；8/13 时代的陈旧依赖 profile 在删除前仍会毒化 `pnpm add`——向导输出截断后的 stderr 并以退出码 1 结束，而不是假装成功。
