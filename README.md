[![npm version](https://img.shields.io/npm/v/dsh-zcf?style=flat&colorA=080f12&colorB=1fa669)](https://www.npmjs.com/package/dsh-zcf)
[![License](https://img.shields.io/badge/license-BSD--3--Clause-1fa669?style=flat&colorA=080f12&colorB=1fa669)](https://github.com/deepseek-ai/deepseek-harness)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek-Harness-1fa669?style=flat&colorA=080f12&colorB=1fa669)](https://github.com/deepseek-ai/deepseek-harness)

# `dsh-zcf`

English | [中文](README.zh.md)

dsh-zcf (DeepSeek Zero-Config Flow) is the one-command setup wizard for DeepSeek Harness. It takes a machine from nothing to a runnable `dsh` deployment: installs the `dsh` CLI when missing, stores the DeepSeek API key (and optional endpoint override) in the harness-home credentials document, and proves the chosen profile composes.

## Features

- **One command, zero config** — take a bare machine to a verified `dsh` deployment in a single `npx`.
- **Navigable steps** — press Esc on any interactive question to step back; prior answers persist as defaults (enter alone moves forward). Esc on the first question cancels.
- **Safe by construction** — keys are masked at the prompt, written to the owner-only managed credentials document under a cross-process lock, and committed atomically. They are never echoed; the summary masks them (`sk-***4321`).
- **Verified, not assumed** — the wizard proves the chosen profile composes via `dsh --dump-default-config`, so the loop is keyless before you ever call a model.
- **Self-contained tarball** — the private `@deepseek-ai` utilities it reuses are bundled into the bin at build time, so an `npx` run resolves only public npm packages and never the private scope.
- **Scriptable** — full non-interactive mode (`--key`, `--mode`, `--yes`, `--dry-run`) for CI and provisioning.
- **Bilingual UI** — `--lang zh-CN|en` (default `zh-CN`).
- **Extensible** — opt into Exa/Perplexity search, SQLite history, a persistent terminal, LSP navigation, Codex/Claude delegation, or an MCP server.

## Quick start

```sh
curl -fsSL https://raw.githubusercontent.com/AdamPlatin123/dsh-zcf/master/install.sh | bash
npx dsh-zcf            # interactive menu: init / plugin market / manage / update / advanced / credentials (after each flow: return to menu or exit)
npx dsh-zcf i          # full init (same as the bare command)
npx dsh-zcf n          # recommended-plugin market
dsh-zcf --help          # grammar (after a global install)
```

Requires Node.js >= 22.12 (`node -v`). On an older runtime the launcher prints a bilingual upgrade hint instead of a stack trace.

Non-interactive (CI, scripts):

```sh
dsh-zcf i --key sk-… --mode tui --yes
dsh-zcf i --key sk-… --mode web --base-url https://relay.example.com --yes
dsh-zcf n --plugin dsh-lens,dsh-spend           # install two picks (default dzcf profile)
dsh-zcf l --plugin dsh-lens                     # remove from the dzcf profile
dsh-zcf i --key sk-… --mode web --dry-run    # report the plan, write nothing
```

## What it does

1. **Detects `dsh`** (`dsh -V`). Missing? The wizard states the cost up front (`@deepseek-ai/dsh` is a full distribution: 60+ sub-packages and hundreds of dependencies; roughly 5–15 minutes from the official registry, 1–2 from a mirror), measures the round-trip latency of the official registry, the Aliyun mirror, and the full-sync Huawei mirror in interactive mode and lists the fastest first, and streams installer output line by line with an elapsed-time report. `--registry <url>` pins the registry without probing; non-interactive runs keep the package manager's own registry and never switch silently. `--yes` skips the question; a run without a package manager fails loud.
2. **Collects inputs** — the DeepSeek API key (masked prompt), an optional `DEEPSEEK_BASE_URL` override, and the runtime surface: `tui` (Claude Code-style terminal UI), `web` (browser UI), or `app` (the DSH Desktop client from anywhere-labs: the wizard downloads the platform installer into `~/Downloads` and guides the install; macOS Universal and Windows x64 only, other platforms fall back to the web composition). Interactive mode asks; non-interactive mode requires `--key` and `--mode` and fails loud otherwise.
3. **Stores credentials** in `$DSH_HOME/.credentials.yaml` — the managed, owner-only (0600 under 0700) document that `dsh-credentials-local` reads. Existing untouched entries survive; writes re-read under the cross-process writer lock and commit atomically. Keys are never echoed: the summary masks them (`sk-***4321`).
4. **Verifies the profile** with `dsh --profile <mode> --dump-default-config` — the shipped `web`/`headless` profiles auto-initialize on first boot, so a successful dump proves the zero-config loop without a model call. Failures report the dsh stderr; the stored credentials remain.
5. **Downloads and guides** (app surface) — an already-installed DSH Desktop (`%LOCALAPPDATA%\Programs\DSH Desktop\` on Windows, `/Applications/DSH Desktop.app` on macOS) is detected and the whole download is skipped; otherwise the installer is resolved (dshdesktop.cn by default, `--desktop-source github` to switch; the GitHub source carries a sha256 verify) and streamed into `~/Downloads` with progress, and an interactive run offers to open it right away (macOS mounts the dmg / Windows runs the Setup.exe; the installer's own prompts stay yours). `--desktop-platform mac|win` fetches for another machine. Platforms without an installer (Linux, Windows on ARM) are told so and continue, with the onboarding pointing at `dsh web`.
6. **Finish orchestration** — web surface: a service already on port 3080 is reused as-is; an interactive run is offered a background launch of `dsh --profile <name> web` with a readiness poll (up to 15 s) that outlives the wizard, while non-interactive runs keep the printed manual command. The tui surface is pointed at `dsh --profile <name>` (default profile name dzcf; override with `--profile`); the app surface prints the installer location and the DSH Desktop first-launch guide (credentials and profile share the same DSH home, so it works right after the install). A plugin install failing on a mirror's missing version (`ERR_PNPM_NO_MATCHING_VERSION` — cold platform packages lag days behind) **announces** the switch of that profile's registry to the official one, retries once, and later installs inherit it.

Nothing else is touched: no profile files are rewritten, no `cordis.yml` is generated, and the wizard itself never calls a model API.

### Existing-user protection (0.5.4+)

Rerunning the wizard on a machine that already has configuration:

- **Merge semantics** (the default, no overwrites): credentials merge per entry — other providers' entries survive untouched; profile plugins only ever get added; the model catalog upserts per row. The wizard states both facts before touching anything.
- **Automatic backup**: before the first change, `.credentials.yaml` and the profile's `package.json`/`.npmrc`/`cordis.patch.yml` are snapshotted into `~/.dsh/.zcf/backups/<timestamp>-<profile>/` (a RESTORE.md inside spells the copy-back steps; the newest 5 snapshots are kept). Interactive runs get one continue confirm here; fresh machines skip the block entirely.
- **Other launch commands**: every profile starts independently with `dsh --profile <name>`; the onboarding lists the launch commands for the machine's other profiles. When a foreign `dsh-tui` command is detected (the TUI project ships the same name), the wizard no longer claims it ready and never fights over the name (no EEXIST); its own self-healing launcher is always available as the `dzcf-tui` alias.
- **Legacy desktop migration**: the `dsh-desktop-app` doc bundle left by app surfaces from 0.5.2 and earlier is removed automatically on the next run.

## Options

| Option | Meaning |
|---|---|
| `i` | Full init (same as the bare command). |
| `n` | Recommended-plugin market: multi-select from the 22 curated picks (default dzcf profile). |
| `l` | Manage installed plugins: list and remove picked ones (default dzcf profile); interactive removals show a summary confirm first (`--yes` skips it). |
| `u` | Update installed plugins: multi-select refreshes picked entries to npm latest; non-interactive with no `--plugin` updates all. |
| `tui` / `dsh-tui` | Launch the default profile's terminal UI directly (the `dsh-tui` bin works after a global install), announcing the config source first. |
| `c` | Advanced integrations; requires `--profile` and `--with`. |
| `k` | Credential management menu: update the key (stored credentials are listed masked for picking, or type a new one), the base URL, pick a model from the upstream `GET /models` listing, or reconfigure all (endpoint, key, model). |
| `-k, --key <key>` | API key; skip the masked prompt. |
| `--base-url <url>` | Endpoint override; any http(s) URL, else exit 1. |
| `--model <id>` | Pin this model id into the profile's model catalog (interactive flows also list the upstream `GET /models` result). |
| `-m, --mode <mode>` | `tui`, `web`, or `app`; skip the list prompt. |
| `--desktop-source <source>` | DSH Desktop installer source: `cn` (dshdesktop.cn, default) or `github`. |
| `--desktop-platform <platform>` | DSH Desktop installer platform: `mac` or `win`; defaults to this machine, and can fetch installers for another one. |
| `-l, --lang <lang>` | Interface language: `zh-CN` (default) or `en`. |
| `-y, --yes` | Assume yes for the install and write confirmations. |
| `-p, --profile <name>` | Custom profile name for integration options. |
| `--with <list>` | Integration ids, comma-separated (`exa,terminal,lsp`). |
| `--mcp-command <cmd>` | MCP server launch command (non-interactive `--with mcp`). |
| `--registry <url>` | npm registry for the dsh install; any http(s) URL, else exit 1. |
| `--plugin <list>` | Recommended-plugin npm names, comma-separated (`dsh-lens,dsh-spend`); installs in init, removes in manage. |
| `--dry-run` | Print the planned writes and verify command, touch nothing. |
| `-V, --version` | Print the version and exit. |

## Recommended plugins (22 curated picks)

The `n` market and the init multiselect, all runtime-verified entries from the community radar [awesome-dsh-plugins](https://github.com/AdamPlatin123/awesome-dsh-plugins); more at [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin).

| Direction | Plugin | Effect |
|---|---|---|
| Coding | `dsh-lens` | Live feedback on file writes: LSP, linter, formatter, ast-grep, symbol search. |
| Coding | `dsh-ci-doctor` | Background CI failure watcher with log-signature diagnosis. |
| Coding | `dsh-file-review` | Review agent file modifications in a diff view. |
| Agent | `dsh-subagent-tools` | Per-call overrides for subagent model/provider/persona and tool filter. |
| Agent | `dsh-mcp-adapter` | On-demand MCP search/describe/call proxy keeping schemas out of context. |
| Agent | `billion-context-dsh` | Model-driven context compression with compress/decompress/search. |
| Web UI | `dsh-office` | Floating workspace/session dashboard with token and subagent views. |
| Web UI | `dsh-spend` | Token usage and estimated cost floating window. |
| Web UI | `dsh-turn-index` | Turn-by-turn question index sidebar with click-to-jump. |
| Web UI | `dsh-outline` | Live outline tree from questions and Markdown headings. |
| Web UI | `dsh-genui` | Inline GenUI: charts, forms, quizzes, 3D scenes. |
| Memory | `dsh-mnemon` | Three-tier local memory (runtime/project/long-term) with web UI. |
| Memory | `dsh-memento` | Bounded, approval-gated cross-session memory. |
| Messaging | `dsh-lark-bot` | Feishu/Lark bridge: streaming cards, worktree isolation. |
| Messaging | `dsh-dingtalk` | DingTalk group-robot notifications via signed webhook. |
| Files & safety | `dsh-artifact` | Organize and browse session artifacts. |
| Files & safety | `dsh-security-scan` | Scans secrets and dangerous patterns, redacts keys/tokens. |
| Infra guard | `dsh-plugin-guard` | Snapshot/rollback safety net for plugin install/uninstall. |
| Infra guard | `dsh-plugin-audit` | Static permission profiler plus runtime sentinel. |
| Web access | `dsh-web-access` | Multi-provider web search/fetch/source check with web panel. |

## Advanced integrations (official seam options)

The wizard can extend a deployment with capabilities beyond the shipped `web`/`headless` surfaces. Selecting any option creates a custom profile (`--profile <name>`, default `dzcf`) and installs the capability through the launcher's own `dsh plugin add`, then writes its patch rows and verifies the composition:

| Option | Effect |
|---|---|
| `exa` | Register the Exa search provider (`EXA_API_KEY` → `$DSH_HOME/.env`). |
| `perplexity` | Register the Perplexity search provider (`PERPLEXITY_API_KEY` → `$DSH_HOME/.env`). |
| `sqlite` | Persist session history in SQLite (replaces the JSONL default). |
| `terminal` | Add the persistent PTY terminal tool. |
| `lsp` | Add language-server symbol navigation (service + stdio backend + tool). |
| `codex` | Delegate subtasks to a local Codex CLI (requires `codex` installed). |
| `claude` | Delegate subtasks to a local Claude Code (requires `claude` installed). |
| `mcp` | Attach one MCP server (enter its launch command). |

Interactive mode asks a multiselect; non-interactive uses `--with exa,terminal,lsp` and `--profile <name>`. Provider keys are prompted only in interactive mode.


## Development

The wizard is a menu-driven CLI over three injectable seams — `RunFn` (subprocesses), `PromptFn` (@clack/prompts port), and the harness home — so the whole flow is testable without a TTY. The published tarball is self-contained: the two `@deepseek-ai` utilities it reuses (`dsh-home-paths`, `dsh-atomic-write`) are bundled into the bin at build time (`noExternal`), so an npx run resolves only public npm packages and never the private `@deepseek-ai` scope. Source launch from the repository root: `pnpm dzcf <args...>` (tsx ESM hook; no build needed). Unit specs cover the grammar, the credentials and env-file contracts, the capability catalog, the profile patch writer, and the wizard flows; the keyless snapshot replays the real entry end to end against a fixture `dsh` on the PATH.
## Known limitations

- The base-URL prompt accepts any http(s) URL; reachability and key validity are not checked — the first real request owns that failure.
- Credential writes are atomic but not crash-durable (inherited from `dsh-atomic-write`); the document is re-read on every boot.
- On Windows the 0600/0700 permission checks are skipped, matching `dsh-credentials-local`.
- On Windows the full wizard flow works (0.5.5+: the `.cmd` shapes of npm/pnpm/dsh and the command probes are platform-aware), but the `dsh-tui`/`dzcf-tui` straight-to-TUI bin forwarding relies on POSIX symlink shapes and never triggers under Windows' npm `.cmd` shims — use `dsh-zcf tui` (or the menu) instead; a proper fix needs split bin entries and is planned for the next release.

## License

Released under the [BSD-3-Clause](https://github.com/deepseek-ai/deepseek-harness) license as part of DeepSeek Harness.
