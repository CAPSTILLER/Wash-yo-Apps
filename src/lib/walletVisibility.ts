/**
 * Base Discover / OKX / store-style preview metadata for cleaned zips.
 * Baked into Clean (always on by default) and PWA pack: OG + Twitter tags,
 * favicon links, og.jpg (reuse icon-512 / apple-touch when missing).
 */

import { detectProjectLayout, type ProjectLayout } from './pwaPack'
import {
  basename,
  decodeText,
  encodeText,
  findFileKey,
  joinPath,
  listNormalizedPaths,
  normalizePath,
  pathParts,
} from './zipPaths'

export type WalletVisibilityOptions = {
  /** Default ON — part of every Clean / PWA pack */
  enabled: boolean
  appName: string
  shortName: string
  /** Optional absolute origin, e.g. https://gearup.wtf — used for absolute OG/Twitter URLs */
  publicSiteUrl: string
}

export type WalletVisibilityResult = {
  htmlPatched: string[]
  ogImagePath: string | null
  ogImageHref: string | null
  faviconIcoPath: string | null
  titleUsed: string | null
  skippedReason: string | null
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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

function upsertMetaByAttr(
  html: string,
  attr: 'name' | 'property',
  key: string,
  content: string,
): string {
  const re = new RegExp(
    `<meta\\s+[^>]*\\b${attr}\\s*=\\s*["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
    'i',
  )
  const tag = `<meta ${attr}="${key}" content="${escapeHtml(content)}">`
  if (re.test(html)) return html.replace(re, tag)
  return insertInHead(html, `    ${tag}\n`)
}


function ensurePngFavicon(html: string, href: string): string {
  const tag = `<link rel="icon" type="image/png" sizes="32x32" href="${href}">`
  const re =
    /<link\b[^>]*\brel\s*=\s*["']icon["'][^>]*type\s*=\s*["']image\/png["'][^>]*>/i
  const re2 =
    /<link\b[^>]*type\s*=\s*["']image\/png["'][^>]*\brel\s*=\s*["']icon["'][^>]*>/i
  if (re.test(html)) return html.replace(re, tag)
  if (re2.test(html)) return html.replace(re2, tag)
  return insertInHead(html, `    ${tag}\n`)
}

function ensureIcoFavicon(html: string, href: string): string {
  const tag = `<link rel="icon" href="${href}" sizes="any">`
  // Prefer adding alongside PNG; replace a bare favicon.ico link if present
  const re =
    /<link\b[^>]*\brel\s*=\s*["']icon["'][^>]*href\s*=\s*["'][^"']*favicon\.ico["'][^>]*>/i
  if (re.test(html)) return html.replace(re, tag)
  if (/favicon\.ico/i.test(html) && /rel\s*=\s*["']icon["']/i.test(html)) {
    return html
  }
  return insertInHead(html, `    ${tag}\n`)
}

function normalizePublicOrigin(raw: string): string {
  const t = raw.trim().replace(/\/+$/, '')
  if (!t) return ''
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t}`
}

/** Root-relative or absolute URL for wallet crawlers. */
export function resolveAssetHref(
  pathOrHref: string,
  publicSiteUrl: string,
): string {
  const origin = normalizePublicOrigin(publicSiteUrl)
  const path = pathOrHref.startsWith('/')
    ? pathOrHref
    : `/${pathOrHref.replace(/^\.\//, '')}`
  if (!origin) return path
  return `${origin}${path}`
}

function readTitle(html: string): string | null {
  const m = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  if (!m) return null
  const t = m[1]!.replace(/<[^>]+>/g, '').trim()
  return t || null
}

function readManifestName(
  files: Record<string, Uint8Array>,
  layout: ProjectLayout,
): { name: string | null; shortName: string | null } {
  const candidates = [
    layout.existingManifest,
    joinPath(layout.assetDir, 'manifest.webmanifest'),
    joinPath(layout.assetDir, 'site.webmanifest'),
  ].filter(Boolean) as string[]
  for (const p of candidates) {
    const key = findFileKey(files, p)
    if (!key || !files[key]) continue
    try {
      const j = JSON.parse(decodeText(files[key]!)) as {
        name?: unknown
        short_name?: unknown
      }
      const name = typeof j.name === 'string' ? j.name.trim() : null
      const shortName =
        typeof j.short_name === 'string' ? j.short_name.trim() : null
      if (name || shortName) return { name, shortName }
    } catch {
      /* ignore */
    }
  }
  return { name: null, shortName: null }
}

function findAssetBytes(
  files: Record<string, Uint8Array>,
  layout: ProjectLayout,
  names: string[],
): { path: string; bytes: Uint8Array } | null {
  for (const name of names) {
    const candidates = [
      joinPath(layout.assetDir, name),
      joinPath(layout.projectRoot, name),
      joinPath(layout.projectRoot, 'public', name),
    ]
    for (const c of candidates) {
      const key = findFileKey(files, c)
      if (key && files[key] && files[key]!.byteLength > 0) {
        return { path: normalizePath(c), bytes: files[key]! }
      }
    }
  }
  // basename scan
  const want = new Set(names.map((n) => n.toLowerCase()))
  for (const raw of listNormalizedPaths(files)) {
    const n = normalizePath(raw)
    if (pathParts(n).includes('node_modules')) continue
    if (want.has(basename(n).toLowerCase())) {
      const key = findFileKey(files, n)
      if (key && files[key] && files[key]!.byteLength > 0) {
        return { path: n, bytes: files[key]! }
      }
    }
  }
  return null
}

/**
 * Minimal ICO containing a single PNG image (modern browsers accept PNG-in-ICO).
 */
export function pngBytesToIco(png: Uint8Array): Uint8Array {
  const header = new Uint8Array(6)
  const view = new DataView(header.buffer)
  view.setUint16(0, 0, true) // reserved
  view.setUint16(2, 1, true) // type = icon
  view.setUint16(4, 1, true) // count

  const entry = new Uint8Array(16)
  const ev = new DataView(entry.buffer)
  entry[0] = 32 // width (0 = 256; we use 32 for favicon-32 source)
  entry[1] = 32 // height
  entry[2] = 0 // palette
  entry[3] = 0 // reserved
  ev.setUint16(4, 1, true) // planes
  ev.setUint16(6, 32, true) // bit count
  ev.setUint32(8, png.byteLength, true)
  ev.setUint32(12, 22, true) // offset = 6 + 16

  const out = new Uint8Array(22 + png.byteLength)
  out.set(header, 0)
  out.set(entry, 6)
  out.set(png, 22)
  return out
}

function collectHtmlTargets(
  files: Record<string, Uint8Array>,
  layout: ProjectLayout,
): string[] {
  const out = new Set<string>(layout.indexHtmlPaths)
  for (const e of [
    joinPath(layout.projectRoot, 'index.html'),
    joinPath(layout.projectRoot, 'dist/index.html'),
    joinPath(layout.projectRoot, 'public/index.html'),
  ]) {
    if (findFileKey(files, e)) out.add(normalizePath(e))
  }
  return [...out].sort(
    (a, b) => pathParts(a).length - pathParts(b).length || a.localeCompare(b),
  )
}

export function patchWalletHtml(
  html: string,
  opts: {
    title: string
    description: string
    imageHref: string
    favicon32Href: string | null
    faviconIcoHref: string | null
    keepSvgFavicon: boolean
  },
): { html: string; changed: boolean } {
  let out = html

  if (/<title\b[^>]*>[\s\S]*?<\/title>/i.test(out)) {
    out = out.replace(
      /<title\b[^>]*>[\s\S]*?<\/title>/i,
      `<title>${escapeHtml(opts.title)}</title>`,
    )
  } else {
    out = insertInHead(out, `    <title>${escapeHtml(opts.title)}</title>\n`)
  }

  out = upsertMetaByAttr(out, 'property', 'og:type', 'website')
  out = upsertMetaByAttr(out, 'property', 'og:title', opts.title)
  out = upsertMetaByAttr(out, 'property', 'og:description', opts.description)
  out = upsertMetaByAttr(out, 'property', 'og:image', opts.imageHref)

  out = upsertMetaByAttr(out, 'name', 'twitter:card', 'summary_large_image')
  out = upsertMetaByAttr(out, 'name', 'twitter:title', opts.title)
  out = upsertMetaByAttr(out, 'name', 'twitter:description', opts.description)
  out = upsertMetaByAttr(out, 'name', 'twitter:image', opts.imageHref)

  if (opts.favicon32Href) {
    out = ensurePngFavicon(out, opts.favicon32Href)
  }
  if (opts.faviconIcoHref) {
    out = ensureIcoFavicon(out, opts.faviconIcoHref)
  }

  // Keep existing svg favicon link if present (do not strip)
  void opts.keepSvgFavicon

  return { html: out, changed: out !== html }
}

/**
 * Ensure og.jpg + favicons + OG/Twitter tags so Base / OKX show name + image.
 */
export function applyWalletVisibility(
  kept: Record<string, Uint8Array>,
  opts: WalletVisibilityOptions,
): WalletVisibilityResult {
  const layout = detectProjectLayout(kept)

  if (!opts.enabled) {
    return {
      htmlPatched: [],
      ogImagePath: null,
      ogImageHref: null,
      faviconIcoPath: null,
      titleUsed: null,
      skippedReason: 'Wallet / store preview off',
    }
  }

  const manifestNames = readManifestName(kept, layout)
  let title =
    opts.appName.trim() ||
    manifestNames.name ||
    opts.shortName.trim() ||
    manifestNames.shortName ||
    ''

  // Peek first HTML title if still empty
  const htmlTargets = collectHtmlTargets(kept, layout)
  if (!title && htmlTargets[0]) {
    const key = findFileKey(kept, htmlTargets[0])
    if (key && kept[key]) {
      title = readTitle(decodeText(kept[key]!)) ?? ''
    }
  }

  if (!title) {
    return {
      htmlPatched: [],
      ogImagePath: null,
      ogImageHref: null,
      faviconIcoPath: null,
      titleUsed: null,
      skippedReason:
        'No app name / title available for wallet preview (set App name or enable PWA pack)',
    }
  }

  const description =
    opts.shortName.trim() ||
    manifestNames.shortName ||
    title

  // Ensure og.jpg exists (copy from icon-512 / apple-touch / icon-192)
  let ogPath: string | null = null
  const existingOg = findAssetBytes(kept, layout, [
    'og.jpg',
    'og.jpeg',
    'og.png',
  ])
  if (existingOg) {
    ogPath = existingOg.path
  } else {
    const source = findAssetBytes(kept, layout, [
      'icon-512.png',
      'apple-touch-icon.png',
      'icon-192.png',
      'favicon-32.png',
    ])
    if (source) {
      ogPath = joinPath(layout.assetDir, 'og.jpg')
      // Reuse PNG bytes as og.jpg — wallets accept PNG content at .jpg URL in practice;
      // prefer writing as og.jpg name that matches common crawler expectations.
      // If source is already jpeg-named, copy bytes; otherwise still write as og.jpg.
      const destKey = findFileKey(kept, ogPath) ?? ogPath
      kept[destKey] = source.bytes
    }
  }

  if (!ogPath) {
    return {
      htmlPatched: [],
      ogImagePath: null,
      ogImageHref: null,
      faviconIcoPath: null,
      titleUsed: title,
      skippedReason: 'No icon / og image found to use for og:image',
    }
  }

  const ogHrefPath = `/${basename(ogPath)}`
  const ogImageHref = resolveAssetHref(ogHrefPath, opts.publicSiteUrl)

  // favicon-32
  let fav32Href: string | null = null
  const fav32 = findAssetBytes(kept, layout, ['favicon-32.png'])
  if (fav32) {
    fav32Href = resolveAssetHref('/favicon-32.png', opts.publicSiteUrl)
  }

  // favicon.ico — generate from favicon-32 or icon when missing
  let faviconIcoPath: string | null = null
  const existingIco = findAssetBytes(kept, layout, ['favicon.ico'])
  if (existingIco) {
    faviconIcoPath = existingIco.path
  } else {
    const pngSrc =
      fav32 ??
      findAssetBytes(kept, layout, [
        'icon-192.png',
        'apple-touch-icon.png',
        'icon-512.png',
      ])
    if (pngSrc) {
      faviconIcoPath = joinPath(layout.assetDir, 'favicon.ico')
      const destKey = findFileKey(kept, faviconIcoPath) ?? faviconIcoPath
      kept[destKey] = pngBytesToIco(pngSrc.bytes)
    }
  }
  const favIcoHref = faviconIcoPath
    ? resolveAssetHref('/favicon.ico', opts.publicSiteUrl)
    : null

  const htmlPatched: string[] = []
  for (const htmlPath of htmlTargets) {
    const key = findFileKey(kept, htmlPath)
    if (!key || !kept[key]) continue
    const { html, changed } = patchWalletHtml(decodeText(kept[key]!), {
      title,
      description,
      imageHref: ogImageHref,
      favicon32Href: fav32Href,
      faviconIcoHref: favIcoHref,
      keepSvgFavicon: true,
    })
    if (changed) {
      kept[key] = encodeText(html)
      htmlPatched.push(htmlPath)
    }
  }

  return {
    htmlPatched,
    ogImagePath: ogPath,
    ogImageHref,
    faviconIcoPath,
    titleUsed: title,
    skippedReason: htmlPatched.length === 0 ? 'HTML already had matching tags' : null,
  }
}
