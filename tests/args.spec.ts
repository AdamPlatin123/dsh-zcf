import { describe, expect, it, vi } from 'vitest'
import { CommanderError } from 'commander'
import { parseDzcfArgs } from '../src/args.ts'

const parse = (argv: readonly string[]) => parseDzcfArgs(argv, '0.0.1-rc.2')

function exitCode(argv: readonly string[]): number {
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  try {
    parse(argv)
    throw new Error('expected an exit')
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode
    throw error
  } finally {
    exit.mockRestore()
  }
}

describe('parseDzcfArgs', () => {
  it('defaults to the menu flow with no options', () => {
    expect(parse([])).toEqual({ action: 'menu', with: [], plugins: [], lang: 'zh-CN', yes: false, dryRun: false })
  })

  it('maps the positional actions', () => {
    expect(parse(['i']).action).toBe('init')
    expect(parse(['c']).action).toBe('configure')
    expect(parse(['k']).action).toBe('credentials')
    expect(parse(['init']).action).toBe('init')
  })

  it('collects every non-interactive flag', () => {
    const options = parse(['i', '--key', 'sk-test', '--base-url', 'https://relay.example.com', '--mode', 'web', '--profile', 'my', '--with', 'exa,terminal', '--mcp-command', 'npx x', '--plugin', 'dsh-lens,dsh-spend', '--registry', 'https://registry.npmmirror.com', '--lang', 'en', '--yes', '--dry-run'])
    expect(options).toEqual({
      action: 'init',
      key: 'sk-test',
      baseUrl: 'https://relay.example.com',
      mode: 'web',
      profile: 'my',
      with: ['exa', 'terminal'],
      mcpCommand: 'npx x',
      plugins: ['dsh-lens', 'dsh-spend'],
      registry: 'https://registry.npmmirror.com',
      lang: 'en',
      yes: true,
      dryRun: true,
    })
  })

  it('deduplicates the --with list', () => {
    expect(parse(['i', '--with', 'exa,terminal,exa']).with).toEqual(['exa', 'terminal'])
  })

  it('rejects an unknown --with id with exit code 1', () => {
    expect(exitCode(['i', '--with', 'exa,bogus'])).toBe(1)
  })

  it('rejects an unknown mode with exit code 1', () => {
    expect(exitCode(['--mode', 'headless'])).toBe(1)
  })

  it('rejects an unknown language with exit code 1', () => {
    expect(exitCode(['--lang', 'ja-JP'])).toBe(1)
  })

  it('rejects a non-URL --registry with exit code 1', () => {
    expect(exitCode(['--registry', 'npmmirror'])).toBe(1)
  })

  it('rejects an unknown action with exit code 1', () => {
    expect(exitCode(['remove'])).toBe(1)
  })

  it('prints help and exits 0', () => {
    expect(exitCode(['--help'])).toBe(0)
  })

  it('prints the version and exits 0', () => {
    expect(exitCode(['-V'])).toBe(0)
  })
})
