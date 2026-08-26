# Agent Note: dzcf install — measured registry choice and streaming progress

Status: implemented

English | [中文](2026-08-17-dzcf-install-registry-choice.zh.md)

## Problem

The `dsh-zcf@0.0.1-rc.3` publish added `@deepseek-ai/dsh: *` to dependencies (to associate the package with dsh on npm). That turned an npx first install from four small packages into hundreds — measured on the author's machine: 330 s with every tarball already in the npm cache, ten-plus minutes cold, with npm silent throughout. The wizard's install step also had no expectation management: no size notice, no progress, no registry choice.

## Decision

Three changes, all behind injectable seams (`WizardContext.probeRegistry`, `WizardContext.installDsh`), so every branch stays testable without a TTY:

1. **Size notice before the install confirm**: `@deepseek-ai/dsh` is a full distribution (60+ sub-packages, hundreds of dependencies); the wizard states the expected duration up front (5–15 min official, 1–2 min mirror).
2. **Registry by measured latency, not geography.** Interactive runs probe `/-/ping` on the official registry and the Aliyun mirror in parallel (3 s timeout) and list the faster one first with its measured milliseconds — the user picks informed. `--registry <url>` pins one without probing. Non-interactive runs keep the package manager's own registry and never switch silently: a silent registry swap in CI is worse than slow. Proxied users are the counterexample to geo-detection — the author's own machine exits through a Japan node, so IP geolocation concludes the opposite of reality, while the measured latency is directly on point.
3. **Streaming install.** The install moved from the synchronous `run` seam to an async streaming `installDsh` seam: installer stdout forwards line by line (carriage returns stripped), the wizard reports elapsed time after; npm additionally gets `--no-audit --no-fund` to drop unrelated requests.

For the publish itself, rc.4 dependencies return to the four public packages of the rc.2 shape; dsh stays runtime-detected and offered, matching the original design. The wizard must never be the reason a `npx dsh-zcf` resolves hundreds of packages before its first prompt.

## Alternatives considered

**Geo/timezone detection with an automatic mirror switch.** Rejected: unreliable in both directions (proxied users in China, Chinese-locale users abroad) and it makes the trust decision to a third-party registry for the user. Measured latency plus an informed pick covers the same need.

**A timeout/timing field on `RunFn`.** Rejected: it changes the existing seam contract and every existing test for a benefit a dedicated `installDsh` seam delivers with less churn.

**npm `--loglevel info` for per-package output.** Rejected: too noisy; forwarding the installer's own output plus the wizard's elapsed line is enough.

## Consequences

The keyless snapshot's banner expectation was refreshed alongside (stale from the 2026-08-13 DS-blue recolor, not a behavior change of this note). `installDshArgs` is a pure function; all wizard branches (explicit `--registry`, non-interactive default, fastest-first menu, both-probes-dead fallback, installer failure fails loud) have TTY-less unit coverage. Publishing rc.4 must keep `@deepseek-ai/dsh` out of dependencies — the rc.3 lesson is recorded here so the publish checklist can point at it.

## Rename to `dsh-zcf` (same day)

The package name moved from `@deepseek-ai/dzcf` to the public `dsh-zcf` it was actually published under, ending the rc.2/rc.3 state where the README said `npx @deepseek-ai/dzcf` (a 404) while the published bin still introduced itself as dzcf. Aligned: package name and `bin`, commander program name, banner wordmark (rebuilt glyph grid for `dsh-zcf`, monotone Z stroke, uniform 70-column rows), user-facing strings, error prefixes, both READMEs and their badges. Unchanged on purpose: the `apps/dzcf` directory and the root `pnpm dzcf` dev script (repo-internal paths), the `dzcf` default custom-profile name (a user-facing deployment name, not the command), and both Agent Notes as history. `publishConfig.access` became `public` — an unscoped package cannot be `restricted` — and the `repository` field was dropped rather than point npm users at a private repo they cannot open.
