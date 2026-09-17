import { useEffect, useMemo, useRef, useState } from 'react'
import {
  formatBytes,
  type MediaEntry,
  type MediaKind,
} from './lib/cleanZip'
import { findFileKey } from './lib/zipPaths'

const KIND_BADGE: Record<
  MediaKind,
  { label: string; className: string }
> = {
  image: {
    label: 'image',
    className: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60',
  },
  audio: {
    label: 'audio',
    className: 'bg-violet-950/80 text-violet-300 border-violet-800/60',
  },
  video: {
    label: 'video',
    className: 'bg-rose-950/80 text-rose-300 border-rose-800/60',
  },
}

/** Lazily create / revoke object URLs for media previews */
function useLazyPreviewUrl(
  path: string | null,
  bytes: Uint8Array | null,
  mime: string,
) {
  const [url, setUrl] = useState<string | null>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!path || !bytes) {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
      setUrl(null)
      return
    }
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    const next = URL.createObjectURL(new Blob([copy.buffer], { type: mime }))
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = next
    setUrl(next)
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [path, bytes, mime])

  return url
}

function MediaRow({
  entry,
  bytes,
  markedRemove,
  onToggle,
}: {
  entry: MediaEntry
  bytes: Uint8Array | undefined
  markedRemove: boolean
  onToggle: (path: string, remove: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const previewBytes = expanded && bytes ? bytes : null
  const previewUrl = useLazyPreviewUrl(
    expanded ? entry.path : null,
    previewBytes,
    entry.mime,
  )
  const badge = KIND_BADGE[entry.kind]

  return (
    <div
      className={[
        'rounded-lg border px-3 py-2.5 transition-colors',
        markedRemove
          ? 'border-rose-900/50 bg-rose-950/20'
          : 'border-zinc-800 bg-zinc-950/50',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-start gap-3">
        <label className="flex items-start gap-2 cursor-pointer shrink-0 pt-0.5">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-rose-400"
            checked={markedRemove}
            onChange={(e) => onToggle(entry.path, e.target.checked)}
            aria-label={`Remove ${entry.path}`}
          />
          <span className="text-xs text-zinc-500 hidden sm:inline w-14">
            {markedRemove ? 'Remove' : 'Keep'}
          </span>
        </label>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide font-medium ${badge.className}`}
            >
              {badge.label}
            </span>
            <span className="text-xs text-zinc-500 tabular-nums">
              {formatBytes(entry.size)}
            </span>
          </div>
          <p
            className={[
              'mt-1 font-mono text-xs break-all',
              markedRemove
                ? 'text-rose-200/70 line-through'
                : 'text-cyan-100/90',
            ].join(' ')}
            title={entry.path}
          >
            {entry.path}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          disabled={!bytes}
          className="shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:border-cyan-700/60 hover:text-cyan-200 disabled:opacity-40"
        >
          {expanded ? 'Hide' : 'Preview'}
        </button>
      </div>

      {expanded ? (
        <div className="mt-3 rounded-md border border-zinc-800 bg-black/40 p-2">
          {!bytes ? (
            <p className="text-xs text-zinc-500">Bytes unavailable.</p>
          ) : !previewUrl ? (
            <p className="text-xs text-zinc-500">Loading preview…</p>
          ) : entry.kind === 'image' ? (
            <img
              src={previewUrl}
              alt={entry.path}
              className="max-h-48 max-w-full rounded object-contain mx-auto"
            />
          ) : entry.kind === 'audio' ? (
            <audio
              src={previewUrl}
              controls
              preload="metadata"
              className="w-full"
            />
          ) : (
            <video
              src={previewUrl}
              controls
              preload="metadata"
              className="max-h-56 max-w-full rounded mx-auto"
            />
          )}
        </div>
      ) : null}
    </div>
  )
}

export function MediaReview({
  entries,
  files,
  removePaths,
  onChangeRemovePaths,
}: {
  entries: MediaEntry[]
  files: Record<string, Uint8Array> | null
  removePaths: Set<string>
  onChangeRemovePaths: (next: Set<string>) => void
}) {
  const totals = useMemo(() => {
    let totalSize = 0
    let removeSize = 0
    let removeCount = 0
    const byKind: Record<MediaKind, { count: number; size: number }> = {
      image: { count: 0, size: 0 },
      audio: { count: 0, size: 0 },
      video: { count: 0, size: 0 },
    }
    for (const e of entries) {
      totalSize += e.size
      byKind[e.kind].count += 1
      byKind[e.kind].size += e.size
      if (removePaths.has(e.path)) {
        removeCount += 1
        removeSize += e.size
      }
    }
    return { totalSize, removeSize, removeCount, byKind }
  }, [entries, removePaths])

  const toggle = (path: string, remove: boolean) => {
    const next = new Set(removePaths)
    if (remove) next.add(path)
    else next.delete(path)
    onChangeRemovePaths(next)
  }

  const removeAllVideos = () => {
    const next = new Set(removePaths)
    for (const e of entries) {
      if (e.kind === 'video') next.add(e.path)
    }
    onChangeRemovePaths(next)
  }

  const keepAll = () => {
    onChangeRemovePaths(new Set())
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <h3 className="text-sm font-medium text-cyan-200 mb-1">Media review</h3>
        <p className="text-xs text-zinc-500">
          No image / audio / video files among kept entries. Videos are not
          auto-stripped — upload a zip with media to review and opt into
          removals.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-cyan-900/40 bg-cyan-950/10 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h3 className="text-sm font-medium text-cyan-200">Media review</h3>
        <span className="text-xs text-zinc-500 tabular-nums">
          {entries.length} file{entries.length === 1 ? '' : 's'} ·{' '}
          {formatBytes(totals.totalSize)}
        </span>
      </div>
      <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
        Preview images, audio, and video from the zip. Removal is{' '}
        <span className="text-zinc-400">opt-in</span> (default keep) — nothing
        is auto-stripped here. Marked files are omitted from the clean zip in
        addition to strip rules.
      </p>

      <div className="flex flex-wrap gap-2 text-[11px] text-zinc-400 mb-3">
        {(Object.keys(totals.byKind) as MediaKind[]).map((k) =>
          totals.byKind[k].count > 0 ? (
            <span
              key={k}
              className={`rounded border px-2 py-0.5 ${KIND_BADGE[k].className}`}
            >
              {totals.byKind[k].count} {k}
              {totals.byKind[k].count === 1 ? '' : 's'} ·{' '}
              {formatBytes(totals.byKind[k].size)}
            </span>
          ) : null,
        )}
      </div>

      {totals.removeCount > 0 ? (
        <p className="mb-3 text-xs text-rose-300/90">
          Will remove {totals.removeCount} media file
          {totals.removeCount === 1 ? '' : 's'} ·{' '}
          {formatBytes(totals.removeSize)}
        </p>
      ) : (
        <p className="mb-3 text-xs text-zinc-600">
          No media marked for removal.
        </p>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        <button
          type="button"
          onClick={removeAllVideos}
          disabled={totals.byKind.video.count === 0}
          className="rounded-md border border-rose-900/60 bg-rose-950/40 px-2.5 py-1 text-xs text-rose-200 hover:border-rose-700 disabled:opacity-40"
        >
          Remove all videos
        </button>
        <button
          type="button"
          onClick={keepAll}
          disabled={removePaths.size === 0}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:border-cyan-700/50 disabled:opacity-40"
        >
          Keep all
        </button>
      </div>

      <div className="space-y-2 max-h-[28rem] overflow-auto pr-0.5">
        {entries.map((e) => {
          const key = files ? findFileKey(files, e.path) : null
          const bytes = key && files ? files[key] : undefined
          return (
            <MediaRow
              key={e.path}
              entry={e}
              bytes={bytes}
              markedRemove={removePaths.has(e.path)}
              onToggle={toggle}
            />
          )
        })}
      </div>
    </div>
  )
}
