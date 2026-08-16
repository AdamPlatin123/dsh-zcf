import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * End-to-end snapshot of the real dzcf entry (`node --import tsx/esm`): a
 * non-interactive init against a temp harness home and a hermetic PATH shim
 * for `dsh`. Pins the user-visible transcript, the exit code, and the written
 * credentials document — the zero-config loop in one replay.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const BIN = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

const tempHomes: string[] = []

afterEach(async () => {
  await Promise.all(tempHomes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dzcf-snapshot-'))
  tempHomes.push(home)
  return home
}

describe('dzcf non-interactive setup snapshot', () => {
  it('installs nothing, stores the key, verifies through the shim, and prints next steps', async () => {
    await chmod(join(FIXTURES, 'dsh'), 0o755)
    const home = await tempHome()
    const result = spawnSync(process.execPath, ['--import', 'tsx/esm', BIN, 'i', '--key', 'sk-snapshot-1234567890', '--mode', 'web', '--yes'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        DSH_HOME: home,
        PATH: `${FIXTURES}${delimiter}${process.env.PATH ?? ''}`,
      },
    })

    const document = await readFile(join(home, '.credentials.yaml'), 'utf8')
    const fileMode = process.platform === 'win32' ? 'skipped-on-win32' : String((await stat(join(home, '.credentials.yaml'))).mode & 0o777)

    expect({
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      document,
      fileMode,
    }).toMatchSnapshot()
  })
})
