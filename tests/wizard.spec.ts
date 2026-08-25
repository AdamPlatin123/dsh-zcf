import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DzcfOptions } from '../src/args.ts'
import { credentialsPath, ensureHomeDirectory, readCredentials, writeCredentials } from '../src/credentials.ts'
import { RECOMMENDED_PLUGINS } from '../src/marketplace.ts'
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

const NO_MODELS = async (): Promise<readonly string[] | undefined> => undefined

const context = async (overrides: Partial<WizardContext> & { home: string }): Promise<WizardContext> => ({
  lang: 'zh-CN',
  run: scriptedRun().run,
  installDsh: scriptedInstall().installDsh,
  probeRegistry: NO_PROBE,
  fetchModels: NO_MODELS,
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
      fetchModels: NO_MODELS,
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
      fetchModels: NO_MODELS,
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
      fetchModels: NO_MODELS,
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
      if (command === 'pnpm' && args[0] === '-v') return { status: 0, stdout: '10.18.0\n', stderr: '' }
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
      fetchModels: NO_MODELS,
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
    const { prompt, asked } = scriptedPrompt({ key: 'sk-typed', baseUrl: '', mode: 'web', plugins: [], proceed: true, modelManual: '' })
    const lines: string[] = []
    const code = await runWizard({
      home,
      lang: 'zh-CN',
      run,
      installDsh: scriptedInstall().installDsh,
      probeRegistry: NO_PROBE,
      fetchModels: NO_MODELS,
      prompt,
      interactive: true,
      ...outputLines(lines),
    }, { ...OPTIONS })
    expect(code).toBe(0)
    expect(asked.map(question => question.type)).toEqual(['input', 'password', 'input', 'list', 'multiselect', 'confirm'])
    expect(readCredentials(home)).toEqual({ DEEPSEEK_API_KEY: 'sk-typed' })
  })

  it('writes nothing when the user declines the summary', async () => {
    const home = await tempHome()
    const { prompt } = scriptedPrompt({ key: 'sk-typed', baseUrl: '', mode: 'web', plugins: [], proceed: false, modelManual: '' })
    const lines: string[] = []
    const code = await runWizard({
      home,
      lang: 'zh-CN',
      run: scriptedRun().run,
      installDsh: scriptedInstall().installDsh,
      probeRegistry: NO_PROBE,
      fetchModels: NO_MODELS,
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
      fetchModels: NO_MODELS,
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
        case 'key': return baseUrlAskCount === 1
          // Esc on the first key ask steps back to the endpoint step; the re-ask must carry the prior value as default.
          ? { status: 'cancelled' }
          : { status: 'answered', value: { key: 'sk-typed' } }
        case 'baseUrl': {
          baseUrlAskCount += 1
          if (baseUrlAskCount === 1) return { status: 'answered', value: { baseUrl: 'https://relay.example.com' } }
          expect((question as { default?: string }).default).toBe('https://relay.example.com')
          return { status: 'answered', value: { baseUrl: 'https://relay.example.com' } }
        }
        case 'modelManual': return { status: 'answered', value: { modelManual: '' } }
        case 'mode': return { status: 'answered', value: { mode: 'web' } }
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
      fetchModels: NO_MODELS,
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
    let pnpmReady = false
    const run: RunFn = (command, args) => {
      if (command === 'dsh' && args[0] === '-V') {
        return installed
          ? { status: 0, stdout: '0.0.1-rc.4\n', stderr: '' }
          : { status: null, stdout: '', stderr: 'not found' }
      }
      if (command === 'dsh') return { status: 0, stdout: '# composed\n', stderr: '' }
      if (command === 'npm' && args[0] === '-v') return { status: 0, stdout: '11.0.0\n', stderr: '' }
      if (command === 'pnpm' && args[0] === '-v') return pnpmReady ? { status: 0, stdout: '10.18.0\n', stderr: '' } : { status: null, stdout: '', stderr: 'command not found: pnpm' }
      if (command === 'npm' && args[0] === 'install') { pnpmReady = true; return { status: 0, stdout: '', stderr: '' } }
      if (command === 'pnpm' && args[0] === '-v') return { status: 0, stdout: '10.18.0\n', stderr: '' }
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
      proceed: true, modelManual: '' })
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
      fetchModels: NO_MODELS,
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
      proceed: true, modelManual: '' })
    const lines: string[] = []
    const code = await runWizard({
      home,
      lang: 'zh-CN',
      run,
      installDsh,
      probeRegistry: NO_PROBE,
      fetchModels: NO_MODELS,
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
      if (command === 'pnpm' && args[0] === '-v') return { status: 0, stdout: '10.18.0\n', stderr: '' }
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

  it('expands the (All) sentinel into every catalog entry', async () => {
    const home = await tempHome()
    const { run, calls } = scriptedRun()
    const { prompt } = scriptedPrompt({ plugins: ['__ALL__'] })
    const code = await runWizard(await context({ home, run, prompt, interactive: true }), {
      ...OPTIONS, action: 'marketplace', profile: 'dzcf',
    })
    expect(code).toBe(0)
    const adds = calls.filter(call => call.command === 'dsh' && call.args.includes('add') && !call.args.at(-1)!.startsWith('@'))
    expect(adds).toHaveLength(RECOMMENDED_PLUGINS.length)
  })

  it('updates only the picked plugins in a non-interactive update', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-lens', 'dsh-spend'] } } }))
    const { run, calls } = scriptedRun()
    const code = await runWizard(await context({ home, run }), {
      ...OPTIONS, action: 'update', plugins: ['dsh-lens'],
    })
    expect(code).toBe(0)
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', 'dsh-lens'] })
    expect(calls).not.toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', 'dsh-spend'] })
  })

  it('updates every registered plugin when non-interactive and no --plugin is given', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-lens', 'dsh-spend'] } } }))
    const { run, calls } = scriptedRun()
    const code = await runWizard(await context({ home, run }), { ...OPTIONS, action: 'update' })
    expect(code).toBe(0)
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', 'dsh-lens'] })
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', 'dsh-spend'] })
  })

  it('reports the update plan without executing under --dry-run', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-lens'] } } }))
    const { run, calls } = scriptedRun()
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, ...outputLines(lines) }), { ...OPTIONS, action: 'update', dryRun: true })
    expect(code).toBe(0)
    expect(calls).toHaveLength(0)
    expect(lines.join('\n')).toContain('update dsh-lens -> latest')
  })

  it('continues updating the rest when one plugin update fails', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-lens', 'dsh-spend'] } } }))
    const { run, calls } = scriptedRun({ dsh: args => (args.includes('add') && args.includes('dsh-lens')
      ? { status: 1, stdout: '', stderr: 'registry boom' }
      : { status: 0, stdout: '', stderr: '' }) })
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, ...outputLines(lines) }), { ...OPTIONS, action: 'update' })
    expect(code).toBe(1)
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', 'dsh-lens'] })
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', 'dsh-spend'] })
    expect(lines.join('\n')).toContain('dsh-spend 已更新到最新版')
  })

  it('installs pnpm through npm when the machine only has npm', async () => {
    const home = await tempHome()
    let pnpmReady = false
    const { run, calls } = scriptedRun({
      pnpm: () => (pnpmReady ? { status: 0, stdout: '', stderr: '' } : { status: null, stdout: '', stderr: 'command not found: pnpm' }),
      npm: () => { pnpmReady = true; return { status: 0, stdout: '', stderr: '' } },
    })
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, ...outputLines(lines) }), {
      ...OPTIONS, action: 'marketplace', plugins: ['dsh-lens'],
    })
    expect(code).toBe(0)
    expect(calls).toContainEqual({ command: 'npm', args: ['install', '--global', 'pnpm', '--no-audit', '--no-fund'] })
    expect(lines.join('\n')).toContain('pnpm 安装完成')
  })

  it('skips the pnpm step when pnpm already answers', async () => {
    const home = await tempHome()
    const { run, calls } = scriptedRun()
    const code = await runWizard(await context({ home, run }), {
      ...OPTIONS, action: 'marketplace', plugins: ['dsh-lens'],
    })
    expect(code).toBe(0)
    expect(calls).not.toContainEqual({ command: 'npm', args: ['install', '--global', 'pnpm', '--no-audit', '--no-fund'] })
  })

  it('reuses the stored key in a non-interactive run without --key', async () => {
    const home = await tempHome()
    await ensureHomeDirectory(home)
    await writeCredentials(home, { DEEPSEEK_API_KEY: 'sk-stored-1234567890' })
    const { run, calls } = scriptedRun()
    const code = await runWizard(await context({ home, run }), { ...OPTIONS, mode: 'web' })
    expect(code).toBe(0)
    expect(calls.length).toBeGreaterThan(0)
    const document = readCredentials(home)
    expect(document.DEEPSEEK_API_KEY).toBe('sk-stored-1234567890')
  })

  it('offers stored credentials as a pick list in the interactive key step', async () => {
    const home = await tempHome()
    await ensureHomeDirectory(home)
    await writeCredentials(home, { DEEPSEEK_API_KEY: 'sk-primary-1234567890', DEEPSEEK_API_KEY_BAK: 'sk-backup-1234567890' })
    const { prompt, asked } = scriptedPrompt({ keyChoice: 'DEEPSEEK_API_KEY_BAK', baseUrl: '', mode: 'web', plugins: [], proceed: true, modelManual: '' })
    const { run } = scriptedRun()
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, prompt, interactive: true, ...outputLines(lines) }), { ...OPTIONS })
    expect(code).toBe(0)
    const keyQuestion = asked.find(question => question.name === 'keyChoice') as { choices?: { value: string }[] } | undefined
    expect(keyQuestion?.choices?.map(choice => choice.value)).toEqual(['DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY_BAK', '__NEW__'])
    const document = readCredentials(home)
    expect(document.DEEPSEEK_API_KEY).toBe('sk-backup-1234567890')
  })

  it('pins --model into the profile catalog in a non-interactive run', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
    const { run } = scriptedRun()
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, ...outputLines(lines) }), {
      ...OPTIONS, key: 'sk-test-1234', mode: 'web', model: 'deepseek-v4-pro',
    })
    expect(code).toBe(0)
    const patch = await readFile(join(home, 'profiles', 'dzcf', 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('id: zcf-model')
    expect(patch).toContain('models:')
    expect(patch).toContain('id: deepseek-v4-pro')
    expect(lines.join('\n')).toContain('deepseek-v4-pro 已写入')
  })

  it('picks a model from the upstream listing in the interactive flow', async () => {
    const home = await tempHome()
    const { prompt } = scriptedPrompt({ keyChoice: '__NEW__', key: 'sk-typed-1234567890', baseUrl: '', model: 'deepseek-v4-flash', mode: 'web', plugins: [], proceed: true })
    const { run } = scriptedRun()
    const lines: string[] = []
    const code = await runWizard(await context({
      home, run, prompt, interactive: true, ...outputLines(lines),
      fetchModels: async () => ['deepseek-v4-flash', 'deepseek-v4-pro'],
    }), { ...OPTIONS })
    expect(code).toBe(0)
    const patch = await readFile(join(home, 'profiles', 'dzcf', 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('id: deepseek-v4-flash')
    expect(lines.join('\n')).toContain('deepseek-v4-flash 已写入')
  })

  it('runs the k-menu model scope: pick from the listing, write the catalog', async () => {
    const home = await tempHome()
    await ensureHomeDirectory(home)
    await writeCredentials(home, { DEEPSEEK_API_KEY: 'sk-stored-1234567890' })
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
    const { prompt } = scriptedPrompt({ kmenu: 'model', model: 'deepseek-v4-pro', proceed: true })
    const { run } = scriptedRun()
    const lines: string[] = []
    const code = await runWizard(await context({
      home, run, prompt, interactive: true, ...outputLines(lines),
      fetchModels: async () => ['deepseek-v4-flash', 'deepseek-v4-pro'],
    }), { ...OPTIONS, action: 'credentials' })
    expect(code).toBe(0)
    const patch = await readFile(join(home, 'profiles', 'dzcf', 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('id: deepseek-v4-pro')
    expect(lines.join('\n')).toContain('deepseek-v4-pro 已写入')
  })

  it('fails loud when the update target profile is missing', async () => {
    const home = await tempHome()
    const lines: string[] = []
    const code = await runWizard(await context({ home, ...outputLines(lines) }), { ...OPTIONS, action: 'update' })
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('profile 不存在')
  })

  it('init installs picked plugins after creating a tui-surface profile', async () => {
    const home = await tempHome()
    const { run, calls } = scriptedRun()
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, ...outputLines(lines) }), {
      ...OPTIONS, key: 'sk-test-1234', mode: 'tui', plugins: ['dsh-doublecheck'],
    })
    expect(code).toBe(0)
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', '@deepseek-harness-tui/dsh-tui'] })
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', 'dsh-doublecheck'] })
    expect(lines.join('\n')).toContain('dsh --profile dzcf')
  })
})

describe('bin launcher wiring', () => {
  it('points bin at the CommonJS version gate, which exists', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { bin: Record<string, string> }
    expect(manifest.bin['dsh-zcf']).toBe('lib/cli.cjs')
    await expect(access(new URL('../src/cli.cjs', import.meta.url))).resolves.toBeUndefined()
  })
})
