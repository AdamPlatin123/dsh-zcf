import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  detectDesktopPlatform,
  downloadDesktopInstaller,
  resolveDesktopAsset,
  type FetchLike,
} from '../src/desktop.ts'

const tempDirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dzcf-desktop-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('detectDesktopPlatform', () => {
  it('maps supported machines and rejects the rest', () => {
    expect(detectDesktopPlatform(undefined, 'darwin', 'arm64')).toBe('mac')
    expect(detectDesktopPlatform(undefined, 'darwin', 'x64')).toBe('mac')
    expect(detectDesktopPlatform(undefined, 'win32', 'x64')).toBe('win')
    expect(detectDesktopPlatform(undefined, 'win32', 'arm64')).toBe('none')
    expect(detectDesktopPlatform(undefined, 'linux', 'x64')).toBe('none')
  })

  it('lets an explicit pick override detection (cross-machine fetches)', () => {
    expect(detectDesktopPlatform('mac', 'linux', 'x64')).toBe('mac')
    expect(detectDesktopPlatform('win', 'linux', 'x64')).toBe('win')
    expect(detectDesktopPlatform('nonsense', 'linux', 'x64')).toBe('none')
  })
})

describe('resolveDesktopAsset', () => {
  it('uses the cn redirect with size and a named file', async () => {
    const fetchImpl: FetchLike = async () => new Response(null, {
      status: 200,
      headers: { 'content-length': '285000000', 'content-disposition': 'attachment; filename="DSH.Desktop-2.0.3-universal.dmg"' },
    })
    const asset = await resolveDesktopAsset('cn', 'mac', fetchImpl)
    expect(asset.fileName).toBe('DSH.Desktop-2.0.3-universal.dmg')
    expect(asset.size).toBe(285000000)
    expect(asset.url).toContain('dshdesktop.cn')
  })

  it('fails loud when the cn endpoint answers an error', async () => {
    const fetchImpl: FetchLike = async () => new Response('nope', { status: 503 })
    await expect(resolveDesktopAsset('cn', 'win', fetchImpl)).rejects.toThrow('503')
  })

  it('matches the github asset naming and carries the digest', async () => {
    const fetchImpl: FetchLike = async () => new Response(JSON.stringify({
      assets: [
        { name: 'DSH.Desktop-2.0.3-universal.dmg', browser_download_url: 'https://objects.example/dmg', size: 267000000, digest: 'sha256:' + 'a'.repeat(64) },
        { name: 'DSH-Desktop-2.0.3-x64-Setup.exe', browser_download_url: 'https://objects.example/exe', size: 116000000 },
        { name: 'source.zip', browser_download_url: 'https://objects.example/zip' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
    const mac = await resolveDesktopAsset('github', 'mac', fetchImpl)
    expect(mac).toMatchObject({ url: 'https://objects.example/dmg', fileName: 'DSH.Desktop-2.0.3-universal.dmg', size: 267000000, sha256: 'a'.repeat(64) })
    const win = await resolveDesktopAsset('github', 'win', fetchImpl)
    expect(win).toMatchObject({ url: 'https://objects.example/exe', fileName: 'DSH-Desktop-2.0.3-x64-Setup.exe' })
  })

  it('fails loud when the release has no matching asset', async () => {
    const fetchImpl: FetchLike = async () => new Response(JSON.stringify({ assets: [] }), { status: 200 })
    await expect(resolveDesktopAsset('github', 'win', fetchImpl)).rejects.toThrow('no win asset')
  })
})

describe('downloadDesktopInstaller', () => {
  const bodyOf = (chunks: readonly string[]): ReadableStream<Uint8Array> =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
        controller.close()
      },
    })

  it('streams the body to disk, reports progress, and verifies the digest', async () => {
    const dir = await tempDir()
    const chunks = ['DSH ', 'Desktop ', 'payload']
    const bytes = new TextEncoder().encode(chunks.join(''))
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const fetchImpl: FetchLike = async () => new Response(bodyOf(chunks), {
      status: 200,
      headers: { 'content-length': String(bytes.byteLength) },
    })
    const onProgress = vi.fn()
    const saved = await downloadDesktopInstaller({ url: 'https://x/DSH.Desktop-2.0.3-universal.dmg', fileName: 'DSH.Desktop-2.0.3-universal.dmg', size: bytes.byteLength, sha256 }, dir, onProgress, fetchImpl)
    expect(saved).toBe(join(dir, 'DSH.Desktop-2.0.3-universal.dmg'))
    expect(await readFile(saved, 'utf8')).toBe(chunks.join(''))
    const calls = onProgress.mock.calls.map(call => call[0])
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.at(-1)).toEqual({ received: bytes.byteLength, total: bytes.byteLength })
    await expect(stat(`${saved}.part`)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to commit and cleans the partial file on a digest mismatch', async () => {
    const dir = await tempDir()
    const fetchImpl: FetchLike = async () => new Response(bodyOf(['payload']), { status: 200 })
    await expect(downloadDesktopInstaller({ url: 'https://x/a.exe', fileName: 'a.exe', sha256: '0'.repeat(64) }, dir, undefined, fetchImpl)).rejects.toThrow('sha256')
    await expect(stat(join(dir, 'a.exe'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(dir, 'a.exe.part'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('propagates HTTP failures without leaving files', async () => {
    const dir = await tempDir()
    const fetchImpl: FetchLike = async () => new Response('gone', { status: 404 })
    await expect(downloadDesktopInstaller({ url: 'https://x/a.exe', fileName: 'a.exe' }, dir, undefined, fetchImpl)).rejects.toThrow('404')
  })
})
