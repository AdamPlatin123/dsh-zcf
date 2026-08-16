import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import { credentialsPath, ensureHomeDirectory, isValidRef, maskKey, readCredentials, writeCredentials } from '../src/credentials.ts'

const tempHomes: string[] = []

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dzcf-credentials-'))
  tempHomes.push(home)
  return home
}

afterEach(async () => {
  await Promise.all(tempHomes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

describe('readCredentials', () => {
  it('reads an absent document as an empty store', () => {
    expect(readCredentials(join(tmpdir(), 'dzcf-absent-home'))).toEqual({})
  })

  it('reads a mapping document', async () => {
    const home = await tempHome()
    await writeFile(credentialsPath(home), 'DEEPSEEK_API_KEY: sk-one\nOPENAI_API_KEY: sk-two\n')
    expect(readCredentials(home)).toEqual({ DEEPSEEK_API_KEY: 'sk-one', OPENAI_API_KEY: 'sk-two' })
  })

  it('rejects a list-root document, naming the file', async () => {
    const home = await tempHome()
    await writeFile(credentialsPath(home), '- DEEPSEEK_API_KEY\n')
    expect(() => readCredentials(home)).toThrow(/must be a YAML mapping/)
    expect(() => readCredentials(home)).toThrow(credentialsPath(home))
  })

  it('rejects a non-identifier reference', async () => {
    const home = await tempHome()
    await writeFile(credentialsPath(home), '"bad key": sk-x\n')
    expect(() => readCredentials(home)).toThrow(/invalid reference/)
  })

  it('rejects a non-string value', async () => {
    const home = await tempHome()
    await writeFile(credentialsPath(home), 'DEEPSEEK_API_KEY: 42\n')
    expect(() => readCredentials(home)).toThrow(/non-empty string/)
  })

  it('rejects an empty-string value', async () => {
    const home = await tempHome()
    await writeFile(credentialsPath(home), "DEEPSEEK_API_KEY: ''\n")
    expect(() => readCredentials(home)).toThrow(/non-empty string/)
  })
})

describe('writeCredentials', () => {
  it('writes a fresh document with owner-only modes and parses it back', async () => {
    const home = await tempHome()
    await writeCredentials(home, { DEEPSEEK_API_KEY: 'sk-new' })
    expect(readCredentials(home)).toEqual({ DEEPSEEK_API_KEY: 'sk-new' })
    if (process.platform !== 'win32') {
      const fileMode = (await stat(credentialsPath(home))).mode & 0o777
      const dirMode = (await stat(home)).mode & 0o777
      expect(fileMode).toBe(0o600)
      expect(dirMode).toBe(0o700)
    }
  })

  it('merges entries and preserves untouched references', async () => {
    const home = await tempHome()
    await writeCredentials(home, { OPENAI_API_KEY: 'sk-openai' })
    await writeCredentials(home, { DEEPSEEK_API_KEY: 'sk-deepseek' })
    expect(readCredentials(home)).toEqual({ OPENAI_API_KEY: 'sk-openai', DEEPSEEK_API_KEY: 'sk-deepseek' })
  })

  it('stores the base-url entry beside the key', async () => {
    const home = await tempHome()
    await writeCredentials(home, { DEEPSEEK_API_KEY: 'sk-deepseek', DEEPSEEK_BASE_URL: 'https://relay.example.com' })
    const document = await readFile(credentialsPath(home), 'utf8')
    expect(yaml.load(document)).toEqual({ DEEPSEEK_API_KEY: 'sk-deepseek', DEEPSEEK_BASE_URL: 'https://relay.example.com' })
  })

  it('refuses an invalid reference before touching the file', async () => {
    const home = await tempHome()
    await expect(writeCredentials(home, { 'bad key': 'sk-x' })).rejects.toThrow(/invalid credential reference/)
    expect(readCredentials(home)).toEqual({})
  })

  it('refuses an empty value before touching the file', async () => {
    const home = await tempHome()
    await expect(writeCredentials(home, { DEEPSEEK_API_KEY: '' })).rejects.toThrow(/empty value/)
    expect(readCredentials(home)).toEqual({})
  })
})

describe('helpers', () => {
  it('validates POSIX identifier references', () => {
    expect(isValidRef('DEEPSEEK_API_KEY')).toBe(true)
    expect(isValidRef('_UNDERSCORED_1')).toBe(true)
    expect(isValidRef('bad key')).toBe(false)
    expect(isValidRef('1starts-with-digit')).toBe(false)
    expect(isValidRef('has-dash')).toBe(false)
  })

  it('masks keys with a recognizable tail', () => {
    expect(maskKey('sk-abcdefghijk')).toBe('sk-***hijk')
    expect(maskKey('sk-short')).toBe('sk***')
  })
})

describe('ensureHomeDirectory', () => {
  it('creates the home owner-only when missing', async () => {
    const home = await tempHome()
    const nested = join(home, 'nested', 'deeper')
    await ensureHomeDirectory(nested)
    if (process.platform !== 'win32') {
      expect((await stat(nested)).mode & 0o777).toBe(0o700)
    }
  })
})
