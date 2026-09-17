import { zipSync } from 'fflate'
import {
  decodeText,
  encodeText,
  findFileKey,
  normalizePath,
} from '../zipPaths'
import { findExactMatches, uniqueFileCount } from './match'
import type {
  ChangeLogEntry,
  MatchOccurrence,
  ReplaceAllResult,
} from './types'

function nextId(): string {
  return `chg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Replace the Nth occurrence of `oldValue` in a single file (0-based).
 * Returns false if that occurrence was not found.
 */
export function replaceOccurrenceInFile(
  files: Record<string, Uint8Array>,
  path: string,
  oldValue: string,
  newValue: string,
  occurrenceInFile: number,
): boolean {
  const key = findFileKey(files, path)
  if (!key || !oldValue) return false
  const text = decodeText(files[key]!)
  let from = 0
  let occ = 0
  let idx = -1
  while (from <= text.length) {
    const found = text.indexOf(oldValue, from)
    if (found === -1) break
    if (occ === occurrenceInFile) {
      idx = found
      break
    }
    occ += 1
    from = found + Math.max(1, oldValue.length)
  }
  if (idx === -1) return false
  const next =
    text.slice(0, idx) + newValue + text.slice(idx + oldValue.length)
  files[key] = encodeText(next)
  return true
}

/** Replace every exact occurrence of `oldValue` inside one file. */
export function replaceAllInFile(
  files: Record<string, Uint8Array>,
  path: string,
  oldValue: string,
  newValue: string,
): number {
  const key = findFileKey(files, path)
  if (!key || !oldValue) return 0
  const text = decodeText(files[key]!)
  if (!text.includes(oldValue)) return 0
  // Split/join is safe for non-overlapping exact string replace-all
  const parts = text.split(oldValue)
  const count = parts.length - 1
  if (count <= 0) return 0
  files[key] = encodeText(parts.join(newValue))
  return count
}

/**
 * Replace ALL exact occurrences of `oldValue` across eligible text-ish files
 * (same corpus as findExactMatches). Mutates `files` immediately.
 * Hits both src/ and dist/ trees (and any other text-ish paths) so Clean →
 * Vercel source builds and static preview stay in sync.
 */
export function replaceAllExact(
  files: Record<string, Uint8Array>,
  oldValue: string,
  newValue: string,
  kind: ChangeLogEntry['kind'] = 'text',
): ReplaceAllResult | null {
  if (!oldValue) return null
  const { matches } = findExactMatches(files, oldValue)
  if (matches.length === 0) return null

  const byFile = new Map<string, number>()
  for (const m of matches) {
    byFile.set(m.path, (byFile.get(m.path) ?? 0) + 1)
  }

  const perFile: { path: string; count: number }[] = []
  let total = 0
  for (const [path, expected] of byFile) {
    const n = replaceAllInFile(files, path, oldValue, newValue)
    if (n > 0) {
      perFile.push({ path, count: n })
      total += n
    } else if (expected > 0) {
      // Fallback: shouldn't happen; try occurrence-by-occurrence
      for (let i = expected - 1; i >= 0; i--) {
        if (replaceOccurrenceInFile(files, path, oldValue, newValue, i)) {
          total += 1
        }
      }
      if (total > 0) perFile.push({ path, count: expected })
    }
  }

  perFile.sort((a, b) => a.path.localeCompare(b.path))
  const paths = perFile.map((p) => p.path)
  const fileList = perFile
    .map((p) => `${p.path} (${p.count})`)
    .join(', ')

  return {
    occurrenceCount: total,
    fileCount: paths.length,
    paths,
    perFile,
    log: {
      id: nextId(),
      at: Date.now(),
      kind,
      summary: `Replaced ${total} occurrence(s) in ${paths.length} file(s): ${fileList}`,
      path: paths[0],
      paths,
    },
  }
}

/** Summarize match set for UI: "N occurrences in M files". */
export function summarizeMatches(matches: MatchOccurrence[]): {
  occurrenceCount: number
  fileCount: number
  paths: string[]
  perFile: { path: string; count: number }[]
  label: string
} {
  const byFile = new Map<string, number>()
  for (const m of matches) {
    byFile.set(m.path, (byFile.get(m.path) ?? 0) + 1)
  }
  const perFile = [...byFile.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => a.path.localeCompare(b.path))
  const paths = perFile.map((p) => p.path)
  return {
    occurrenceCount: matches.length,
    fileCount: paths.length,
    paths,
    perFile,
    label: `${matches.length} occurrence(s) in ${paths.length} file(s)`,
  }
}

/**
 * If exactly one match across the zip, patch it. Otherwise return the matches
 * for the UI (does not mutate). Prefer replaceAllExact for the default path.
 */
export function tryUniqueReplace(
  files: Record<string, Uint8Array>,
  oldValue: string,
  newValue: string,
):
  | { ok: true; path: string; log: ChangeLogEntry }
  | { ok: false; reason: 'zero' | 'many'; matches: MatchOccurrence[] } {
  const { matches } = findExactMatches(files, oldValue)
  if (matches.length === 0) return { ok: false, reason: 'zero', matches }
  if (matches.length > 1) return { ok: false, reason: 'many', matches }
  const m = matches[0]!
  const applied = replaceOccurrenceInFile(
    files,
    m.path,
    oldValue,
    newValue,
    m.occurrenceInFile,
  )
  if (!applied) return { ok: false, reason: 'zero', matches: [] }
  return {
    ok: true,
    path: m.path,
    log: {
      id: nextId(),
      at: Date.now(),
      kind: 'text',
      summary: `Replaced text in ${m.path}`,
      path: m.path,
      paths: [m.path],
    },
  }
}

export function applyPickedReplace(
  files: Record<string, Uint8Array>,
  match: MatchOccurrence,
  oldValue: string,
  newValue: string,
  kind: ChangeLogEntry['kind'] = 'text',
): ChangeLogEntry | null {
  const ok = replaceOccurrenceInFile(
    files,
    match.path,
    oldValue,
    newValue,
    match.occurrenceInFile,
  )
  if (!ok) return null
  return {
    id: nextId(),
    at: Date.now(),
    kind,
    summary: `Replaced in ${match.path} (occ #${match.occurrenceInFile + 1})`,
    path: match.path,
    paths: [match.path],
  }
}

/**
 * Resolve a preview/src URL path to a zip entry.
 * Tries absolute-looking paths against public/, dist/, and root.
 */
export function resolveAssetPath(
  files: Record<string, Uint8Array>,
  srcOrHref: string,
): string | null {
  if (!srcOrHref || srcOrHref.startsWith('data:') || srcOrHref.startsWith('blob:')) {
    return null
  }
  let clean = srcOrHref.split('?')[0]!.split('#')[0]!
  if (clean.startsWith('./')) clean = clean.slice(2)
  if (clean.startsWith('/')) clean = clean.slice(1)

  const candidates = [
    clean,
    `public/${clean}`,
    `dist/${clean}`,
    `static/${clean}`,
  ]
  // Also try basename search under public/
  const base = clean.split('/').pop()!
  for (const raw of Object.keys(files)) {
    const n = normalizePath(raw)
    if (candidates.some((c) => n === c || n.endsWith('/' + c))) {
      return n
    }
  }
  if (base) {
    for (const raw of Object.keys(files)) {
      const n = normalizePath(raw)
      if (
        (n.startsWith('public/') || n.startsWith('static/') || n.startsWith('dist/')) &&
        n.endsWith('/' + base)
      ) {
        return n
      }
    }
  }
  return findFileKey(files, clean) ? normalizePath(clean) : null
}

/** Overwrite image bytes at a zip path. */
export function replaceImageBytes(
  files: Record<string, Uint8Array>,
  assetPath: string,
  bytes: Uint8Array,
): ChangeLogEntry | null {
  const key = findFileKey(files, assetPath)
  if (!key) return null
  files[key] = bytes
  return {
    id: nextId(),
    at: Date.now(),
    kind: 'image-replace',
    summary: `Replaced image ${assetPath}`,
    path: assetPath,
    paths: [assetPath],
  }
}

/**
 * Remove an image path from the zip. If `clearRefs`, replace-all exact path
 * string refs (and common basename /public forms) across text-ish files.
 */
export function removeImageAsset(
  files: Record<string, Uint8Array>,
  assetPath: string,
  clearRefs: boolean,
): { log: ChangeLogEntry; clearedRefs: string[]; paths: string[] } {
  const key = findFileKey(files, assetPath)
  const clearedRefs: string[] = []
  const touched = new Set<string>()
  if (key) {
    delete files[key]
    touched.add(normalizePath(assetPath))
  }

  if (clearRefs) {
    const n = normalizePath(assetPath)
    const base = n.split('/').pop()!
    const forms = [
      n,
      '/' + n.replace(/^(public|static|dist)\//, ''),
      '/' + base,
      base,
      './' + base,
    ]
    const seenForms = new Set<string>()
    for (const form of forms) {
      if (!form || seenForms.has(form)) continue
      seenForms.add(form)
      const result = replaceAllExact(files, form, '', 'image-remove')
      if (result) {
        for (const p of result.paths) touched.add(p)
        clearedRefs.push(
          `${result.occurrenceCount}× "${form}" in ${result.fileCount} file(s)`,
        )
      }
    }
  }

  const paths = [...touched].sort()
  return {
    clearedRefs,
    paths,
    log: {
      id: nextId(),
      at: Date.now(),
      kind: 'image-remove',
      summary: `Removed ${assetPath}${
        clearedRefs.length
          ? ` (+ cleared refs: ${clearedRefs.join('; ')})`
          : ''
      }${paths.length ? ` · files: ${paths.join(', ')}` : ''}`,
      path: assetPath,
      paths,
    },
  }
}

export function zipFiles(files: Record<string, Uint8Array>): Uint8Array {
  // fflate zipSync expects Record<string, Uint8Array>
  const out: Record<string, Uint8Array> = {}
  for (const [k, v] of Object.entries(files)) {
    if (k.endsWith('/')) continue
    out[k] = v
  }
  return zipSync(out, { level: 6 })
}

export function suggestTweakOutName(originalName: string): string {
  const base = originalName.replace(/\.zip$/i, '')
  return `${base}-tweaked.zip`
}

// Re-export for UI convenience
export { uniqueFileCount }
