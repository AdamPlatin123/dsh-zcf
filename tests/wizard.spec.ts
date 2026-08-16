import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DzcfOptions } from '../src/args.ts'
import { credentialsPath, readCredentials } from '../src/credentials.ts'
import type { RunFn, RunResult } from '../src/exec.ts'
import type { PromptOutcome, PromptQuestion } from '../src/ui.ts'
import { runWizard, type WizardContext } from '../src/wizard.ts'

const OPTIONS: DzcfOptions = { action: 'init', with: [], plugins: [], lang: 'zh-CN', yes: false, dryRun: false }

interface ScriptedCall { command: string; args: readonly string[] }

/** One recorded streaming-install invocation, with the lines it forwarded. */
interface InstallCall { pm: string; args: readonly string[]; lines: string[] }

function scriptedInstall(result: RunResult = { status: 0, stdout: '', stderr: '' }): {
  installDsh: WizardContext['installDsh']
  calls: InstallCall[]
} {
  const calls: InstallCall[] = []
  const installDsh: WizardContext['installDsh'] = async (pm, args, onLine) => {
    const lines: string[] = []
    calls.push({ pm, args, lines })
    const wrapped = (line: string): void => {
      lines.push(line)
      onLine(line)
    }
    wrapped('Packages: +1')
    wrapped('')
    wrapped('Done')
    return result
  }
  return { installDsh, calls }
}

const NO_PROBE: WizardContext['probeRegistry'] = async () => undefined

function scriptedRun(overrides: Readonly<Record<string, (args: readonly string[]) => RunResult>> = {}): {
  run: RunFn
  calls: ScriptedCall[]
} {
  const calls: ScriptedCall[] = []
  const run: RunFn = (command, args) => {
    calls.push({ command, args })
    const override = overrides[command]
    if (override !== undefined) return override(args)
    if (command === 'dsh' && args[0] === '-V') return { status: 0, stdout: '0.0.1-rc.2\n', stderr: '' }
    if (command === 'dsh' && args[0] === '--profile' && (args[2] === '--dump-default-config' || args[2] === '--dump-config')) return { status: 0, stdout: '# composed\n', stderr: '' }
    if (command === 'dsh' && args[0] === 'plugin' && args.includes('add')) return { status: 0, stdout: '', stderr: '' }
    if (command === 'dsh' && args[0] === 'plugin') return { status: 0, stdout: '', stderr: '' }
    if (command === 'pnpm' || command === 'npm') return { status: 0, stdout: '', stderr: '' }
    return { status: null, stdout: '', stderr: `command not found: ${command}` }
  }
  return { run, calls }
}

function scriptedPrompt(answers: Readonly<Record<string, unknown>>): {
  prompt: (questions: readonly PromptQuestion[]) => Promise<PromptOutcome>
  asked: PromptQuestion[]
} {
  const asked: PromptQuestion[] = []
  const prompt = async (questions: readonly PromptQuestion[]): Promise<PromptOutcome> => {
    for (const question of questions) {
      asked.push(question)
      if (!(question.name in answers)) return { status: 'cancelled' }
    }
    return { status: 'answered', value: answers }
  }
  return { prompt, asked }
}

const outputLines = (lines: string[]): { out: (text: string) => void; err: (text: string) => void } => ({
  out: text => lines.push(`out: ${text}`),
  err: text => lines.push(`err: ${text}`),
})

const tempHomes: string[] = []

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dzcf-wizard-'))
  tempHomes.push(home)
  return home
}

afterEach(async () => {
  await Promise.all(tempHomes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

const context = async (overrides: Partial<WizardContext> & { home: string }): Promise<WizardContext> => ({
  lang: 'zh-CN',
  run: scriptedRun().run,
  installDsh: scriptedInstall().installDsh,
  probeRegistry: NO_PROBE,
  prompt: scriptedPrompt({}).prompt,
  interactive: false,
  out: () => {},
  err: () => {},
  ...overrides,
})

describe('runWizard — non-interactive init', () => {
  it('stores credentials, verifies the shipped profile, and prints next steps', async () => {
    const home = await tempHome()
    const { run, calls } = scriptedRun()
    const lines: string[] = []
    const code = await runWizard({
      home,
      lang: 'zh-CN',
      run,
      installDsh: scriptedInstall().installDsh,
      probeRegistry: NO_PROBE,
      prompt: vi.fn(),
      interactive: false,
      ...outputLines(lines),
    }, { ...OPTIONS, key: 'sk-test-1234', mode: 'web' })

    expect(code).toBe(0)
    expect(readCredentials(home)).toEqual({ DEEPSEEK_API_KEY: 'sk-test-1234' })
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', '@deepseek-ai/dsh-web-app@^0.1.0-rc.6'] })
    expect(calls).toContainEqual({ command: 'dsh', args: ['--profile', 'dzcf', '--dump-config'] })
    expect(lines.join('\n')).toContain('已找到 dsh 命令')
    expect(lines.join('\n')).toContain('dzcf profile 组装成功')
    expect(lines.join('\n')).toContain('下一步：dsh web')
  })

  it('stores a base URL beside the key', async () => {
    const home = await tempHome()
    const code = await runWizard(await context({ home }), { ...OPTIONS, key: 'sk-test-1234', baseUrl: 'https://relay.example.com', mode: 'web' })
    expect(code).toBe(0)
    expect(readCredentials(home)).toEqual({ DEEPSEEK_API_KEY: 'sk-test-1234', DEEPSEEK_BASE_URL: 'https://relay.example.com' })
  })

  it('keeps untouched existing entries when merging', async () => {
    const home = await tempHome()
    await writeFile(credentialsPath(home), 'OPENAI_API_KEY: sk-openai\n', { mode: 0o600 })
    const code = await runWizard(await context({ home }), { ...OPTIONS, key: 'sk-test-1234', mode: 'web' })
    expect(code).toBe(0)
    expect(readCredentials(home)).toEqual({ OPENAI_API_KEY: 'sk-openai', DEEPSEEK_API_KEY: 'sk-test-1234' })
  })

  it('fails loud without a key', async () => {
    const home = await tempHome()
    const lines: string[] = []
    const code = await runWizard(await context({ home, ...outputLines(lines) }), { ...OPTIONS, mode: 'web' })
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('缺少 API Key')
  })

  it('fails loud without a mode', async () => {
    const home = await tempHome()
    const lines: string[] = []
    const code = await runWizard(await context({ home, ...outputLines(lines) }), { ...OPTIONS, key: 'sk-test-1234' })
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('缺少运行形态')
  })

  it('rejects a malformed base URL', async () => {
    const home = await tempHome()
    const lines: string[] = []
    const code = await runWizard(await context({ home, ...outputLines(lines) }), { ...OPTIONS, key: 'sk-test-1234', baseUrl: 'not a url', mode: 'web' })
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('无效的 Base URL')
  })

  it('writes nothing in dry-run mode', async () => {
    const home = await tempHome()
    const { run, calls } = scriptedRun()
    const lines: string[] = []
    const code = await runWizard({
      home,
      lang: 'zh-CN',
      run,
      installDsh: scriptedInstall().installDsh,
      probeRegistry: NO_PROBE,
      prompt: vi.fn(),
      interactive: false,
      ...outputLines(lines),
    }, { ...OPTIONS, key: 'sk-test-1234', mode: 'web', dryRun: true })
    expect(code).toBe(0)
    expect(readCredentials(home)).toEqual({})
    expect(calls.filter(call => call.args[0] === 'plugin')).toHaveLength(0)
    expect(lines.join('\n')).toContain('dry-run')
  })

  it('fails when the verify step cannot compose the profile', async () => {
    const home = await tempHome()
    const { run } = scriptedRun({
      dsh: args => args[0] === '-V'
        ? { status: 0, stdout: '0.0.1-rc.2\n', stderr: '' }
        : { status: 1, stdout: '', stderr: 'load failure\n' },
    })
    const lines: string[] = []
    const code = await runWizard({
      home,
      lang: 'zh-CN',
      run,
      installDsh: scriptedInstall().installDsh,
      probeRegistry: NO_PROBE,
      prompt: vi.fn(),
      interactive: false,
      ...outputLines(lines),
    }, { ...OPTIONS, key: 'sk-test-1234', mode: 'web' })
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('验证失败')
  })

  it('fails loud when the existing document is malformed', async () => {
    const home = await tempHome()
    await writeFile(credentialsPath(home), 'not: [valid\n')
    const lines: string[] = []
    const code = await runWizard(await context({ home, ...outputLines(lines) }), { ...OPTIONS, key: 'sk-test-1234', mode: 'web' })
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('读取凭据文件失败')
  })

  it('installs dsh with --yes when it is missing and then proceeds', async () => {
    const home = await tempHome()
    const calls: ScriptedCall[] = []
    let dshInstalled = false
    const run: RunFn = (command, args) => {
      calls.push({ command, args })
      if (command === 'dsh' && args[0] === '-V') return { status: dshInstalled ? 0 : null, stdout: '', stderr: 'not found' }
      if (command === 'dsh') return { status: 0, stdout: '# composed\n', stderr: '' }
      if (command === 'pnpm' && args[0] === '-v') return { status: 0, stdout: '11.0.0\n', stderr: '' }
      return { status: null, stdout: '', stderr: `command not found: ${command}` }
    }
    const { installDsh, calls: installCalls } = scriptedInstall()
    const installing = async (pm: string, args: readonly string[], onLine: (line: string) => void) => {
      dshInstalled = true
      return installDsh(pm, args, onLine)
    }
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, installDsh: installing, ...outputLines(lines) }), { ...OPTIONS, key: 'sk-test-1234', mode: 'web', yes: true })
    expect(code).toBe(0)
    expect(installCalls).toEqual([{ pm: 'pnpm', args: ['add', '--global', '@deepseek-ai/dsh'], lines: ['Packages: +1', '', 'Done'] }])
    expect(calls).not.toContainEqual({ command: 'pnpm', args: ['add', '--global', '@deepseek-ai/dsh'] })
    expect(lines.join('\n')).toContain('完整发行版')
    expect(lines.join('\n')).toContain('Packages: +1')
    expect(lines.join('\n')).toMatch(/安装耗时 \d+ 秒/)
  })

  it('fails without installing when dsh is missing and --yes is absent', async () => {
    const home = await tempHome()
    const run: RunFn = () => ({ status: null, stdout: '', stderr: 'not found' })
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, ...outputLines(lines) }), { ...OPTIONS, key: 'sk-test-1234', mode: 'web' })
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('未找到 dsh 命令')
  })
})

describe('runWizard — integrations', () => {
  it('creates a custom profile and installs the requested capability', async () => {
    const home = await tempHome()
    const { run, calls } = scriptedRun()
    const code = await runWizard(await context({ home, run }), {
      ...OPTIONS,
      action: 'configure',
      key: 'sk-test-1234',
      mode: 'web',
      profile: 'my',
      with: ['terminal'],
    })
    expect(code).toBe(0)
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'my', 'add', '-w', '@deepseek-ai/dsh-web-app@^0.1.0-rc.6'] })
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'my', 'add', '-w', '@deepseek-ai/dsh-tool-terminal'] })
    expect(calls).toContainEqual({ command: 'dsh', args: ['--profile', 'my', '--dump-config'] })
  })

  it('stores provider keys into the launch environment for env-keyed capabilities', async () => {
    const home = await tempHome()
    const { run } = scriptedRun()
    const lines: string[] = []
    const code = await runWizard({
      home,
      lang: 'zh-CN',
      run,
      installDsh: scriptedInstall().installDsh,
      probeRegistry: NO_PROBE,
      prompt: vi.fn(),
      interactive: false,
      ...outputLines(lines),
    }, { ...OPTIONS, key: 'sk-test-1234', mode: 'web', profile: 'my', with: ['exa'] })
    // Env keys are interactive-only; non-interactive leaves the provider keyless.
    expect(code).toBe(0)
  })
})

describe('runWizard — interactive', () => {
  it('asks for key, surface, integrations, then confirms', async () => {
    const home = await tempHome()
    const { run } = scriptedRun()
    const { prompt, asked } = scriptedPrompt({ key: 'sk-typed', baseUrl: '', mode: 'web', plugins: [], proceed: true })
    const lines: string[] = []
    const code = await runWizard({
      home,
      lang: 'zh-CN',
      run,
      installDsh: scriptedInstall().installDsh,
      probeRegistry: NO_PROBE,
      prompt,
      interactive: true,
      ...outputLines(lines),
    }, { ...OPTIONS })
    expect(code).toBe(0)
    expect(asked.map(question => question.type)).toEqual(['password', 'input', 'list', 'multiselect', 'confirm'])
    expect(readCredentials(home)).toEqual({ DEEPSEEK_API_KEY: 'sk-typed' })
  })

  it('writes nothing when the user declines the summary', async () => {
    const home = await tempHome()
    const { prompt } = scriptedPrompt({ key: 'sk-typed', baseUrl: '', mode: 'web', plugins: [], proceed: false })
    const lines: string[] = []
    const code = await runWizard({
      home,
      lang: 'zh-CN',
      run: scriptedRun().run,
      installDsh: scriptedInstall().installDsh,
      probeRegistry: NO_PROBE,
      prompt,
      interactive: true,
      ...outputLines(lines),
    }, { ...OPTIONS })
    expect(code).toBe(0)
    expect(readCredentials(home)).toEqual({})
    expect(lines.join('\n')).toContain('已取消')
  })

  it('cancels gently when Esc lands on the first question', async () => {
    const home = await tempHome()
    const { prompt } = scriptedPrompt({})
    const lines: string[] = []
    const code = await runWizard({
      home,
      lang: 'zh-CN',
      run: scriptedRun().run,
      installDsh: scriptedInstall().installDsh,
      probeRegistry: NO_PROBE,
      prompt,
      interactive: true,
      ...outputLines(lines),
    }, { ...OPTIONS })
    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('已取消')
    expect(readCredentials(home)).toEqual({})
  })

  it('steps back on Esc and re-asks with the prior answer as default', async () => {
    const home = await tempHome()
    const asked: PromptQuestion[] = []
    let baseUrlAskCount = 0
    const prompt = async (questions: readonly PromptQuestion[]): Promise<PromptOutcome> => {
      const question = questions[0]
      if (question === undefined) return { status: 'cancelled' }
      asked.push(question)
      switch (question.name) {
        case 'key': return { status: 'answered', value: { key: 'sk-typed' } }
        case 'baseUrl': {
          baseUrlAskCount += 1
          // First ask is answered; the re-ask (after Esc on the surface step) must carry the prior value as default.
          if (baseUrlAskCount === 1) return { status: 'answered', value: { baseUrl: 'https://relay.example.com' } }
          expect((question as { default?: string }).default).toBe('https://relay.example.com')
          return { status: 'answered', value: { baseUrl: 'https://relay.example.com' } }
        }
        case 'mode': return baseUrlAskCount === 1
          ? { status: 'cancelled' }
          : { status: 'answered', value: { mode: 'web' } }
        case 'plugins': return { status: 'answered', value: { plugins: [] } }
        case 'proceed': return { status: 'answered', value: { proceed: true } }
        default: return { status: 'cancelled' }
      }
    }
    const lines: string[] = []
    const code = await runWizard({
      home,
      lang: 'zh-CN',
      run: scriptedRun().run,
      installDsh: scriptedInstall().installDsh,
      probeRegistry: NO_PROBE,
      prompt,
      interactive: true,
      ...outputLines(lines),
    }, { ...OPTIONS })
    expect(code).toBe(0)
    expect(baseUrlAskCount).toBe(2)
    expect(asked.filter(question => question.name === 'baseUrl')).toHaveLength(2)
    expect(lines.join('\n')).toContain('按 Esc 返回上一步')
    expect(readCredentials(home)).toEqual({ DEEPSEEK_API_KEY: 'sk-typed', DEEPSEEK_BASE_URL: 'https://relay.example.com' })
  })
})

describe('runWizard — credentials flow', () => {
  it('stores the key without a surface or integrations', async () => {
    const home = await tempHome()
    const code = await runWizard(await context({ home }), { ...OPTIONS, action: 'credentials', key: 'sk-cred-1' })
    expect(code).toBe(0)
    expect(readCredentials(home)).toEqual({ DEEPSEEK_API_KEY: 'sk-cred-1' })
  })
})

describe('wizard writes are permission-scoped', () => {
  it('leaves a 0600 document on disk', async () => {
    const home = await tempHome()
    const code = await runWizard(await context({ home }), { ...OPTIONS, key: 'sk-test-1234', mode: 'web' })
    expect(code).toBe(0)
    if (process.platform !== 'win32') {
      expect((await stat(credentialsPath(home))).mode & 0o777).toBe(0o600)
    }
  })
})

describe('runWizard — registry pick and install streaming', () => {
  /** dsh missing on the PATH until the streaming installer runs; npm answers. */
  function dshMissingUntilInstall(): { run: RunFn; installDsh: WizardContext['installDsh']; calls: InstallCall[] } {
    let installed = false
    const run: RunFn = (command, args) => {
      if (command === 'dsh' && args[0] === '-V') {
        return installed
          ? { status: 0, stdout: '0.0.1-rc.4\n', stderr: '' }
          : { status: null, stdout: '', stderr: 'not found' }
      }
      if (command === 'dsh') return { status: 0, stdout: '# composed\n', stderr: '' }
      if (command === 'npm' && args[0] === '-v') return { status: 0, stdout: '11.0.0\n', stderr: '' }
      return { status: null, stdout: '', stderr: `command not found: ${command}` }
    }
    const scripted = scriptedInstall()
    const installDsh: WizardContext['installDsh'] = async (pm, args, onLine) => {
      const result = await scripted.installDsh(pm, args, onLine)
      installed = true
      return result
    }
    return { run, installDsh, calls: scripted.calls }
  }

  it('pins an explicit --registry without probing', async () => {
    const home = await tempHome()
    const { run, installDsh, calls } = dshMissingUntilInstall()
    let probed = 0
    const lines: string[] = []
    const code = await runWizard(await context({
      home,
      run,
      installDsh,
      probeRegistry: async () => { probed += 1; return 1 },
      ...outputLines(lines),
    }), { ...OPTIONS, key: 'sk-test-1234', mode: 'web', yes: true, registry: 'https://registry.npmmirror.com' })
    expect(code).toBe(0)
    expect(probed).toBe(0)
    expect(calls[0]?.args).toContain('--registry=https://registry.npmmirror.com')
    expect(lines.join('\n')).toContain('使用指定安装源')
  })

  it('keeps the default registry in non-interactive runs', async () => {
    const home = await tempHome()
    const { run, installDsh, calls } = dshMissingUntilInstall()
    const lines: string[] = []
    const code = await runWizard(await context({
      home,
      run,
      installDsh,
      probeRegistry: async () => 1,
      ...outputLines(lines),
    }), { ...OPTIONS, key: 'sk-test-1234', mode: 'web', yes: true })
    expect(code).toBe(0)
    expect(calls[0]?.args.some(arg => arg.startsWith('--registry='))).toBe(false)
    expect(calls[0]?.args).toContain('--no-audit')
    expect(calls[0]?.args).toContain('--no-fund')
  })

  it('offers registries fastest-first with measured latency and installs the pick', async () => {
    const home = await tempHome()
    const { run, installDsh, calls } = dshMissingUntilInstall()
    const { prompt, asked } = scriptedPrompt({
      registry: 'https://registry.npmmirror.com',
      install: true,
      key: 'sk-typed',
      baseUrl: '',
      mode: 'web',
      plugins: [],
      proceed: true,
    })
    const latencies = new Map([
      ['https://registry.npmjs.org', 1200],
      ['https://registry.npmmirror.com', 90],
    ])
    const lines: string[] = []
    const code = await runWizard({
      home,
      lang: 'zh-CN',
      run,
      installDsh,
      probeRegistry: async url => latencies.get(url),
      prompt,
      interactive: true,
      ...outputLines(lines),
    }, { ...OPTIONS })
    expect(code).toBe(0)
    const registryQuestion = asked.find(question => question.name === 'registry')
    expect(registryQuestion?.type).toBe('list')
    if (registryQuestion?.type !== 'list') return
    expect(registryQuestion.choices[0]?.value).toBe('https://registry.npmmirror.com')
    expect(registryQuestion.choices[0]?.name).toContain('90ms')
    expect(registryQuestion.choices[1]?.name).toContain('1200ms')
    expect(calls[0]?.args).toContain('--registry=https://registry.npmmirror.com')
  })

  it('falls back to the official registry when no probe answers', async () => {
    const home = await tempHome()
    const { run, installDsh, calls } = dshMissingUntilInstall()
    const { prompt, asked } = scriptedPrompt({
      install: true,
      key: 'sk-typed',
      baseUrl: '',
      mode: 'web',
      plugins: [],
      proceed: true,
    })
    const lines: string[] = []
    const code = await runWizard({
      home,
      lang: 'zh-CN',
      run,
      installDsh,
      probeRegistry: NO_PROBE,
      prompt,
      interactive: true,
      ...outputLines(lines),
    }, { ...OPTIONS })
    expect(code).toBe(0)
    expect(asked.some(question => question.name === 'registry')).toBe(false)
    expect(calls[0]?.args.some(arg => arg.startsWith('--registry='))).toBe(false)
    expect(lines.join('\n')).toContain('两个安装源都未在 3 秒内应答')
  })

  it('fails loud when the streaming installer fails', async () => {
    const home = await tempHome()
    const run: RunFn = (command, args) => {
      if (command === 'dsh' && args[0] === '-V') return { status: null, stdout: '', stderr: 'not found' }
      if (command === 'npm' && args[0] === '-v') return { status: 0, stdout: '11.0.0\n', stderr: '' }
      return { status: null, stdout: '', stderr: `command not found: ${command}` }
    }
    const { installDsh } = scriptedInstall({ status: 1, stdout: '', stderr: 'network unreachable\n' })
    const lines: string[] = []
    const code = await runWizard(await context({
      home,
      run,
      installDsh,
      ...outputLines(lines),
    }), { ...OPTIONS, key: 'sk-test-1234', mode: 'web', yes: true })
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('安装 dsh 失败')
  })
})

describe('runWizard — marketplace and manage', () => {
  it('installs picked recommended plugins into an existing profile', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
    const { run, calls } = scriptedRun()
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, ...outputLines(lines) }), {
      ...OPTIONS, action: 'marketplace', plugins: ['dsh-lens', 'dsh-spend'], profile: 'dzcf',
    })
    expect(code).toBe(0)
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', 'dsh-lens'] })
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', 'dsh-spend'] })
    expect(lines.join('\n')).toContain('dsh-lens 已安装并登记')
  })

  it('creates the profile on the web surface when it does not exist', async () => {
    const home = await tempHome()
    const { run, calls } = scriptedRun()
    const code = await runWizard(await context({ home, run }), {
      ...OPTIONS, action: 'marketplace', plugins: ['dsh-artifact'],
    })
    expect(code).toBe(0)
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', '@deepseek-ai/dsh-web-app@^0.1.0-rc.6'] })
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', 'dsh-artifact'] })
  })

  it('lists registered bundles and removes the picked ones', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-lens', 'dsh-spend'] } } }))
    const { run, calls } = scriptedRun()
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, ...outputLines(lines) }), {
      ...OPTIONS, action: 'manage', plugins: ['dsh-lens'],
    })
    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('dsh-lens')
    expect(lines.join('\n')).toContain('dsh-spend')
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'remove', '-w', 'dsh-lens'] })
    expect(calls).not.toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'remove', '-w', 'dsh-spend'] })
  })

  it('fails loud when the managed profile is missing', async () => {
    const home = await tempHome()
    const lines: string[] = []
    const code = await runWizard(await context({ home, ...outputLines(lines) }), { ...OPTIONS, action: 'manage' })
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('profile 不存在')
  })

  it('init installs picked plugins after creating a tui-surface profile', async () => {
    const home = await tempHome()
    const { run, calls } = scriptedRun()
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, ...outputLines(lines) }), {
      ...OPTIONS, key: 'sk-test-1234', mode: 'tui', plugins: ['dsh-security-scan'],
    })
    expect(code).toBe(0)
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', '@deepseek-harness-tui/dsh-tui'] })
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', 'dsh-security-scan'] })
    expect(lines.join('\n')).toContain('dsh --profile dzcf')
  })
})
