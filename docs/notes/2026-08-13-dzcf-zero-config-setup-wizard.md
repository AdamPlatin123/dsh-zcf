# Agent Note: dzcf — a zero-config setup wizard for the dsh CLI

Status: implemented

English | [中文](2026-08-13-dzcf-zero-config-setup-wizard.zh.md)

## Problem

The `dsh` CLI has no CLI-first zero-config path. The Web surface onboards keyless through the Models page, but a terminal user must hand-assemble the pieces the product already owns: install `@deepseek-ai/dsh`, store `DEEPSEEK_API_KEY` where `dsh-credentials-local` reads it, and pick a runnable surface. The ZCF-style one-command wizard is an established demand signal for exactly this gap, and the [removed SDK project toolchain](../simplification/2026-08-11-remove-sdk-project-toolchain.md) sets the boundary it must respect: that deletion removed a *developer-project initializer* (generated editable Cordis projects, feature trees, launcher telemetry) for lack of a consumer. This wizard is the different product on the other side of the line — *user runtime setup*, grounded in the CLI user's first-run workflow and consuming only shipped, current mechanisms (the credentials document, shipped profile templates, the launcher's dump surface).

## Decision

A new app package `@deepseek-ai/dzcf` (bin `dzcf`, publish `restricted`) under `apps/dzcf`, runnable via `npx @deepseek-ai/dzcf`. One loop, five steps:

1. **Detect dsh** (`dsh -V`); missing → offer global install via the first available of pnpm/npm. Non-interactive without `--yes` fails loud instead of installing.
2. **Collect inputs**: the key (masked prompt or `--key`), an optional `DEEPSEEK_BASE_URL` (http(s) validated), and the surface (`headless` | `web`, prompt or `--mode`).
3. **Store into `$DSH_HOME/.credentials.yaml`** — the managed document, not a `.env` layer: it outranks both `.env` layers, is the provider's writable store, and owns the 0600/0700 and malformed-document-fail-loud contracts. Writes reuse `dsh-atomic-write`'s cross-process lock + atomic rename and merge untouched entries; keys never appear in output (masked summary).
4. **Verify** with `dsh --profile <mode> --dump-default-config` — shipped profiles auto-initialize on first boot, so a successful composition proves the loop keyless; failure reports dsh's stderr and keeps the stored credentials.
5. **Print next steps** per surface.

The wizard is a menu-driven CLI (ASCII banner + three flows — `i` full init, `c` integrations-only, `k` credentials-only) over three injectable seams — `RunFn` (subprocesses), `PromptFn` (@clack/prompts port bound to injectable streams), and the harness home — so unit specs drive every branch without a TTY, and a keyless snapshot replays the real `tsx` entry end to end against a fixture `dsh` on the PATH. All user-facing strings live in one bilingual table (`--lang zh-CN|en`, default `zh-CN`). Selecting any integration option (`exa`, `perplexity`, `sqlite`, `terminal`, `lsp`, `codex`, `claude`, `mcp`) creates a custom profile through the launcher's own `dsh plugin add`, appends the capability's patch rows (disabling a replaced row where the seam is single-provider), stores env-keyed provider credentials in `$DSH_HOME/.env`, and re-verifies with `--dump-config`.

## Alternatives considered

**inquirer (ZCF's library).** Rejected: heavier surface; @clack/prompts is the interactive-command precedent this repository already established, and the prompt port keeps it behind one seam anyway.

**Write `$DSH_HOME/.env` instead of the managed document.** Rejected: `.credentials.yaml` is the store the provider writes through `set`/`unset`, wins over both `.env` layers, and is the only one whose 0600/0700 and rejection semantics are contractual.

**`dsh setup` subcommand inside the launcher.** Rejected for v1: it requires `dsh` to already be installed, which removes the bootstrap value for the exact users the wizard serves; a standalone npx package installs dsh *and* configures it.

**Generate custom profiles (bundles manifest + `cordis.patch.yml`) in v1.** Deferred: `web`/`headless` ship templates that auto-initialize, covering the core loop; capability checkboxes (MCP, search providers, persistence backends) and an idempotent `dzcf u` are the v2 surface on top of the same seams.

## Consequences

A machine goes from nothing to a verified `dsh web` / `dsh --profile headless "task"` in one command without a model call. The wizard writes exactly one file (`$DSH_HOME/.credentials.yaml`); profile files, `cordis.yml`, and `.env` are untouched. The published tarball is npx-ready and self-contained: the two `@deepseek-ai` utilities it reuses are bundled into the bin at build time (`noExternal`) and declared as devDependencies, so `npx @deepseek-ai/dzcf` resolves only public npm packages and never the private `@deepseek-ai` scope (verified end to end through a real `npx --package <tarball>` run on a fresh VM). New workspace registration is minimal: root tsdown workspace list, `tsconfig.host.json` include + reference, knip entry, snapshot include, `appPackageFiles` policy, two source-plane paths entries for the util dependencies, and the `dzcf` source-launch script. Known gaps recorded in the package README: base-URL reachability and key validity are first-request failures, and crash durability is inherited from `dsh-atomic-write`.
