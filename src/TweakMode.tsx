import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { unzipSync } from 'fflate'
import { downloadBlob, formatBytes, resolveOutputZipName } from './lib/cleanZip'
import { findFileKey, normalizePath } from './lib/zipPaths'
import {
  applyPickedReplace,
  buildInventory,
  buildPreview,
  findExactMatches,
  mimeForImagePath,
  parsePreviewMessage,
  removeImageAsset,
  replaceAllExact,
  replaceImageBytes,
  resolveAssetPath,
  revokeBlobUrls,
  suggestTweakOutName,
  summarizeMatches,
  zipFiles,
  type ChangeLogEntry,
  type InventoryItem,
  type MatchOccurrence,
  type PreviewSelection,
} from './lib/tweak'

const HUGE_MB = 80

type PendingReplace = {
  oldValue: string
  newValue: string
  kind: ChangeLogEntry['kind']
  matches: MatchOccurrence[]
  summaryLabel: string
  paths: string[]
  perFile: { path: string; count: number }[]
}

export function TweakMode() {
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileBytes, setFileBytes] = useState(0)
  const [outputZipName, setOutputZipName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const filesRef = useRef<Record<string, Uint8Array> | null>(null)
  const blobUrlsRef = useRef<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const [previewMode, setPreviewMode] = useState<'preview' | 'inventory' | null>(
    null,
  )
  const [srcdoc, setSrcdoc] = useState<string | null>(null)
  const [previewNote, setPreviewNote] = useState<string | null>(null)
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [selection, setSelection] = useState<PreviewSelection | null>(null)
  const [editText, setEditText] = useState('')
  const [editHref, setEditHref] = useState('')
  const [changelog, setChangelog] = useState<ChangeLogEntry[]>([])
  const [pendingReplace, setPendingReplace] = useState<PendingReplace | null>(
    null,
  )
  const [matchWarn, setMatchWarn] = useState<string | null>(null)
  const [previewKey, setPreviewKey] = useState(0)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [downloadWarn, setDownloadWarn] = useState<string | null>(null)

  const clearPreviewBlobs = () => {
    revokeBlobUrls(blobUrlsRef.current)
    blobUrlsRef.current = []
  }

  const rebuildPreview = useCallback(() => {
    const files = filesRef.current
    if (!files) return
    clearPreviewBlobs()
    const built = buildPreview(files)
    blobUrlsRef.current = built.blobUrls
    setPreviewMode(built.mode)
    setSrcdoc(built.srcdoc ?? null)
    setPreviewNote(built.note ?? null)
    if (built.mode === 'inventory') {
      setInventory(buildInventory(files))
    } else {
      // Keep inventory available alongside preview for path resolution
      setInventory(buildInventory(files))
    }
    setPreviewKey((k) => k + 1)
  }, [])

  const clearAll = useCallback(() => {
    clearPreviewBlobs()
    filesRef.current = null
    setFileName(null)
    setFileBytes(0)
    setOutputZipName('')
    setError(null)
    setStatus(null)
    setBusy(false)
    setPreviewMode(null)
    setSrcdoc(null)
    setPreviewNote(null)
    setInventory([])
    setSelection(null)
    setEditText('')
    setEditHref('')
    setChangelog([])
    setPendingReplace(null)
    setMatchWarn(null)
    setAdvancedOpen(false)
    setDownloadWarn(null)
    if (inputRef.current) inputRef.current.value = ''
  }, [])

  useEffect(() => {
    return () => {
      clearPreviewBlobs()
      filesRef.current = null
    }
  }, [])

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const sel = parsePreviewMessage(ev.data)
      if (!sel) return
      setSelection(sel)
      setMatchWarn(null)
      setPendingReplace(null)
      setDownloadWarn(null)
      setAdvancedOpen(false)
      setEditText(sel.text ?? '')
      setEditHref(sel.href ?? '')
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  const loadZip = useCallback(
    async (file: File) => {
      setError(null)
      setStatus(null)
      setChangelog([])
      setSelection(null)
      setPendingReplace(null)
      setMatchWarn(null)
      setDownloadWarn(null)
      if (!file.name.toLowerCase().endsWith('.zip')) {
        setError('Please upload a .zip file.')
        return
      }
      const huge = file.size > HUGE_MB * 1024 * 1024
      setBusy(true)
      setFileName(file.name)
      setFileBytes(file.size)
      try {
        setStatus(
          huge
            ? `Warning: zip is ${formatBytes(file.size)} (>${HUGE_MB} MB). Still trying…`
            : 'Reading zip…',
        )
        const buf = new Uint8Array(await file.arrayBuffer())
        await new Promise((r) => setTimeout(r, 20))
        const unzipped = unzipSync(buf)
        const files: Record<string, Uint8Array> = {}
        for (const [k, v] of Object.entries(unzipped)) {
          if (k.endsWith('/')) continue
          files[k] = v
        }
        filesRef.current = files
        setStatus(`Loaded ${Object.keys(files).length} files. Building preview…`)
        rebuildPreview()
        setStatus(
          `Loaded ${Object.keys(files).length} files from ${file.name}.`,
        )
      } catch (e) {
        console.error(e)
        clearAll()
        setError(
          e instanceof Error
            ? `Failed to read zip: ${e.message}`
            : 'Failed to read zip.',
        )
      } finally {
        setBusy(false)
      }
    },
    [clearAll, rebuildPreview],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const f = e.dataTransfer.files?.[0]
      if (f) void loadZip(f)
    },
    [loadZip],
  )

  const pushLog = (entry: ChangeLogEntry) => {
    setChangelog((prev) => [entry, ...prev].slice(0, 50))
  }

  /** True when sidebar edits differ from last applied/selected baseline. */
  const hasUnsavedPreviewEdits = useMemo(() => {
    if (!selection) return false
    if (
      (selection.kind === 'text' || selection.kind === 'link') &&
      selection.text !== undefined &&
      editText !== (selection.text ?? '')
    ) {
      return true
    }
    if (
      selection.kind === 'link' &&
      selection.href !== undefined &&
      editHref !== (selection.href ?? '')
    ) {
      return true
    }
    return false
  }, [selection, editText, editHref])

  const hasPendingConfirm = pendingReplace !== null

  const zeroMatchMessage = (oldValue: string) =>
    `No exact match for ${JSON.stringify(oldValue)} in text-ish source files (src/, dist/, html, css, js, …). Preview-only / compiled / dynamic text cannot be patched from the visible string — this edit was NOT saved to the zip. Try a shorter unique substring from Inventory, or edit the source files.`

  /**
   * Stage a replace-all (show summary + primary button). Does not mutate yet.
   * Preview iframe / textarea edits are NOT considered saved until Apply
   * runs against the in-memory zip map.
   */
  const stageTextOrHref = (
    oldValue: string,
    newValue: string,
    kind: ChangeLogEntry['kind'],
  ) => {
    const files = filesRef.current
    if (!files) return
    setDownloadWarn(null)
    if (!oldValue) {
      setPendingReplace(null)
      setMatchWarn('Nothing to search for (empty original value).')
      return
    }
    if (oldValue === newValue) {
      setPendingReplace(null)
      setMatchWarn('No change — new value matches original.')
      return
    }
    const { matches } = findExactMatches(files, oldValue)
    if (matches.length === 0) {
      setPendingReplace(null)
      setMatchWarn(zeroMatchMessage(oldValue))
      return
    }
    const summary = summarizeMatches(matches)
    setMatchWarn(null)
    setAdvancedOpen(false)
    setPendingReplace({
      oldValue,
      newValue,
      kind,
      matches,
      summaryLabel: summary.label,
      paths: summary.paths,
      perFile: summary.perFile,
    })
    setStatus(
      `Ready: Updating ${summary.label}: ${summary.perFile
        .map((p) => `${p.path} (${p.count})`)
        .join(', ')}`,
    )
  }

  /** Mutate zip map for all exact matches, then rebuild preview from updated map. */
  const commitReplaceAll = () => {
    const files = filesRef.current
    if (!files || !pendingReplace) return
    const result = replaceAllExact(
      files,
      pendingReplace.oldValue,
      pendingReplace.newValue,
      pendingReplace.kind,
    )
    if (!result) {
      setMatchWarn(
        zeroMatchMessage(pendingReplace.oldValue),
      )
      setPendingReplace(null)
      return
    }
    pushLog(result.log)
    const { kind, newValue } = pendingReplace
    setPendingReplace(null)
    setMatchWarn(null)
    setDownloadWarn(null)
    if (kind === 'href') {
      setSelection((s) => (s ? { ...s, href: newValue } : s))
      setEditHref(newValue)
    } else {
      setSelection((s) => (s ? { ...s, text: newValue } : s))
      setEditText(newValue)
    }
    setStatus(
      `Updated ${result.occurrenceCount} occurrence(s) in ${result.fileCount} file(s): ${result.paths.join(', ')}`,
    )
    // Refresh preview from the mutated zip (rebuild srcdoc), not a stale blob
    rebuildPreview()
  }

  const onPickMatch = (m: MatchOccurrence) => {
    const files = filesRef.current
    if (!files || !pendingReplace) return
    const log = applyPickedReplace(
      files,
      m,
      pendingReplace.oldValue,
      pendingReplace.newValue,
      pendingReplace.kind,
    )
    if (!log) {
      setMatchWarn('Failed to apply patch at selected occurrence.')
      return
    }
    pushLog(log)
    const { kind, newValue } = pendingReplace
    setPendingReplace(null)
    setMatchWarn(null)
    setDownloadWarn(null)
    if (kind === 'href') {
      setSelection((s) => (s ? { ...s, href: newValue } : s))
      setEditHref(newValue)
    } else {
      setSelection((s) => (s ? { ...s, text: newValue } : s))
      setEditText(newValue)
    }
    setStatus(`Patched single occurrence in ${m.path} (advanced)`)
    rebuildPreview()
  }

  const onApplyText = () => {
    if (!selection) return
    const old = selection.text ?? ''
    stageTextOrHref(old, editText, 'text')
  }

  const onApplyHref = () => {
    if (!selection) return
    const old = selection.href ?? ''
    stageTextOrHref(old, editHref, 'href')
  }

  const onClearHref = () => {
    if (!selection?.href) return
    setEditHref('')
    stageTextOrHref(selection.href, '', 'href')
  }

  const [selectedAssetPath, setSelectedAssetPath] = useState<string | null>(
    null,
  )
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)

  useEffect(() => {
    const files = filesRef.current
    let path: string | null = null
    if (files && selection?.src && !selection.src.startsWith('blob:')) {
      path = resolveAssetPath(files, selection.src)
    }
    // Inventory may pass a direct zip path
    if (
      !path &&
      files &&
      selection?.src &&
      findFileKey(files, selection.src)
    ) {
      path = normalizePath(selection.src)
    }
    setSelectedAssetPath(path)

    setThumbUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    if (!files || !path) return
    const key = findFileKey(files, path)
    if (!key) return
    const bytes = files[key]!
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    const url = URL.createObjectURL(
      new Blob([copy.buffer], { type: mimeForImagePath(path) }),
    )
    setThumbUrl(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [selection, previewKey])

  const onReplaceImage = async (file: File) => {
    const files = filesRef.current
    if (!files) return
    let path = selectedAssetPath
    if (!path && selection?.src && !selection.src.startsWith('blob:')) {
      path = resolveAssetPath(files, selection.src)
    }
    if (!path && selection?.src?.startsWith('blob:')) {
      setMatchWarn(
        'Preview used a blob URL — select the image from Inventory (or ensure src path is in source) so we know which zip path to overwrite.',
      )
      return
    }
    if (!path) {
      setMatchWarn('Could not resolve image path inside the zip.')
      return
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const log = replaceImageBytes(files, path, bytes)
    if (!log) {
      setMatchWarn(`Failed to overwrite ${path}`)
      return
    }
    pushLog(log)
    setMatchWarn(null)
    setDownloadWarn(null)
    setStatus(`Replaced ${path}`)
    rebuildPreview()
  }

  const onRemoveImage = () => {
    const files = filesRef.current
    if (!files) return
    let path = selectedAssetPath
    if (!path && selection?.src && !selection.src.startsWith('blob:')) {
      path = resolveAssetPath(files, selection.src)
    }
    if (!path) {
      setMatchWarn(
        'Could not resolve image path. Pick it from Inventory if preview used blob URLs.',
      )
      return
    }
    const { log } = removeImageAsset(files, path, true)
    pushLog(log)
    setSelection(null)
    setMatchWarn(null)
    setDownloadWarn(null)
    setStatus(log.summary)
    rebuildPreview()
  }

  const onInventorySelect = (item: InventoryItem) => {
    setPendingReplace(null)
    setMatchWarn(null)
    setDownloadWarn(null)
    setAdvancedOpen(false)
    if (item.kind === 'text') {
      setSelection({ kind: 'text', text: item.value, tag: 'span' })
      setEditText(item.value)
      setEditHref('')
    } else if (item.kind === 'link') {
      setSelection({
        kind: 'link',
        href: item.value,
        text: item.value,
        tag: 'a',
      })
      setEditHref(item.value)
      setEditText(item.value)
    } else {
      setSelection({
        kind: 'image',
        src: item.assetPath || item.value,
        tag: 'img',
      })
      setEditText('')
      setEditHref('')
    }
  }

  const onDownload = () => {
    const files = filesRef.current
    if (!files || !fileName) return
    if (hasUnsavedPreviewEdits || hasPendingConfirm) {
      setDownloadWarn(
        hasPendingConfirm
          ? 'Download blocked: you have a staged replace that is not applied yet. Click “Replace all …” (or cancel) first. Download only writes the mutated zip map.'
          : 'Download blocked: sidebar edits are not saved until you Apply → Replace all against the zip. Preview/textarea changes alone do not mutate the download.',
      )
      return
    }
    try {
      setBusy(true)
      setDownloadWarn(null)
      const out = zipFiles(files)
      const outName = resolveOutputZipName(
        outputZipName,
        suggestTweakOutName(fileName),
      )
      downloadBlob(out, outName)
      setStatus(
        `Downloaded ${outName} (${formatBytes(out.byteLength)} compressed).`,
      )
    } catch (e) {
      console.error(e)
      setError(
        e instanceof Error
          ? `Failed to build zip: ${e.message}`
          : 'Failed to build zip.',
      )
    } finally {
      setBusy(false)
    }
  }

  const downloadBlocked = hasUnsavedPreviewEdits || hasPendingConfirm

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-400 leading-relaxed">
        Upload a project zip, preview the lander (best-effort from{' '}
        <span className="text-zinc-300">dist/index.html</span>, else root /{' '}
        <span className="text-zinc-300">public/</span>), click elements to
        select (links do <span className="text-cyan-300">not</span> navigate),
        then Apply. Default patch is{' '}
        <span className="text-cyan-300">replace all exact matches</span> across
        text-ish files (src + dist) so Clean → Vercel builds stay in sync.
        Preview edits are not saved until Apply mutates the in-memory zip.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={[
          'rounded-xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors',
          dragOver
            ? 'border-cyan-400 bg-cyan-400/10'
            : 'border-zinc-700 bg-zinc-900/40 hover:border-zinc-500',
        ].join(' ')}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void loadZip(f)
          }}
        />
        <p className="text-lg text-zinc-200">
          Drop a <span className="text-cyan-300">.zip</span> to tweak, or click
          to browse
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Client-side only (fflate). Original zip stays in memory until you
          clear or leave.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}
      {status ? <p className="text-sm text-zinc-400">{status}</p> : null}

      {fileName ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-zinc-300">
            <span className="text-zinc-500">File:</span> {fileName}{' '}
            <span className="text-zinc-600">({formatBytes(fileBytes)})</span>
          </span>
          <label className="flex items-center gap-2 text-zinc-400">
            <span className="text-zinc-500 whitespace-nowrap">Output zip name</span>
            <input
              type="text"
              value={outputZipName}
              onChange={(e) => setOutputZipName(e.target.value)}
              placeholder={suggestTweakOutName(fileName)}
              className="w-44 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500/70 focus:outline-none"
            />
          </label>
          <button
            type="button"
            disabled={busy || downloadBlocked}
            title={
              downloadBlocked
                ? 'Apply or cancel pending edits before download'
                : undefined
            }
            onClick={onDownload}
            className="rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white"
          >
            Download tweaked zip
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={clearAll}
            className="rounded-lg border border-zinc-700 hover:border-zinc-500 px-3 py-2 text-sm text-zinc-300"
          >
            Clear
          </button>
          {downloadBlocked ? (
            <span className="text-xs text-amber-300">
              Unsaved / staged edits — Apply first
            </span>
          ) : null}
        </div>
      ) : null}

      {downloadWarn ? (
        <div className="rounded-lg border border-amber-900/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
          {downloadWarn}
        </div>
      ) : null}

      {previewMode ? (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-cyan-200/90">
                {previewMode === 'preview' ? 'Live preview' : 'Editable inventory'}
              </h2>
              {previewNote ? (
                <p className="text-[11px] text-zinc-500 text-right max-w-md">
                  {previewNote}
                </p>
              ) : null}
            </div>

            {previewMode === 'preview' && srcdoc ? (
              <div className="rounded-xl border border-zinc-800 bg-white overflow-hidden h-[520px]">
                <iframe
                  key={previewKey}
                  title="Tweak preview"
                  srcDoc={srcdoc}
                  sandbox="allow-scripts allow-same-origin"
                  className="w-full h-full bg-white"
                />
              </div>
            ) : null}

            {previewMode === 'inventory' || inventory.length > 0 ? (
              <div
                className={
                  previewMode === 'inventory'
                    ? 'rounded-xl border border-amber-900/50 bg-amber-950/20 p-3'
                    : 'rounded-xl border border-zinc-800 bg-zinc-900/40 p-3'
                }
              >
                {previewMode === 'inventory' ? (
                  <p className="text-xs text-amber-200/90 mb-2">
                    Fallback mode: no previewable HTML. Edit from discovered
                    strings / hrefs / public images below.
                  </p>
                ) : (
                  <p className="text-xs text-zinc-500 mb-2">
                    Inventory (also useful when preview blob URLs hide asset
                    paths):
                  </p>
                )}
                <div className="max-h-64 overflow-auto space-y-1">
                  {inventory.length === 0 ? (
                    <p className="text-xs text-zinc-500">No inventory items.</p>
                  ) : (
                    inventory.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onInventorySelect(item)}
                        className="w-full text-left rounded-md border border-zinc-800 hover:border-cyan-700/60 bg-zinc-950/60 px-2 py-1.5 text-xs flex gap-2 items-start"
                      >
                        <span
                          className={
                            item.kind === 'text'
                              ? 'text-emerald-400 shrink-0'
                              : item.kind === 'link'
                                ? 'text-cyan-400 shrink-0'
                                : 'text-amber-400 shrink-0'
                          }
                        >
                          {item.kind}
                        </span>
                        <span className="min-w-0 truncate text-zinc-300">
                          {item.value}
                        </span>
                        {item.sourcePath ? (
                          <span className="ml-auto shrink-0 text-zinc-600 font-mono">
                            {normalizePath(item.sourcePath).split('/').pop()}
                          </span>
                        ) : null}
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <div className="lg:col-span-2 space-y-3">
            <h2 className="text-sm font-medium text-cyan-200/90">
              Selected element
            </h2>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
              {!selection ? (
                <p className="text-sm text-zinc-500">
                  Click text, a link/button, or an image in the preview — or
                  pick from inventory.
                </p>
              ) : (
                <>
                  <p className="text-xs text-zinc-500">
                    Kind:{' '}
                    <span className="text-cyan-300">{selection.kind}</span> ·
                    tag:{' '}
                    <span className="font-mono text-zinc-400">
                      &lt;{selection.tag}&gt;
                    </span>
                  </p>

                  {(selection.kind === 'text' || selection.kind === 'link') &&
                  selection.text !== undefined ? (
                    <label className="block">
                      <span className="text-xs uppercase tracking-wide text-zinc-500">
                        Text
                      </span>
                      <textarea
                        value={editText}
                        onChange={(e) => {
                          setEditText(e.target.value)
                          setDownloadWarn(null)
                        }}
                        rows={3}
                        className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500/70 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={onApplyText}
                        className="mt-2 rounded-lg bg-cyan-700 hover:bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white"
                      >
                        Apply text…
                      </button>
                    </label>
                  ) : null}

                  {selection.kind === 'link' ? (
                    <label className="block">
                      <span className="text-xs uppercase tracking-wide text-zinc-500">
                        Link href
                      </span>
                      <input
                        type="text"
                        value={editHref}
                        onChange={(e) => {
                          setEditHref(e.target.value)
                          setDownloadWarn(null)
                        }}
                        className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500/70 focus:outline-none"
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={onApplyHref}
                          className="rounded-lg bg-cyan-700 hover:bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white"
                        >
                          Apply href…
                        </button>
                        <button
                          type="button"
                          onClick={onClearHref}
                          className="rounded-lg border border-zinc-600 hover:border-zinc-400 px-3 py-1.5 text-xs text-zinc-300"
                        >
                          Clear href
                        </button>
                      </div>
                    </label>
                  ) : null}

                  {selection.kind === 'image' ? (
                    <div className="space-y-2">
                      {thumbUrl ? (
                        <img
                          src={thumbUrl}
                          alt="Selected"
                          className="max-h-32 rounded border border-zinc-700 object-contain bg-zinc-950"
                        />
                      ) : null}
                      <p className="text-xs text-zinc-500 break-all">
                        {selectedAssetPath ||
                          selection.src ||
                          '(unresolved path)'}
                      </p>
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) void onReplaceImage(f)
                          e.target.value = ''
                        }}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => imageInputRef.current?.click()}
                          className="rounded-lg bg-cyan-700 hover:bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white"
                        >
                          Replace image…
                        </button>
                        <button
                          type="button"
                          onClick={onRemoveImage}
                          className="rounded-lg border border-red-900/60 text-red-300 hover:border-red-600 px-3 py-1.5 text-xs"
                        >
                          Remove image
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              )}

              {matchWarn ? (
                <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
                  {matchWarn}
                </div>
              ) : null}

              {pendingReplace ? (
                <div className="rounded-lg border border-cyan-900/50 bg-cyan-950/20 p-3 space-y-2">
                  <p className="text-xs text-cyan-100/90 font-medium">
                    Updating {pendingReplace.summaryLabel}:
                  </p>
                  <ul className="text-[11px] text-zinc-400 max-h-28 overflow-auto space-y-0.5 font-mono">
                    {pendingReplace.perFile.map((p) => (
                      <li key={p.path}>
                        {p.path}{' '}
                        <span className="text-zinc-600">×{p.count}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={commitReplaceAll}
                      className="rounded-lg bg-cyan-600 hover:bg-cyan-500 px-3 py-1.5 text-xs font-medium text-white"
                    >
                      Replace all {pendingReplace.matches.length} matches
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingReplace(null)
                        setStatus(null)
                      }}
                      className="rounded-lg border border-zinc-600 hover:border-zinc-400 px-3 py-1.5 text-xs text-zinc-300"
                    >
                      Cancel
                    </button>
                  </div>
                  <details
                    className="text-[11px] text-zinc-500"
                    open={advancedOpen}
                    onToggle={(e) =>
                      setAdvancedOpen((e.target as HTMLDetailsElement).open)
                    }
                  >
                    <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">
                      Advanced: edit only selected match
                    </summary>
                    <div className="mt-2 space-y-1 max-h-40 overflow-auto">
                      {pendingReplace.matches.map((m, i) => (
                        <button
                          key={`${m.path}:${m.index}:${i}`}
                          type="button"
                          onClick={() => onPickMatch(m)}
                          className="w-full text-left rounded border border-zinc-800 hover:border-cyan-700 px-2 py-1.5 text-[11px]"
                        >
                          <span className="font-mono text-cyan-300/90">
                            {m.path}
                          </span>
                          <span className="text-zinc-600">
                            {' '}
                            · occ #{m.occurrenceInFile + 1}
                          </span>
                          <div className="text-zinc-500 truncate">
                            {m.snippet}
                          </div>
                        </button>
                      ))}
                    </div>
                  </details>
                </div>
              ) : null}
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              <h3 className="text-xs font-medium text-zinc-400 mb-2">
                Change log
              </h3>
              {changelog.length === 0 ? (
                <p className="text-xs text-zinc-600">No changes yet.</p>
              ) : (
                <ul className="space-y-1 max-h-40 overflow-auto">
                  {changelog.map((c) => (
                    <li key={c.id} className="text-[11px] text-zinc-400">
                      <span className="text-cyan-500/80">{c.kind}</span> —{' '}
                      {c.summary}
                      {c.paths && c.paths.length > 1 ? (
                        <div className="text-zinc-600 font-mono mt-0.5">
                          {c.paths.join(', ')}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {busy ? (
        <p className="text-sm text-zinc-500 animate-pulse">Working…</p>
      ) : null}
    </div>
  )
}
