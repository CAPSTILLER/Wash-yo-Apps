import { unzipSync, zipSync } from 'fflate'
import {
  convertWavBytesToMp3,
  isWavPath,
  wavPathToMp3,
} from './ffmpegWav'
import {
  analyzeHostStrip,
  applyHostStripToFiles,
  emptyHostStrip,
  stripHostFromNpmScript,
  type HostStripInfo,
} from './hostStrip'
import {
  applyGrokHrefRewrites,
  type GrokHrefRewriteResult,
} from './grokHrefRewrite'
import {
  applyPwaPack,
  type PwaApplyResult,
  type PwaPackOptions,
} from './pwaPack'
import {
  applyPasswordGate,
  type PasswordGateApplyResult,
  type PasswordGateOptions,
} from './passwordGate'
import {
  applyWalletVisibility,
  type WalletVisibilityOptions,
  type WalletVisibilityResult,
} from './walletVisibility'
import {
  applyCapEasterEgg,
  type CapEasterEggApplyResult,
  type CapEasterEggOptions,
} from './capEasterEgg'
import {
  isViteConfigFileName,
  rewriteViteConfigForVercel,
  simplifyBuildScriptForVercel,
  type ViteConfigFixResult,
} from './viteConfigFix'
import {
  basename,
  decodeText,
  encodeText,
  findFileKey,
  findRootMostPackageJson,
  normalizePath,
  pathParts,
} from './zipPaths'

export { findRootMostPackageJson } from './zipPaths'
export type { HostStripInfo } from './hostStrip'
export {
  rewriteViteConfigForVercel,
  simplifyBuildScriptForVercel,
} from './viteConfigFix'
export type { PwaPackOptions, PwaApplyResult } from './pwaPack'
export type { GrokHrefRewriteResult } from './grokHrefRewrite'
export type {
  PasswordGateOptions,
  PasswordGateApplyResult,
  GateConfig,
} from './passwordGate'
export type {
  WalletVisibilityOptions,
  WalletVisibilityResult,
} from './walletVisibility'
export type {
  CapEasterEggOptions,
  CapEasterEggApplyResult,
} from './capEasterEgg'

export type CleanOptions = {
  nodeModules: boolean
  buildDirs: boolean
  git: boolean
  osJunk: boolean
  vercel: boolean
  /** Strip .grok/ meta + grok sandbox leftovers (__grok, grok-pwa*, with-app-env*) */
  grok: boolean
  sandboxCrumbs: boolean
  logs: boolean
  wav: boolean
  /** Convert remaining *.wav to *.mp3 (ffmpeg.wasm). Default OFF. Wins over wav remove. */
  convertWavToMp3: boolean
  /** Rewrite grok sandbox Vite/Vercel issues (with-app-env, build chains, vite.config ./scripts imports) */
  fixViteScripts: boolean
  /** When true, leave --host / 0.0.0.0. Default OFF — hard to leave on. */
  keepHostExpose: boolean
  /**
   * Inject GITHUB-UPLOAD.txt + Must/Optional checklist for GitHub web upload
   * (Ctrl+A skips nested folders). Default ON. Does not flatten the tree.
   */
  githubUploadHelper: boolean
}

export const DEFAULT_OPTIONS: CleanOptions = {
  nodeModules: true,
  buildDirs: true,
  git: true,
  osJunk: true,
  vercel: true,
  grok: true,
  sandboxCrumbs: true,
  logs: true,
  wav: false,
  convertWavToMp3: false,
  fixViteScripts: true,
  keepHostExpose: false,
  githubUploadHelper: true,
}

/** Build/cache dirs stripped when buildDirs is on */
export const BUILD_DIR_NAMES = [
  '.next',
  'dist',
  'build',
  'out',
  '.turbo',
  '.cache',
  'coverage',
] as const

export type RemovalBucket =
  | 'node_modules'
  | 'build_dirs'
  | 'git'
  | 'os_junk'
  | 'vercel'
  | '.grok'
  | 'sandbox_crumbs'
  | 'logs'
  | 'wav'
  | 'other'

export type EntryInfo = {
  path: string
  size: number
  remove: boolean
  bucket: RemovalBucket | null
}

export type ViteScriptFixInfo = {
  willApply: boolean
  packageJsonPath: string | null
  scriptsChanged: string[]
  viteAdded: boolean
  /** Human-readable summary for scan UI */
  summary: string | null
  /** vite.config paths rewritten (dynamic import / inline) */
  viteConfigFixed: string[]
  /** vite.config paths that need a manual Capstiller/Vercel fix */
  viteConfigManualFix: string[]
  /** package.json paths where scripts.build was simplified to vite build */
  buildSimplified: string[]
}

export type ScanResult = {
  entries: EntryInfo[]
  totalEntries: number
  totalSize: number
  removeCount: number
  removeSize: number
  keepCount: number
  keepSize: number
  byBucket: Record<RemovalBucket, { count: number; size: number }>
  /** Unzipped file map for re-zip (kept in memory until clear) */
  files: Record<string, Uint8Array>
  viteScriptFix: ViteScriptFixInfo
  hostStrip: HostStripInfo
  /** Kept *.wav entries that would convert when convertWavToMp3 is ON */
  wavConvertCandidates: { path: string; size: number }[]
}

const DEFAULT_VITE_VERSION = '^8.3.0'

function emptyBuckets(): Record<RemovalBucket, { count: number; size: number }> {
  return {
    node_modules: { count: 0, size: 0 },
    build_dirs: { count: 0, size: 0 },
    git: { count: 0, size: 0 },
    os_junk: { count: 0, size: 0 },
    vercel: { count: 0, size: 0 },
    '.grok': { count: 0, size: 0 },
    sandbox_crumbs: { count: 0, size: 0 },
    logs: { count: 0, size: 0 },
    wav: { count: 0, size: 0 },
    other: { count: 0, size: 0 },
  }
}

function emptyViteFix(): ViteScriptFixInfo {
  return {
    willApply: false,
    packageJsonPath: null,
    scriptsChanged: [],
    viteAdded: false,
    summary: null,
    viteConfigFixed: [],
    viteConfigManualFix: [],
    buildSimplified: [],
  }
}


/**
 * Path-based grok.com sandbox leftovers (PWA install assets, wrappers).
 * Does not match by file contents — src/ comments mentioning "grok" stay.
 */
export function isGrokSandboxLeftoverPath(
  _path: string,
  name: string,
  lowerName: string,
  parts: string[],
): boolean {
  // scripts/grok-pwa* / *grok-pwa* (any depth) — basename contains grok-pwa
  if (/grok-pwa/i.test(name)) return true

  // Known server leftovers from grok sandbox PWA middleware / OG identity
  if (
    lowerName === 'virtual-grok-og-identity.d.ts' ||
    (parts.includes('middleware') && lowerName.startsWith('grok-pwa'))
  ) {
    return true
  }
  // Also catch server/virtual-grok-og-identity.d.ts by name alone
  if (lowerName.includes('virtual-grok-og-identity')) return true

  // with-app-env* — package.json already rewritten to plain vite; wrapper unused
  if (/^with-app-env/i.test(name)) return true

  return false
}

/**
 * Decide if a path should be stripped given options.
 * Never strips package.json, src/, public assets, mp3, images unless wav opted in.
 */
export function classifyPath(
  rawPath: string,
  opts: CleanOptions,
): { remove: boolean; bucket: RemovalBucket | null } {
  const path = normalizePath(rawPath)
  if (!path || path.endsWith('/')) {
    // Directory markers — classify by dir name rules
  }

  const parts = pathParts(path)
  const name = basename(path)
  const lowerName = name.toLowerCase()

  if (opts.nodeModules && parts.includes('node_modules')) {
    return { remove: true, bucket: 'node_modules' }
  }

  if (opts.buildDirs) {
    for (const dir of BUILD_DIR_NAMES) {
      if (parts.includes(dir)) {
        return { remove: true, bucket: 'build_dirs' }
      }
    }
  }

  if (opts.git && parts.includes('.git')) {
    return { remove: true, bucket: 'git' }
  }

  if (opts.osJunk) {
    if (parts.includes('__MACOSX')) return { remove: true, bucket: 'os_junk' }
    if (lowerName === '.ds_store' || lowerName === 'thumbs.db') {
      return { remove: true, bucket: 'os_junk' }
    }
  }

  if (opts.vercel && parts.includes('.vercel')) {
    return { remove: true, bucket: 'vercel' }
  }

  if (opts.grok) {
    if (parts.includes('.grok') || parts.includes('__grok')) {
      return { remove: true, bucket: '.grok' }
    }
    const sandboxMeta = ['.grokignore', '.sandbox', '.cursorignore.bak']
    if (sandboxMeta.includes(lowerName) || sandboxMeta.includes(name)) {
      return { remove: true, bucket: '.grok' }
    }
    if (parts.includes('.sandbox-meta') || parts.includes('.grok-sandbox')) {
      return { remove: true, bucket: '.grok' }
    }
    // Grok.com sandbox leftover install / PWA assets (path-based — not src/ comments)
    if (isGrokSandboxLeftoverPath(path, name, lowerName, parts)) {
      return { remove: true, bucket: '.grok' }
    }
  }

  if (opts.sandboxCrumbs) {
    const crumbNames = [
      '.project_id',
      '.node_modules.lock',
      '.sandbox',
      '.project',
    ]
    if (crumbNames.includes(name) || crumbNames.includes(lowerName)) {
      return { remove: true, bucket: 'sandbox_crumbs' }
    }
    if (
      parts.includes('.project_id') ||
      parts.includes('.sandbox') ||
      parts.includes('.project')
    ) {
      return { remove: true, bucket: 'sandbox_crumbs' }
    }
  }

  if (opts.logs && lowerName.endsWith('.log')) {
    return { remove: true, bucket: 'logs' }
  }

  if (opts.wav && !opts.convertWavToMp3 && lowerName.endsWith('.wav')) {
    return { remove: true, bucket: 'wav' }
  }

  return { remove: false, bucket: null }
}

export const WAV_CONVERT_WARN = {
  count: 8,
  totalBytes: 40 * 1024 * 1024,
} as const

export function wavConvertWarning(
  candidates: { path: string; size: number }[],
): string | null {
  if (candidates.length === 0) return null
  const total = candidates.reduce((s, c) => s + c.size, 0)
  const parts: string[] = []
  if (candidates.length >= WAV_CONVERT_WARN.count) {
    parts.push(`${candidates.length} WAV files`)
  }
  if (total >= WAV_CONVERT_WARN.totalBytes) {
    parts.push(`${formatBytes(total)} of WAV data`)
  }
  if (parts.length === 0) return null
  return `Warning: ${parts.join(' / ')} — conversion may be slow or hit browser memory (OOM). First run also downloads ffmpeg core (~25–30 MB).`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export type MediaKind = 'image' | 'audio' | 'video'

export type MediaEntry = {
  path: string
  kind: MediaKind
  size: number
  mime: string
}

const IMAGE_EXTS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'svg',
  'ico',
  'avif',
])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'avi'])

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
  avi: 'video/x-msvideo',
}

export function mediaKindFromPath(rawPath: string): MediaKind | null {
  const name = basename(normalizePath(rawPath)).toLowerCase()
  const dot = name.lastIndexOf('.')
  if (dot < 0) return null
  const ext = name.slice(dot + 1)
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (VIDEO_EXTS.has(ext)) return 'video'
  return null
}

export function mimeForMediaPath(rawPath: string): string {
  const name = basename(normalizePath(rawPath)).toLowerCase()
  const dot = name.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  const ext = name.slice(dot + 1)
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

/**
 * List image / audio / video entries from an unzipped files map.
 * When `opts` is provided, skip paths already stripped by classifyPath
 * (media review is for junk the user may still opt to remove).
 */
export function listMediaEntries(
  files: Record<string, Uint8Array>,
  opts?: CleanOptions,
): MediaEntry[] {
  const out: MediaEntry[] = []
  for (const [rawPath, bytes] of Object.entries(files)) {
    const path = normalizePath(rawPath)
    if (!path || path.endsWith('/')) continue
    const kind = mediaKindFromPath(path)
    if (!kind) continue
    if (opts) {
      const { remove } = classifyPath(path, opts)
      if (remove) continue
    }
    out.push({
      path,
      kind,
      size: bytes.byteLength,
      mime: mimeForMediaPath(path),
    })
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) {
      const order: Record<MediaKind, number> = { image: 0, audio: 1, video: 2 }
      return order[a.kind] - order[b.kind]
    }
    return a.path.localeCompare(b.path)
  })
  return out
}

function toRemovePathSet(
  extra?: Set<string> | string[] | null,
): Set<string> {
  if (!extra) return new Set()
  if (extra instanceof Set) {
    const s = new Set<string>()
    for (const p of extra) s.add(normalizePath(p))
    return s
  }
  return new Set(extra.map((p) => normalizePath(p)))
}

/** True if script invokes scripts/with-app-env.mjs together with vite */
export function scriptUsesWithAppEnvVite(script: string): boolean {
  if (!script.includes('with-app-env.mjs')) return false
  if (!/\bvite\b/.test(script)) return false
  return /(?:^|[\s;&|])(?:node\s+)?(?:\.\/)?scripts\/with-app-env\.mjs\b/.test(
    script,
  )
}

/**
 * Strip with-app-env.mjs wrapper; drop --host unless keepHostExpose.
 * Also strips host from plain vite scripts (no wrapper required).
 * Returns null if unchanged.
 */
export function rewriteViteScript(
  script: string,
  keepHostExpose: boolean,
): string | null {
  const usesWrapper = scriptUsesWithAppEnvVite(script)
  let out = script

  if (usesWrapper) {
    out = out.replace(
      /(?:node\s+)?(?:\.\/)?scripts\/with-app-env\.mjs\s+/g,
      '',
    )
  }

  if (!keepHostExpose) {
    out = stripHostFromNpmScript(out)
  }

  out = out.replace(/[ \t]+/g, ' ').replace(/\s+$/gm, '').trim()
  out = out.replace(/\s*&&\s*/g, ' && ')

  return out === script.trim() ? null : out
}

type PackageJsonLike = {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  [key: string]: unknown
}

export type FixPackageJsonResult = {
  changed: boolean
  jsonText: string
  scriptsChanged: string[]
  wrapperScripts: string[]
  viteAdded: boolean
  buildSimplified: boolean
}

/**
 * Parse package.json, rewrite with-app-env vite scripts, strip --host from
 * every script unless keepHostExpose, ensure vite in devDependencies when a
 * wrapper was rewritten.
 */
export function fixPackageJsonViteScripts(
  rawText: string,
  keepHostExpose: boolean,
): FixPackageJsonResult {
  let pkg: PackageJsonLike
  try {
    pkg = JSON.parse(rawText) as PackageJsonLike
  } catch {
    return {
      changed: false,
      jsonText: rawText,
      scriptsChanged: [],
      wrapperScripts: [],
      viteAdded: false,
      buildSimplified: false,
    }
  }

  const scriptsChanged: string[] = []
  const wrapperScripts: string[] = []
  let changed = false
  let buildSimplified = false

  if (pkg.scripts && typeof pkg.scripts === 'object') {
    const next: Record<string, string> = { ...pkg.scripts }
    for (const [name, value] of Object.entries(pkg.scripts)) {
      if (typeof value !== 'string') continue
      const hadWrapper = scriptUsesWithAppEnvVite(value)
      const rewritten = rewriteViteScript(value, keepHostExpose)
      if (rewritten !== null) {
        next[name] = rewritten
        scriptsChanged.push(name)
        if (hadWrapper) wrapperScripts.push(name)
        changed = true
      }
    }
    pkg.scripts = next

    // Vercel-safe build: drop db:migrate / with-app-env chains
    if (typeof next.build === 'string') {
      const simplified = simplifyBuildScriptForVercel(next.build)
      if (simplified !== null) {
        next.build = simplified
        if (!scriptsChanged.includes('build')) scriptsChanged.push('build')
        buildSimplified = true
        changed = true
        pkg.scripts = next
      }
    }
  }

  let viteAdded = false
  if (wrapperScripts.length > 0) {
    const deps = pkg.dependencies ?? {}
    const dev = { ...(pkg.devDependencies ?? {}) }
    const existingVersion =
      (typeof dev.vite === 'string' && dev.vite) ||
      (typeof deps.vite === 'string' && deps.vite) ||
      null

    if (!dev.vite) {
      dev.vite = existingVersion ?? DEFAULT_VITE_VERSION
      pkg.devDependencies = dev
      viteAdded = !existingVersion
      changed = true
    }
  }

  if (!changed) {
    return {
      changed: false,
      jsonText: rawText,
      scriptsChanged: [],
      wrapperScripts: [],
      viteAdded: false,
      buildSimplified: false,
    }
  }

  const jsonText = `${JSON.stringify(pkg, null, 2)}\n`
  return {
    changed: true,
    jsonText,
    scriptsChanged,
    wrapperScripts,
    viteAdded,
    buildSimplified,
  }
}

/**
 * Inspect kept files for Vite/Vercel auto-fixes:
 * - with-app-env.mjs wrappers → plain vite
 * - scripts.build chains with db:migrate / with-app-env → `vite build`
 * - vite.config static ./scripts/*.mjs imports → inline trivial helpers + dynamic import
 *
 * Does NOT strip scripts/*.mjs (including migration-plan.mjs) — those stay for
 * runtime dynamic import / app code. Strip rules never targeted them.
 */
export function analyzeViteScriptFix(
  files: Record<string, Uint8Array>,
  opts: CleanOptions,
): ViteScriptFixInfo {
  if (!opts.fixViteScripts) return emptyViteFix()

  const kept = keptFilesView(files, opts)
  return collectViteFixInfo(kept, opts, /*mutate*/ false)
}

function collectPackageJsonPaths(kept: Record<string, Uint8Array>): string[] {
  const out: string[] = []
  for (const raw of Object.keys(kept)) {
    const n = normalizePath(raw)
    if (n.split('/').includes('node_modules')) continue
    if (basename(n) === 'package.json') out.push(n)
  }
  out.sort(
    (a, b) =>
      a.split('/').filter(Boolean).length - b.split('/').filter(Boolean).length ||
      a.localeCompare(b),
  )
  return out
}

function collectViteConfigPaths(kept: Record<string, Uint8Array>): string[] {
  const out: string[] = []
  for (const raw of Object.keys(kept)) {
    const n = normalizePath(raw)
    if (n.split('/').includes('node_modules')) continue
    if (isViteConfigFileName(basename(n))) out.push(n)
  }
  out.sort()
  return out
}

function collectViteFixInfo(
  kept: Record<string, Uint8Array>,
  opts: CleanOptions,
  mutate: boolean,
): ViteScriptFixInfo {
  const scriptsChanged: string[] = []
  const wrapperScripts: string[] = []
  const buildSimplified: string[] = []
  const viteConfigFixed: string[] = []
  const viteConfigManualFix: string[] = []
  let viteAdded = false
  let packageJsonPath: string | null = findRootMostPackageJson(Object.keys(kept))
  const summaryParts: string[] = []

  for (const pkgPath of collectPackageJsonPaths(kept)) {
    const key = findFileKey(kept, pkgPath)
    if (!key || !kept[key]) continue
    const text = decodeText(kept[key])
    const result = fixPackageJsonViteScripts(text, opts.keepHostExpose)
    if (!result.changed) continue
    if (mutate) kept[key] = encodeText(result.jsonText)
    for (const s of result.scriptsChanged) {
      if (!scriptsChanged.includes(s)) scriptsChanged.push(s)
    }
    for (const s of result.wrapperScripts) {
      if (!wrapperScripts.includes(s)) wrapperScripts.push(s)
    }
    if (result.buildSimplified) buildSimplified.push(pkgPath)
    if (result.viteAdded) viteAdded = true
    if (!packageJsonPath) packageJsonPath = pkgPath
  }

  for (const cfgPath of collectViteConfigPaths(kept)) {
    const key = findFileKey(kept, cfgPath)
    if (!key || !kept[key]) continue
    const src = decodeText(kept[key])
    const result: ViteConfigFixResult = rewriteViteConfigForVercel(src)
    if (result.needsManualFix) {
      viteConfigManualFix.push(cfgPath)
      continue
    }
    if (result.changed) {
      if (mutate) kept[key] = encodeText(result.text)
      viteConfigFixed.push(cfgPath)
      if (result.summary) summaryParts.push(`${cfgPath}: ${result.summary}`)
    }
  }

  if (wrapperScripts.length > 0) {
    summaryParts.unshift(
      `rewrite with-app-env scripts: ${wrapperScripts.map((s) => `"${s}"`).join(', ')}`,
    )
  }
  if (buildSimplified.length > 0) {
    summaryParts.push(
      `simplify build → vite build in ${buildSimplified.join(', ')}`,
    )
  }
  if (viteAdded) {
    summaryParts.push(`add vite ${DEFAULT_VITE_VERSION} to devDependencies`)
  }
  if (viteConfigManualFix.length > 0) {
    summaryParts.push(
      `vite.config needs manual fix: ${viteConfigManualFix.join(', ')}`,
    )
  }

  const willApply =
    wrapperScripts.length > 0 ||
    buildSimplified.length > 0 ||
    viteConfigFixed.length > 0 ||
    viteConfigManualFix.length > 0 ||
    viteAdded

  return {
    willApply,
    packageJsonPath,
    scriptsChanged,
    viteAdded,
    summary: willApply ? summaryParts.join('; ') || 'Vite / Vercel fixes pending' : null,
    viteConfigFixed,
    viteConfigManualFix,
    buildSimplified,
  }
}

function keptFilesView(
  files: Record<string, Uint8Array>,
  opts: CleanOptions,
): Record<string, Uint8Array> {
  const kept: Record<string, Uint8Array> = {}
  for (const [rawPath, bytes] of Object.entries(files)) {
    const path = normalizePath(rawPath)
    const { remove } = classifyPath(path, opts)
    if (!remove) kept[path] = bytes
  }
  return kept
}

function summarizeFromFiles(
  files: Record<string, Uint8Array>,
  opts: CleanOptions,
): ScanResult {
  const entries: EntryInfo[] = []
  const byBucket = emptyBuckets()
  let totalSize = 0
  let removeCount = 0
  let removeSize = 0
  let keepCount = 0
  let keepSize = 0

  for (const [rawPath, bytes] of Object.entries(files)) {
    const path = normalizePath(rawPath)
    const size = bytes.byteLength
    const { remove, bucket } = classifyPath(path, opts)

    entries.push({ path, size, remove, bucket })
    totalSize += size

    if (remove && bucket) {
      removeCount += 1
      removeSize += size
      byBucket[bucket].count += 1
      byBucket[bucket].size += size
    } else {
      keepCount += 1
      keepSize += size
    }
  }

  entries.sort((a, b) => {
    if (a.remove !== b.remove) return a.remove ? -1 : 1
    return a.path.localeCompare(b.path)
  })

  const viteScriptFix = analyzeViteScriptFix(files, opts)
  const hostStrip = opts.keepHostExpose
    ? emptyHostStrip()
    : analyzeHostStrip(keptFilesView(files, opts), {
        keepHostExpose: opts.keepHostExpose,
        fixViteScripts: opts.fixViteScripts,
      })

  const wavConvertCandidates = entries
    .filter((e) => !e.remove && isWavPath(e.path))
    .map((e) => ({ path: e.path, size: e.size }))

  return {
    entries,
    totalEntries: entries.length,
    totalSize,
    removeCount,
    removeSize,
    keepCount,
    keepSize,
    byBucket,
    files,
    viteScriptFix,
    hostStrip,
    wavConvertCandidates,
  }
}

export function scanZip(data: Uint8Array, opts: CleanOptions): ScanResult {
  const unzipped = unzipSync(data)
  return summarizeFromFiles(unzipped, opts)
}

export function rescanFiles(
  files: Record<string, Uint8Array>,
  opts: CleanOptions,
): ScanResult {
  return summarizeFromFiles(files, opts)
}

export function applyViteScriptFixToFiles(
  kept: Record<string, Uint8Array>,
  opts: CleanOptions,
): ViteScriptFixInfo {
  if (!opts.fixViteScripts) return emptyViteFix()
  return collectViteFixInfo(kept, opts, /*mutate*/ true)
}

export const GITHUB_UPLOAD_FILENAME = 'GITHUB-UPLOAD.txt'

export type GithubUploadHelper = {
  /** Project root prefix inside the zip ('' = zip root) */
  projectRoot: string
  /** Immediate child folders under project root (no trailing slash in stored name) */
  folders: string[]
  /** Immediate child files under project root */
  rootFiles: string[]
  /** Folders that should be uploaded for a Vercel deploy */
  mustFolders: string[]
  /** Root files that should be uploaded for a Vercel deploy */
  mustFiles: string[]
  /** Nice-to-have folders (docs, screenshots, helper text) */
  optionalFolders: string[]
  /** Nice-to-have root files */
  optionalFiles: string[]
  /** Path where the helper file was written in the zip */
  helperPath: string
  /** Full plain-text contents of GITHUB-UPLOAD.txt */
  text: string
}

/**
 * Resolve project root for the upload checklist: dirname of shallowest
 * package.json when present, otherwise zip root ('').
 */
export function resolveGithubProjectRoot(
  paths: string[],
): string {
  const pkg = findRootMostPackageJson(paths)
  if (pkg) {
    const parts = pathParts(pkg)
    if (parts.length <= 1) return ''
    return parts.slice(0, -1).join('/')
  }
  return ''
}

/**
 * Collect unique top-level folders vs root files under projectRoot from kept paths.
 * Does not restructure the tree — analysis only.
 */
export function analyzeGithubUploadTargets(
  files: Record<string, Uint8Array>,
  projectRoot?: string,
): { projectRoot: string; folders: string[]; rootFiles: string[] } {
  const paths = Object.keys(files).map(normalizePath)
  const root =
    projectRoot !== undefined ? projectRoot : resolveGithubProjectRoot(paths)
  const rootPrefix = root ? `${root}/` : ''
  const folders = new Set<string>()
  const rootFiles = new Set<string>()

  for (const p of paths) {
    if (root) {
      if (p === root) continue
      if (!p.startsWith(rootPrefix)) continue
      const rest = p.slice(rootPrefix.length)
      if (!rest) continue
      const segs = rest.split('/').filter(Boolean)
      if (segs.length === 0) continue
      if (segs.length === 1) {
        // file at project root (zip entries are files; bare dir markers rare)
        rootFiles.add(segs[0]!)
      } else {
        folders.add(segs[0]!)
      }
    } else {
      const segs = pathParts(p)
      if (segs.length === 0) continue
      if (segs.length === 1) {
        rootFiles.add(segs[0]!)
      } else {
        folders.add(segs[0]!)
      }
    }
  }

  // A name that appears both as a lone file and as a folder prefix is a folder
  for (const f of folders) rootFiles.delete(f)

  const folderList = [...folders].sort((a, b) => a.localeCompare(b))
  const fileList = [...rootFiles].sort((a, b) => a.localeCompare(b))
  return { projectRoot: root, folders: folderList, rootFiles: fileList }
}


/** Top-level folders typically required for Capstiller / Vite → Vercel deploys */
export const GITHUB_MUST_FOLDERS = [
  'src',
  'public',
  'server',
  'scripts',
  'migrations',
  'attachments',
  'shared',
  'lib',
  'api',
  'components',
  'app',
  'pages',
  'styles',
  'assets',
  'drizzle',
  'prisma',
  'supabase',
] as const

/** Top-level folders that are usually optional for the deploy itself */
export const GITHUB_OPTIONAL_FOLDERS = [
  'screenshots',
  'artifacts',
  'docs',
  'design',
  '.github',
] as const

/** Root files that are usually optional */
export const GITHUB_OPTIONAL_FILES = [
  GITHUB_UPLOAD_FILENAME,
  'AGENTS.md',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'LICENSE.md',
  '.gitignore',
  '.npmrc',
  '.editorconfig',
  'CONTRIBUTING.md',
] as const

/**
 * Split analyzed top-level folders/files into Must (Vercel) vs Optional.
 * attachments/ is Must — Capstiller southern-cap layouts keep site media there.
 * Unknown folders default to Must (safer for deploy); unknown files default to Must
 * when they look like configs (vite/tsconfig/eslint/…) else Optional.
 */
export function partitionGithubUploadTargets(info: {
  folders: string[]
  rootFiles: string[]
}): {
  mustFolders: string[]
  mustFiles: string[]
  optionalFolders: string[]
  optionalFiles: string[]
} {
  const mustFolderSet = new Set(
    GITHUB_MUST_FOLDERS.map((s) => s.toLowerCase()),
  )
  const optionalFolderSet = new Set(
    GITHUB_OPTIONAL_FOLDERS.map((s) => s.toLowerCase()),
  )
  const optionalFileSet = new Set(
    GITHUB_OPTIONAL_FILES.map((s) => s.toLowerCase()),
  )

  const mustFolders: string[] = []
  const optionalFolders: string[] = []
  for (const f of info.folders) {
    const low = f.toLowerCase()
    if (optionalFolderSet.has(low)) optionalFolders.push(f)
    else if (mustFolderSet.has(low)) mustFolders.push(f)
    else mustFolders.push(f) // unknown folder → Must (safer for site)
  }

  const mustFiles: string[] = []
  const optionalFiles: string[] = []
  for (const f of info.rootFiles) {
    const low = f.toLowerCase()
    if (optionalFileSet.has(low)) {
      optionalFiles.push(f)
      continue
    }
    // Root configs that matter for Vercel / Vite
    if (
      low === 'package.json' ||
      low === 'package-lock.json' ||
      low === 'pnpm-lock.yaml' ||
      low === 'yarn.lock' ||
      low === 'bun.lock' ||
      low === 'bun.lockb' ||
      low === 'vercel.json' ||
      low === 'index.html' ||
      low.startsWith('vite.config.') ||
      low.startsWith('tsconfig') ||
      low.startsWith('jsconfig') ||
      low.startsWith('eslint') ||
      low.startsWith('.eslintrc') ||
      low.startsWith('prettier') ||
      low.startsWith('.prettierrc') ||
      low.startsWith('postcss.config.') ||
      low.startsWith('tailwind.config.') ||
      low.startsWith('drizzle.config.') ||
      low === 'components.json' ||
      low === '.env.example' ||
      low === 'env.example' ||
      low === 'Dockerfile' ||
      low === 'docker-compose.yml'
    ) {
      mustFiles.push(f)
      continue
    }
    // Default: treat as Must if it looks like source/config, else Optional
    if (
      /\.(ts|tsx|js|mjs|cjs|json|css|scss|html|toml|yaml|yml)$/i.test(f) &&
      !/^agents\.md$/i.test(f)
    ) {
      mustFiles.push(f)
    } else {
      optionalFiles.push(f)
    }
  }

  return { mustFolders, mustFiles, optionalFolders, optionalFiles }
}

export function formatGithubUploadText(info: {
  projectRoot: string
  folders: string[]
  rootFiles: string[]
  mustFolders?: string[]
  mustFiles?: string[]
  optionalFolders?: string[]
  optionalFiles?: string[]
}): string {
  const parts = partitionGithubUploadTargets(info)
  const mustFolders = info.mustFolders ?? parts.mustFolders
  const mustFiles = info.mustFiles ?? parts.mustFiles
  const optionalFolders = info.optionalFolders ?? parts.optionalFolders
  const optionalFiles = info.optionalFiles ?? parts.optionalFiles

  const fmtFolders = (list: string[]) =>
    list.length > 0 ? list.map((f) => `  - ${f}/`).join('\n') : '  (none)'
  const fmtFiles = (list: string[]) =>
    list.length > 0 ? list.map((f) => `  - ${f}`).join('\n') : '  (none)'

  const where =
    info.projectRoot === ''
      ? 'the extracted zip root'
      : `the "${info.projectRoot}" folder after extract`

  return `GitHub upload helper
====================

Prefer GitHub Desktop (https://desktop.github.com/) — one push, whole tree.
Web Upload with Ctrl+A often skips nested folders.

If you use the GitHub website "Upload files":
1. Extract this zip.
2. Open ${where}.
3. Drag items from the sections below onto the upload area
   (do not rely on Ctrl+A alone — nested folders get missed).

Must upload for Vercel
----------------------
Folders:
${fmtFolders(mustFolders)}

Root files:
${fmtFiles(mustFiles)}

Optional
--------
Folders:
${fmtFolders(optionalFolders)}

Root files:
${fmtFiles(optionalFiles)}

Notes:
- attachments/ is listed under Must when present — Capstiller apps often keep
  site media (mp3/images) there that the running site references.
- GITHUB-UPLOAD.txt / AGENTS.md / screenshots/ are optional for the deploy.
- Prefer GitHub Desktop / git push for one shot of the whole tree.
`
}

export function buildGithubUploadHelper(
  files: Record<string, Uint8Array>,
): GithubUploadHelper {
  const analyzed = analyzeGithubUploadTargets(files)
  // Ensure the helper file itself appears in the root-files checklist (Optional)
  const rootFiles = analyzed.rootFiles.includes(GITHUB_UPLOAD_FILENAME)
    ? analyzed.rootFiles
    : [...analyzed.rootFiles, GITHUB_UPLOAD_FILENAME].sort((a, b) =>
        a.localeCompare(b),
      )
  const partitioned = partitionGithubUploadTargets({
    folders: analyzed.folders,
    rootFiles,
  })
  const withHelper = {
    ...analyzed,
    rootFiles,
    ...partitioned,
  }
  const text = formatGithubUploadText(withHelper)
  const helperPath = analyzed.projectRoot
    ? `${analyzed.projectRoot}/${GITHUB_UPLOAD_FILENAME}`
    : GITHUB_UPLOAD_FILENAME
  return {
    projectRoot: analyzed.projectRoot,
    folders: analyzed.folders,
    rootFiles,
    ...partitioned,
    helperPath,
    text,
  }
}

export type BuildProgress = {
  phase:
    | 'stripping'
    | 'loading-ffmpeg'
    | 'converting'
    | 'host-strip'
    | 'pwa'
    | 'wallet'
    | 'gate'
    | 'easter-egg'
    | 'zipping'
  message: string
  current?: number
  total?: number
}

export type WavConvertFailure = {
  path: string
  error: string
}

export type InjectionSummary = {
  iconsWritten: string[]
  manifestPath: string | null
  htmlPatched: string[]
  /** Text files where /__grok/ icon+manifest hrefs were rewritten to pack assets */
  grokHrefsRewritten: string[]
  scriptsFixed: string[]
  hostStripped: string[]
  wavsConverted: number
  packageNameSet: string | null
  vercelJsonAdded: boolean
  pwaSkipped: string | null
  viteConfigFixed: string[]
  viteConfigManualFix: string[]
  buildSimplified: string[]
  /** Soft password gate (optional) */
  gateConfigPath: string | null
  gateScriptPath: string | null
  gateHtmlPatched: string[]
  gateTanstackPatched: string | null
  gateSkipped: string | null
  gateRemoteConfigUrl: string | null
  /** Base / OKX / store preview (OG + Twitter + og.jpg) */
  walletHtmlPatched: string[]
  walletOgImagePath: string | null
  walletOgImageHref: string | null
  walletFaviconIcoPath: string | null
  walletTitleUsed: string | null
  walletSkipped: string | null
  /** CAPSTILLER easter egg (optional) */
  eggAssetPath: string | null
  eggScriptPath: string | null
  eggHtmlPatched: string[]
  eggTanstackPatched: string | null
  eggSkipped: string | null
}

export type BuildCleanZipResult = {
  zip: Uint8Array
  converted: number
  failures: WavConvertFailure[]
  injections: InjectionSummary
  viteFix: ViteScriptFixInfo
  hostStrip: HostStripInfo
  pwa: PwaApplyResult | null
  githubUpload: GithubUploadHelper | null
}

function emptyInjections(): InjectionSummary {
  return {
    iconsWritten: [],
    manifestPath: null,
    htmlPatched: [],
    grokHrefsRewritten: [],
    scriptsFixed: [],
    hostStripped: [],
    wavsConverted: 0,
    packageNameSet: null,
    vercelJsonAdded: false,
    pwaSkipped: null,
    viteConfigFixed: [],
    viteConfigManualFix: [],
    buildSimplified: [],
    gateConfigPath: null,
    gateScriptPath: null,
    gateHtmlPatched: [],
    gateTanstackPatched: null,
    gateSkipped: null,
    gateRemoteConfigUrl: null,
    walletHtmlPatched: [],
    walletOgImagePath: null,
    walletOgImageHref: null,
    walletFaviconIcoPath: null,
    walletTitleUsed: null,
    walletSkipped: null,
    eggAssetPath: null,
    eggScriptPath: null,
    eggHtmlPatched: [],
    eggTanstackPatched: null,
    eggSkipped: null,
  }
}

/**
 * Strip junk, optionally convert kept WAVs → MP3, fix vite scripts,
 * neutralize --host / 0.0.0.0, inject PWA/install metadata, zip.
 */
export async function buildCleanZip(
  files: Record<string, Uint8Array>,
  opts: CleanOptions,
  onProgress?: (p: BuildProgress) => void,
  pwa?: PwaPackOptions,
  /** Extra relative paths the user marked for removal in Media review */
  extraRemovePaths?: Set<string> | string[] | null,
  passwordGate?: PasswordGateOptions,
  wallet?: WalletVisibilityOptions,
  easterEgg?: CapEasterEggOptions,
): Promise<BuildCleanZipResult> {
  onProgress?.({ phase: 'stripping', message: 'Applying strip rules…' })

  const extraRemove = toRemovePathSet(extraRemovePaths)

  const kept: Record<string, Uint8Array> = {}
  for (const [rawPath, bytes] of Object.entries(files)) {
    const path = normalizePath(rawPath)
    const { remove } = classifyPath(path, opts)
    if (remove || extraRemove.has(path)) continue
    kept[path] = bytes
  }

  const failures: WavConvertFailure[] = []
  let converted = 0

  if (opts.convertWavToMp3) {
    const wavEntries = Object.entries(kept).filter(([p]) => isWavPath(p))
    const total = wavEntries.length

    if (total > 0) {
      onProgress?.({
        phase: 'loading-ffmpeg',
        message: 'Loading ffmpeg…',
        current: 0,
        total,
      })

      for (let i = 0; i < wavEntries.length; i++) {
        const [wavPath, wavBytes] = wavEntries[i]!
        const n = i + 1
        onProgress?.({
          phase: 'converting',
          message: `Converting song ${n}/${total}…`,
          current: n,
          total,
        })

        try {
          const mp3 = await convertWavBytesToMp3(wavBytes, {
            onStatus: (message) =>
              onProgress?.({
                phase: 'loading-ffmpeg',
                message,
                current: n,
                total,
              }),
          })
          const mp3Path = wavPathToMp3(wavPath)
          kept[mp3Path] = mp3
          delete kept[wavPath]
          converted += 1
        } catch (err) {
          const error =
            err instanceof Error ? err.message : 'Conversion failed'
          failures.push({ path: wavPath, error })
        }
      }
    }
  }

  let viteFix = emptyViteFix()
  if (opts.fixViteScripts) {
    viteFix = applyViteScriptFixToFiles(kept, opts)
  }

  onProgress?.({
    phase: 'host-strip',
    message: 'Stripping --host / 0.0.0.0…',
  })
  const hostStrip = applyHostStripToFiles(kept, {
    keepHostExpose: opts.keepHostExpose,
    fixViteScripts: opts.fixViteScripts,
  })

  // When grok strip removes public/__grok/** and/or PWA pack injects root
  // icons + manifest, rewrite dangling /__grok/icon-*.png + manifest hrefs in
  // HTML/TS/JS so home-screen install never points at 404 junk.
  let grokHrefRewrite: GrokHrefRewriteResult = {
    filesRewritten: [],
    replacementCount: 0,
  }
  if (opts.grok || pwa?.enabled) {
    onProgress?.({
      phase: 'pwa',
      message: 'Rewriting __grok icon / manifest hrefs…',
    })
    grokHrefRewrite = applyGrokHrefRewrites(kept)
  }

  let pwaResult: PwaApplyResult | null = null
  if (pwa?.enabled) {
    onProgress?.({ phase: 'pwa', message: 'Adding PWA / install metadata…' })
    pwaResult = await applyPwaPack(kept, pwa, (message) =>
      onProgress?.({ phase: 'pwa', message }),
    )
  }

  // Base Discover / OKX wallet preview — always on by default as part of Clean/PWA
  let walletResult: WalletVisibilityResult | null = null
  const walletOpts: WalletVisibilityOptions = wallet ?? {
    enabled: true,
    appName: pwa?.appName ?? '',
    shortName: pwa?.shortName ?? '',
    publicSiteUrl: '',
  }
  if (walletOpts.enabled) {
    onProgress?.({
      phase: 'wallet',
      message: 'Adding Base / OKX store preview tags…',
    })
    walletResult = applyWalletVisibility(kept, {
      ...walletOpts,
      appName: walletOpts.appName || pwa?.appName || '',
      shortName: walletOpts.shortName || pwa?.shortName || '',
    })
  }

  let gateResult: PasswordGateApplyResult | null = null
  if (passwordGate?.enabled) {
    onProgress?.({ phase: 'gate', message: 'Injecting soft password gate…' })
    gateResult = await applyPasswordGate(kept, passwordGate)
  }

  let eggResult: CapEasterEggApplyResult | null = null
  if (easterEgg?.enabled) {
    onProgress?.({
      phase: 'easter-egg',
      message: 'Injecting CAPSTILLER easter egg…',
    })
    eggResult = await applyCapEasterEgg(kept, easterEgg)
  }

  let githubUpload: GithubUploadHelper | null = null
  if (opts.githubUploadHelper) {
    githubUpload = buildGithubUploadHelper(kept)
    kept[githubUpload.helperPath] = encodeText(githubUpload.text)
  }

  onProgress?.({ phase: 'zipping', message: 'Building Vercel-ready zip…' })
  const zip = zipSync(kept, { level: 6 })

  const hostStripped: string[] = []
  for (const p of hostStrip.packageJsonPaths) {
    hostStripped.push(`${p} scripts`)
  }
  for (const p of hostStrip.viteConfigPaths) hostStripped.push(p)
  for (const p of hostStrip.scriptFilePaths) hostStripped.push(p)

  const injections: InjectionSummary = {
    ...emptyInjections(),
    iconsWritten: pwaResult?.iconsWritten ?? [],
    manifestPath: pwaResult?.manifestPath ?? null,
    htmlPatched: pwaResult?.htmlPatched ?? [],
    grokHrefsRewritten: grokHrefRewrite.filesRewritten,
    scriptsFixed: viteFix.scriptsChanged,
    hostStripped,
    wavsConverted: converted,
    packageNameSet: pwaResult?.packageNameSet ?? null,
    vercelJsonAdded: pwaResult?.vercelJsonAdded ?? false,
    pwaSkipped: pwaResult?.skippedReason ?? (pwa?.enabled ? null : 'PWA off'),
    viteConfigFixed: viteFix.viteConfigFixed,
    viteConfigManualFix: viteFix.viteConfigManualFix,
    buildSimplified: viteFix.buildSimplified,
    gateConfigPath: gateResult?.configPath ?? null,
    gateScriptPath: gateResult?.scriptPath ?? null,
    gateHtmlPatched: gateResult?.htmlPatched ?? [],
    gateTanstackPatched: gateResult?.tanstackPatched ?? null,
    gateSkipped:
      gateResult?.skippedReason ??
      (passwordGate?.enabled ? null : 'Password gate off'),
    gateRemoteConfigUrl: gateResult?.remoteConfigUrl ?? null,
    walletHtmlPatched: walletResult?.htmlPatched ?? [],
    walletOgImagePath: walletResult?.ogImagePath ?? null,
    walletOgImageHref: walletResult?.ogImageHref ?? null,
    walletFaviconIcoPath: walletResult?.faviconIcoPath ?? null,
    walletTitleUsed: walletResult?.titleUsed ?? null,
    walletSkipped:
      walletResult?.skippedReason ??
      (walletOpts.enabled ? null : 'Wallet / store preview off'),
    eggAssetPath: eggResult?.assetPath ?? null,
    eggScriptPath: eggResult?.scriptPath ?? null,
    eggHtmlPatched: eggResult?.htmlPatched ?? [],
    eggTanstackPatched: eggResult?.tanstackPatched ?? null,
    eggSkipped:
      eggResult?.skippedReason ??
      (easterEgg?.enabled ? null : 'CAPSTILLER Easter egg off'),
  }

  return {
    zip,
    converted,
    failures,
    injections,
    viteFix,
    hostStrip,
    pwa: pwaResult,
    githubUpload,
  }
}

export function downloadBlob(data: Uint8Array, filename: string) {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  const blob = new Blob([copy.buffer], {
    type: 'application/zip',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function suggestOutName(originalName: string): string {
  const base = originalName.replace(/\.zip$/i, '')
  return `${base}-vercel.zip`
}

/** Use custom output zip name when provided; otherwise fall back to suggested. */
export function resolveOutputZipName(
  customName: string | null | undefined,
  fallbackSuggested: string,
): string {
  const t = (customName ?? '').trim()
  if (!t) return fallbackSuggested
  const base = t.replace(/\.zip$/i, '')
  return `${base}.zip`
}
