/**
 * Child-process surface for the dsh-zcf wizard: probe, install, and verify
 * commands through the PATH. `RunFn` is injectable so tests drive every step
 * without spawning real processes; the registry probe and the streaming
 * installer are the async counterparts for steps that must not block silently.
 * @module dsh-zcf
 */

import { spawn, spawnSync } from 'node:child_process'

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
 * Run one command synchronously through the PATH, capturing output as UTF-8.
 * A missing executable yields `status: null` plus the spawn error on stderr.
 * @param command - executable name or path.
 * @param args - arguments.
 * @param env - optional environment override (merged over `process.env`).
 * @returns the run result.
 */
/**
 * Run a command with the terminal attached (stdin/stdout/stderr inherited),
 * for launchers the user is meant to interact with; Ctrl-C reaches the child
 * directly. Returns the child's exit code (1 when it cannot spawn).
 * @param command - executable name or path.
 * @param args - arguments.
 * @returns the exit code.
 */
export function runInteractive(command: string, args: readonly string[]): number {
  const result = spawnSync(command, [...args], { stdio: 'inherit' })
  return result.status ?? 1
}

export function runCommand(
  command: string,
  args: readonly string[],
  env?: Readonly<Record<string, string | undefined>>,
  timeoutMs?: number,
  cwd?: string,
): RunResult {
  const result = spawnSync(command, [...args], {
    encoding: 'utf8',
    env: env === undefined ? process.env : { ...process.env, ...env },
    // A hung pnpm (store-lock wait on a broken profile) must surface as a
    // failed run the wizard can recover from, not an indefinite stall.
    ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
    ...(cwd === undefined ? {} : { cwd }),
  })
  if (result.error !== undefined) {
    return { status: null, stdout: '', stderr: result.error.message }
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
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
    const child = spawn(pm, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
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
const MODELS_TIMEOUT_MS = 8000

/**
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
