/**
 * DSH Desktop (anywhere-labs) installer acquisition for the app surface. The
 * desktop shell is a standalone Electron distribution — not a dsh plugin — so
 * the app flow resolves the installer for the running platform (or one picked
 * with `--desktop-platform`, which also lets a Linux box fetch installers for
 * other machines), downloads it with progress, and verifies the sha256 when
 * the source publishes one. Credential and profile work stays in the wizard:
 * DSH Desktop shares the standard DSH home, so what the wizard wrote before
 * the install is what the app reads after it.
 * @module dsh-zcf
 */

import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Where an installer can come from: the project's own CDN or GitHub Releases. */
export type DesktopSource = 'cn' | 'github'

/** Installer targets DSH Desktop ships: macOS Universal and Windows x64. */
export type DesktopPlatform = 'mac' | 'win' | 'none'

/** Minimal fetch shape so tests can script responses without the network. */
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<Response>

/** A resolved installer: a direct URL, a display file name, and facts known upfront. */
export interface DesktopAsset {
  url: string
  fileName: string
  size?: number
  sha256?: string
}

/** The always-latest redirects the project publishes (China-friendly). */
const CN_DOWNLOADS: Readonly<Record<Exclude<DesktopPlatform, 'none'>, string>> = {
  mac: 'https://www.dshdesktop.cn/api/downloads/mac',
  win: 'https://www.dshdesktop.cn/api/downloads/windows',
}

/** GitHub's latest-release document for the desktop repository. */
const GITHUB_LATEST = 'https://api.github.com/repos/anywhere-labs/dsh-desktop/releases/latest'

/** Release asset naming as published: `DSH.Desktop-2.0.3-universal.dmg`, `DSH-Desktop-2.0.3-x64-Setup.exe`. */
const GITHUB_ASSET_PATTERN: Readonly<Record<Exclude<DesktopPlatform, 'none'>, RegExp>> = {
  mac: /^DSH\.Desktop-[\d.]+-universal\.dmg$/,
  win: /^DSH-Desktop-[\d.]+-x64-Setup\.exe$/,
}

/**
 * Which installer this machine takes. Only macOS Universal and Windows x64
 * exist; Windows-on-ARM and Linux have no build (the upstream FAQ is explicit
 * that cross-platform source code does not imply a shipped installer).
 * @param explicit - `--desktop-platform` override; `mac`/`win` win over detection.
 * @param platform - process platform (injectable for tests).
 * @param arch - process arch (injectable for tests).
 * @returns the platform whose installer to fetch, or `none` when unsupported.
 */
export function detectDesktopPlatform(explicit?: string, platform: NodeJS.Platform = process.platform, arch: string = process.arch): DesktopPlatform {
  if (explicit === 'mac' || explicit === 'win') return explicit
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32' && arch === 'x64') return 'win'
  return 'none'
}

/**
 * Default save directory: the user's Downloads folder (created on demand).
 * `DZCF_DESKTOP_DIR` redirects it wholesale — tests use it, and so can anyone
 * funneling downloads somewhere specific.
 */
export function desktopDownloadDir(): string {
  return process.env.DZCF_DESKTOP_DIR ?? join(homedir(), 'Downloads')
}

function parseContentDispositionFileName(header: string | null): string | undefined {
  if (header === null) return undefined
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header)
  return match?.[1]
}

function fileNameFromUrl(url: string): string | undefined {
  const segment = url.split('?')[0]?.split('/').at(-1)
  if (segment === undefined || segment === '') return undefined
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function numberOrUndefined(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Resolve the installer for one platform from one source. The `cn` source
 * probes the always-latest redirect with HEAD and keeps the final URL it
 * lands on; `github` reads the latest release document and matches the asset
 * naming (carrying size and the published sha256 digest).
 * @param source - where to resolve from.
 * @param platform - which installer to resolve.
 * @param fetchImpl - fetch implementation (injectable for tests).
 * @returns the resolved asset.
 */
export async function resolveDesktopAsset(source: DesktopSource, platform: Exclude<DesktopPlatform, 'none'>, fetchImpl: FetchLike): Promise<DesktopAsset> {
  if (source === 'cn') {
    const response = await fetchImpl(CN_DOWNLOADS[platform], { method: 'HEAD' })
    if (!response.ok) throw new Error(`dshdesktop.cn responded ${response.status}`)
    const url = response.url === '' ? CN_DOWNLOADS[platform] : response.url
    const fileName = parseContentDispositionFileName(response.headers.get('content-disposition')) ?? fileNameFromUrl(url)
    if (fileName === undefined) throw new Error('the download endpoint did not name a file')
    const size = numberOrUndefined(response.headers.get('content-length'))
    return size === undefined ? { url, fileName } : { url, fileName, size }
  }
  const response = await fetchImpl(GITHUB_LATEST, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-zcf' } })
  if (!response.ok) throw new Error(`GitHub API responded ${response.status}`)
  const release = await response.json() as { assets?: Array<{ name?: string; browser_download_url?: string; size?: number; digest?: string }> }
  const asset = (release.assets ?? []).find(candidate => typeof candidate.name === 'string' && GITHUB_ASSET_PATTERN[platform].test(candidate.name))
  if (asset === undefined || typeof asset.browser_download_url !== 'string') throw new Error(`the latest DSH Desktop release has no ${platform} asset`)
  const resolved: DesktopAsset = { url: asset.browser_download_url, fileName: asset.name as string }
  if (typeof asset.size === 'number') resolved.size = asset.size
  if (typeof asset.digest === 'string') resolved.sha256 = asset.digest.replace(/^sha256:/, '')
  return resolved
}

/** Progress facts for one callback tick while streaming the installer down. */
export interface DownloadProgress {
  received: number
  /** Missing when neither the response nor the asset declared a length. */
  total: number | undefined
}

/**
 * Stream the installer into `destDir`, reporting progress at most every ~1.5s,
 * verifying the published sha256 when present, and committing via a `.part`
 * rename so a partial download never masquerades as the real thing.
 * @param asset - the resolved asset to fetch.
 * @param destDir - directory to save into (created when missing).
 * @param onProgress - progress sink (wired to the wizard's output).
 * @param fetchImpl - fetch implementation (injectable for tests).
 * @returns the absolute path of the saved installer.
 */
export async function downloadDesktopInstaller(asset: DesktopAsset, destDir: string, onProgress: (progress: DownloadProgress) => void | undefined, fetchImpl: FetchLike = fetch as FetchLike): Promise<string> {
  await mkdir(destDir, { recursive: true })
  const response = await fetchImpl(asset.url)
  if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`)
  const total = numberOrUndefined(response.headers.get('content-length')) ?? asset.size
  const destination = join(destDir, asset.fileName)
  const partial = `${destination}.part`
  const hasher = createHash('sha256')
  const writer = createWriteStream(partial)
  const reader = response.body.getReader()
  let received = 0
  let lastTick = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done === true || value === undefined) break
      hasher.update(value)
      // The write callback resolves on success and rejects with the stream
      // error otherwise (Node passes `null` for "no error").
      await new Promise<void>((resolve, reject) => writer.write(value, error => error === null || error === undefined ? resolve() : reject(error)))
      received += value.byteLength
      const now = Date.now()
      if (onProgress !== undefined && (now - lastTick >= 1500 || (total !== undefined && received >= total))) {
        lastTick = now
        onProgress({ received, total })
      }
    }
    await new Promise<void>((resolve, reject) => writer.end((error: Error | null | undefined) => error === null || error === undefined ? resolve() : reject(error)))
    if (asset.sha256 !== undefined && hasher.digest('hex') !== asset.sha256) throw new Error('sha256 mismatch')
    await rename(partial, destination)
  } catch (error) {
    await rm(partial, { force: true })
    throw error
  }
  return destination
}
