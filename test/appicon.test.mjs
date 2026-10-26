import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, strFromU8 } from 'fflate'
import { loadLib, closeLib } from './load.mjs'
after(closeLib)
const L = () => loadLib('/src/lib/appIcon.ts')
const b = (n) => new Uint8Array(n).fill(1)
const icons = () => ({ 'favicon.ico': b(3), 'favicon-32.png': b(4), 'apple-touch-icon.png': b(5), 'icon-192.png': b(6), 'icon-512.png': b(7), 'og-image.png': b(8) })
const meta = { siteUrl: 'myapp.gearup.wtf/x', title: 'My App', description: 'Hi', themeColor: '#000000' }

test('vite html: replaces old icon/og tags without duplicates, idempotent', async () => {
  const { applyAppIcon } = await L()
  const f = {
    'app/package.json': strToU8('{"devDependencies":{"vite":"1"}}'),
    'app/index.html': strToU8('<html><head><title>Old</title>\n<link rel="icon" href="https://basescan.org/x.ico">\n<meta property="og:image" content="/old.png">\n<link rel="stylesheet" href="/a.css">\n</head><body></body></html>'),
  }
  const r = applyAppIcon(f, icons(), meta, '#000')
  assert.equal(r.target.framework, 'vite')
  assert.ok(f['app/public/og-image.png'] && f['app/public/favicon.ico'] && f['app/public/manifest.webmanifest'])
  applyAppIcon(f, icons(), meta, '#000')
  const h = strFromU8(f['app/index.html'])
  assert.equal((h.match(/rel="apple-touch-icon"/g) || []).length, 1)
  assert.equal((h.match(/og:image"/g) || []).length, 1)
  assert.ok(!h.includes('basescan') && !h.includes('/old.png') && h.includes('stylesheet'))
  assert.ok(h.includes('content="https://myapp.gearup.wtf/og-image.png"') && h.includes('<title>My App</title>'))
  const man = JSON.parse(strFromU8(f['app/public/manifest.webmanifest']))
  assert.equal(man.icons[1].src, 'https://myapp.gearup.wtf/icon-512.png')
})

test('next app router: file conventions + metadata merge (no duplicate keys)', async () => {
  const { applyAppIcon } = await L()
  const f = {
    'package.json': strToU8('{"dependencies":{"next":"15"}}'),
    'app/layout.tsx': strToU8("import './globals.css'\n\nexport const metadata = {\n  title: 'Old',\n  description: 'old',\n}\n\nexport default function L({children}){return <html><body>{children}</body></html>}\n"),
    'app/icon.svg': strToU8('<svg/>'),
  }
  const r = applyAppIcon(f, icons(), meta, '#000')
  assert.equal(r.target.framework, 'next-app')
  const s = strFromU8(f['app/layout.tsx'])
  assert.equal((s.match(/\btitle:/g) || []).length, 1)
  assert.ok(s.includes('title: "My App"') && s.includes('metadataBase: new URL("https://myapp.gearup.wtf")'))
  assert.ok(f['app/icon.png'] && f['app/apple-icon.png'] && f['app/opengraph-image.png'] && f['app/_old-icons/icon.svg'] && !f['app/icon.svg'])
  assert.ok(f['public/favicon.ico'] && !f['app/favicon.ico'])
})

test('next pages router: creates _document with tags', async () => {
  const { applyAppIcon } = await L()
  const f = { 'package.json': strToU8('{"dependencies":{"next":"14"}}'), 'pages/index.tsx': strToU8('x') }
  const r = applyAppIcon(f, icons(), meta, '#000')
  assert.equal(r.target.framework, 'next-pages')
  assert.match(strFromU8(f['pages/_document.tsx']), /og:image" content="https:\/\/myapp.gearup.wtf\/og-image.png" \/>/)
})

test('tanstack start: patches head() arrays', async () => {
  const { applyAppIcon } = await L()
  const f = {
    'package.json': strToU8('{"dependencies":{"@tanstack/react-start":"1"}}'),
    'src/routes/__root.tsx': strToU8("export const Route = createRootRoute({\n  head: () => ({\n    meta: [\n      { charSet: 'utf-8' },\n      { title: 'Old' },\n      { property: 'og:image', content: '/x.png' },\n    ],\n    links: [\n      { rel: 'icon', href: '/favicon.svg' },\n      { rel: 'stylesheet', href: css },\n    ],\n  }),\n})\n"),
  }
  applyAppIcon(f, icons(), meta, '#000')
  applyAppIcon(f, icons(), meta, '#000')
  const s = strFromU8(f['src/routes/__root.tsx'])
  assert.equal((s.match(/og:image'/g) || []).length, 1)
  assert.ok(!s.includes('/favicon.svg') && !s.includes('/x.png') && s.includes("stylesheet") && s.includes('{ title: "My App" }'))
})

test('guess site url + ico header', async () => {
  const { guessSiteUrl, buildIco } = await L()
  assert.equal(guessSiteUrl({ 'index.html': strToU8('<meta property="og:url" content="https://aybags.gearup.wtf/">') }), 'https://aybags.gearup.wtf')
  assert.equal(guessSiteUrl({ 'README.md': strToU8('Live at https://99audio.gearup.wtf and https://github.com/x') }), 'https://99audio.gearup.wtf')
  const ico = buildIco([{ size: 16, png: b(10) }, { size: 32, png: b(10) }])
  assert.deepEqual([...ico.slice(0, 6)], [0, 0, 1, 0, 2, 0])
})

test('html head block keeps indentation and is idempotent', async () => {
  const { patchHtmlHead } = await L()
  const m = { siteUrl: 'https://x.example', title: 'X', description: 'd', themeColor: '#000' }
  const h = '<html>\n  <head>\n    <meta charset="UTF-8" />\n    <title>Old</title>\n    <meta name="viewport" content="w" />\n  </head>\n</html>\n'
  const a = patchHtmlHead(h, m).html
  assert.equal(patchHtmlHead(a, m).html, a)
  assert.match(a, /\n    <!-- wash-yo-apps:app-icon -->\n    <link/)
  assert.match(a, /\n    <meta name="viewport"/)
  assert.match(a, /\n  <\/head>/)
})
