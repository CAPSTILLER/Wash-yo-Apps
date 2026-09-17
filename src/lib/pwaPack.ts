import {
  basename,
  decodeText,
  dirname,
  encodeText,
  findFileKey,
  findRootMostIndexHtml,
  findRootMostPackageJson,
  hasDirPrefix,
  isUnderNodeModules,
  joinPath,
  listNormalizedPaths,
  normalizePath,
  pathParts,
} from './zipPaths'

export const PWA_BG = '#0c0a09'
export const PWA_THEME = '#c9a227'

export type PwaIconInput = {
  bytes: Uint8Array
  mime: string
}

export type PwaPackOptions = {
  enabled: boolean
  appName: string
  shortName: string
  icon: PwaIconInput | null
}

export type ProjectLayout = {
  projectRoot: string
  packageJsonPath: string | null
  indexHtmlPaths: string[]
  assetDir: string
  assetUrlPrefix: string
  viteConfigPaths: string[]
  hasViteConfig: boolean
  vercelJsonPath: string | null
  wouldAddVercelJson: boolean
  existingManifest: string | null
  manifestFileName: string
}

export type PwaApplyResult = {
  iconsWritten: string[]
  manifestPath: string | null
  htmlPatched: string[]
  packageNameSet: string | null
  vercelJsonAdded: boolean
  assetDir: string
  skippedReason: string | null
}

const VITE_CONFIG_RE = /^vite\.config\.(ts|mts|js|mjs|cts|cjs)$/i
const MANIFEST_NAMES = ['manifest.webmanifest', 'site.webmanifest']

export function defaultShortName(appName: string): string {
  const t = appName.trim()
  if (!t) return ''
  if (t.length <= 12) return t
  const first = t.split(/\s+/)[0] ?? t
  if (first.length <= 12) return first
  return t.slice(0, 12)
}

export function npmSafeSlug(name: string): string {
  let s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
  if (!s) s = 'app'
  if (s.startsWith('.')) s = `app-${s.replace(/^\.+/, '')}`
  if (!s) s = 'app'
  return s.slice(0, 214)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function collectViteConfigs(paths: string[]): string[] {
  return paths
    .map(normalizePath)
    .filter((p) => !isUnderNodeModules(p) && VITE_CONFIG_RE.test(basename(p)))
    .sort(
      (a, b) =>
        pathParts(a).length - pathParts(b).length || a.localeCompare(b),
    )
}

function collectIndexHtmls(paths: string[], projectRoot: string): string[] {
  const out: string[] = []
  for (const p of paths) {
    const n = normalizePath(p)
    if (isUnderNodeModules(n)) continue
    if (basename(n).toLowerCase() !== 'index.html') continue
    const dir = dirname(n)
    // root index.html, public/index.html, or static/index.html under project
    if (
      dir === projectRoot ||
      dir === joinPath(projectRoot, 'public') ||
      dir === joinPath(projectRoot, 'static')
    ) {
      out.push(n)
    }
  }
  out.sort(
    (a, b) => pathParts(a).length - pathParts(b).length || a.localeCompare(b),
  )
  return out
}

function findExistingManifest(
  paths: string[],
  projectRoot: string,
  assetDir: string,
): string | null {
  const candidates = [
    joinPath(assetDir, 'manifest.webmanifest'),
    joinPath(assetDir, 'site.webmanifest'),
    joinPath(projectRoot, 'manifest.webmanifest'),
    joinPath(projectRoot, 'site.webmanifest'),
    joinPath(projectRoot, 'public', 'manifest.webmanifest'),
    joinPath(projectRoot, 'public', 'site.webmanifest'),
  ]
  const set = new Set(paths.map(normalizePath))
  for (const c of candidates) {
    if (set.has(c)) return c
  }
  for (const p of paths) {
    const n = normalizePath(p)
    if (isUnderNodeModules(n)) continue
    if (MANIFEST_NAMES.includes(basename(n))) return n
  }
  return null
}

/**
 * Detect where icons / manifest / index.html live.
 * Prefer public/, then Vite → create public/, then static/, else project root.
 */
export function detectProjectLayout(
  files: Record<string, Uint8Array>,
): ProjectLayout {
  const paths = listNormalizedPaths(files)
  const packageJsonPath = findRootMostPackageJson(paths)
  const rootHtml = findRootMostIndexHtml(paths)
  const projectRoot = packageJsonPath
    ? dirname(packageJsonPath)
    : rootHtml
      ? dirname(rootHtml)
      : ''

  const publicDir = joinPath(projectRoot, 'public')
  const staticDir = joinPath(projectRoot, 'static')
  const hasPublic = hasDirPrefix(paths, publicDir)
  const hasStatic = hasDirPrefix(paths, staticDir)
  const viteConfigPaths = collectViteConfigs(paths)
  const hasViteConfig = viteConfigPaths.length > 0

  let assetDir: string
  if (hasPublic) {
    assetDir = publicDir
  } else if (hasViteConfig || packageJsonPath) {
    // Vite / npm project: public/ is served at /
    assetDir = publicDir
  } else if (hasStatic) {
    assetDir = staticDir
  } else {
    assetDir = projectRoot
  }

  // public/ and static/ (when used as the asset root we created/detected
  // for Vite-style apps) are served at URL `/`.
  const assetUrlPrefix = '/'

  const vercelName = joinPath(projectRoot, 'vercel.json')
  const vercelExists = paths.includes(vercelName)
  const existingManifest = findExistingManifest(paths, projectRoot, assetDir)
  const manifestFileName = existingManifest
    ? basename(existingManifest)
    : 'manifest.webmanifest'

  return {
    projectRoot,
    packageJsonPath,
    indexHtmlPaths: collectIndexHtmls(paths, projectRoot),
    assetDir,
    assetUrlPrefix,
    viteConfigPaths,
    hasViteConfig,
    vercelJsonPath: vercelExists ? vercelName : null,
    wouldAddVercelJson: !vercelExists && !hasViteConfig,
    existingManifest,
    manifestFileName,
  }
}

function insertInHead(html: string, snippet: string): string {
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${snippet}</head>`)
  }
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (m) => `${m}\n${snippet}`)
  }
  return `${snippet}${html}`
}

function upsertMeta(html: string, name: string, content: string): string {
  const re = new RegExp(`<meta\\s+[^>]*\\bname\\s*=\\s*["']${name}["'][^>]*>`, 'i')
  const tag = `<meta name="${name}" content="${escapeHtml(content)}">`
  if (re.test(html)) return html.replace(re, tag)
  return insertInHead(html, `    ${tag}\n`)
}

function upsertLinkByRel(html: string, rel: string, tag: string): string {
  const re = new RegExp(
    `<link\\b[^>]*\\brel\\s*=\\s*["']${rel}["'][^>]*>`,
    'gi',
  )
  const replaced = html.replace(re, tag)
  if (replaced !== html) return replaced
  return insertInHead(html, `    ${tag}\n`)
}

function ensurePngFavicon(html: string, tag: string): string {
  const re =
    /<link\b[^>]*\brel\s*=\s*["']icon["'][^>]*type\s*=\s*["']image\/png["'][^>]*>/i
  const re2 =
    /<link\b[^>]*type\s*=\s*["']image\/png["'][^>]*\brel\s*=\s*["']icon["'][^>]*>/i
  if (re.test(html)) return html.replace(re, tag)
  if (re2.test(html)) return html.replace(re2, tag)
  return insertInHead(html, `    ${tag}\n`)
}

export function patchIndexHtml(
  html: string,
  opts: {
    appName: string
    manifestHref: string
    appleIconHref: string
    faviconHref: string
    themeColor: string
  },
): { html: string; changed: boolean } {
  let out = html

  if (/<title\b[^>]*>[\s\S]*?<\/title>/i.test(out)) {
    out = out.replace(
      /<title\b[^>]*>[\s\S]*?<\/title>/i,
      `<title>${escapeHtml(opts.appName)}</title>`,
    )
  } else {
    out = insertInHead(out, `    <title>${escapeHtml(opts.appName)}</title>\n`)
  }

  out = upsertLinkByRel(
    out,
    'manifest',
    `<link rel="manifest" href="${opts.manifestHref}">`,
  )
  out = upsertLinkByRel(
    out,
    'apple-touch-icon',
    `<link rel="apple-touch-icon" href="${opts.appleIconHref}">`,
  )
  out = ensurePngFavicon(
    out,
    `<link rel="icon" type="image/png" sizes="32x32" href="${opts.faviconHref}">`,
  )
  out = upsertMeta(out, 'apple-mobile-web-app-title', opts.appName)
  out = upsertMeta(out, 'application-name', opts.appName)
  out = upsertMeta(out, 'theme-color', opts.themeColor)

  return { html: out, changed: out !== html }
}

type ManifestIcon = {
  src: string
  sizes: string
  type: string
  purpose?: string
}

type WebManifest = {
  name: string
  short_name: string
  display: string
  start_url: string
  background_color: string
  theme_color: string
  icons: ManifestIcon[]
  [key: string]: unknown
}

function buildManifestJson(
  existingText: string | null,
  name: string,
  shortName: string,
  icons: ManifestIcon[],
): string {
  let base: Record<string, unknown> = {}
  if (existingText) {
    try {
      const parsed: unknown = JSON.parse(existingText)
      if (parsed && typeof parsed === 'object') {
        base = parsed as Record<string, unknown>
      }
    } catch {
      base = {}
    }
  }
  const merged: WebManifest = {
    ...base,
    name,
    short_name: shortName,
    display: 'standalone',
    start_url: '/',
    background_color:
      typeof base.background_color === 'string' && base.background_color
        ? base.background_color
        : PWA_BG,
    theme_color:
      typeof base.theme_color === 'string' && base.theme_color
        ? base.theme_color
        : PWA_THEME,
    icons,
  }
  return `${JSON.stringify(merged, null, 2)}\n`
}

async function rasterizeIcon(
  bitmap: ImageBitmap,
  size: number,
): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.fillStyle = PWA_BG
  ctx.fillRect(0, 0, size, size)
  const scale = Math.max(size / bitmap.width, size / bitmap.height)
  const w = bitmap.width * scale
  const h = bitmap.height * scale
  const x = (size - w) / 2
  const y = (size - h) / 2
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, x, y, w, h)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))),
      'image/png',
    )
  })
  return new Uint8Array(await blob.arrayBuffer())
}

export async function generatePwaIcons(
  icon: PwaIconInput,
): Promise<{
  icon192: Uint8Array
  icon512: Uint8Array
  apple180: Uint8Array
  favicon32: Uint8Array
}> {
  const ab = new ArrayBuffer(icon.bytes.byteLength)
  new Uint8Array(ab).set(icon.bytes)
  const blob = new Blob([ab], {
    type: icon.mime || 'image/png',
  })
  const bitmap = await createImageBitmap(blob)
  try {
    const [icon192, icon512, apple180, favicon32] = await Promise.all([
      rasterizeIcon(bitmap, 192),
      rasterizeIcon(bitmap, 512),
      rasterizeIcon(bitmap, 180),
      rasterizeIcon(bitmap, 32),
    ])
    return { icon192, icon512, apple180, favicon32 }
  } finally {
    bitmap.close()
  }
}

function emptyApply(assetDir: string, reason: string): PwaApplyResult {
  return {
    iconsWritten: [],
    manifestPath: null,
    htmlPatched: [],
    packageNameSet: null,
    vercelJsonAdded: false,
    assetDir,
    skippedReason: reason,
  }
}

/**
 * Write icons, manifest, HTML patches, package.json name, optional vercel.json.
 */
export async function applyPwaPack(
  kept: Record<string, Uint8Array>,
  pwa: PwaPackOptions,
  onProgress?: (message: string) => void,
): Promise<PwaApplyResult> {
  const layout = detectProjectLayout(kept)
  if (!pwa.enabled) {
    return emptyApply(layout.assetDir, 'PWA toggle off')
  }
  const appName = pwa.appName.trim()
  if (!appName) {
    return emptyApply(layout.assetDir, 'App name required')
  }
  if (!pwa.icon || pwa.icon.bytes.byteLength === 0) {
    return emptyApply(layout.assetDir, 'Icon image required')
  }

  const shortName = (pwa.shortName.trim() || defaultShortName(appName)).slice(
    0,
    12,
  )

  onProgress?.('Generating install icons…')
  const icons = await generatePwaIcons(pwa.icon)

  const icon192Path = joinPath(layout.assetDir, 'icon-192.png')
  const icon512Path = joinPath(layout.assetDir, 'icon-512.png')
  const applePath = joinPath(layout.assetDir, 'apple-touch-icon.png')
  const favPath = joinPath(layout.assetDir, 'favicon-32.png')

  kept[icon192Path] = icons.icon192
  kept[icon512Path] = icons.icon512
  kept[applePath] = icons.apple180
  kept[favPath] = icons.favicon32

  const iconsWritten = [icon192Path, icon512Path, applePath, favPath]

  const manifestPath = layout.existingManifest
    ? layout.existingManifest
    : joinPath(layout.assetDir, 'manifest.webmanifest')

  let existingManifestText: string | null = null
  if (layout.existingManifest) {
    const key = findFileKey(kept, layout.existingManifest)
    if (key && kept[key]) existingManifestText = decodeText(kept[key])
  }

  const manifestHref = `${layout.assetUrlPrefix}`.replace(/\/$/, '') +
    `/${basename(manifestPath)}`
  const appleHref = `${layout.assetUrlPrefix}`.replace(/\/$/, '') +
    '/apple-touch-icon.png'
  const favHref = `${layout.assetUrlPrefix}`.replace(/\/$/, '') +
    '/favicon-32.png'
  const icon192Href = `${layout.assetUrlPrefix}`.replace(/\/$/, '') +
    '/icon-192.png'
  const icon512Href = `${layout.assetUrlPrefix}`.replace(/\/$/, '') +
    '/icon-512.png'

  onProgress?.('Writing web manifest…')
  const manifestText = buildManifestJson(existingManifestText, appName, shortName, [
    {
      src: icon192Href,
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: icon512Href,
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
  ])
  const manifestKey = findFileKey(kept, manifestPath) ?? manifestPath
  kept[manifestKey] = encodeText(manifestText)

  onProgress?.('Patching index.html…')
  const htmlPatched: string[] = []
  let htmlTargets = layout.indexHtmlPaths
  if (htmlTargets.length === 0) {
    const fallback = findRootMostIndexHtml(listNormalizedPaths(kept))
    if (fallback) htmlTargets = [fallback]
  }
  for (const htmlPath of htmlTargets) {
    const key = findFileKey(kept, htmlPath)
    if (!key || !kept[key]) continue
    const { html, changed } = patchIndexHtml(decodeText(kept[key]), {
      appName,
      manifestHref,
      appleIconHref: appleHref,
      faviconHref: favHref,
      themeColor: PWA_THEME,
    })
    if (changed) {
      kept[key] = encodeText(html)
      htmlPatched.push(htmlPath)
    }
  }

  let packageNameSet: string | null = null
  if (layout.packageJsonPath) {
    const key = findFileKey(kept, layout.packageJsonPath)
    if (key && kept[key]) {
      try {
        const pkg = JSON.parse(decodeText(kept[key])) as {
          name?: unknown
          [k: string]: unknown
        }
        const slug = npmSafeSlug(appName)
        if (pkg.name !== slug) {
          pkg.name = slug
          kept[key] = encodeText(`${JSON.stringify(pkg, null, 2)}\n`)
          packageNameSet = slug
        } else {
          packageNameSet = slug
        }
      } catch {
        /* leave package.json */
      }
    }
  }

  let vercelJsonAdded = false
  // Skip vercel.json when vite.config is present — Vercel auto-detects Vite
  // and a catch-all rewrite can break SSR / framework output.
  if (layout.wouldAddVercelJson) {
    const vercelPath = joinPath(layout.projectRoot, 'vercel.json')
    const vercel = {
      rewrites: [{ source: '/(.*)', destination: '/index.html' }],
    }
    kept[vercelPath] = encodeText(`${JSON.stringify(vercel, null, 2)}\n`)
    vercelJsonAdded = true
  }

  return {
    iconsWritten,
    manifestPath,
    htmlPatched,
    packageNameSet,
    vercelJsonAdded,
    assetDir: layout.assetDir,
    skippedReason: null,
  }
}

export function describePwaPlan(
  layout: ProjectLayout,
  pwa: PwaPackOptions,
): string | null {
  if (!pwa.enabled) return null
  if (!pwa.appName.trim()) return 'Enter an app name to add install metadata.'
  if (!pwa.icon) return 'Upload an icon to generate 192/512/180/32 PNG assets.'
  const bits = [
    `icons → ${layout.assetDir || '(project root)'}`,
    `manifest ${layout.manifestFileName}`,
  ]
  if (layout.indexHtmlPaths.length > 0) {
    bits.push(`patch ${layout.indexHtmlPaths.join(', ')}`)
  }
  if (layout.packageJsonPath) {
    bits.push(`package.json name → ${npmSafeSlug(pwa.appName)}`)
  }
  if (layout.wouldAddVercelJson) {
    bits.push('add vercel.json SPA rewrite (no vite.config)')
  } else if (layout.hasViteConfig) {
    bits.push('skip vercel.json (Vite auto-detect)')
  }
  return bits.join(' · ')
}
