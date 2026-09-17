import {
  basename,
  decodeText,
  encodeText,
  isUnderNodeModules,
  normalizePath,
} from './zipPaths'

/**
 * Rewrite grok sandbox install-asset hrefs left in HTML/JS/TS after
 * `public/__grok/**` is stripped and/or PWA pack injects root icons + manifest.
 *
 * Path-based string replace only — does not parse AST.
 */

export type GrokHrefRewriteResult = {
  filesRewritten: string[]
  replacementCount: number
}

/** Extensions that can hold <link>/href strings for icons + manifest. */
const REWRITE_EXT_RE =
  /\.(html?|tsx|jsx|ts|js|mts|cts|mjs|cjs)$/i

export function isGrokHrefRewriteCandidate(path: string): boolean {
  const n = normalizePath(path)
  if (!n || n.endsWith('/')) return false
  if (isUnderNodeModules(n)) return false
  return REWRITE_EXT_RE.test(basename(n))
}

/**
 * Map a matched __grok icon path to the PWA-pack public asset.
 * Size-aware when possible; otherwise apple-touch-icon.
 */
function mapGrokIconPath(matched: string): string {
  const lower = matched.toLowerCase()
  if (/icon-512\.png/.test(lower)) return '/icon-512.png'
  if (/icon-192\.png/.test(lower)) return '/icon-192.png'
  if (/favicon/.test(lower)) return '/favicon-32.png'
  // icon-180, apple-touch-icon, other icon-*.png under __grok
  return '/apple-touch-icon.png'
}

/**
 * Rewrite __grok icon + manifest paths in a single text buffer.
 * Matches optional leading `./`, `/`, or `public/` before `__grok/`.
 */
export function rewriteGrokAssetHrefsInText(text: string): {
  text: string
  count: number
} {
  if (!text.includes('__grok')) {
    return { text, count: 0 }
  }

  let count = 0
  let out = text

  // Manifest (and site.webmanifest) under __grok → root pack manifest
  out = out.replace(
    /(?:\.\/)?(?:\/)?(?:public\/)?__grok\/(?:manifest|site)\.webmanifest\b/gi,
    () => {
      count += 1
      return '/manifest.webmanifest'
    },
  )

  // Icon / apple-touch / favicon PNGs under __grok
  out = out.replace(
    /(?:\.\/)?(?:\/)?(?:public\/)?__grok\/(?:icon-\d+|apple-touch-icon|favicon(?:-\d+)?)\.png\b/gi,
    (m) => {
      count += 1
      return mapGrokIconPath(m)
    },
  )

  return { text: out, count }
}

/**
 * Apply path-safe __grok → public asset rewrites across kept text files.
 * Mutates `kept`. Call when grok strip and/or PWA pack is enabled.
 */
export function applyGrokHrefRewrites(
  kept: Record<string, Uint8Array>,
): GrokHrefRewriteResult {
  const filesRewritten: string[] = []
  let replacementCount = 0

  for (const raw of Object.keys(kept)) {
    const n = normalizePath(raw)
    if (!isGrokHrefRewriteCandidate(n)) continue
    const bytes = kept[raw]
    if (!bytes || bytes.byteLength === 0) continue

    // Cheap skip: only decode files that likely mention __grok
    // (ASCII search on raw bytes for "__grok")
    if (!bytesIncludesAscii(bytes, '__grok')) continue

    const src = decodeText(bytes)
    const { text, count } = rewriteGrokAssetHrefsInText(src)
    if (count === 0 || text === src) continue
    kept[raw] = encodeText(text)
    filesRewritten.push(n)
    replacementCount += count
  }

  filesRewritten.sort((a, b) => a.localeCompare(b))
  return { filesRewritten, replacementCount }
}

function bytesIncludesAscii(bytes: Uint8Array, needle: string): boolean {
  const n = needle.length
  if (n === 0 || bytes.byteLength < n) return false
  outer: for (let i = 0; i <= bytes.byteLength - n; i++) {
    for (let j = 0; j < n; j++) {
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer
    }
    return true
  }
  return false
}
