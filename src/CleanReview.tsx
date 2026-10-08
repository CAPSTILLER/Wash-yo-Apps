import {
  formatBytes,
  PROTECT_REASON_LABELS,
  type BackupZipInfo,
} from './lib/cleanZip'
import type { ReviewGroup, ReviewPlan } from './lib/reviewPlan'

const MAX_LIST = 300

const TONE: Record<ReviewGroup['tone'], { box: string; title: string; dot: string }> = {
  remove: {
    box: 'border-amber-900/50 bg-amber-950/15',
    title: 'text-amber-200',
    dot: 'bg-amber-400',
  },
  warn: {
    box: 'border-rose-900/60 bg-rose-950/20',
    title: 'text-rose-200',
    dot: 'bg-rose-400',
  },
  keep: {
    box: 'border-emerald-900/40 bg-emerald-950/10',
    title: 'text-emerald-200',
    dot: 'bg-emerald-400',
  },
}

function FileList({ group }: { group: ReviewGroup }) {
  const shown = group.files.slice(0, MAX_LIST)
  return (
    <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-zinc-800/80 bg-zinc-950/70 p-2 font-mono text-[11px] space-y-0.5">
      {shown.map((f) => (
        <div key={f.path} className="flex justify-between gap-2">
          <span className="break-all text-zinc-300">{f.path}</span>
          <span className="shrink-0 text-zinc-600">{formatBytes(f.size)}</span>
        </div>
      ))}
      {group.files.length > shown.length ? (
        <p className="pt-1 text-zinc-500">
          …and {group.files.length - shown.length} more
        </p>
      ) : null}
    </div>
  )
}

function BackupZipControls({
  zips,
  zipRemove,
  onZipRemove,
  pullMissing,
  onPullMissing,
}: {
  zips: BackupZipInfo[]
  zipRemove: Set<string>
  onZipRemove: (next: Set<string>) => void
  pullMissing: boolean
  onPullMissing: (v: boolean) => void
}) {
  const allOn = zips.length > 0 && zips.every((z) => zipRemove.has(z.path))
  const anyMissing = zips.some(
    (z) => zipRemove.has(z.path) && z.missingMedia.length > 0,
  )
  return (
    <div className="mt-3 space-y-2">
      <label className="flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-3 cursor-pointer">
        <input
          type="checkbox"
          className="size-5 accent-rose-400"
          checked={allOn}
          onChange={(e) =>
            onZipRemove(e.target.checked ? new Set(zips.map((z) => z.path)) : new Set())
          }
        />
        <span className="text-sm text-zinc-100">Remove backup zips</span>
        <span className="ml-auto text-xs text-zinc-500">
          {zipRemove.size}/{zips.length}
        </span>
      </label>
      {zips.map((z) => {
        const on = zipRemove.has(z.path)
        const n = z.missingMedia.length
        return (
          <label
            key={z.path}
            className={[
              'block rounded-lg border px-3 py-2.5 cursor-pointer',
              on ? 'border-rose-900/60 bg-rose-950/25' : 'border-zinc-800 bg-zinc-950/50',
            ].join(' ')}
          >
            <span className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-rose-400"
                checked={on}
                onChange={(e) => {
                  const next = new Set(zipRemove)
                  if (e.target.checked) next.add(z.path)
                  else next.delete(z.path)
                  onZipRemove(next)
                }}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-xs break-all text-zinc-200">
                  {z.path}
                </span>
                <span className="block text-[11px] text-zinc-500 mt-0.5">
                  {formatBytes(z.size)} · {z.mediaCount} image/sound file
                  {z.mediaCount === 1 ? '' : 's'} inside · {on ? 'Remove' : 'Keep'}
                </span>
                {z.error ? (
                  <span className="block text-[11px] text-amber-300 mt-1">
                    Couldn't look inside: {z.error}
                  </span>
                ) : n > 0 ? (
                  <span className="block text-[11px] text-amber-300 mt-1">
                    {n} of them aren't anywhere else in the upload.
                  </span>
                ) : z.mediaCount > 0 ? (
                  <span className="block text-[11px] text-emerald-400/80 mt-1">
                    All its images are also outside the zip.
                  </span>
                ) : null}
              </span>
            </span>
          </label>
        )
      })}
      {anyMissing ? (
        <label className="flex items-start gap-3 rounded-lg border border-amber-800/60 bg-amber-950/25 px-3 py-2.5 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-amber-400"
            checked={pullMissing}
            onChange={(e) => onPullMissing(e.target.checked)}
          />
          <span className="text-xs text-amber-100">
            Pull missing images out of the zip, then remove it
            <span className="block text-amber-200/70 mt-0.5">
              Puts them back where they belong (e.g. public/sprites/). Never
              overwrites a file.
            </span>
          </span>
        </label>
      ) : null}
    </div>
  )
}

export function CleanReview({
  plan,
  zips,
  zipRemove,
  onZipRemove,
  pullMissing,
  onPullMissing,
}: {
  plan: ReviewPlan
  zips: BackupZipInfo[]
  zipRemove: Set<string>
  onZipRemove: (next: Set<string>) => void
  pullMissing: boolean
  onPullMissing: (v: boolean) => void
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5">
      <h3 className="text-base font-medium text-white">What happens to your files</h3>
      <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
        Nothing is removed until you tap <span className="text-amber-300">Clean &amp; download</span>{' '}
        and confirm. Images, sounds, public/ and files your code uses are protected.
      </p>
      {plan.protectedSaved > 0 ? (
        <p className="mt-2 text-xs text-emerald-300/90">
          {plan.protectedSaved} protected file{plan.protectedSaved === 1 ? '' : 's'} matched a
          cleanup rule and {plan.protectedSaved === 1 ? 'was' : 'were'} kept.
        </p>
      ) : null}
      <div className="mt-3 space-y-2.5">
        {plan.groups.map((g) => {
          const tone = TONE[g.tone]
          const isZipGroup = g.id === 'keep-zips' || g.id === 'remove-zips'
          if (isZipGroup) return null // shown with controls below
          return (
            <details
              key={g.id}
              className={`rounded-lg border px-3 py-2.5 ${tone.box}`}
              open={g.tone === 'warn'}
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 py-1">
                <span className={`size-2 shrink-0 rounded-full ${tone.dot}`} />
                <span className={`text-sm font-medium ${tone.title}`}>{g.title}</span>
                <span className="ml-auto shrink-0 text-xs text-zinc-400 tabular-nums">
                  {g.count} · {formatBytes(g.size)}
                </span>
              </summary>
              <p className="mt-1 text-xs text-zinc-400 leading-relaxed">{g.note}</p>
              {g.count > 0 ? <FileList group={g} /> : null}
            </details>
          )
        })}
        {zips.length > 0 ? (
          <div className="rounded-lg border border-amber-900/50 bg-amber-950/10 px-3 py-3">
            <p className="text-sm font-medium text-amber-200">
              Backup zips ({zips.length}) — kept unless you remove them
            </p>
            <BackupZipControls
              zips={zips}
              zipRemove={zipRemove}
              onZipRemove={onZipRemove}
              pullMissing={pullMissing}
              onPullMissing={onPullMissing}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function ConfirmClean({
  plan,
  busy,
  onConfirm,
  onBack,
}: {
  plan: ReviewPlan
  busy: boolean
  onConfirm: () => void
  onBack: () => void
}) {
  return (
    <div
      id="confirm-clean"
      className="rounded-xl border-2 border-amber-500/60 bg-zinc-950 p-4 sm:p-5"
    >
      <h3 className="text-base font-semibold text-amber-200">Confirm clean</h3>
      <ul className="mt-2 space-y-1 text-sm text-zinc-300">
        <li>
          Remove <span className="text-amber-300 tabular-nums">{plan.removeCount}</span> files ·{' '}
          {formatBytes(plan.removeSize)}
        </li>
        <li>
          Keep <span className="text-emerald-300 tabular-nums">{plan.keepCount}</span> files
          {plan.pulledCount > 0 ? ` (incl. ${plan.pulledCount} pulled out of backup zips)` : ''}
        </li>
      </ul>

      {plan.mediaWarnings.length > 0 ? (
        <div className="mt-3 rounded-lg border border-rose-800/70 bg-rose-950/40 p-3">
          <p className="text-sm font-medium text-rose-200">
            ⚠ {plan.mediaWarnings.length} image/sound file
            {plan.mediaWarnings.length === 1 ? '' : 's'} will be removed
          </p>
          <ul className="mt-1.5 max-h-40 overflow-auto space-y-0.5 font-mono text-[11px] text-rose-100/90">
            {plan.mediaWarnings.map((f) => (
              <li key={f.path} className="break-all">
                {f.path}
                {f.protectedBy ? (
                  <span className="text-rose-300/70"> — protected ({PROTECT_REASON_LABELS[f.protectedBy]})</span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-rose-200/70">
            Go back and re-check them in Media review if your app uses them.
          </p>
        </div>
      ) : null}

      {plan.zipWarnings.length > 0 ? (
        <div className="mt-3 rounded-lg border border-amber-800/70 bg-amber-950/30 p-3 space-y-1.5">
          {plan.zipWarnings.map((w) => (
            <p key={w} className="text-xs text-amber-100">
              ⚠ {w}
            </p>
          ))}
        </div>
      ) : null}

      {plan.mediaWarnings.length === 0 && plan.zipWarnings.length === 0 ? (
        <p className="mt-3 text-xs text-emerald-300/90">
          No images or sounds will be removed.
        </p>
      ) : null}

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-5 py-3 text-sm text-zinc-200 disabled:opacity-40"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || plan.keepCount <= 0}
          className="flex-1 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-zinc-950 font-semibold px-5 py-3 text-sm"
        >
          {busy ? 'Working…' : 'Yes, clean & download'}
        </button>
      </div>
    </div>
  )
}
