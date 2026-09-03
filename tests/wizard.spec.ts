import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DzcfOptions } from '../src/args.ts'
import { credentialsPath, ensureHomeDirectory, readCredentials, writeCredentials } from '../src/credentials.ts'
import { RECOMMENDED_PLUGINS } from '../src/marketplace.ts'
import { writeDefaultProfile } from '../src/profile.ts'
import yaml from 'js-yaml'
import type { RunFn, RunResult } from '../src/exec.ts'
import type { PromptOutcome, PromptQuestion } from '../src/ui.ts'
import { globalShortcutReady, runWizard, type WizardContext } from '../src/wizard.ts'
import { detectDesktopPlatform } from '../src/desktop.ts'

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
    if (command === 'pnpm' || command.endsWith('/pnpm')) return { status: 0, stdout: '10.18.0\n', stderr: '' }
    if (command === 'npm') return { status: 0, stdout: '11.0.0\n', stderr: '' }
    return { status: null, stdout: '', stderr: `command not found: ${command}` }
  }
  return { run, calls }
}

function scriptedPrompt(answers: Readonly<Record<string, unknown>>): {
  prompt: (questions: readonly PromptQuestion[]) => Promise<PromptOutcome>
  asked: PromptQuestion[]
} {
  const asked: PromptQuestion[] = []
  const timesAsked = new Map<string, number>()
  const prompt = async (questions: readonly PromptQuestion[]): Promise<PromptOutcome> => {
    for (const question of questions) {
      asked.push(question)
      const times = (timesAsked.get(question.name) ?? 0) + 1
      timesAsked.set(question.name, times)
      // A scripted prompt never varies its answers, so a wizard that keeps
      // re-asking one question is looping (mock keys drifting off the real
      // question names used to do exactly this until the worker OOM'd); fail
      // with a readable cause instead.
      if (times > 50) throw new Error(`scriptedPrompt: '${question.name}' asked ${times} times — the wizard looks stuck in a loop`)
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

/** Fails the test if the app surface unexpectedly reaches the network. */
const NO_FETCH = async (): Promise<Response> => {
  throw new Error('unexpected desktop fetch in test')
}

const context = async (overrides: Partial<WizardContext> & { home: string }): Promise<WizardContext> => ({
  lang: 'zh-CN',
  run: scriptedRun().run,
  installDsh: scriptedInstall().installDsh,
  probeRegistry: NO_PROBE,
  fetchModels: NO_MODELS,
  fetchDesktop: NO_FETCH,
  runInteract: () => 127,
  which: () => undefined,
  runDetached: () => false,
  probeWeb: async () => false,
  desktopInstalled: () => false,
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
      fetchDesktop: NO_FETCH,
      runInteract: () => 127,
      which: () => undefined,
      runDetached: () => false,
      probeWeb: async () => false,
      desktopInstalled: () => false,
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
    expect(lines.join('\n')).toContain('启动 Web 界面')
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
      fetchDesktop: NO_FETCH,
      runInteract: () => 127,
      which: () => undefined,
      runDetached: () => false,
      probeWeb: async () => false,
      desktopInstalled: () => false,
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
      fetchDesktop: NO_FETCH,
      runInteract: () => 127,
      which: () => undefined,
      runDetached: () => false,
      probeWeb: async () => false,
      desktopInstalled: () => false,
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
      if ((command === 'pnpm' || command.endsWith('/pnpm')) && args[0] === '-v') return { status: 0, stdout: '10.18.0\n', stderr: '' }
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
      fetchDesktop: NO_FETCH,
      runInteract: () => 127,
      which: () => undefined,
      runDetached: () => false,
      probeWeb: async () => false,
      desktopInstalled: () => false,
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
    const { prompt, asked } = scriptedPrompt({ key: 'sk-typed', baseUrl: '', mode: 'web', plugins: [], proceed: true, modelManual: '', launchWeb: false })
    const lines: string[] = []
    const code = await runWizard({
      home,
      lang: 'zh-CN',
      run,
      installDsh: scriptedInstall().installDsh,
      probeRegistry: NO_PROBE,
      fetchModels: NO_MODELS,
      fetchDesktop: NO_FETCH,
      runInteract: () => 127,
      which: () => undefined,
      runDetached: () => false,
      probeWeb: async () => false,
      desktopInstalled: () => false,
      prompt,
      interactive: true,
      ...outputLines(lines),
    }, { ...OPTIONS })
    expect(code).toBe(0)
    expect(asked.map(question => question.type)).toEqual(['input', 'password', 'input', 'list', 'multiselect', 'confirm', 'confirm', 'confirm', 'confirm'])
    expect(readCredentials(home)).toEqual({ DEEPSEEK_API_KEY: 'sk-typed' })
    // The summary and the onboarding both bridge the two names: the surface
    // choice lands as a profile the user can start later.
    expect(lines.join('\n')).toContain('保存为 profile：dzcf')
    expect(lines.join('\n')).toContain('已保存为 profile：dzcf')
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
      fetchDesktop: NO_FETCH,
      runInteract: () => 127,
      which: () => undefined,
      runDetached: () => false,
      probeWeb: async () => false,
      desktopInstalled: () => false,
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
      fetchDesktop: NO_FETCH,
      runInteract: () => 127,
      which: () => undefined,
      runDetached: () => false,
      probeWeb: async () => false,
      desktopInstalled: () => false,
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
      fetchDesktop: NO_FETCH,
      runInteract: () => 127,
      which: () => undefined,
      runDetached: () => false,
      probeWeb: async () => false,
      desktopInstalled: () => false,
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

  it('offers stored key credentials (never the base URL) in the interactive key update and uses the picked one', async () => {
    const home = await tempHome()
    await writeCredentials(home, { DEEPSEEK_API_KEY: 'sk-primary-0001', DEEPSEEK_BASE_URL: 'https://relay.example.com', OTHER_API_KEY: 'sk-other-0002' })
    const { prompt, asked } = scriptedPrompt({ kmenu: 'key', keyChoice: 'OTHER_API_KEY', proceed: true })
    const lines: string[] = []
    const code = await runWizard(await context({ home, prompt, interactive: true, ...outputLines(lines) }), { ...OPTIONS, action: 'credentials' })
    expect(code).toBe(0)
    const keyChoice = asked.find(question => question.name === 'keyChoice')
    expect(keyChoice?.choices?.map(choice => choice.value)).toEqual(['DEEPSEEK_API_KEY', 'OTHER_API_KEY', '__NEW__'])
    // Masking is the only barrier between stored keys and the terminal.
    for (const choice of keyChoice?.choices ?? []) {
      expect(choice.name).not.toContain('sk-primary-0001')
      expect(choice.name).not.toContain('sk-other-0002')
    }
    expect(keyChoice?.choices?.[0]?.name).toContain('sk-***0001')
    expect(readCredentials(home)).toEqual({
      DEEPSEEK_API_KEY: 'sk-other-0002',
      DEEPSEEK_BASE_URL: 'https://relay.example.com',
      OTHER_API_KEY: 'sk-other-0002',
    })
  })

  it('cancels gently when Esc lands on the stored-credential pick, leaving credentials untouched', async () => {
    const home = await tempHome()
    await writeCredentials(home, { DEEPSEEK_API_KEY: 'sk-primary-0001' })
    const { prompt, asked } = scriptedPrompt({ kmenu: 'key' })
    const lines: string[] = []
    const code = await runWizard(await context({ home, prompt, interactive: true, ...outputLines(lines) }), { ...OPTIONS, action: 'credentials' })
    expect(code).toBe(0)
    expect(asked.map(question => question.name)).toEqual(['kmenu', 'keyChoice', 'returnToMenu'])
    expect(lines.join('\n')).toContain('已取消')
    expect(readCredentials(home)).toEqual({ DEEPSEEK_API_KEY: 'sk-primary-0001' })
  })

  it('never shadows a CLI --key with the interactive picker, same as init', async () => {
    const home = await tempHome()
    await writeCredentials(home, { DEEPSEEK_API_KEY: 'sk-stored-0001' })
    const { prompt, asked } = scriptedPrompt({ kmenu: 'key', proceed: true })
    const code = await runWizard(await context({ home, prompt, interactive: true }), { ...OPTIONS, action: 'credentials', key: 'sk-cli-0002' })
    expect(code).toBe(0)
    expect(asked.filter(question => question.name === 'keyChoice' || question.name === 'key')).toHaveLength(0)
    expect(readCredentials(home)).toEqual({ DEEPSEEK_API_KEY: 'sk-cli-0002' })
  })

  it('falls through to a typed key when the stored-credential pick chooses re-enter', async () => {
    const home = await tempHome()
    await writeCredentials(home, { DEEPSEEK_API_KEY: 'sk-primary-0001' })
    const { prompt } = scriptedPrompt({ kmenu: 'key', keyChoice: '__NEW__', key: 'sk-fresh-0003', proceed: true })
    const lines: string[] = []
    const code = await runWizard(await context({ home, prompt, interactive: true, ...outputLines(lines) }), { ...OPTIONS, action: 'credentials' })
    expect(code).toBe(0)
    expect(readCredentials(home)).toEqual({ DEEPSEEK_API_KEY: 'sk-fresh-0003' })
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
      if ((command === 'pnpm' || command.endsWith('/pnpm')) && args[0] === '-v') return pnpmReady ? { status: 0, stdout: '10.18.0\n', stderr: '' } : { status: null, stdout: '', stderr: 'command not found: pnpm' }
      if (command === 'npm' && args[0] === 'install') { pnpmReady = true; return { status: 0, stdout: '', stderr: '' } }
      if ((command === 'pnpm' || command.endsWith('/pnpm')) && args[0] === '-v') return { status: 0, stdout: '10.18.0\n', stderr: '' }
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
      ['https://repo.huaweicloud.com/repository/npm', 200],
    ])
    const lines: string[] = []
    const code = await runWizard({
      home,
      lang: 'zh-CN',
      run,
      installDsh,
      probeRegistry: async url => latencies.get(url),
      fetchModels: NO_MODELS,
      fetchDesktop: NO_FETCH,
      runInteract: () => 127,
      which: () => undefined,
      runDetached: () => false,
      probeWeb: async () => false,
      desktopInstalled: () => false,
      prompt,
      interactive: true,
      ...outputLines(lines),
    }, { ...OPTIONS })
    expect(code).toBe(0)
    const registryQuestion = asked.find(question => question.name === 'registry')
    expect(registryQuestion?.type).toBe('list')
    if (registryQuestion?.type !== 'list') return
    expect(registryQuestion.choices).toHaveLength(3)
    expect(registryQuestion.choices[0]?.value).toBe('https://registry.npmmirror.com')
    expect(registryQuestion.choices[0]?.name).toContain('90ms')
    expect(registryQuestion.choices[1]?.name).toContain('200ms')
    expect(registryQuestion.choices[1]?.name).toContain('华为云')
    expect(registryQuestion.choices[2]?.name).toContain('1200ms')
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
      fetchDesktop: NO_FETCH,
      runInteract: () => 127,
      which: () => undefined,
      runDetached: () => false,
      probeWeb: async () => false,
      desktopInstalled: () => false,
      prompt,
      interactive: true,
      ...outputLines(lines),
    }, { ...OPTIONS })
    expect(code).toBe(0)
    expect(asked.some(question => question.name === 'registry')).toBe(false)
    expect(calls[0]?.args.some(arg => arg.startsWith('--registry='))).toBe(false)
    expect(lines.join('\n')).toContain('所有安装源都未在 3 秒内应答')
  })

  it('fails loud when the streaming installer fails', async () => {
    const home = await tempHome()
    const run: RunFn = (command, args) => {
      if (command === 'dsh' && args[0] === '-V') return { status: null, stdout: '', stderr: 'not found' }
      if (command === 'npm' && args[0] === '-v') return { status: 0, stdout: '11.0.0\n', stderr: '' }
      if ((command === 'pnpm' || command.endsWith('/pnpm')) && args[0] === '-v') return { status: 0, stdout: '10.18.0\n', stderr: '' }
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
    const { run } = scriptedRun()
    const scripted = scriptedInstall()
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, installDsh: scripted.installDsh, ...outputLines(lines) }), {
      ...OPTIONS, action: 'marketplace', plugins: ['dsh-lens', 'dsh-spend'], profile: 'dzcf',
    })
    expect(code).toBe(0)
    // Two or more picks install as one batched launcher call.
    expect(scripted.calls.filter(call => call.args.includes('add'))).toHaveLength(1)
    expect(scripted.calls[0]?.args).toEqual(['plugin', '--profile', 'dzcf', 'add', '-w', 'dsh-lens', 'dsh-spend'])
    expect(lines.join('\n')).toContain('dsh-lens 已安装并登记')
    expect(lines.join('\n')).toContain('批量安装')
  })

  it('creates the profile on the web surface when it does not exist', async () => {
    const home = await tempHome()
    const { run, calls } = scriptedRun()
    const code = await runWizard(await context({ home, run }), {
      ...OPTIONS, action: 'marketplace', plugins: ['dsh-spend'],
    })
    expect(code).toBe(0)
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', '@deepseek-ai/dsh-web-app@^0.1.0-rc.6'] })
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', 'dsh-spend'] })
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

  it('asks a confirm before interactive removals and keeps everything on decline', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-lens', 'dsh-spend'] } } }))
    const { run, calls } = scriptedRun()
    const { prompt, asked } = scriptedPrompt({ remove: ['dsh-lens'], removeConfirm: false })
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, prompt, interactive: true, ...outputLines(lines) }), {
      ...OPTIONS, action: 'manage', profile: 'dzcf',
    })
    expect(code).toBe(0)
    expect(asked.map(question => question.name)).toEqual(['remove', 'removeConfirm', 'returnToMenu'])
    expect(lines.join('\n')).toContain('即将从 dzcf 移除')
    expect(lines.join('\n')).toContain('已取消')
    expect(calls.filter(call => call.args.includes('remove'))).toHaveLength(0)
  })

  it('removes the picked plugins after the interactive confirm is accepted', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-lens', 'dsh-spend'] } } }))
    const { run, calls } = scriptedRun()
    const { prompt, asked } = scriptedPrompt({ remove: ['dsh-lens'], removeConfirm: true })
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, prompt, interactive: true, ...outputLines(lines) }), {
      ...OPTIONS, action: 'manage', profile: 'dzcf',
    })
    expect(code).toBe(0)
    expect(asked.find(question => question.name === 'removeConfirm')?.message).toContain('继续移除吗')
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'remove', '-w', 'dsh-lens'] })
    expect(calls).not.toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'remove', '-w', 'dsh-spend'] })
  })

  it('skips the interactive removal confirm when --yes is passed', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-lens'] } } }))
    const { run, calls } = scriptedRun()
    const { prompt, asked } = scriptedPrompt({ remove: ['dsh-lens'] })
    const code = await runWizard(await context({ home, run, prompt, interactive: true }), {
      ...OPTIONS, action: 'manage', profile: 'dzcf', yes: true,
    })
    expect(code).toBe(0)
    expect(asked.filter(question => question.name === 'removeConfirm')).toHaveLength(0)
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'remove', '-w', 'dsh-lens'] })
  })

  it('prints the removal plan under --dry-run without the interactive confirm', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-lens'] } } }))
    const { run, calls } = scriptedRun()
    const { prompt, asked } = scriptedPrompt({ remove: ['dsh-lens'] })
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, prompt, interactive: true, ...outputLines(lines) }), {
      ...OPTIONS, action: 'manage', profile: 'dzcf', dryRun: true,
    })
    expect(code).toBe(0)
    expect(asked.filter(question => question.name === 'removeConfirm')).toHaveLength(0)
    expect(lines.join('\n')).toContain('remove dsh-lens')
    expect(calls.filter(call => call.args.includes('remove'))).toHaveLength(0)
  })

  it('expands the (All) sentinel into every catalog entry', async () => {
    const home = await tempHome()
    const { run } = scriptedRun()
    const scripted = scriptedInstall()
    const { prompt } = scriptedPrompt({ plugins: ['__ALL__'] })
    const code = await runWizard(await context({ home, run, prompt, interactive: true, installDsh: scripted.installDsh }), {
      ...OPTIONS, action: 'marketplace', profile: 'dzcf',
    })
    expect(code).toBe(0)
    // The whole catalog expands into exactly one batched launcher call whose
    // argument tail carries every plugin id.
    expect(scripted.calls.filter(call => call.args.includes('add'))).toHaveLength(1)
    const batchCall = scripted.calls.find(call => call.args.includes('add'))
    expect(batchCall?.args.filter(arg => RECOMMENDED_PLUGINS.some(plugin => plugin.id === arg))).toHaveLength(RECOMMENDED_PLUGINS.length)
  })

  it('fails loud before any removal when no usable pnpm can be established', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-lens'] } } }))
    // System pnpm answers with the wrong major and the private install never
    // verifies, so the manage flow must refuse before touching the profile.
    const privatePnpm = join(home, '.zcf', 'pnpm10', 'node_modules', '.bin', 'pnpm')
    const { run, calls } = scriptedRun({ pnpm: () => ({ status: 0, stdout: '11.22.0\n', stderr: '' }), [privatePnpm]: () => ({ status: null, stdout: '', stderr: 'not found' }) })
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, ...outputLines(lines) }), { ...OPTIONS, action: 'manage', plugins: ['dsh-lens'], profile: 'dzcf' })
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('pnpm 安装失败')
    expect(calls).not.toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'remove', '-w', 'dsh-lens'] })
  })

  it('fails loud before any update when no usable pnpm can be established', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-lens'] } } }))
    const privatePnpm = join(home, '.zcf', 'pnpm10', 'node_modules', '.bin', 'pnpm')
    const { run, calls } = scriptedRun({ pnpm: () => ({ status: 0, stdout: '11.22.0\n', stderr: '' }), [privatePnpm]: () => ({ status: null, stdout: '', stderr: 'not found' }) })
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, ...outputLines(lines) }), { ...OPTIONS, action: 'update', plugins: ['dsh-lens'], profile: 'dzcf' })
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('pnpm 安装失败')
    expect(calls).not.toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', 'dsh-lens'] })
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
    // The pnpm-version probe is expected; no launcher (dsh) work may run.
    expect(calls.filter(call => call.command === 'dsh')).toHaveLength(0)
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

  it('installs a private pnpm 10 when the machine has no pnpm at all', async () => {
    const home = await tempHome()
    let privateReady = false
    const base = scriptedRun({
      npm: (args) => {
        if (args[0] === 'install') {
          privateReady = true
          return { status: 0, stdout: '', stderr: '' }
        }
        return { status: 0, stdout: '11.0.0\n', stderr: '' }
      },
    })
    const run: RunFn = (command, args) => {
      if ((command === 'pnpm' || command.endsWith('/pnpm')) && args[0] === '-v') {
        return privateReady && command.endsWith('/pnpm')
          ? { status: 0, stdout: '10.18.0\n', stderr: '' }
          : { status: null, stdout: '', stderr: 'not found' }
      }
      return base.run(command, args)
    }
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, ...outputLines(lines) }), {
      ...OPTIONS, action: 'marketplace', plugins: ['dsh-lens'],
    })
    expect(code).toBe(0)
    expect(base.calls).toContainEqual({ command: 'npm', args: ['install', '--prefix', join(home, '.zcf', 'pnpm10'), 'pnpm@10', '--no-audit', '--no-fund'] })
    expect(lines.join('\n')).toContain('私有 pnpm 10 已就绪')
  })

  it('skips the pnpm step when pnpm already answers', async () => {
    const home = await tempHome()
    const { run, calls } = scriptedRun()
    const code = await runWizard(await context({ home, run }), {
      ...OPTIONS, action: 'marketplace', plugins: ['dsh-lens'],
    })
    expect(code).toBe(0)
    expect(calls).not.toContainEqual({ command: 'npm', args: ['install', '--global', 'pnpm@10', '--no-audit', '--no-fund'] })
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
    const { prompt, asked } = scriptedPrompt({ keyChoice: 'DEEPSEEK_API_KEY_BAK', baseUrl: '', mode: 'web', plugins: [], proceed: true, modelManual: '', keepGoing: true })
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

  it('offers returning to the main menu after a finished interactive flow', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-lens'] } } }))
    const asked: PromptQuestion[] = []
    const prompt = async (questions: readonly PromptQuestion[]): Promise<PromptOutcome> => {
      const question = questions[0]
      if (question === undefined) return { status: 'cancelled' }
      asked.push(question)
      if (question.name === 'returnToMenu') return { status: 'answered', value: { returnToMenu: true } }
      if (question.name === 'action') return { status: 'answered', value: { action: 'exit' } }
      return { status: 'answered', value: { update: ['dsh-lens'] } }
    }
    const { run, calls } = scriptedRun()
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, prompt, interactive: true, ...outputLines(lines) }), {
      ...OPTIONS, action: 'update',
    })
    expect(code).toBe(0)
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', 'dsh-lens'] })
    expect(asked.map(question => question.name)).toEqual(['update', 'returnToMenu', 'action'])
  })

  it('persists --registry into the profile .npmrc before installing plugins', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
    const { run, calls } = scriptedRun()
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, ...outputLines(lines) }), {
      ...OPTIONS, action: 'marketplace', plugins: ['dsh-lens'], registry: 'https://registry.npmmirror.com',
    })
    expect(code).toBe(0)
    const npmrc = await readFile(join(home, 'profiles', 'dzcf', '.npmrc'), 'utf8')
    expect(npmrc).toContain('registry=https://registry.npmmirror.com')
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', 'dsh-lens'] })
    expect(lines.join('\n')).toContain('registry.npmmirror.com')
  })

  it('asks once for a plugin registry in interactive runs and writes it', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
    const { prompt, asked } = scriptedPrompt({ registry: 'https://registry.npmmirror.com', plugins: ['dsh-lens'] })
    const { run } = scriptedRun()
    const code = await runWizard(await context({ home, run, prompt, interactive: true, probeRegistry: async () => 50 }), {
      ...OPTIONS, action: 'marketplace', profile: 'dzcf',
    })
    expect(code).toBe(0)
    expect(asked.some(question => question.name === 'registry')).toBe(true)
    const npmrc = await readFile(join(home, 'profiles', 'dzcf', '.npmrc'), 'utf8')
    expect(npmrc).toContain('registry=https://registry.npmmirror.com')
  })

  it('recovers a broken profile: wipes and rebuilds after a failed compose', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'pnpm-lock.yaml'), 'brokenness: [\n')
    let dumpCalls = 0
    const { prompt } = scriptedPrompt({ key: 'sk-typed-1234567890', baseUrl: '', modelManual: '', mode: 'web', plugins: [], proceed: true, rebuildProfile: true })
    const run: RunFn = (command, args) => {
      if (command === 'dsh' && args[0] === '-V') return { status: 0, stdout: '0.0.1-rc.4\n', stderr: '' }
      if (command === 'dsh' && (args[2] === '--dump-default-config' || args[2] === '--dump-config')) {
        dumpCalls += 1
        return dumpCalls <= 1
          ? { status: 1, stdout: '', stderr: 'dsh: pnpm failed in profile directory' }
          : { status: 0, stdout: '# composed\n', stderr: '' }
      }
      if (command === 'dsh' && args[0] === 'plugin' && args.includes('add')) return { status: 0, stdout: '', stderr: '' }
      if (command === 'pnpm' || command.endsWith('/pnpm')) return { status: 0, stdout: '10.18.0\n', stderr: '' }
      if (command === 'npm') return { status: 0, stdout: '11.0.0\n', stderr: '' }
      return { status: null, stdout: '', stderr: `command not found: ${command}` }
    }
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, prompt, interactive: true, ...outputLines(lines) }), {
      ...OPTIONS, key: 'sk-test-1234', mode: 'web',
    })
    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('正在清除并重建')
    expect(lines.join('\n')).toContain('已重建')
  })

  it('self-heals refused build scripts: allowlists and retries the plugin', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
    await writeFile(join(home, 'profiles', 'dzcf', 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\n')
    let lensCalls = 0
    const run: RunFn = (command, args) => {
      if (command === 'dsh' && args[0] === 'plugin' && args.includes('add') && args.includes('dsh-lens')) {
        lensCalls += 1
        return lensCalls === 1
          ? { status: 1, stdout: '[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: @ast-grep/cli@0.45.2\n', stderr: 'dsh: pnpm failed in profile directory' }
          : { status: 0, stdout: '', stderr: '' }
      }
      if (command === 'dsh' && args[0] === '-V') return { status: 0, stdout: '0.0.1-rc.4\n', stderr: '' }
      if (command === 'dsh') return { status: 0, stdout: '', stderr: '' }
      if (command === 'pnpm' || command.endsWith('/pnpm')) return { status: 0, stdout: '10.18.0\n', stderr: '' }
      if (command === 'npm') return { status: 0, stdout: '11.0.0\n', stderr: '' }
      return { status: null, stdout: '', stderr: `command not found: ${command}` }
    }
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, ...outputLines(lines) }), {
      ...OPTIONS, action: 'marketplace', plugins: ['dsh-lens'],
    })
    expect(code).toBe(0)
    const workspace = await readFile(join(home, 'profiles', 'dzcf', 'pnpm-workspace.yaml'), 'utf8')
    expect(workspace).toContain('onlyBuiltDependencies:')
    expect(workspace).toContain("'@ast-grep/cli'")
    expect(lines.join('\n')).toContain('已加入')
  })

  it('switches a lagging mirror to the official registry and retries the plugin', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
    await writeFile(join(home, 'profiles', 'dzcf', '.npmrc'), 'registry=https://registry.npmmirror.com\n')
    let lensCalls = 0
    const run: RunFn = (command, args) => {
      if (command === 'dsh' && args[0] === 'plugin' && args.includes('add') && args.includes('dsh-lens')) {
        lensCalls += 1
        return lensCalls === 1
          ? { status: 1, stdout: '[ERR_PNPM_NO_MATCHING_VERSION] No matching version found for @ast-grep/cli-win32-arm64-msvc@0.45.2 while fetching it from https://registry.npmmirror.com/\n', stderr: 'dsh: pnpm failed in profile directory' }
          : { status: 0, stdout: '', stderr: '' }
      }
      if (command === 'dsh' && args[0] === '-V') return { status: 0, stdout: '0.0.1-rc.4\n', stderr: '' }
      if (command === 'dsh') return { status: 0, stdout: '', stderr: '' }
      if (command === 'pnpm' || command.endsWith('/pnpm')) return { status: 0, stdout: '10.18.0\n', stderr: '' }
      if (command === 'npm') return { status: 0, stdout: '11.0.0\n', stderr: '' }
      return { status: null, stdout: '', stderr: `command not found: ${command}` }
    }
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, ...outputLines(lines) }), {
      ...OPTIONS, action: 'marketplace', plugins: ['dsh-lens'],
    })
    expect(code).toBe(0)
    expect(lensCalls).toBe(2)
    expect(await readFile(join(home, 'profiles', 'dzcf', '.npmrc'), 'utf8')).toContain('registry=https://registry.npmjs.org')
    expect(lines.join('\n')).toContain('切换为官方源')
  })

  it('does not switch the registry when it already is the official one', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
    await writeFile(join(home, 'profiles', 'dzcf', '.npmrc'), 'registry=https://registry.npmjs.org\n')
    const run: RunFn = (command, args) => {
      if (command === 'dsh' && args[0] === 'plugin' && args.includes('add') && args.includes('dsh-lens')) {
        return { status: 1, stdout: '[ERR_PNPM_NO_MATCHING_VERSION] No matching version found\n', stderr: 'dsh: pnpm failed in profile directory' }
      }
      if (command === 'dsh' && args[0] === '-V') return { status: 0, stdout: '0.0.1-rc.4\n', stderr: '' }
      if (command === 'dsh') return { status: 0, stdout: '', stderr: '' }
      if (command === 'pnpm' || command.endsWith('/pnpm')) return { status: 0, stdout: '10.18.0\n', stderr: '' }
      if (command === 'npm') return { status: 0, stdout: '11.0.0\n', stderr: '' }
      return { status: null, stdout: '', stderr: `command not found: ${command}` }
    }
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, ...outputLines(lines) }), {
      ...OPTIONS, action: 'marketplace', plugins: ['dsh-lens'],
    })
    expect(code).toBe(1)
    expect(await readFile(join(home, 'profiles', 'dzcf', '.npmrc'), 'utf8')).toContain('registry=https://registry.npmjs.org')
    expect(lines.join('\n')).not.toContain('切换为官方源')
  })

  it('dsh-tui launches the default profile with a config-source notice', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
    await writeDefaultProfile(home, 'dzcf')
    const lines: string[] = []
    const code = await runWizard(await context({ home, ...outputLines(lines) }), { ...OPTIONS, action: 'tui' })
    // Without a real dsh on the test PATH the launcher exits nonzero, but the
    // notice line and profile resolution are what this test pins.
    expect(lines.join('\n')).toContain('正在从')
    expect(lines.join('\n')).toContain(join('profiles', 'dzcf'))
    expect(code).not.toBe(0)
  })

  it('installs the global dsh-tui shortcut after a finished init', async () => {
    const home = await tempHome()
    let installed = false
    const base = scriptedRun({
      bash: (args) => {
        const cmd = args.join(' ')
        if (cmd.includes('readlink')) {
          return { status: 0, stdout: '/usr/local/lib/node_modules/dsh-zcf/lib/cli.cjs\n', stderr: '' }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
      npm: (args) => {
        if (args[0] === 'install' && args.includes('--global')) {
          installed = true
          return { status: 0, stdout: '', stderr: '' }
        }
        return { status: 0, stdout: '11.0.0\n', stderr: '' }
      },
    })
    const { prompt } = scriptedPrompt({ key: 'sk-typed-1234567890', baseUrl: '', modelManual: '', mode: 'web', plugins: [], proceed: true, globalShortcut: true, keepGoing: true })
    const lines: string[] = []
    const code = await runWizard(await context({ home, run: base.run, prompt, interactive: true, which: (name) => name === 'dsh-tui' && installed ? '/usr/local/bin/dsh-tui' : undefined, ...outputLines(lines) }), {
      ...OPTIONS, key: 'sk-test-1234', mode: 'web', yes: false, selfVersion: '0.4.3',
    })
    expect(code).toBe(0)
    expect(base.calls).toContainEqual({ command: 'npm', args: ['install', '--global', 'dsh-zcf@0.4.3'] })
    expect(lines.join('\n')).toContain('dsh-tui 已全局就绪')
  })

  it('dsh-tui preflight repairs conflicts and migrates flat credentials', async () => {
    const home = await tempHome()
    await ensureHomeDirectory(home)
    await writeFile(credentialsPath(home), 'DEEPSEEK_API_KEY: sk-flat-1234567890\n')
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-claude-move', 'dsh-chat-import'] } } }))
    await writeDefaultProfile(home, 'dzcf')
    const { run, calls } = scriptedRun()
    const launches: string[][] = []
    const interact = (command: string, args: readonly string[]): number => { launches.push([command, ...args]); return 127 }
    const context2 = await context({ home, run, runInteract: interact })
    const lines: string[] = []
    const code = await runWizard({ ...context2, out: (text: string) => { lines.push(text) } }, { ...OPTIONS, action: 'tui' })
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'remove', '-w', 'dsh-claude-move'] })
    expect(launches).toContainEqual(['dsh', '--profile', 'dzcf'])
    expect(lines.join('\n')).toContain('自动移除')
    expect(lines.join('\n')).toContain('迁移')
    const document = yaml.load(await readFile(credentialsPath(home), 'utf8')) as { version?: number; refs?: Record<string, string> }
    expect(document.version).toBe(1)
    expect(document.refs?.DEEPSEEK_API_KEY).toBe('sk-flat-1234567890')
    expect(code).not.toBe(0)
  })

  it('skips web-only plugins when installing into a tui profile', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-harness-tui/dsh-tui'] } } }))
    const scripted = scriptedInstall()
    const { run, calls } = scriptedRun()
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, installDsh: scripted.installDsh, ...outputLines(lines) }), {
      ...OPTIONS, action: 'marketplace', plugins: ['dsh-lens', 'dsh-message-edit', 'dsh-full-remote'],
    })
    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('跳过 dsh-message-edit')
    expect(lines.join('\n')).toContain('跳过 dsh-full-remote')
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', 'dsh-lens'] })
    expect(calls.some(call => call.args.includes('dsh-message-edit') || call.args.includes('dsh-full-remote'))).toBe(false)
  })

  it('leaving the TUI exits the wizard without a return-to-menu prompt', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-harness-tui/dsh-tui'] } } }))
    await writeDefaultProfile(home, 'dzcf')
    const asked: string[] = []
    const prompt = async (questions: readonly PromptQuestion[]): Promise<PromptOutcome> => {
      const question = questions[0]
      if (question !== undefined) asked.push(question.name)
      return { status: 'cancelled' }
    }
    const { run } = scriptedRun()
    const code = await runWizard(await context({ home, run, prompt, interactive: true, runInteract: () => 0 }), { ...OPTIONS, action: 'tui' })
    expect(code).toBe(0)
    expect(asked).toEqual([])
  })

  it('dsh-tui preflight removes web-only plugins from a tui profile', async () => {
    const home = await tempHome()
    await ensureHomeDirectory(home)
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-harness-tui/dsh-tui', 'dsh-message-edit'] } } }))
    await writeDefaultProfile(home, 'dzcf')
    const { run, calls } = scriptedRun()
    const lines: string[] = []
    await runWizard(await context({ home, run, ...outputLines(lines) }), { ...OPTIONS, action: 'tui' })
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'remove', '-w', 'dsh-message-edit'] })
    expect(lines.join('\n')).toContain('自动移除')
  })

  it('dsh-tui fails loud when the default profile is missing', async () => {
    const home = await tempHome()
    const lines: string[] = []
    const code = await runWizard(await context({ home, ...outputLines(lines) }), { ...OPTIONS, action: 'tui' })
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('默认 profile 不存在')
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

describe('runWizard — web launch orchestration', () => {
  /** The interactive init answers that reach the web onboarding untouched. */
  const webPromptAnswers = { baseUrl: '', key: 'sk-web-0001', modelManual: '', mode: 'web', plugins: [], proceed: true, globalShortcut: false }

  it('reuses a running web service instead of starting another', async () => {
    const home = await tempHome()
    const detached: Array<readonly string[]> = []
    const { prompt } = scriptedPrompt(webPromptAnswers)
    const lines: string[] = []
    const code = await runWizard(await context({
      home,
      prompt,
      interactive: true,
      runDetached: (command, args) => { detached.push([command, ...args]); return true },
      probeWeb: async () => true,
      ...outputLines(lines),
    }), { ...OPTIONS, action: 'init', mode: 'web' })
    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('Web 服务已在运行')
    expect(lines.join('\n')).toContain('http://127.0.0.1:3080')
    expect(detached).toHaveLength(0)
  })

  it('launches the web service in the background and waits for readiness', async () => {
    const home = await tempHome()
    let probes = 0
    const detached: Array<readonly string[]> = []
    const { prompt, asked } = scriptedPrompt({ ...webPromptAnswers, launchWeb: true })
    const lines: string[] = []
    const code = await runWizard(await context({
      home,
      prompt,
      interactive: true,
      runDetached: (command, args) => { detached.push([command, ...args]); return true },
      // First probe (pre-check) says the port is free; the readiness poll
      // answers after one retry tick.
      probeWeb: async () => { probes += 1; return probes > 1 },
      ...outputLines(lines),
    }), { ...OPTIONS, action: 'init', mode: 'web' })
    expect(code).toBe(0)
    expect(detached).toEqual([['dsh', '--profile', 'dzcf', 'web']])
    expect(asked.some(question => question.name === 'launchWeb')).toBe(true)
    expect(lines.join('\n')).toContain('正在后台启动')
    expect(lines.join('\n')).toContain('Web 界面已就绪')
  })

  it('suggests the manual command when the service cannot be spawned', async () => {
    const home = await tempHome()
    const { prompt } = scriptedPrompt({ ...webPromptAnswers, launchWeb: true })
    const lines: string[] = []
    const code = await runWizard(await context({
      home,
      prompt,
      interactive: true,
      runDetached: () => false,
      probeWeb: async () => false,
      desktopInstalled: () => false,
      ...outputLines(lines),
    }), { ...OPTIONS, action: 'init', mode: 'web' })
    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('dsh --profile dzcf web')
    expect(lines.join('\n')).toContain('未在等待窗口内就绪')
  })

  it('stays with the printed manual command in non-interactive runs', async () => {
    const home = await tempHome()
    let probes = 0
    const lines: string[] = []
    const code = await runWizard(await context({
      home,
      probeWeb: async () => { probes += 1; return true },
      ...outputLines(lines),
    }), { ...OPTIONS, action: 'init', key: 'sk-web-0010', mode: 'web', yes: true })
    expect(code).toBe(0)
    expect(probes).toBe(0)
    expect(lines.join('\n')).not.toContain('已在运行')
    expect(lines.join('\n')).toContain('dsh web')
  })
})

describe('runWizard — app surface (DSH Desktop installer)', () => {
  /** Scripted fetch answering the cn HEAD resolve and the installer GET. */
  const scriptedDesktopFetch = (): { fetch: typeof fetch; savedName: string } => {
    const savedName = 'DSH.Desktop-9.9.9-universal.dmg'
    const impl = (async (url: string, init?: { method?: string }) => {
      if (init?.method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'content-length': '21', 'content-disposition': `attachment; filename="${savedName}"` } })
      }
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('desktop installer'))
          controller.close()
        },
      }), { status: 200, headers: { 'content-length': '17' } })
    }) as typeof fetch
    return { fetch: impl, savedName }
  }

  afterEach(() => {
    delete process.env.DZCF_DESKTOP_DIR
  })

  it('creates a web-composed profile and explains the missing installer on unsupported platforms', async () => {
    const home = await tempHome()
    const { run, calls } = scriptedRun()
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, ...outputLines(lines) }), {
      ...OPTIONS, action: 'init', key: 'sk-app-0001', mode: 'app', yes: true,
    })
    expect(code).toBe(0)
    // The desktop shell is no longer an npm plugin: the profile mounts the web
    // composition that DSH Desktop's tray can pick.
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', '@deepseek-ai/dsh-web-app@^0.1.0-rc.6'] })
    expect(calls).not.toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'add', '-w', 'dsh-desktop-app@^0.4.0'] })
    if (detectDesktopPlatform() === 'none') {
      expect(lines.join('\n')).toContain('没有 DSH Desktop 安装包')
      expect(lines.join('\n')).toContain('dsh web')
    }
  })

  it('plans the installer download under --dry-run with an explicit platform', async () => {
    const home = await tempHome()
    const lines: string[] = []
    const code = await runWizard(await context({ home, ...outputLines(lines) }), {
      ...OPTIONS, action: 'init', key: 'sk-app-0002', mode: 'app', dryRun: true, desktopPlatform: 'mac',
    })
    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('下载 DSH Desktop 安装包（mac，来源 cn）')
  })

  it('skips the whole download when DSH Desktop is already installed', async () => {
    const home = await tempHome()
    const lines: string[] = []
    const code = await runWizard(await context({
      home,
      desktopInstalled: () => true,
      fetchDesktop: NO_FETCH,
      ...outputLines(lines),
    }), { ...OPTIONS, action: 'init', key: 'sk-app-0003', mode: 'app', yes: true })
    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('检测到已安装的 DSH Desktop')
    expect(lines.join('\n')).toContain('打开 DSH Desktop')
  })

  it('offers to open the downloaded installer and launches it detached', async () => {
    const home = await tempHome()
    process.env.DZCF_DESKTOP_DIR = await mkdtemp(join(tmpdir(), 'dzcf-desktop-'))
    const detached: Array<readonly string[]> = []
    const { prompt } = scriptedPrompt({ baseUrl: '', key: 'sk-app-0004', modelManual: '', mode: 'app', plugins: [], proceed: true, globalShortcut: false, download: true, openInstaller: true })
    const scripted = scriptedDesktopFetch()
    const lines: string[] = []
    const code = await runWizard(await context({
      home,
      prompt,
      interactive: true,
      fetchDesktop: scripted.fetch,
      runDetached: (command, args) => { detached.push([command, ...args]); return true },
      ...outputLines(lines),
    }), { ...OPTIONS, action: 'init', key: 'sk-app-0004', mode: 'app', desktopPlatform: 'mac' })
    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('已启动安装程序')
    // On the POSIX hosts the tests run on, the saved installer is spawned
    // directly (the `open` path is macOS-only).
    expect(detached).toHaveLength(1)
    expect(String(detached[0]?.[0])).toContain(scripted.savedName)
    expect(detached[0]).toHaveLength(1)
  })

  it('downloads the installer when --desktop-platform points at a supported machine', async () => {
    const home = await tempHome()
    const downloadDir = await tempHome()
    process.env.DZCF_DESKTOP_DIR = downloadDir
    const scripted = scriptedDesktopFetch()
    const lines: string[] = []
    const code = await runWizard(await context({ home, fetchDesktop: scripted.fetch, ...outputLines(lines) }), {
      ...OPTIONS, action: 'init', key: 'sk-app-0003', mode: 'app', yes: true, desktopPlatform: 'mac',
    })
    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('安装包已保存')
    const saved = join(downloadDir, scripted.savedName)
    expect(await readFile(saved, 'utf8')).toBe('desktop installer')
    // The onboarding points at the saved installer.
    expect(lines.join('\n')).toContain(scripted.savedName)
  })

  it('skips the download when the interactive confirm is declined', async () => {
    const home = await tempHome()
    const downloadDir = await tempHome()
    process.env.DZCF_DESKTOP_DIR = downloadDir
    const scripted = scriptedDesktopFetch()
    const { prompt } = scriptedPrompt({ baseUrl: '', key: 'sk-app-0004', modelManual: '', mode: 'app', plugins: [], proceed: true, download: false })
    const lines: string[] = []
    const code = await runWizard(await context({ home, prompt, interactive: true, fetchDesktop: scripted.fetch, ...outputLines(lines) }), {
      ...OPTIONS, action: 'init', desktopPlatform: 'mac',
    })
    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('已跳过下载')
    await expect(stat(join(downloadDir, scripted.savedName))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})


describe('runWizard — existing-user protection', () => {
  const seededHome = async (): Promise<string> => {
    const home = await tempHome()
    await writeCredentials(home, { DEEPSEEK_API_KEY: 'sk-stored-0001', DEEPSEEK_BASE_URL: 'https://relay.example.com', OTHER_API_KEY: 'sk-other-0002' })
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-spend'] } } }))
    return home
  }

  it('announces merge semantics, takes a backup, and preserves everything', async () => {
    const home = await seededHome()
    const lines: string[] = []
    const code = await runWizard(await context({ home, ...outputLines(lines) }), {
      ...OPTIONS, action: 'init', key: 'sk-stored-0001', mode: 'web', yes: true,
    })
    expect(code).toBe(0)
    const text = lines.join('\n')
    expect(text).toContain('合并语义')
    expect(text).toContain('已备份原配置')
    const backups = await readdir(join(home, '.zcf', 'backups'))
    expect(backups.length).toBe(1)
    const saved = await readFile(join(home, '.zcf', 'backups', backups[0] as string, 'profiles', 'dzcf', 'package.json'), 'utf8')
    expect(saved).toContain('dsh-spend')
    expect(readCredentials(home)['OTHER_API_KEY']).toBe('sk-other-0002')
    expect(JSON.parse(await readFile(join(home, 'profiles', 'dzcf', 'package.json'), 'utf8')).dsh.profile.bundles).toContain('dsh-spend')
  })

  it('stops without changes when the interactive protection confirm is declined', async () => {
    const home = await seededHome()
    const { prompt } = scriptedPrompt({ baseUrl: '', key: 'sk-stored-0001', modelManual: '', mode: 'web', plugins: [], proceed: true, keepGoing: false })
    const lines: string[] = []
    const code = await runWizard(await context({ home, prompt, interactive: true, ...outputLines(lines) }), {
      ...OPTIONS, action: 'init', key: 'sk-stored-0001', mode: 'web',
    })
    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('已取消，未做任何修改')
    expect(readCredentials(home)['OTHER_API_KEY']).toBe('sk-other-0002')
    // The declined run still leaves the backup behind.
    expect((await readdir(join(home, '.zcf', 'backups'))).length).toBe(1)
  })

  it('says nothing on a fresh machine', async () => {
    const home = await tempHome()
    const lines: string[] = []
    await runWizard(await context({ home, ...outputLines(lines) }), {
      ...OPTIONS, action: 'init', key: 'sk-fresh-0003', mode: 'web', yes: true,
    })
    const text = lines.join('\n')
    expect(text).not.toContain('合并语义')
    expect(text).not.toContain('已备份原配置')
  })

  it('lists other profiles with their launch commands in the onboarding', async () => {
    const home = await seededHome()
    await mkdir(join(home, 'profiles', 'dzcf-tui'), { recursive: true })
    const lines: string[] = []
    await runWizard(await context({ home, ...outputLines(lines) }), {
      ...OPTIONS, action: 'init', key: 'sk-stored-0001', mode: 'web', yes: true,
    })
    expect(lines.join('\n')).toContain('dsh --profile dzcf-tui')
  })

  it('removes the legacy dsh-desktop-app bundle when the app surface reruns', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'profiles', 'dzcf'), { recursive: true })
    await writeFile(join(home, 'profiles', 'dzcf', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-desktop-app'] } } }))
    const { run, calls } = scriptedRun()
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, ...outputLines(lines) }), {
      ...OPTIONS, action: 'init', key: 'sk-legacy-0004', mode: 'app', yes: true,
    })
    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('dsh-desktop-app')
    expect(calls).toContainEqual({ command: 'dsh', args: ['plugin', '--profile', 'dzcf', 'remove', '-w', 'dsh-desktop-app'] })
  })
})

describe('runWizard — dsh-tui launcher ownership', () => {
  /** The command exists on PATH; readlink resolves it to `resolved`. */
  const whichOverride = (): ((name: string) => string | undefined) => (name) => name === 'dsh-tui' ? '/home/adam/.npm-global/bin/dsh-tui' : undefined
  const bashOverride = (resolved: string): ((args: readonly string[]) => RunResult) => (args) => {
    const cmd = args.join(' ')
    if (cmd.includes('readlink')) return { status: 0, stdout: `${resolved}\n`, stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  }

  it('does not claim a foreign dsh-tui as ready and skips the doomed install', async () => {
    const home = await tempHome()
    const { run, calls } = scriptedRun({ bash: bashOverride('/home/adam/.npm-global/lib/node_modules/@deepseek-harness-tui/dsh-tui/bin/dsh-tui.js') })
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, which: whichOverride(), ...outputLines(lines) }), {
      ...OPTIONS, action: 'init', key: 'sk-foreign-0005', mode: 'tui', yes: true,
    })
    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('其它来源的 dsh-tui')
    expect(calls.filter(call => call.command === 'npm')).toHaveLength(0)
  })

  it('claims readiness only for the wizard-owned launcher', async () => {
    const home = await tempHome()
    const { run } = scriptedRun({ bash: bashOverride('/home/adam/.npm-global/lib/node_modules/dsh-zcf/lib/cli.cjs') })
    const { prompt, asked } = scriptedPrompt({ baseUrl: '', key: 'sk-own-0006', modelManual: '', mode: 'tui', plugins: [], proceed: true })
    const lines: string[] = []
    const code = await runWizard(await context({ home, run, prompt, interactive: true, which: whichOverride(), ...outputLines(lines) }), {
      ...OPTIONS, action: 'init',
    })
    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('已全局就绪')
    expect(asked.filter(question => question.name === 'globalShortcut')).toHaveLength(0)
  })

  it('reads the cmd-shim body to claim ownership on Windows', async () => {
    // npm's cmd-shim embeds its target; ownership is decided from the file.
    const shimDir = await mkdtemp(join(tmpdir(), 'dzcf-cmdshim-'))
    const shim = join(shimDir, 'dsh-tui.cmd')
    await writeFile(shim, '@ECHO off\r\nnode "%~dp0\\..\\node_modules\\dsh-zcf\\lib\\cli.cjs" %*\r\n')
    const foreignShim = join(shimDir, 'foreign.cmd')
    await writeFile(foreignShim, '@node "%~dp0\\other-project\\bin.js" %*\r\n')
    const run = scriptedRun().run
    expect(globalShortcutReady(run, () => shim, 'win32')).toBe(true)
    expect(globalShortcutReady(run, () => foreignShim, 'win32')).toBe(false)
    await rm(shimDir, { recursive: true, force: true })
  })
})

describe('runWizard — credentials flow keep semantics', () => {
  it('a skipped model keeps the pending key and endpoint changes', async () => {
    const home = await tempHome()
    await writeCredentials(home, { DEEPSEEK_API_KEY: 'sk-old-0001' })
    const models = async (): Promise<readonly string[] | undefined> => ['deepseek-chat', 'deepseek-reasoner']
    const { prompt } = scriptedPrompt({ kmenu: 'all', baseUrl: 'https://relay.example.com', keyChoice: '__NEW__', key: 'sk-new-0002', model: '__SKIP__', proceed: true })
    const lines: string[] = []
    const code = await runWizard(await context({ home, prompt, interactive: true, fetchModels: models, ...outputLines(lines) }), {
      ...OPTIONS, action: 'credentials',
    })
    expect(code).toBe(0)
    expect(readCredentials(home)).toEqual({ DEEPSEEK_API_KEY: 'sk-new-0002', DEEPSEEK_BASE_URL: 'https://relay.example.com' })
  })

  it('shows the stored endpoint with a kept hint when the input is empty', async () => {
    const home = await tempHome()
    await writeCredentials(home, { DEEPSEEK_API_KEY: 'sk-old-0001', DEEPSEEK_BASE_URL: 'https://relay.example.com' })
    const { prompt } = scriptedPrompt({ kmenu: 'baseUrl', baseUrl: '', proceed: true })
    const lines: string[] = []
    const code = await runWizard(await context({ home, prompt, interactive: true, ...outputLines(lines) }), {
      ...OPTIONS, action: 'credentials',
    })
    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('https://relay.example.com')
    expect(lines.join('\n')).toContain('留空=保留此值')
    expect(readCredentials(home)['DEEPSEEK_BASE_URL']).toBe('https://relay.example.com')
  })
})

describe('bin launcher wiring', () => {
  it('points bin at the CommonJS version gate, which exists', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { bin: Record<string, string> }
    expect(manifest.bin['dsh-zcf']).toBe('lib/cli.cjs')
    await expect(access(new URL('../src/cli.cjs', import.meta.url))).resolves.toBeUndefined()
  })
})
