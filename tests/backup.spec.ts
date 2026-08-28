import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { backupExistingState, KEEP_BACKUPS } from '../src/backup.ts'

const tempHomes: string[] = []

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dzcf-backup-'))
  tempHomes.push(home)
  return home
}

afterEach(async () => {
  await Promise.all(tempHomes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

describe('backupExistingState', () => {
  it('reports nothing to do on a fresh machine', async () => {
    const home = await tempHome()
    const result = await backupExistingState(home, 'dzcf')
    expect(result.dir).toBeUndefined()
    expect(result.lines).toEqual([])
  })

  it('snapshots credentials and the profile configuration files with a restore note', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, '.credentials.yaml'), 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-old\n', { mode: 0o600 })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), '{"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","dsh-spend"]}}}')
    await writeFile(join(home, 'profiles', 'dzcf', 'cordis.patch.yml'), '[]')
    const result = await backupExistingState(home, 'dzcf')
    expect(result.dir).toBeDefined()
    expect(result.lines).toContain('.credentials.yaml')
    expect(result.lines).toContain('profiles/dzcf/package.json')
    expect(result.lines).toContain('profiles/dzcf/cordis.patch.yml')
    expect(await readFile(join(result.dir as string, 'credentials', '.credentials.yaml'), 'utf8')).toContain('sk-old')
    expect(await readFile(join(result.dir as string, 'profiles', 'dzcf', 'package.json'), 'utf8')).toContain('dsh-spend')
    const note = await readFile(join(result.dir as string, 'RESTORE.md'), 'utf8')
    expect(note).toContain('.credentials.yaml')
    expect(note).toContain('profiles/dzcf/package.json')
  })

  it('keeps only the newest snapshots', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, '.credentials.yaml'), 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-1\n')
    const root = join(home, '.zcf', 'backups')
    await mkdir(root, { recursive: true })
    // Forge more than the retention count with older, sortable stamps.
    for (let i = 0; i < KEEP_BACKUPS + 1; i += 1) {
      await mkdir(join(root, `20200101-0000${String(i).padStart(2, '0')}-dzcf`), { recursive: true })
    }
    const result = await backupExistingState(home, 'dzcf')
    expect(result.dir).toBeDefined()
    const names = (await readdir(root)).sort()
    expect(names.length).toBe(KEEP_BACKUPS)
    // The forged oldest ones are gone; the fresh timestamped one survived.
    expect(names).not.toContain('20200101-000000-dzcf')
    expect(names.at(-1)).toBe(join(result.dir as string).split('/').at(-1))
  })
})
