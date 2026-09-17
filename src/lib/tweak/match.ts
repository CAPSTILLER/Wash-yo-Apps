import {
  decodeText,
  isUnderNodeModules,
  normalizePath,
} from '../zipPaths'
import type { FindMatchesResult, MatchOccurrence } from './types'

const TEXTISH_RE =
  /\.(tsx|jsx|ts|js|mts|cts|mjs|cjs|html|htm|css|scss|sass|less|json|md|mdx|svg|txt|xml|webmanifest)$/i

export function isTextishPath(path: string): boolean {
  const n = normalizePath(path)
  if (isUnderNodeModules(n)) return false
  // Skip directories / empty
  if (!n || n.endsWith('/')) return false
  return TEXTISH_RE.test(n)
}

function snippetAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 40)
  const end = Math.min(text.length, index + len + 40)
  let s = text.slice(start, end).replace(/\s+/g, ' ')
  if (start > 0) s = '…' + s
  if (end < text.length) s = s + '…'
  return s
}

/**
 * Find exact string matches across text-ish zip entries (excluding node_modules).
 * Returns every occurrence so the UI can summarize and replace-all (or advanced single-pick).
 */
export function findExactMatches(
  files: Record<string, Uint8Array>,
  value: string,
): FindMatchesResult {
  if (!value) return { value, matches: [] }
  const matches: MatchOccurrence[] = []

  for (const raw of Object.keys(files)) {
    const path = normalizePath(raw)
    if (!isTextishPath(path)) continue
    let text: string
    try {
      text = decodeText(files[raw]!)
    } catch {
      continue
    }
    // Skip huge binary-looking blobs mislabeled
    if (text.includes('\0')) continue

    let from = 0
    let occ = 0
    while (from <= text.length) {
      const idx = text.indexOf(value, from)
      if (idx === -1) break
      matches.push({
        path,
        index: idx,
        occurrenceInFile: occ,
        snippet: snippetAround(text, idx, value.length),
      })
      occ += 1
      from = idx + Math.max(1, value.length)
    }
  }

  return { value, matches }
}

/** Count of distinct files that contain the value. */
export function uniqueFileCount(result: FindMatchesResult): number {
  return new Set(result.matches.map((m) => m.path)).size
}
