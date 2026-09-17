import {
  basename,
  decodeText,
  isUnderNodeModules,
  normalizePath,
} from '../zipPaths'
import type { InventoryItem } from './types'

const SRC_RE = /^(.+\/)?src\/.+\.(tsx|jsx|html|htm)$/i
const PUBLIC_IMG_RE =
  /\.(png|jpe?g|gif|webp|svg|ico|avif)$/i

function isSrcSource(path: string): boolean {
  const n = normalizePath(path)
  if (isUnderNodeModules(n)) return false
  return SRC_RE.test(n) || /\.(html|htm)$/i.test(n)
}

function isPublicImage(path: string): boolean {
  const n = normalizePath(path)
  if (isUnderNodeModules(n)) return false
  if (!PUBLIC_IMG_RE.test(n)) return false
  return (
    n.startsWith('public/') ||
    n.startsWith('static/') ||
    n.startsWith('dist/') ||
    !n.includes('/')
  )
}

/** Extract string literals that look editable (quoted, length 2–200). */
function extractStringLiterals(
  text: string,
  sourcePath: string,
  out: InventoryItem[],
  seen: Set<string>,
) {
  const re = /(['"`])([^'"`\n]{2,200})\1/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const value = m[2]!
    if (/^(https?:\/\/|data:)/i.test(value)) {
      const id = `link:${value}`
      if (!seen.has(id)) {
        seen.add(id)
        out.push({
          id,
          kind: 'link',
          value,
          sourcePath,
        })
      }
      continue
    }
    if (
      /^(\/|\.\/|#)/.test(value) ||
      /\.(png|jpe?g|gif|webp|svg|ico|html|pdf)(\?|$)/i.test(value)
    ) {
      const kind = PUBLIC_IMG_RE.test(value) ? 'image' : 'link'
      const id = `${kind}:${value}`
      if (!seen.has(id)) {
        seen.add(id)
        out.push({ id, kind, value, sourcePath })
      }
      continue
    }
    if (/^[a-zA-Z_$][\w$]*$/.test(value)) continue
    if (/^(flex|grid|block|hidden|text-|bg-|border-|w-|h-|p-|m-|gap-)/.test(value))
      continue
    if (value.includes('${')) continue
    const id = `text:${value}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, kind: 'text', value, sourcePath })
  }

  const attrRe = /\b(href|src)\s*=\s*(["'])([^"']+)\2/gi
  while ((m = attrRe.exec(text))) {
    const attr = m[1]!.toLowerCase()
    const value = m[3]!
    const kind = attr === 'src' || PUBLIC_IMG_RE.test(value) ? 'image' : 'link'
    const id = `${kind}:${value}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, kind, value, sourcePath })
  }

  // Short text nodes between tags (JSX / HTML), e.g. <h1>Hello</h1>
  const textNodeRe = />([^<>{\n][^<>{\n]{0,198})</g
  while ((m = textNodeRe.exec(text))) {
    const value = m[1]!.trim()
    if (value.length < 2) continue
    if (/^[{}/\s]*$/.test(value)) continue
    if (/^(flex|grid|block|hidden)/.test(value)) continue
    const id = `text:${value}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, kind: 'text', value, sourcePath })
  }
}

/**
 * Build editable inventory from src TSX/JSX/HTML string literals / hrefs /
 * image paths, plus public/** images (fallback when no HTML preview).
 */
export function buildInventory(
  files: Record<string, Uint8Array>,
): InventoryItem[] {
  const out: InventoryItem[] = []
  const seen = new Set<string>()

  for (const raw of Object.keys(files)) {
    const path = normalizePath(raw)
    if (isSrcSource(path)) {
      try {
        const text = decodeText(files[raw]!)
        if (text.includes('\0')) continue
        extractStringLiterals(text, path, out, seen)
      } catch {
        /* skip */
      }
    }
  }

  for (const raw of Object.keys(files)) {
    const path = normalizePath(raw)
    if (!isPublicImage(path)) continue
    const id = `asset:${path}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      kind: 'image',
      value: path,
      assetPath: path,
      sourcePath: path,
    })
  }

  out.sort((a, b) => {
    const ka = a.kind === 'text' ? 0 : a.kind === 'link' ? 1 : 2
    const kb = b.kind === 'text' ? 0 : b.kind === 'link' ? 1 : 2
    if (ka !== kb) return ka - kb
    return a.value.localeCompare(b.value)
  })

  return out.slice(0, 400)
}

export function mimeForImagePath(path: string): string {
  const ext = basename(path).split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    avif: 'image/avif',
  }
  return map[ext] ?? 'application/octet-stream'
}
