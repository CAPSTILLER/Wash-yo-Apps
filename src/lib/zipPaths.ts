/** Zip path helpers (forward slashes, no leading ./). */

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

export function pathParts(p: string): string[] {
  return normalizePath(p).split('/').filter(Boolean)
}

export function basename(p: string): string {
  const parts = pathParts(p)
  return parts[parts.length - 1] ?? ''
}

export function dirname(p: string): string {
  const parts = pathParts(p)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}

export function joinPath(...parts: string[]): string {
  return parts
    .filter((s) => s !== '')
    .join('/')
    .replace(/\/{2,}/g, '/')
}

export function isUnderNodeModules(p: string): boolean {
  return pathParts(p).includes('node_modules')
}

export function findRootMostFile(
  paths: string[],
  predicate: (p: string) => boolean,
): string | null {
  const matches = paths.map(normalizePath).filter((p) => {
    if (isUnderNodeModules(p)) return false
    return predicate(p)
  })
  if (matches.length === 0) return null
  matches.sort((a, b) => {
    const da = pathParts(a).length
    const db = pathParts(b).length
    if (da !== db) return da - db
    return a.localeCompare(b)
  })
  return matches[0] ?? null
}

/** Prefer shallowest package.json; skip anything under node_modules. */
export function findRootMostPackageJson(paths: string[]): string | null {
  return findRootMostFile(paths, (p) => basename(p) === 'package.json')
}

export function findRootMostIndexHtml(paths: string[]): string | null {
  return findRootMostFile(
    paths,
    (p) => basename(p).toLowerCase() === 'index.html',
  )
}

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

export function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** Resolve a normalized path back to a key in the files map. */
export function findFileKey(
  files: Record<string, Uint8Array>,
  normalized: string,
): string | null {
  const want = normalizePath(normalized)
  for (const raw of Object.keys(files)) {
    if (normalizePath(raw) === want) return raw
  }
  return null
}

export function listNormalizedPaths(files: Record<string, Uint8Array>): string[] {
  return Object.keys(files).map(normalizePath)
}

export function hasDirPrefix(
  paths: string[],
  dir: string,
): boolean {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`
  const bare = dir.endsWith('/') ? dir.slice(0, -1) : dir
  return paths.some((p) => {
    const n = normalizePath(p)
    return n === bare || n.startsWith(prefix)
  })
}
