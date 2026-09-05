import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { whichOnPath, windowsSpawnArgs } from '../src/exec.ts'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dzcf-exec-'))
  tempDirs.push(dir)
  return dir
}

describe('windowsSpawnArgs', () => {
  it('assembles the command into one verbatim /c line', () => {
    const wrapped = windowsSpawnArgs('npm', ['install', '--global', 'dsh-zcf@0.5.5', '--registry=https://registry.npmjs.org'])
    expect(wrapped.file).toBe('cmd.exe')
    // One /c operand holding the whole line, no outer quotes: Node's argv
    // serialization must never re-quote it (cmd cannot parse \" escapes).
    expect(wrapped.argv).toEqual(['/d', '/s', '/c', 'npm install --global dsh-zcf@0.5.5 --registry=https://registry.npmjs.org'])
  })

  it('quotes only the arguments that contain spaces', () => {
    const wrapped = windowsSpawnArgs('npm', ['install', '--prefix', 'C:\\Users\\Adam Smith\\.zcf\\pnpm10', 'pnpm@10'])
    expect(wrapped.argv[3]).toBe('npm install --prefix "C:\\Users\\Adam Smith\\.zcf\\pnpm10" pnpm@10')
  })

  it.each(['&', '|', '<', '>', '^', '%VAR%', '!', '"quoted"'])('rejects cmd metacharacters in arguments (%s)', (poison) => {
    expect(() => windowsSpawnArgs('npm', [`--note=${poison}`])).toThrow(/metacharacter/)
  })

  it('rejects metacharacters in the command itself', () => {
    expect(() => windowsSpawnArgs('npm & whoami', [])).toThrow(/metacharacter/)
  })
})

describe('whichOnPath', () => {
  it('finds a bare executable on a POSIX-style PATH', async () => {
    const dir = await tempDir()
    const bin = join(dir, 'dsh')
    await writeFile(bin, '#!/bin/sh\n', { mode: 0o755 })
    expect(whichOnPath('dsh', `${dir}${delimiter}/nonexistent`, undefined, 'linux')).toBe(bin)
  })

  it('skips a file without the executable bit on POSIX', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'dsh'), '#!/bin/sh\n', { mode: 0o644 })
    expect(whichOnPath('dsh', dir, undefined, 'linux')).toBeUndefined()
  })

  it('tries PATHEXT extensions in order on Windows', async () => {
    const dir = await tempDir()
    // Lowercase everywhere: the host filesystem in tests is case-sensitive,
    // while a real Windows one is not — the lookup logic is case-agnostic.
    await writeFile(join(dir, 'dsh.cmd'), '@node "x" %*', { mode: 0o644 })
    expect(whichOnPath('dsh', dir, '.com;.exe;.cmd', 'win32')).toBe(join(dir, 'dsh.cmd'))
  })

  it('honors an explicit extension without re-appending PATHEXT', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'dsh.exe'), '', { mode: 0o644 })
    expect(whichOnPath('dsh.exe', dir, '.COM;.EXE;.CMD', 'win32')).toBe(join(dir, 'dsh.exe'))
  })

  it('walks PATH directories in order and returns the first hit', async () => {
    const first = await tempDir()
    const second = await tempDir()
    await writeFile(join(first, 'pnpm'), '', { mode: 0o755 })
    await writeFile(join(second, 'pnpm'), '', { mode: 0o755 })
    expect(whichOnPath('pnpm', `${first}${delimiter}${second}`, undefined, 'linux')).toBe(join(first, 'pnpm'))
  })

  it('falls back to the default PATHEXT list on Windows', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'nested'), { recursive: true })
    await chmod(join(dir, 'nested'), 0o755)
    // pathExt omitted: .CMD is part of the built-in default, so dsh.cmd is found.
    await writeFile(join(dir, 'dsh.cmd'), '@node "x" %*', { mode: 0o644 })
    expect(whichOnPath('dsh', dir, undefined, 'win32')).toBe(join(dir, 'dsh.cmd'))
  })

  it('returns undefined for an empty name or empty PATH', () => {
    expect(whichOnPath('', 'whatever', undefined, 'linux')).toBeUndefined()
    expect(whichOnPath('dsh', '', undefined, 'linux')).toBeUndefined()
  })
})
