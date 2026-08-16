import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { envFilePath, parseEnvFile, readEnvFile, renderEnvFile, writeEnvFile } from '../src/dotenv.ts'

const tempHomes: string[] = []

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dzcf-env-'))
  tempHomes.push(home)
  return home
}

afterEach(async () => {
  await Promise.all(tempHomes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

describe('parseEnvFile', () => {
  it('parses key=value lines and skips comments/blank lines', () => {
    expect(parseEnvFile('# comment\nEXA_API_KEY=sk-a\nEMPTY=\n')).toEqual({ EXA_API_KEY: 'sk-a' })
  })

  it('strips surrounding quotes', () => {
    expect(parseEnvFile('A="x"\nB=\'y\'\n')).toEqual({ A: 'x', B: 'y' })
  })
})

describe('renderEnvFile', () => {
  it('quotes values containing spaces', () => {
    expect(renderEnvFile({ EXA_API_KEY: 'sk-a', CMD: 'npx -y x' })).toBe('EXA_API_KEY=sk-a\nCMD=\'npx -y x\'\n')
  })
})

describe('writeEnvFile', () => {
  it('creates the file owner-only and merges untouched entries', async () => {
    const home = await tempHome()
    await writeEnvFile(home, { EXA_API_KEY: 'sk-exa' })
    await writeEnvFile(home, { PERPLEXITY_API_KEY: 'sk-perp' })
    expect(readEnvFile(home)).toEqual({ EXA_API_KEY: 'sk-exa', PERPLEXITY_API_KEY: 'sk-perp' })
    if (process.platform !== 'win32') {
      expect((await stat(envFilePath(home))).mode & 0o777).toBe(0o600)
    }
  })

  it('replaces an existing key', async () => {
    const home = await tempHome()
    await writeEnvFile(home, { EXA_API_KEY: 'sk-old' })
    await writeEnvFile(home, { EXA_API_KEY: 'sk-new' })
    const text = await readFile(envFilePath(home), 'utf8')
    expect(text).toBe('EXA_API_KEY=sk-new\n')
  })
})
