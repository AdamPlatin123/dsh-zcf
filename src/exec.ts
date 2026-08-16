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
export type RunFn = (command: string, args: readonly string[], env?: Readonly<Record<string, string | undefined>>) => RunResult

/**
 * Run one command synchronously through the PATH, capturing output as UTF-8.
 * A missing executable yields `status: null` plus the spawn error on stderr.
 * @param command - executable name or path.
 * @param args - arguments.
 * @param env - optional environment override (merged over `process.env`).
 * @returns the run result.
 */
export function runCommand(command: string, args: readonly string[], env?: Readonly<Record<string, string | undefined>>): RunResult {
  const result = spawnSync(command, [...args], {
    encoding: 'utf8',
    env: env === undefined ? process.env : { ...process.env, ...env },
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

/** Registries the wizard offers for the dsh install, in menu order. */
export const REGISTRY_OPTIONS: readonly { id: 'official' | 'mirror'; url: string }[] = [
  { id: 'official', url: 'https://registry.npmjs.org' },
  { id: 'mirror', url: 'https://registry.npmmirror.com' },
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
    await fetch(`${url}/-/ping`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
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
