# Agent Note: dzcf 安装——实测源选择与流式进度

Status: implemented

[English](2026-08-17-dzcf-install-registry-choice.md) | 中文

## 问题

`dsh-zcf@0.0.1-rc.3` 发布时把 `@deepseek-ai/dsh: *` 写进了 dependencies（为了让 npm 页面关联 dsh）。npx 首装从 4 个小包变成数百个包——作者本机实测：tarball 全部命中缓存仍需 330 秒，冷缓存十分钟以上，且 npm 全程无输出。向导的安装步骤同样缺乏预期管理：没有体量预告、没有进度、没有安装源选择。

## 决策

三项改动，全部落在可注入缝隙（`WizardContext.probeRegistry`、`WizardContext.installDsh`）之后，每个分支无 TTY 即可测试：

1. **安装确认前的体量预告**：`@deepseek-ai/dsh` 是完整发行版（60+ 个子包、数百个依赖）；向导先把预期时长摆出来（官方源 5–15 分钟，镜像源 1–2 分钟）。
2. **安装源由实测延迟决定，不由地理猜测决定。** 交互模式并行探测官方源与阿里云镜像的 `/-/ping`（3 秒超时），菜单把快的一方排在首位并显示实测毫秒——用户知情选择。`--registry <url>` 显式指定（跳过探测）。非交互模式保持包管理器自己的默认源、绝不静默切换：CI 里静默换源比慢更危险。走代理的用户就是地理检测的反例——作者本机从日本节点出口，IP 判位会得出与实际相反的结论，而实测延迟直接对症。
3. **流式安装。** 安装从同步 `run` 缝隙改为异步流式 `installDsh` 缝隙：installer stdout 逐行转发（剥掉回车符），结束后向导报告耗时；npm 另加 `--no-audit --no-fund` 砍掉无关请求。

发布面：rc.4 的 dependencies 回到 rc.2 形态的 4 个公共包；dsh 保持运行时检测+提议安装，与原设计一致。向导绝不能成为 `npx dsh-zcf` 在第一个提示符之前解析数百个包的原因。

## 备选方案

**地理/时区检测自动切镜像。** 否决：双向都不可靠（国内走代理者、海外中文环境者都会被误判），而且替用户做了对第三方 registry 的信任决策。实测延迟加知情选择覆盖同一需求。

**给 `RunFn` 加超时/计时字段。** 否决：改现有缝隙契约和全部既有测试，而独立的 `installDsh` 缝隙以更小改动 deliver 同样收益。

**npm `--loglevel info` 逐包输出。** 否决：太吵；转发 installer 自身输出加向导的耗时行已经足够。

## 后果

keyless 快照的 banner 期望一并刷新（陈旧期望来自 2026-08-13 的 DS 蓝上色，不是本 note 的行为变更）。`installDshArgs` 是纯函数；向导全部分支（显式 `--registry`、非交互默认、快方优先菜单、双探测全挂回退、安装失败 fail loud）都有无 TTY 单测。发布 rc.4 时必须保持 dependencies 不含 `@deepseek-ai/dsh`——rc.3 的教训记录在此，发布清单可直接引用。

## 更名为 `dsh-zcf`（同日）

包名从 `@deepseek-ai/dzcf` 改为实际发布所用的公共名 `dsh-zcf`，终结 rc.2/rc.3 时期 README 写 `npx @deepseek-ai/dzcf`（404）而发布版 bin 仍自称 dzcf 的割裂。对齐项：包名与 `bin`、commander 程序名、banner 字标（为 `dsh-zcf` 重建字形网格，Z 斜线单调、行宽统一 70 列）、用户可见文案、错误前缀、双语 README 及徽章。有意不动：`apps/dzcf` 目录与根 `pnpm dzcf` 开发脚本（仓库内部路径）、自定义 profile 的默认名 `dzcf`（用户可见的部署名，不是命令名）、两份 Agent Note 作为历史。`publishConfig.access` 改为 `public`——无 scope 包不能 `restricted`；`repository` 字段移除，而不是让 npm 用户指向一个打不开的私有仓库。
