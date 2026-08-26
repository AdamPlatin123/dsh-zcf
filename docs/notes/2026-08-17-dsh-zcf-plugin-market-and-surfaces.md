# Agent Note: dsh-zcf — plugin market, manage flow, and tui/web/app surfaces

Status: implemented

English | [中文](2026-08-17-dsh-zcf-plugin-market-and-surfaces.zh.md)

## Problem

The wizard offered eight official seam integrations but no path into the plugin ecosystem the community radar had already verified, and its runtime surfaces were the one-shot `headless` and `web` only. Meanwhile real-machine probing exposed two silent breakers in the install path: `dsh plugin add` without `-w` is rejected by `ERR_PNPM_ADDING_TO_ROOT` (every profile directory ships `pnpm-workspace.yaml`), and the official surface bundles' npm `latest` tags point at broken 0.0.1-rc.1 builds whose dependencies were never published — so the wizard's unpinned `plugin add` pulled a 404 chain.

## Decision

Experiments on a scratch profile showed `dsh plugin add -w <pkg>` is self-contained: it installs, registers the bundle in the profile's package.json, and the loader expands it — no patch rows. Removal is symmetric. On that fact:

- `pluginAdd`/`pluginRemove` now pass `-w`, and `SURFACE_BUNDLES` pin caret ranges (`@^0.1.0-rc.6` official, `@^0.7.4` tui, `@^0.4.0` app), fixing both breakers.
- Surfaces became `tui` (`@deepseek-harness-tui/dsh-tui`), `web`, and `app` (`dsh-desktop-app`, the Tauri 2 shell; macOS/Windows, Linux users steered to tui/web). The one-shot `headless` surface is gone from the picker.
- The main menu grew to five flows; init's multiselect now offers twenty runtime-verified plugins from the radar (new `marketplace.ts` catalog, grouped by direction), and `n`/`l` actions expose install and list/remove flows (default profile `dzcf`, no naming prompt, `--plugin` for non-interactive). The eight official seam options moved to the advanced `c` flow unchanged.
- Failures keep dsh's stderr but the launcher truncates pnpm's real error to a deprecation line; a stale pre-pin profile (deps on never-published packages) fails every add until deleted — recorded as a known gap for a future recovery hint.

## Alternatives considered

**Patching rows for third-party plugins.** Unnecessary: the loader expands bundle manifests itself; rows remain only for the official single-provider seams.

**GitHub-hosted plugins from the community list.** Deferred: `pnpm add github:owner/repo` is slow and version-drifting; the README points at the community list instead.

**Keeping `headless` as a fourth surface.** Dropped per product direction: the one-shot flow needs no wizard scaffolding (credentials plus `dsh --profile` suffice), and three choices read cleaner.

## Consequences

`--mode` accepts tui/web/app; tests cover market install (existing and auto-created profiles), removal, missing-profile failure, tui-surface init ordering, and the `-w`/pinned-bundle argument contracts (70 unit tests, snapshot replayed). Verified live on this machine: market install of `dsh-web-access` composes and removal unregisters it; an 8/13-era profile with stale deps still poisons `pnpm add` until deleted — the wizard reports the truncated stderr and exits 1 rather than pretending success.
