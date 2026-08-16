import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import { capabilityOf } from '../src/capabilities.ts'
import type { RunFn, RunResult } from '../src/exec.ts'
import { installCapability, profilePatchPath, readPatchRows } from '../src/profile.ts'

const tempHomes: string[] = []

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dzcf-profile-'))
  tempHomes.push(home)
  return home
}

afterEach(async () => {
  await Promise.all(tempHomes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

function recordingRun(overrides: Readonly<Record<string, RunResult>> = {}): { run: RunFn; calls: string[][] } {
  const calls: string[][] = []
  const run: RunFn = (command, args) => {
    calls.push([command, ...args])
    const key = args.join(' ')
    if (overrides[key] !== undefined) return overrides[key]
    return { status: 0, stdout: '', stderr: '' }
  }
  return { run, calls }
}

type Capability = NonNullable<ReturnType<typeof capabilityOf>>

describe('installCapability', () => {
  it('runs dsh plugin add for each package and writes the patch rows', async () => {
    const home = await tempHome()
    const { run, calls } = recordingRun()
    await installCapability(run, home, 'my', capabilityOf('lsp') as Capability)
    expect(calls).toContainEqual(['dsh', 'plugin', '--profile', 'my', 'add', '-w', '@deepseek-ai/dsh-lsp'])
    expect(calls).toContainEqual(['dsh', 'plugin', '--profile', 'my', 'add', '-w', '@deepseek-ai/dsh-lsp-stdio'])
    expect(calls).toContainEqual(['dsh', 'plugin', '--profile', 'my', 'add', '-w', '@deepseek-ai/dsh-tool-lsp'])

    const rows = readPatchRows(home, 'my') as Array<{ id: string }>
    expect(rows.map(row => row.id)).toEqual(['lsp', 'lsp-stdio', 'tool-lsp'])
  })

  it('disables a replaced bundle row', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'my'), { recursive: true })
    await writeFile(profilePatchPath(home, 'my'), '- id: session-persistence-jsonl\n  name: "@deepseek-ai/dsh-session-persistence-jsonl"\n', { mode: 0o600 })
    const { run } = recordingRun()
    await installCapability(run, home, 'my', capabilityOf('sqlite') as Capability)
    const rows = readPatchRows(home, 'my') as Array<{ id: string; disabled?: boolean; name?: string }>
    expect(rows.find(row => row.id === 'session-persistence-jsonl')?.disabled).toBe(true)
    expect(rows.find(row => row.id === 'session-persistence-sqlite')?.name).toBe('@deepseek-ai/dsh-session-persistence-sqlite')
  })

  it('is idempotent: re-installing does not duplicate rows', async () => {
    const home = await tempHome()
    const { run } = recordingRun()
    await installCapability(run, home, 'my', capabilityOf('terminal') as Capability)
    await installCapability(run, home, 'my', capabilityOf('terminal') as Capability)
    const rows = readPatchRows(home, 'my') as Array<{ id: string }>
    expect(rows.filter(row => row.id === 'tool-terminal')).toHaveLength(1)
  })

  it('injects the MCP command into the row config', async () => {
    const home = await tempHome()
    const { run } = recordingRun()
    const mcp = capabilityOf('mcp') as Capability
    await installCapability(run, home, 'my', { ...mcp, rows: [{ id: 'mcp-1', name: '@deepseek-ai/dsh-mcp-client', config: { command: 'npx -y x' } }] })
    const rows = readPatchRows(home, 'my') as Array<{ id: string; config?: { command?: string } }>
    expect(rows.find(row => row.id === 'mcp-1')?.config).toEqual({ command: 'npx -y x' })
  })

  it('fails loud when dsh plugin add exits nonzero', async () => {
    const home = await tempHome()
    const { run } = recordingRun({
      'plugin --profile my add -w @deepseek-ai/dsh-lsp': { status: 1, stdout: '', stderr: 'boom' },
    })
    await expect(installCapability(run, home, 'my', capabilityOf('lsp') as Capability)).rejects.toThrow(/dsh plugin add @deepseek-ai\/dsh-lsp failed/)
  })

  it('round-trips YAML through js-yaml', async () => {
    const home = await tempHome()
    const { run } = recordingRun()
    await installCapability(run, home, 'my', capabilityOf('terminal') as Capability)
    const text = await readFile(profilePatchPath(home, 'my'), 'utf8')
    expect(Array.isArray(yaml.load(text))).toBe(true)
  })
})
