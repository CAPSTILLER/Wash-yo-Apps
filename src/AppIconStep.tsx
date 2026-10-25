import { useEffect, useMemo, useRef, useState } from 'react'
import { zipSync } from 'fflate'
import {
  applyAppIcon,
  detectAppIconTarget,
  guessSiteUrl,
  guessTitleDesc,
  originOf,
  snippetHtml,
  type AppIconMeta,
  type AppIconResult,
} from './lib/appIcon'
import { drawIcon, loadImage, renderIconFiles, type IconLook } from './lib/appIconRender'
import { downloadBlob } from './lib/cleanZip'
import { encodeText } from './lib/zipPaths'

export type AppIconApplier = (files: Record<string, Uint8Array>) => Promise<AppIconResult>

type Props = {
  files: Record<string, Uint8Array> | null
  fileName: string | null
  /** set when App icon is ON and ready; null otherwise */
  onApplier: (fn: AppIconApplier | null) => void
  lastResult: AppIconResult | null
}

function Preview({ im, look, size, round }: { im: HTMLImageElement; look: IconLook; size: number; round?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const c = drawIcon(im, size, size, look, size >= 180)
    c.style.width = Math.max(size, 16) + 'px'
    c.style.height = Math.max(size, 16) + 'px'
    if (round) c.style.borderRadius = '22%'
    c.style.imageRendering = size <= 32 ? 'pixelated' : 'auto'
    ref.current?.replaceChildren(c)
  }, [im, look, size, round])
  return <div ref={ref} className="shrink-0" />
}

function OgPreview({ im, look }: { im: HTMLImageElement; look: IconLook }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const c = drawIcon(im, 1200, 630, look, true)
    c.style.width = '100%'; c.style.height = 'auto'; c.style.display = 'block'
    ref.current?.replaceChildren(c)
  }, [im, look])
  return <div ref={ref} />
}

export default function AppIconStep({ files, fileName, onApplier, lastResult }: Props) {
  const [on, setOn] = useState(false)
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [im, setIm] = useState<HTMLImageElement | null>(null)
  const [look, setLook] = useState<IconLook>({ fit: 'crop', bg: '#0b1020', zoom: 1, transparent: false })
  const [siteUrl, setSiteUrl] = useState('')
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const target = useMemo(() => (files ? detectAppIconTarget(files) : null), [files])
  // prefill from the zip once per upload
  useEffect(() => {
    if (!files || !target) return
    setSiteUrl(guessSiteUrl(files))
    const td = guessTitleDesc(files, target)
    setTitle(td.title)
    setDesc(td.description)
  }, [files, target])

  useEffect(() => {
    if (!imgUrl) { setIm(null); return }
    let dead = false
    loadImage(imgUrl).then((x) => !dead && setIm(x)).catch((e) => setErr(String(e.message || e)))
    return () => { dead = true }
  }, [imgUrl])

  const meta: AppIconMeta = useMemo(() => ({ siteUrl: originOf(siteUrl), title: title.trim(), description: desc.trim(), themeColor: look.bg }), [siteUrl, title, desc, look.bg])

  useEffect(() => {
    if (!on || !im) { onApplier(null); return }
    onApplier(async (f) => applyAppIcon(f, await renderIconFiles(im, look), meta, look.bg))
  }, [on, im, look, meta, onApplier])

  const pick = (f: File | undefined) => {
    if (!f) return
    if (!/^image\//.test(f.type) && !/\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(f.name)) { setErr('Pick an image file (png, jpg, webp, svg…).'); return }
    setErr(null)
    if (imgUrl) URL.revokeObjectURL(imgUrl)
    setImgUrl(URL.createObjectURL(f))
    setOn(true)
  }

  const iconsOnly = async () => {
    if (!im) return
    const icons = await renderIconFiles(im, look)
    const out: Record<string, Uint8Array> = {}
    for (const [k, v] of Object.entries(icons)) out['public/' + k] = v
    const tmp: Record<string, Uint8Array> = {}
    const { mergeManifest } = await import('./lib/appIcon')
    tmp['public/manifest.webmanifest'] = encodeText(mergeManifest(null, meta, look.bg))
    Object.assign(out, tmp)
    out['head-snippet.html'] = encodeText(snippetHtml(meta))
    out['README-ICONS.txt'] = encodeText(
      'App icon files from Wash yo Apps\n\n1. Copy everything in public/ into the folder your app serves at / (Vite, Next, TanStack: public/. Plain HTML: next to index.html).\n2. Paste head-snippet.html inside <head> (Next app router: put icon.png / apple-icon.png / opengraph-image.png in app/ instead).\n3. Deploy, then open https://your-site/favicon.ico to check.\n',
    )
    const base = (fileName ?? 'app').replace(/\.zip$/i, '')
    downloadBlob(zipSync(out, { level: 6 }), `${base}-icons.zip`)
    setMsg('Downloaded icons-only zip (files + head snippet).')
  }

  const host = originOf(siteUrl).replace(/^https?:\/\//, '') || 'your-site'
  const shownTitle = title || host

  return (
    <section className="mt-8" id="app-icon-step">
      <h2 className="text-sm font-medium text-amber-200/90 mb-1">App icon</h2>
      <p className="text-xs text-zinc-500 mb-3">
        One picture → the icon in browser tabs, wallet browsers (OKX, Base, MetaMask), home screen and link previews. Runs on your phone, nothing is uploaded.
      </p>
      <div className="rounded-xl border border-amber-900/50 bg-zinc-900/50 p-4 space-y-4">
        <label className="flex items-center gap-3 text-sm text-zinc-100">
          <input type="checkbox" className="size-5 accent-amber-400" checked={on} onChange={(e) => setOn(e.target.checked)} />
          Add / replace app icon in the cleaned zip
        </label>

        <label className="block">
          <span className="block text-xs uppercase tracking-wide text-amber-200/70 mb-1">1 · Pick your picture</span>
          <input type="file" accept="image/*" data-testid="app-icon-file" onChange={(e) => pick(e.target.files?.[0])}
            className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-400 file:px-4 file:py-3 file:font-semibold file:text-zinc-950" />
        </label>
        {err ? <p className="text-sm text-red-300">{err}</p> : null}

        {im ? (
          <>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {(['crop', 'fit'] as const).map((f) => (
                <button key={f} type="button" onClick={() => setLook({ ...look, fit: f })}
                  className={`rounded-lg border px-3 py-3 ${look.fit === f ? 'border-amber-400 bg-amber-950/40 text-amber-100' : 'border-zinc-700 text-zinc-300'}`}>
                  {f === 'crop' ? 'Fill square (crop edges)' : 'Show whole picture'}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-300">
              <label className="flex items-center gap-2">Background <input type="color" value={look.bg} onChange={(e) => setLook({ ...look, bg: e.target.value })} className="h-10 w-14 rounded border border-zinc-700 bg-transparent" /></label>
              <label className="flex items-center gap-2 grow">Zoom <input type="range" min={0.5} max={2} step={0.05} value={look.zoom} onChange={(e) => setLook({ ...look, zoom: +e.target.value })} className="grow accent-amber-400" /></label>
              <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-amber-400" checked={look.transparent} onChange={(e) => setLook({ ...look, transparent: e.target.checked })} />See-through tab icon</label>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">How it looks</div>
              <div className="flex items-end gap-4 rounded-lg bg-zinc-950/60 p-3">
                {[16, 32, 48].map((s) => (
                  <div key={s} className="flex flex-col items-center gap-1"><Preview im={im} look={look} size={s} /><span className="text-[10px] text-zinc-500">{s}px</span></div>
                ))}
                <div className="flex flex-col items-center gap-1"><Preview im={im} look={look} size={64} round /><span className="text-[10px] text-zinc-500">home screen</span></div>
              </div>
              {/* fake wallet in-app browser bar */}
              <div className="mt-3 rounded-xl overflow-hidden border border-zinc-700 bg-[#1b1b1f]" data-testid="fake-wallet-tab">
                <div className="flex items-center gap-2 px-3 py-2 text-[13px] text-zinc-200">
                  <span className="text-zinc-400">✕</span>
                  <Preview im={im} look={look} size={20} />
                  <div className="min-w-0 leading-tight">
                    <div className="truncate font-medium">{shownTitle}</div>
                    <div className="truncate text-[11px] text-zinc-400">🔒 {host}</div>
                  </div>
                  <span className="ml-auto text-zinc-400">⋯</span>
                </div>
                <div className="px-3 pb-2 text-[10px] text-zinc-500">Wallet browser (OKX / Base / MetaMask style)</div>
              </div>
              {/* link preview card */}
              <div className="mt-3 rounded-xl overflow-hidden border border-zinc-700 bg-zinc-900" data-testid="fake-link-card">
                <OgPreview im={im} look={look} />
                <div className="px-3 py-2">
                  <div className="text-[11px] text-zinc-500">{host}</div>
                  <div className="text-sm text-zinc-100 font-medium truncate">{shownTitle}</div>
                  {desc ? <div className="text-xs text-zinc-400 line-clamp-2">{desc}</div> : null}
                </div>
              </div>
            </div>
          </>
        ) : null}

        <div className="grid gap-3">
          <label className="block">
            <span className="block text-xs uppercase tracking-wide text-amber-200/70 mb-1">2 · Site address {siteUrl && files ? <span className="normal-case text-zinc-500">(guessed from your zip — fix if wrong)</span> : null}</span>
            <input type="url" inputMode="url" placeholder="https://myapp.gearup.wtf" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100" data-testid="app-icon-url" />
          </label>
          <label className="block">
            <span className="block text-xs uppercase tracking-wide text-amber-200/70 mb-1">3 · Title <span className="normal-case text-zinc-500">(optional)</span></span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My App" className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100" />
          </label>
          <label className="block">
            <span className="block text-xs uppercase tracking-wide text-amber-200/70 mb-1">Description <span className="normal-case text-zinc-500">(optional)</span></span>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="One line about the app" className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100" />
          </label>
        </div>

        {target ? <p className="text-xs text-zinc-400">Detected: <span className="text-zinc-200">{target.label}</span> · icons go in <code>{target.staticDir || '(root)'}/</code></p> : <p className="text-xs text-zinc-500">Drop your app zip above to put the icon into it — or just use “Icons only”.</p>}
        {on && im ? <p className="text-xs text-emerald-300/90">✓ Will be added when you tap “Clean &amp; download…”.</p> : null}

        <button type="button" disabled={!im} onClick={iconsOnly} data-testid="icons-only"
          className="w-full rounded-lg border border-amber-500/70 px-4 py-3 text-sm font-semibold text-amber-200 disabled:opacity-40">
          Icons only (zip of files + head snippet)
        </button>
        {msg ? <p className="text-xs text-zinc-400">{msg}</p> : null}

        {lastResult ? (
          <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-3 text-xs text-emerald-100 space-y-1" data-testid="app-icon-summary">
            <div className="font-semibold">App icon — what changed</div>
            <div>Added/updated {lastResult.written.length} files: {lastResult.written.map((p) => p.split('/').pop()).join(', ')}</div>
            {lastResult.patched.length ? <div>Head tags updated in: {lastResult.patched.join('; ')}</div> : null}
            {lastResult.notes.map((n) => <div key={n} className="text-amber-200">⚠ {n}</div>)}
          </div>
        ) : null}
      </div>
    </section>
  )
}
