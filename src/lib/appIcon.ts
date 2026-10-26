/**
 * App icon step (v3.10): one picked image → favicon.ico (16/32/48), favicon-32.png,
 * apple-touch-icon.png (180), icon-192/512.png, og-image.png (1200x630),
 * manifest.webmanifest, and head tags (icon / og / twitter / title / description)
 * for Vite / plain HTML / Next (app + pages) / TanStack. Pure text helpers here;
 * canvas rendering lives in appIconRender.ts (browser only).
 */
import {
  basename,
  decodeText,
  dirname,
  encodeText,
  findRootMostFile,
  isUnderNodeModules,
  joinPath,
  listNormalizedPaths,
} from './zipPaths'

export type Framework = 'next-app' | 'next-pages' | 'tanstack-start' | 'vite' | 'html'

export type IconFiles = {
  'favicon.ico': Uint8Array
  'favicon-32.png': Uint8Array
  'apple-touch-icon.png': Uint8Array
  'icon-192.png': Uint8Array
  'icon-512.png': Uint8Array
  'og-image.png': Uint8Array
}

export type AppIconMeta = { siteUrl: string; title: string; description: string; themeColor: string }

export type AppIconTarget = {
  framework: Framework
  projectRoot: string
  staticDir: string
  /** files whose head we will patch */
  headFiles: string[]
  label: string
}

const SKIP = (p: string) =>
  isUnderNodeModules(p) || /(^|\/)(dist|build|\.next|\.vercel|\.output)\//.test(p)

export function originOf(url: string): string {
  let u = url.trim()
  if (!u) return ''
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u
  try {
    return new URL(u).origin
  } catch {
    return ''
  }
}

export function detectAppIconTarget(files: Record<string, Uint8Array>): AppIconTarget {
  const paths = listNormalizedPaths(files).filter((p) => !SKIP(p))
  const pkg = findRootMostFile(paths, (p) => basename(p) === 'package.json')
  const rootHtml = findRootMostFile(paths, (p) => basename(p).toLowerCase() === 'index.html')
  const projectRoot = pkg ? dirname(pkg) : rootHtml ? dirname(rootHtml) : ''
  const has = (rel: string) => paths.includes(joinPath(projectRoot, rel))
  const firstOf = (rels: string[]) => rels.map((r) => joinPath(projectRoot, r)).find((p) => paths.includes(p))
  let pkgText = ''
  if (pkg) pkgText = decodeText(files[pkg] ?? files['./' + pkg] ?? new Uint8Array())
  const publicDir = joinPath(projectRoot, 'public')

  const appLayout = firstOf(['app/layout.tsx', 'app/layout.jsx', 'app/layout.js', 'app/layout.ts', 'src/app/layout.tsx', 'src/app/layout.jsx', 'src/app/layout.js'])
  const isNext = /"next"\s*:/.test(pkgText) || !!firstOf(['next.config.js', 'next.config.mjs', 'next.config.ts'])
  if (appLayout && isNext) {
    return { framework: 'next-app', projectRoot, staticDir: publicDir, headFiles: [appLayout], label: 'Next.js (app router) — ' + appLayout }
  }
  if (isNext) {
    const doc = firstOf(['pages/_document.tsx', 'pages/_document.jsx', 'pages/_document.js', 'src/pages/_document.tsx', 'src/pages/_document.jsx', 'src/pages/_document.js'])
    const pagesDir = paths.some((p) => p.startsWith(joinPath(projectRoot, 'src/pages/'))) ? 'src/pages' : 'pages'
    const target = doc ?? joinPath(projectRoot, pagesDir, '_document.tsx')
    return { framework: 'next-pages', projectRoot, staticDir: publicDir, headFiles: [target], label: 'Next.js (pages) — ' + target + (doc ? '' : ' (new)') }
  }
  const root = firstOf(['src/routes/__root.tsx', 'app/routes/__root.tsx', 'src/app/routes/__root.tsx'])
  const html = paths.filter((p) => basename(p).toLowerCase() === 'index.html' && [projectRoot, publicDir].includes(dirname(p)))
  if (root && /@tanstack\/(react-)?start/.test(pkgText) && html.length === 0) {
    return { framework: 'tanstack-start', projectRoot, staticDir: publicDir, headFiles: [root], label: 'TanStack Start — ' + root }
  }
  if (html.length) {
    const isVite = /"vite"\s*:/.test(pkgText) || paths.some((p) => /vite\.config\.[cm]?[jt]s$/.test(p))
    const staticDir = isVite || pkg || has('public') || paths.some((p) => p.startsWith(publicDir + '/')) ? publicDir : projectRoot
    // plain html served from root: if index.html is in public/, icons go there too
    const sd = html[0] && dirname(html[0]) === publicDir ? publicDir : staticDir
    return { framework: isVite ? 'vite' : 'html', projectRoot, staticDir: sd, headFiles: html, label: (isVite ? 'Vite' : 'Plain HTML') + ' — ' + html.join(', ') }
  }
  return { framework: 'html', projectRoot, staticDir: publicDir, headFiles: [], label: 'Unknown — icons only' }
}

/** Guess the live site URL from files (og:url, canonical, CNAME, homepage, README). */
export function guessSiteUrl(files: Record<string, Uint8Array>): string {
  const paths = listNormalizedPaths(files).filter((p) => !SKIP(p))
  const texts: string[] = []
  const pick = (re: RegExp) => paths.filter((p) => re.test(p)).slice(0, 12)
  for (const p of [...pick(/(^|\/)index\.html$/i), ...pick(/(^|\/)(app|src\/app)\/layout\.[jt]sx?$/), ...pick(/__root\.tsx$/)]) texts.push(decodeText(files[p]!))
  for (const t of texts) {
    const m = t.match(/property=["']og:url["'][^>]*content=["'](https?:\/\/[^"']+)/i) || t.match(/rel=["']canonical["'][^>]*href=["'](https?:\/\/[^"']+)/i) || t.match(/metadataBase:\s*new URL\(\s*["'](https?:\/\/[^"']+)/)
    if (m) return originOf(m[1]!)
  }
  for (const t of texts) {
    const m = t.match(/(?:ORIGIN|SITE_URL|siteUrl|BASE_URL|origin)\w*\s*[=:]\s*["'`](https?:\/\/[^"'`/]+)/) || t.match(/https:\/\/[a-z0-9-]+\.gearup\.wtf/i)
    if (m) return originOf(m[1] ?? m[0])
  }
  const cname = paths.find((p) => basename(p) === 'CNAME')
  if (cname) {
    const v = decodeText(files[cname]!).trim().split(/\s+/)[0]
    if (v) return originOf(v)
  }
  const pkg = findRootMostFile(paths, (p) => basename(p) === 'package.json')
  if (pkg) {
    const m = decodeText(files[pkg]!).match(/"homepage"\s*:\s*"(https?:\/\/[^"]+)"/)
    if (m) return originOf(m[1]!)
  }
  for (const p of paths.filter((p) => /(^|\/)readme(\.md)?$/i.test(p)).slice(0, 3)) {
    const t = decodeText(files[p]!)
    const m = t.match(/https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(wtf|app|xyz|com|io|net|org|dev|fun)(?![\w.-]*\.(png|jpe?g|svg|gif))/i)
    if (m && !/github\.com|vercel\.com|basescan|npmjs|shields\.io|desktop\.github/i.test(m[0])) return originOf(m[0])
  }
  return ''
}

/** Read existing title/description to prefill. */
export function guessTitleDesc(files: Record<string, Uint8Array>, t: AppIconTarget): { title: string; description: string } {
  for (const f of t.headFiles) {
    const b = files[f]
    if (!b) continue
    const s = decodeText(b)
    const title = (s.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? s.match(/\btitle:\s*["'`]([^"'`]+)/)?.[1] ?? '').trim()
    const description = (s.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)/i)?.[1] ?? s.match(/\bdescription:\s*["'`]([^"'`]+)/)?.[1] ?? '').trim()
    if (title || description) return { title, description }
  }
  return { title: '', description: '' }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function abs(site: string, file: string): string {
  return (site ? site.replace(/\/$/, '') : '') + '/' + file
}

export function headTags(m: AppIconMeta): string[] {
  const s = originOf(m.siteUrl)
  const out = [
    `<link rel="icon" href="/favicon.ico" sizes="any">`,
    `<link rel="icon" type="image/png" sizes="32x32" href="${abs(s, 'favicon-32.png')}">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="${abs(s, 'apple-touch-icon.png')}">`,
    `<link rel="manifest" href="/manifest.webmanifest">`,
    `<meta name="theme-color" content="${escapeHtml(m.themeColor)}">`,
  ]
  if (m.description) out.push(`<meta name="description" content="${escapeHtml(m.description)}">`)
  out.push(`<meta property="og:type" content="website">`)
  if (s) out.push(`<meta property="og:url" content="${s}/">`)
  if (m.title) out.push(`<meta property="og:title" content="${escapeHtml(m.title)}">`)
  if (m.description) out.push(`<meta property="og:description" content="${escapeHtml(m.description)}">`)
  out.push(
    `<meta property="og:image" content="${abs(s, 'og-image.png')}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  )
  if (m.title) out.push(`<meta name="twitter:title" content="${escapeHtml(m.title)}">`)
  if (m.description) out.push(`<meta name="twitter:description" content="${escapeHtml(m.description)}">`)
  out.push(`<meta name="twitter:image" content="${abs(s, 'og-image.png')}">`)
  return out
}

const LINK_RELS = /^(icon|shortcut icon|apple-touch-icon|apple-touch-icon-precomposed|manifest|mask-icon)$/i
const MARK_START = '<!-- wash-yo-apps:app-icon -->'
const MARK_END = '<!-- /wash-yo-apps:app-icon -->'

/** Replace/insert all icon + share tags and the title in an HTML head. Idempotent. */
function ownedKeys(m: AppIconMeta): Set<string> {
  const k = new Set<string>()
  for (const t of headTags(m)) {
    const v = t.match(/\b(?:name|property)="([^"]+)"/)?.[1]
    if (v) k.add(v.toLowerCase())
  }
  // stale share-image extras always go with a new og:image
  for (const x of ['og:image:url', 'og:image:secure_url', 'og:image:type', 'og:image:alt', 'twitter:image:src', 'twitter:image:alt']) k.add(x)
  return k
}

export function patchHtmlHead(html: string, m: AppIconMeta): { html: string; removed: number } {
  const owned = ownedKeys(m)
  let out = html.replace(new RegExp(`\\n?[ \\t]*${MARK_START}[\\s\\S]*?${MARK_END}`, 'g'), '')
  let removed = 0
  out = out.replace(/[ \t]*<link\b[^>]*>[ \t]*\r?\n?/gi, (tag) => {
    const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1]?.trim()
    if (rel && LINK_RELS.test(rel)) { removed++; return '' }
    return tag
  })
  out = out.replace(/[ \t]*<meta\b[^>]*>[ \t]*\r?\n?/gi, (tag) => {
    const key = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1]?.trim()
    if (key && owned.has(key.toLowerCase())) { removed++; return '' }
    return tag
  })
  if (m.title) {
    if (/<title\b[^>]*>[\s\S]*?<\/title>/i.test(out)) out = out.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, `<title>${escapeHtml(m.title)}</title>`)
    else out = insertHead(out, `<title>${escapeHtml(m.title)}</title>\n`)
  }
  const ind = out.match(/\n([ \t]*)<(?:title|meta)\b/i)?.[1] ?? '    '
  const block = [MARK_START, ...headTags(m), MARK_END].map((l) => ind + l).join('\n')
  out = /<\/title>/i.test(out)
    ? out.replace(/<\/title>/i, (t) => `${t}\n${block}`)
    : insertHead(out, block.trimStart() + '\n' + ind)
  return { html: out, removed }
}

function insertHead(html: string, snippet: string): string {
  if (/<\/title>/i.test(html)) return html.replace(/<\/title>\s*/i, (t) => `${t.trimEnd()}\n${snippet}`)
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (h) => `${h}\n${snippet}`)
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${snippet}</head>`)
  return snippet + html
}

export function mergeManifest(existing: string | null, m: AppIconMeta, bg: string): string {
  let j: Record<string, unknown> = {}
  if (existing) {
    try { j = JSON.parse(existing) } catch { j = {} }
  }
  if (m.title) { j.name = m.title; if (!j.short_name || (j.short_name as string).length > 12) j.short_name = m.title.slice(0, 12) }
  if (m.description) j.description = m.description
  j.start_url ??= '/'
  j.display ??= 'standalone'
  j.background_color = bg
  j.theme_color = m.themeColor
  const s = originOf(m.siteUrl)
  j.icons = [
    { src: abs(s, 'icon-192.png'), sizes: '192x192', type: 'image/png' },
    { src: abs(s, 'icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ]
  return JSON.stringify(j, null, 2) + '\n'
}

/* ---------- Next.js ---------- */

function jsStr(s: string) { return JSON.stringify(s) }

function setTopKey(obj: string, key: string, value: string): string {
  // replace a single-line `key: ...,` at depth 1 inside the metadata object, else insert at start
  const re = new RegExp(`(\\n[ \\t]*)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(["'\`][^\\n]*?["'\`]|new URL\\([^\\n]*?\\)|\\{[^\\n{}]*\\})\\s*,?[ \\t]*(?=\\n)`)
  if (re.test(obj)) return obj.replace(re, `$1${key}: ${value},`)
  return obj.replace(/^\{/, `{\n  ${key}: ${value},`)
}

function findObjectAt(src: string, start: number): number {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return i }
    else if (c === '"' || c === "'" || c === '`') {
      const q = c; i++
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++ }
    }
  }
  return -1
}

/** Next app router: patch `export const metadata = {…}`; icons come from file conventions. */
export function patchNextAppLayout(src: string, m: AppIconMeta): { src: string; note: string | null } {
  if (/^\s*['"]use client['"]/.test(src)) return { src, note: 'layout is a client component — add metadata by hand (see snippet)' }
  const s = originOf(m.siteUrl)
  const keys: [string, string][] = []
  if (s) keys.push(['metadataBase', `new URL(${jsStr(s)})`])
  if (m.title) keys.push(['title', jsStr(m.title)])
  if (m.description) keys.push(['description', jsStr(m.description)])
  keys.push(['manifest', jsStr('/manifest.webmanifest')])
  const at = src.search(/export\s+const\s+metadata\b[^=]*=\s*\{/)
  if (at < 0) {
    if (/export\s+(async\s+)?function\s+generateMetadata/.test(src)) return { src, note: 'uses generateMetadata() — icons via app/ files only; set title/description there' }
    const body = keys.map(([k, v]) => `  ${k}: ${v},`).join('\n')
    const block = `\nexport const metadata = {\n${body}\n}\n`
    const lastImport = [...src.matchAll(/^import[^\n]*\n(?:[^\n]*from[^\n]*\n)?/gm)].pop()
    const idx = lastImport ? lastImport.index! + lastImport[0].length : 0
    return { src: src.slice(0, idx) + block + src.slice(idx), note: null }
  }
  const open = src.indexOf('{', at + src.slice(at).search(/=\s*\{/))
  const close = findObjectAt(src, open)
  if (close < 0) return { src, note: 'could not read metadata object' }
  let obj = src.slice(open, close + 1)
  // remove old icons / openGraph images / twitter images single-line keys that would point at stale files
  obj = obj.replace(/\n[ \t]*icons\s*:\s*(["'`][^\n]*["'`]|\{[^\n{}]*\})\s*,?[ \t]*(?=\n)/, '')
  for (const [k, v] of keys) obj = setTopKey(obj, k, v)
  return { src: src.slice(0, open) + obj + src.slice(close + 1), note: null }
}

/** Next pages router: ensure _document has our tags inside <Head>. */
export function patchNextDocument(src: string | null, m: AppIconMeta): string {
  const tags = headTags(m).map((t) => '        ' + t.replace(/>$/, ' />').replace(/\/ \/>$/, '/>')).join('\n')
  const block = `{/* wash-yo-apps:app-icon */}\n${tags}\n        {/* /wash-yo-apps:app-icon */}`
  if (!src) {
    return `import { Html, Head, Main, NextScript } from 'next/document'\n\nexport default function Document() {\n  return (\n    <Html lang="en">\n      <Head>\n        ${block}\n      </Head>\n      <body>\n        <Main />\n        <NextScript />\n      </body>\n    </Html>\n  )\n}\n`
  }
  let out = src.replace(/\{\/\* wash-yo-apps:app-icon \*\/\}[\s\S]*?\{\/\* \/wash-yo-apps:app-icon \*\/\}\s*/, '')
  out = out.replace(/[ \t]*<link\b[^>]*\/?>[ \t]*\r?\n?/g, (t) => (LINK_RELS.test(t.match(/\brel\s*=\s*["']([^"']+)/)?.[1] ?? '') ? '' : t))
  const owned = ownedKeys(m)
  out = out.replace(/[ \t]*<meta\b[^>]*\/?>[ \t]*\r?\n?/g, (t) => (owned.has((t.match(/\b(?:name|property)\s*=\s*["']([^"']+)/)?.[1] ?? '').toLowerCase()) ? '' : t))
  if (/<Head\s*\/>/.test(out)) return out.replace(/<Head\s*\/>/, `<Head>\n        ${block}\n      </Head>`)
  if (/<Head\b[^>]*>/.test(out)) return out.replace(/<Head\b[^>]*>/, (h) => `${h}\n        ${block}`)
  return out
}

/** TanStack Start __root.tsx: add entries to head() meta/links arrays (best effort). */
export function patchTanstackRoot(src: string, m: AppIconMeta): { src: string; note: string | null } {
  let out = src.replace(/[ \t]*\/\/ wash-yo-apps:app-icon[\s\S]*?\/\/ \/wash-yo-apps:app-icon\n/g, '')
  // drop single-line entries we own
  const owned = ownedKeys(m)
  out = out.replace(/^[ \t]*\{[^\n]*\brel\s*:\s*["'](icon|shortcut icon|apple-touch-icon|manifest)["'][^\n]*\}\s*,?[ \t]*\n/gm, '')
  out = out.replace(/^[ \t]*\{[^\n]*\b(?:name|property)\s*:\s*["']([^"']+)["'][^\n]*\}\s*,?[ \t]*\n/gm, (line, k: string) => (owned.has(k.toLowerCase()) ? '' : line))
  const s = originOf(m.siteUrl)
  const links = [
    `{ rel: 'icon', href: '/favicon.ico', sizes: 'any' },`,
    `{ rel: 'icon', type: 'image/png', sizes: '32x32', href: ${jsStr(abs(s, 'favicon-32.png'))} },`,
    `{ rel: 'apple-touch-icon', sizes: '180x180', href: ${jsStr(abs(s, 'apple-touch-icon.png'))} },`,
    `{ rel: 'manifest', href: '/manifest.webmanifest' },`,
  ]
  const metas: string[] = [`{ name: 'theme-color', content: ${jsStr(m.themeColor)} },`]
  if (m.description) metas.push(`{ name: 'description', content: ${jsStr(m.description)} },`)
  metas.push(`{ property: 'og:type', content: 'website' },`)
  if (s) metas.push(`{ property: 'og:url', content: ${jsStr(s + '/')} },`)
  if (m.title) metas.push(`{ property: 'og:title', content: ${jsStr(m.title)} },`, `{ name: 'twitter:title', content: ${jsStr(m.title)} },`)
  if (m.description) metas.push(`{ property: 'og:description', content: ${jsStr(m.description)} },`)
  metas.push(`{ property: 'og:image', content: ${jsStr(abs(s, 'og-image.png'))} },`, `{ name: 'twitter:card', content: 'summary_large_image' },`, `{ name: 'twitter:image', content: ${jsStr(abs(s, 'og-image.png'))} },`)
  const wrap = (arr: string[]) => `\n      // wash-yo-apps:app-icon\n${arr.map((x) => '      ' + x).join('\n')}\n      // /wash-yo-apps:app-icon\n`
  const mi = out.search(/\bmeta\s*:\s*\[/)
  const li = out.search(/\blinks\s*:\s*\[/)
  if (mi < 0) return { src, note: 'no head() meta: [...] found in __root.tsx — use the snippet' }
  out = out.replace(/\bmeta\s*:\s*\[[ \t]*\n?/, (x) => x.replace(/[ \t]*\n?$/, '') + wrap(metas))
  if (li >= 0) out = out.replace(/\blinks\s*:\s*\[[ \t]*\n?/, (x) => x.replace(/[ \t]*\n?$/, '') + wrap(links))
  else out = out.replace(/\bmeta\s*:\s*\[/, `links: [${wrap(links)}    ],\n    meta: [`)
  if (m.title) out = out.replace(/(\{\s*title\s*:\s*)(["'`][^"'`\n]*["'`])/, `$1${jsStr(m.title)}`)
  return { src: out, note: null }
}

/* ---------- ICO ---------- */
export function buildIco(pngs: { size: number; png: Uint8Array }[]): Uint8Array {
  const n = pngs.length
  const total = 6 + 16 * n + pngs.reduce((a, p) => a + p.png.length, 0)
  const buf = new Uint8Array(total)
  const dv = new DataView(buf.buffer)
  dv.setUint16(2, 1, true); dv.setUint16(4, n, true)
  let off = 6 + 16 * n
  pngs.forEach((p, i) => {
    const e = 6 + 16 * i
    buf[e] = p.size >= 256 ? 0 : p.size; buf[e + 1] = p.size >= 256 ? 0 : p.size
    dv.setUint16(e + 4, 1, true); dv.setUint16(e + 6, 32, true)
    dv.setUint32(e + 8, p.png.length, true); dv.setUint32(e + 12, off, true)
    buf.set(p.png, off); off += p.png.length
  })
  return buf
}

/* ---------- apply ---------- */
export type AppIconResult = { written: string[]; patched: string[]; notes: string[]; target: AppIconTarget }

export function applyAppIcon(
  files: Record<string, Uint8Array>,
  icons: IconFiles,
  m: AppIconMeta,
  bg: string,
): AppIconResult {
  const target = detectAppIconTarget(files)
  const written: string[] = []
  const patched: string[] = []
  const notes: string[] = []
  const put = (p: string, b: Uint8Array) => { files[p] = b; if (!written.includes(p)) written.push(p) }
  const hadPublicFav = !!files[joinPath(target.staticDir, 'favicon.ico')]
  for (const [name, bytes] of Object.entries(icons)) put(joinPath(target.staticDir, name), bytes)

  const manPath = joinPath(target.staticDir, 'manifest.webmanifest')
  const oldMan = files[manPath] ? decodeText(files[manPath]!) : files[joinPath(target.staticDir, 'site.webmanifest')] ? decodeText(files[joinPath(target.staticDir, 'site.webmanifest')]!) : null
  put(manPath, encodeText(mergeManifest(oldMan, m, bg)))

  if (target.framework === 'next-app') {
    const appDir = dirname(target.headFiles[0]!)
    // Next file conventions generate the <link>/<meta> tags automatically.
    for (const old of ['icon.ico', 'icon.svg', 'icon.jpg', 'icon.jpeg', 'apple-icon.jpg', 'opengraph-image.jpg', 'opengraph-image.jpeg', 'twitter-image.jpg', 'twitter-image.jpeg']) {
      const p = joinPath(appDir, old)
      // _folders are private in the app router: keeps the image but stops it competing
      if (files[p]) { files[joinPath(appDir, '_old-icons', old)] = files[p]!; delete files[p]; notes.push(`moved old ${p} → ${appDir}/_old-icons/ (kept)`) }
    }
    // Next errors if public/favicon.ico and app/favicon.ico both exist
    const appFav = joinPath(appDir, 'favicon.ico'), pubFav = joinPath(target.staticDir, 'favicon.ico')
    if (files[appFav] && !hadPublicFav) { put(appFav, icons['favicon.ico']); delete files[pubFav]; written.splice(written.indexOf(pubFav), 1) }
    put(joinPath(appDir, 'icon.png'), icons['icon-512.png'])
    put(joinPath(appDir, 'apple-icon.png'), icons['apple-touch-icon.png'])
    put(joinPath(appDir, 'opengraph-image.png'), icons['og-image.png'])
    put(joinPath(appDir, 'twitter-image.png'), icons['og-image.png'])
    const lay = target.headFiles[0]!
    const r = patchNextAppLayout(decodeText(files[lay]!), m)
    if (r.note) notes.push(r.note)
    else { files[lay] = encodeText(r.src); patched.push(lay) }
  } else if (target.framework === 'next-pages') {
    const doc = target.headFiles[0]!
    files[doc] = encodeText(patchNextDocument(files[doc] ? decodeText(files[doc]!) : null, m))
    patched.push(doc)
    notes.push('If a page sets its own <Head> title/og tags, those still win on that page.')
  } else if (target.framework === 'tanstack-start') {
    const f = target.headFiles[0]!
    const r = patchTanstackRoot(decodeText(files[f]!), m)
    if (r.note) notes.push(r.note)
    else { files[f] = encodeText(r.src); patched.push(f) }
  } else if (target.headFiles.length) {
    for (const f of target.headFiles) {
      const r = patchHtmlHead(decodeText(files[f]!), m)
      files[f] = encodeText(r.html)
      patched.push(f + (r.removed ? ` (replaced ${r.removed} old tag${r.removed === 1 ? '' : 's'})` : ''))
    }
  } else {
    notes.push('No index.html / Next / TanStack head found — use "Icons only" and paste the snippet.')
  }
  // also refresh a built dist/index.html if one ships in the zip
  for (const p of Object.keys(files)) {
    if (/(^|\/)dist\/index\.html$/.test(p) && !isUnderNodeModules(p)) {
      files[p] = encodeText(patchHtmlHead(decodeText(files[p]!), m).html)
      patched.push(p)
    }
  }
  if (!originOf(m.siteUrl)) notes.push('No site URL — share images use /og-image.png (some wallets and X need a full https URL).')
  return { written, patched, notes, target }
}

export function snippetHtml(m: AppIconMeta): string {
  return `<!-- Paste inside <head>. Put the icon files in the folder served at / (usually public/). -->\n${m.title ? `<title>${escapeHtml(m.title)}</title>\n` : ''}${headTags(m).join('\n')}\n`
}
