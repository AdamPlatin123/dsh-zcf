/**
 * Child-process surface for the dsh-zcf wizard: probe, install, and verify
 * commands through the PATH. `RunFn` is injectable so tests drive every step
 * without spawning real processes; the registry probe and the streaming
 * installer are the async counterparts for steps that must not block silently.
 * @module dsh-zcf
 */

import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants as fsConstants } from 'node:fs'
import { isAbsolute, join } from 'node:path'

/** Result of one synchronous command run. */
export interface RunResult {
  /** Exit status; null when the process could not be spawned (ENOENT). */
  status: number | null
  stdout: string
  stderr: string
}

/** Synchronous command runner; `env` replaces inherited variables. */
export type RunFn = (
  command: string,
  args: readonly string[],
  env?: Readonly<Record<string, string | undefined>>,
  timeoutMs?: number,
  cwd?: string,
) => RunResult

/**
 * Characters cmd.exe re-interprets even inside double quotes (`%VAR%`,
 * `!VAR!`, and friends). Any of these in a command or argument is rejected
 * outright — everything the wizard passes (package names, URLs, paths,
 * profile names) stays inside the safe set, and a violation fails loud
 * instead of executing a rewritten command line.
 */
const CMD_FORBIDDEN = /[&|<>^%!"]/

/**
 * Wrap one command line for cmd.exe on Windows, where npm/pnpm/dsh are
 * `.cmd` shims that CreateProcess cannot launch directly (Node refuses
 * shell-less `.cmd`/`.bat` spawns since the CVE-2024-27980 fix).
 *
 * The command is assembled into ONE line passed as the single `/c` operand
 * with `windowsVerbatimArguments`, so Node never re-quotes it into the `\"`
 * escapes cmd cannot parse. Arguments containing spaces get their own inner
 * quotes (parsed by the child, not by cmd); the line itself carries no
 * outer quotes, so cmd's own quote-stripping rules never trigger.
 * @param command - executable name or path.
 * @param args - arguments.
 * @returns the `cmd.exe` invocation to spawn instead.
 * @throws when any part carries a cmd metacharacter (never silently mangled).
 */
export function windowsSpawnArgs(command: string, args: readonly string[]): { file: string; argv: readonly string[] } {
  const parts = [command, ...args]
  for (const part of parts) {
    if (CMD_FORBIDDEN.test(part)) throw new Error(`dsh-zcf: refusing to run through cmd.exe (metacharacter in ${JSON.stringify(part)})`)
  }
  const line = parts.map(part => (part.includes(' ') ? `"${part}"` : part)).join(' ')
  return { file: 'cmd.exe', argv: ['/d', '/s', '/c', line] }
}

/**
 * Run a command with the terminal attached (stdin/stdout/stderr inherited),
 * for launchers the user is meant to interact with; Ctrl-C reaches the child
 * directly. Returns the child's exit code (1 when it cannot spawn).
 * @param command - executable name or path.
 * @param args - arguments.
 * @returns the exit code.
 */
export function runInteractive(command: string, args: readonly string[]): number {
  if (process.platform === 'win32') {
    try {
      const wrapped = windowsSpawnArgs(command, args)
      const result = spawnSync(wrapped.file, [...wrapped.argv], { stdio: 'inherit', windowsHide: true, windowsVerbatimArguments: true })
      return result.status ?? 1
    } catch (error) {
      return 1
    }
  }
  const result = spawnSync(command, [...args], { stdio: 'inherit' })
  return result.status ?? 1
}

/**
 * Run one command synchronously through the PATH, capturing output as UTF-8.
 * A missing executable yields `status: null` plus the spawn error on stderr.
 * @param command - executable name or path.
 * @param args - arguments.
 * @param env - optional environment override (merged over `process.env`).
 * @param timeoutMs - optional kill-after milliseconds.
 * @param cwd - optional working directory.
 * @returns the run result.
 */
export function runCommand(
  command: string,
  args: readonly string[],
  env?: Readonly<Record<string, string | undefined>>,
  timeoutMs?: number,
  cwd?: string,
): RunResult {
  // A hung pnpm (store-lock wait on a broken profile) must surface as a
  // failed run the wizard can recover from, not an indefinite stall.
  const options = {
    encoding: 'utf8',
    env: env === undefined ? process.env : { ...process.env, ...env },
    ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
    ...(cwd === undefined ? {} : { cwd }),
  }
  let file = command
  let argv = [...args]
  if (process.platform === 'win32') {
    try {
      const wrapped = windowsSpawnArgs(command, args)
      file = wrapped.file
      argv = [...wrapped.argv]
    } catch (error) {
      return { status: null, stdout: '', stderr: (error as Error).message }
    }
  }
  const result = spawnSync(file, argv, process.platform === 'win32' ? { ...options, windowsHide: true, windowsVerbatimArguments: true } : options)
  if (result.error !== undefined) {
    return { status: null, stdout: '', stderr: result.error.message }
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/**
 * Find an executable on the PATH the way a shell would, without a shell:
 * each directory is probed for the bare name (POSIX) or for the name with
 * every PATHEXT extension in order (Windows). Replaces `bash -lc 'command
 * -v …'`, which needs bash and does not exist on Windows.
 * @param name - executable name to look for.
 * @param pathEnv - PATH string (injectable for tests).
 * @param pathExt - PATHEXT string with leading dot per extension (Windows only).
 * @param platform - platform to resolve for (injectable for tests).
 * @returns the first matching absolute path, or undefined.
 */
export function whichOnPath(name: string, pathEnv: string | undefined = process.env.PATH, pathExt: string | undefined = process.env.PATHEXT, platform: NodeJS.Platform = process.platform): string | undefined {
  if (name === '') return undefined
  // The separators follow the platform being resolved for, not the one
  // running the test — the strings are POSIX or Windows shaped accordingly.
  const entrySeparator = platform === 'win32' ? ';' : ':'
  const hasExtension = /\.[^./\\]+$/.test(name)
  const candidates: string[] = []
  if (platform === 'win32') {
    // Lowercase fallback extensions: Windows matching is case-insensitive,
    // and lowercase keeps the lookup testable on case-sensitive hosts.
    const extensions = (pathExt ?? '.com;.exe;.bat;.cmd').split(entrySeparator).filter(ext => ext !== '')
    if (hasExtension) candidates.push(name)
    else candidates.push(...extensions.map(ext => `${name}${ext.startsWith('.') ? ext : `.${ext}`}`))
  } else {
    candidates.push(name)
  }
  for (const dir of (pathEnv ?? '').split(entrySeparator)) {
    if (dir === '') continue
    for (const candidate of candidates) {
      const full = isAbsolute(candidate) ? candidate : join(dir, candidate)
      try {
        // POSIX checks the executable bit; on Windows existence is all a
        // permission check can mean (every PATHEXT hit is runnable via cmd).
        accessSync(full, platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK)
        return full
      } catch {
        // not present in this directory — keep scanning
      }
    }
  }
  return undefined
}

const DSH_PACKAGE = '@deepseek-ai/dsh'

/**
 * Whether the `dsh` launcher answers on the PATH (`dsh -V` exits 0).
 * @param run - command runner.
 * @returns true when dsh is runnable.
 */
export function dshAvailable(run: RunFn): boolean {
  return run('dsh', ['-V']).status === 0
}

/** Package managers the wizard installs dsh with, in preference order. */
const PACKAGE_MANAGERS = ['pnpm', 'npm'] as const

/**
 * The first available package manager, or undefined when none answers.
 * @param run - command runner.
 * @returns the executable name of the detected package manager.
 */
export function detectPackageManager(run: RunFn): string | undefined {
  for (const name of PACKAGE_MANAGERS) {
    if (run(name, ['-v']).status === 0) return name
  }
  return undefined
}

/**
 * Registries the wizard offers for the dsh install, in menu order. Each entry
 * carries the i18n key of its menu label; adding a mirror is one entry here
 * plus one message, nothing else. The full-sync mirrors (Huawei) track the
 * official version list completely, while popularity-ranked mirrors (Aliyun)
 * can lag days behind on cold platform-specific packages.
 */
export const REGISTRY_OPTIONS: readonly { labelKey: string; url: string }[] = [
  { labelKey: 'registryOfficial', url: 'https://registry.npmjs.org' },
  { labelKey: 'registryAliyun', url: 'https://registry.npmmirror.com' },
  { labelKey: 'registryHuawei', url: 'https://repo.huaweicloud.com/repository/npm' },
]

/** How long one registry probe may take before counting as unreachable. */
const PROBE_TIMEOUT_MS = 3000

/**
 * Measure one registry's `/-/ping` round trip. Reachability, not geography,
 * decides the recommendation: a probe answers in milliseconds or it does not.
 * @param url - registry base URL (http(s)).
 * @returns round-trip milliseconds, or undefined when unreachable within the timeout.
 */
export async function probeRegistryLatency(url: string): Promise<number | undefined> {
  const started = Date.now()
  try {
    const response = await fetch(`${url}/-/ping`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    // A fast error page is not a usable registry: only a healthy ping counts.
    if (!response.ok) return undefined
  } catch {
    return undefined
  }
  return Date.now() - started
}

/**
 * Global-install argument list for dsh. `npm` skips audit and funding requests
 * (network round trips the wizard does not need); a registry pins `--registry`.
 * @param pm - package-manager executable (`pnpm` or `npm`).
 * @param registry - optional registry base URL for the install.
 * @returns the argument list.
 */
export function installDshArgs(pm: string, registry?: string): readonly string[] {
  const args = pm === 'pnpm'
    ? ['add', '--global', DSH_PACKAGE]
    : ['install', '--global', DSH_PACKAGE, '--no-audit', '--no-fund']
  return registry === undefined ? args : [...args, `--registry=${registry}`]
}

/**
 * Install dsh globally while forwarding the installer's stdout line by line,
 * so a minutes-long download shows progress instead of silence.
 * @param pm - package-manager executable.
 * @param args - argument list from {@link installDshArgs}.
 * @param onLine - receives each completed stdout line, carriage returns stripped.
 * @returns the run result once the installer exits.
 */
export function installDshStreaming(pm: string, args: readonly string[], onLine: (line: string) => void): Promise<RunResult> {
  return new Promise((resolve) => {
    let file = pm
    let argv = [...args]
    let windows = false
    if (process.platform === 'win32') {
      windows = true
      try {
        const wrapped = windowsSpawnArgs(pm, args)
        file = wrapped.file
        argv = [...wrapped.argv]
      } catch (error) {
        resolve({ status: null, stdout: '', stderr: (error as Error).message })
        return
      }
    }
    const child = spawn(file, argv, { stdio: ['ignore', 'pipe', 'pipe'], ...(windows ? { windowsHide: true, windowsVerbatimArguments: true } : {}) })
    let stdout = ''
    let stderr = ''
    let pending = ''
    const emitLines = (flush: boolean): void => {
      let newline = pending.indexOf('\n')
      while (newline !== -1) {
        onLine(pending.slice(0, newline).replace(/\r$/, ''))
        pending = pending.slice(newline + 1)
        newline = pending.indexOf('\n')
      }
      if (flush && pending !== '') {
        onLine(pending.replace(/\r$/, ''))
        pending = ''
      }
    }
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stdout += text
      pending += text
      emitLines(false)
    })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => {
      resolve({ status: null, stdout, stderr: stderr === '' ? error.message : stderr })
    })
    child.on('close', (code) => {
      emitLines(true)
      resolve({ status: code, stdout, stderr })
    })
  })
}

/** How long the upstream model listing may take before counting as unreachable. */
const MODELS_TIMEOUT_MS = 8000/**
 * List model ids from an OpenAI-compatible `GET {baseUrl}/models` endpoint
 * with the picked key; DeepSeek's public API is the default base.
 * @param baseUrl - endpoint base; empty uses the public DeepSeek API.
 * @param key - bearer credential for the listing.
 * @returns model ids, or undefined when the endpoint does not answer in time.
 */
export async function fetchUpstreamModels(baseUrl: string, key: string): Promise<readonly string[] | undefined> {
  const base = baseUrl === '' ? 'https://api.deepseek.com' : baseUrl
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    const body: unknown = await response.json()
    const data = (body as { data?: unknown }).data
    if (!Array.isArray(data)) return undefined
    const ids = data.map(entry => (entry as { id?: unknown }).id).filter((id): id is string => typeof id === 'string' && id !== '')
    return ids.length === 0 ? undefined : ids
  } catch {
    return undefined
  }
}

/**
 * Start a long-running service in the background and detach: the wizard does
 * not wait for it (the web UI outlives the wizard that launched it). The
 * child is unref'd so the wizard process can exit independently.
 * @param command - executable name or path.
 * @param args - arguments.
 * @param env - optional environment override (merged over `process.env`).
 * @returns true when the process was spawned; its later fate is observed
 *          through a readiness probe, not through this return value.
 */
export function runDetached(command: string, args: readonly string[], env?: Readonly<Record<string, string | undefined>>): boolean {
  let file = command
  let argv = [...args]
  let windows = false
  if (process.platform === 'win32') {
    windows = true
    try {
      const wrapped = windowsSpawnArgs(command, args)
      file = wrapped.file
      argv = [...wrapped.argv]
    } catch {
      return false
    }
  }
  try {
    const child = spawn(file, argv, {
      stdio: 'ignore',
      detached: true,
      env: env === undefined ? process.env : { ...process.env, ...env },
      ...(windows ? { windowsHide: true, windowsVerbatimArguments: true } : {}),
    })
    child.unref()
    return true
  } catch {
    return false
  }
}

/**
 * Whether the web UI answers on its port. Any HTTP response counts as a live
 * service (the wizard only needs to know the port is serving, not which page).
 * @param url - base URL to probe.
 * @param timeoutMs - per-request timeout.
 * @returns true when the port responded.
 */
export async function probeWebReady(url: string, timeoutMs = 3000): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return true
  } catch {
    return false
  }
}
