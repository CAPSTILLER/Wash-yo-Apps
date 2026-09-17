import {
  basename,
  decodeText,
  encodeText,
  findFileKey,
  isUnderNodeModules,
  normalizePath,
  pathParts,
} from './zipPaths'

export type HostStripOpts = {
  /** When true, leave --host / 0.0.0.0 alone. Default OFF. */
  keepHostExpose: boolean
  /** When true, also rewrite vite.config and script files. */
  fixViteScripts: boolean
}

export type HostStripInfo = {
  willApply: boolean
  packageJsonPaths: string[]
  scriptsChanged: string[]
  viteConfigPaths: string[]
  scriptFilePaths: string[]
  summary: string | null
}

export function emptyHostStrip(): HostStripInfo {
  return {
    willApply: false,
    packageJsonPaths: [],
    scriptsChanged: [],
    viteConfigPaths: [],
    scriptFilePaths: [],
    summary: null,
  }
}

const VITE_CONFIG_RE = /^vite\.config\.(ts|mts|js|mjs|cts|cjs)$/i
const SCRIPT_FILE_RE = /\.(mjs|cjs|js|ts|mts|cts|sh|bash)$/i

/**
 * Strip --host / 0.0.0.0 / HOST=0.0.0.0 from an npm script string.
 * Covers: --host, --host addr, --host=addr, HOST=0.0.0.0, `vite 0.0.0.0`.
 */
export function stripHostFromNpmScript(script: string): string {
  let out = script

  // HOST=0.0.0.0 or HOST="0.0.0.0" prefix / infix
  out = out.replace(/(?:^|[\s;&|])HOST\s*=\s*['"]?0\.0\.0\.0['"]?\s*/g, (m) => {
    const lead = m.match(/^[\s;&|]/)
    return lead ? lead[0]! : ''
  })

  // --host=addr | --host addr | --host= (empty)
  out = out.replace(/\s+--host(?:=|\s+)\S+/g, '')
  out = out.replace(/\s+--host\b/g, '')
  // start-of-string flag (unusual)
  out = out.replace(/^--host(?:=|\s+)\S+\s*/g, '')
  out = out.replace(/^--host\b\s*/g, '')

  // positional bind-all after vite / vite preview / vite dev
  out = out.replace(
    /\b(vite(?:\s+(?:preview|dev|build))?)\s+0\.0\.0\.0\b/g,
    '$1',
  )

  // leftover bare 0.0.0.0 token next to vite-ish commands
  out = out.replace(/\s+0\.0\.0\.0\b/g, '')

  out = out.replace(/[ \t]+/g, ' ').replace(/\s+$/gm, '').trim()
  out = out.replace(/\s*&&\s*/g, ' && ')
  out = out.replace(/\s*\|\|\s*/g, ' || ')
  return out
}

export function npmScriptHasHost(script: string): boolean {
  return stripHostFromNpmScript(script) !== script.trim()
}

/**
 * Neutralize host bind-all in vite.config source.
 * Rewrites host: true | '0.0.0.0' | "0.0.0.0" | '::' on server/preview.
 */
export function rewriteViteConfigHost(src: string): string {
  let out = src
  out = out.replace(/\bhost\s*:\s*(['"])0\.0\.0\.0\1/g, "host: 'localhost'")
  out = out.replace(/\bhost\s*:\s*(['"])::\1/g, "host: 'localhost'")
  out = out.replace(/\bhost\s*:\s*(['"])::0\1/g, "host: 'localhost'")
  // host: true  (Vite: listen on all interfaces)
  out = out.replace(/\bhost\s*:\s*true\b/g, "host: 'localhost'")
  // leftover string literals of the bind-all address in this config
  out = out.replace(/(['"])0\.0\.0\.0\1/g, "'localhost'")
  return out
}

/**
 * Patch wrapper / shell / spawn scripts so they no longer inject --host or 0.0.0.0.
 */
export function stripHostFromScriptSource(src: string): string {
  let out = src

  // CLI flags (quoted or not)
  out = out.replace(/\s+--host(?:=|\s+)(?:'[^']*'|"[^"]*"|\S+)/g, '')
  out = out.replace(/\s+--host\b/g, '')
  out = out.replace(/--host(?:=|\s+)(?:'[^']*'|"[^"]*"|\S+)/g, '')
  out = out.replace(/--host\b/g, '')

  // HOST=0.0.0.0
  out = out.replace(/\bHOST\s*=\s*['"]?0\.0\.0\.0['"]?/g, 'HOST=localhost')

  // process.env.HOST = '0.0.0.0'
  out = out.replace(
    /(process\.env\.HOST\s*=\s*)(['"])0\.0\.0\.0\2/g,
    "$1$2localhost$2",
  )

  // env: { HOST: '0.0.0.0' } or HOST: "0.0.0.0"
  out = out.replace(/(\bHOST\s*:\s*)(['"])0\.0\.0\.0\2/g, "$1$2localhost$2")

  // host: '0.0.0.0' / host: true
  out = out.replace(/\bhost\s*:\s*(['"])0\.0\.0\.0\1/g, "host: 'localhost'")
  out = out.replace(/\bhost\s*:\s*true\b/g, "host: 'localhost'")

  // remaining 0.0.0.0 string literals (spawn args, defaults)
  out = out.replace(/(['"])0\.0\.0\.0\1/g, "'localhost'")

  return out
}

export function isViteConfigPath(p: string): boolean {
  if (isUnderNodeModules(p)) return false
  return VITE_CONFIG_RE.test(basename(p))
}

/**
 * Script files we will patch when Fix vite is ON:
 * - any *with-app-env* file
 * - files under scripts/ with js/ts/sh extensions
 * - root-level *.sh (1–2 path segments)
 */
export function isPatchableScriptPath(p: string): boolean {
  const n = normalizePath(p)
  if (isUnderNodeModules(n)) return false
  const name = basename(n)
  const lower = name.toLowerCase()
  if (lower.includes('with-app-env')) return true
  const parts = pathParts(n)
  if (parts.includes('scripts') && SCRIPT_FILE_RE.test(name)) return true
  if (parts.length <= 2 && /\.(sh|bash)$/i.test(name)) return true
  return false
}

type PkgLike = {
  scripts?: Record<string, string>
  [key: string]: unknown
}

export function stripHostFromPackageJsonText(rawText: string): {
  changed: boolean
  jsonText: string
  scriptsChanged: string[]
} {
  let pkg: PkgLike
  try {
    pkg = JSON.parse(rawText) as PkgLike
  } catch {
    return { changed: false, jsonText: rawText, scriptsChanged: [] }
  }
  if (!pkg.scripts || typeof pkg.scripts !== 'object') {
    return { changed: false, jsonText: rawText, scriptsChanged: [] }
  }
  const scriptsChanged: string[] = []
  const next: Record<string, string> = { ...pkg.scripts }
  for (const [name, value] of Object.entries(pkg.scripts)) {
    if (typeof value !== 'string') continue
    const stripped = stripHostFromNpmScript(value)
    if (stripped !== value.trim() || stripped !== value) {
      if (stripped !== value) {
        next[name] = stripped
        scriptsChanged.push(name)
      }
    }
  }
  if (scriptsChanged.length === 0) {
    return { changed: false, jsonText: rawText, scriptsChanged: [] }
  }
  pkg.scripts = next
  return {
    changed: true,
    jsonText: `${JSON.stringify(pkg, null, 2)}\n`,
    scriptsChanged,
  }
}

function bytesFor(
  files: Record<string, Uint8Array>,
  normalized: string,
): { key: string; bytes: Uint8Array } | null {
  const key = findFileKey(files, normalized)
  if (!key) return null
  const bytes = files[key]
  if (!bytes) return null
  return { key, bytes }
}

function collectPackageJsons(files: Record<string, Uint8Array>): string[] {
  const out: string[] = []
  for (const raw of Object.keys(files)) {
    const n = normalizePath(raw)
    if (isUnderNodeModules(n)) continue
    if (basename(n) === 'package.json') out.push(n)
  }
  out.sort((a, b) => pathParts(a).length - pathParts(b).length || a.localeCompare(b))
  return out
}

function summarize(info: Omit<HostStripInfo, 'willApply' | 'summary'>): HostStripInfo {
  const parts: string[] = []
  if (info.scriptsChanged.length > 0) {
    parts.push(
      `package.json scripts: ${info.scriptsChanged.map((s) => `"${s}"`).join(', ')}`,
    )
  }
  if (info.viteConfigPaths.length > 0) {
    parts.push(`vite.config host → localhost: ${info.viteConfigPaths.join(', ')}`)
  }
  if (info.scriptFilePaths.length > 0) {
    parts.push(`script files: ${info.scriptFilePaths.join(', ')}`)
  }
  const willApply = parts.length > 0
  return {
    ...info,
    willApply,
    summary: willApply
      ? `Strip --host / 0.0.0.0 (${parts.join('; ')})`
      : null,
  }
}

/**
 * Inspect files for host-bind leftovers. Does not mutate.
 * package.json scripts always (unless keepHost). vite.config + script files
 * only when fixViteScripts is ON.
 */
export function analyzeHostStrip(
  files: Record<string, Uint8Array>,
  opts: HostStripOpts,
): HostStripInfo {
  if (opts.keepHostExpose) return emptyHostStrip()

  const packageJsonPaths: string[] = []
  const scriptsChanged: string[] = []
  const viteConfigPaths: string[] = []
  const scriptFilePaths: string[] = []

  for (const pkgPath of collectPackageJsons(files)) {
    const hit = bytesFor(files, pkgPath)
    if (!hit) continue
    const result = stripHostFromPackageJsonText(decodeText(hit.bytes))
    if (result.changed) {
      packageJsonPaths.push(pkgPath)
      for (const s of result.scriptsChanged) {
        if (!scriptsChanged.includes(s)) scriptsChanged.push(s)
      }
    }
  }

  if (opts.fixViteScripts) {
    for (const raw of Object.keys(files)) {
      const n = normalizePath(raw)
      if (isViteConfigPath(n)) {
        const next = rewriteViteConfigHost(decodeText(files[raw]!))
        if (next !== decodeText(files[raw]!)) {
          viteConfigPaths.push(n)
        }
      } else if (isPatchableScriptPath(n)) {
        const src = decodeText(files[raw]!)
        if (stripHostFromScriptSource(src) !== src) {
          scriptFilePaths.push(n)
        }
      }
    }
    viteConfigPaths.sort()
    scriptFilePaths.sort()
  }

  return summarize({
    packageJsonPaths,
    scriptsChanged,
    viteConfigPaths,
    scriptFilePaths,
  })
}

/** Apply host neutralization into a mutable kept-files map. */
export function applyHostStripToFiles(
  kept: Record<string, Uint8Array>,
  opts: HostStripOpts,
): HostStripInfo {
  if (opts.keepHostExpose) return emptyHostStrip()

  const packageJsonPaths: string[] = []
  const scriptsChanged: string[] = []
  const viteConfigPaths: string[] = []
  const scriptFilePaths: string[] = []

  for (const pkgPath of collectPackageJsons(kept)) {
    const hit = bytesFor(kept, pkgPath)
    if (!hit) continue
    const result = stripHostFromPackageJsonText(decodeText(hit.bytes))
    if (result.changed) {
      kept[hit.key] = encodeText(result.jsonText)
      packageJsonPaths.push(pkgPath)
      for (const s of result.scriptsChanged) {
        if (!scriptsChanged.includes(s)) scriptsChanged.push(s)
      }
    }
  }

  if (opts.fixViteScripts) {
    for (const raw of Object.keys(kept)) {
      const n = normalizePath(raw)
      if (isViteConfigPath(n)) {
        const src = decodeText(kept[raw]!)
        const next = rewriteViteConfigHost(src)
        if (next !== src) {
          kept[raw] = encodeText(next)
          viteConfigPaths.push(n)
        }
      } else if (isPatchableScriptPath(n)) {
        const src = decodeText(kept[raw]!)
        const next = stripHostFromScriptSource(src)
        if (next !== src) {
          kept[raw] = encodeText(next)
          scriptFilePaths.push(n)
        }
      }
    }
    viteConfigPaths.sort()
    scriptFilePaths.sort()
  }

  return summarize({
    packageJsonPaths,
    scriptsChanged,
    viteConfigPaths,
    scriptFilePaths,
  })
}
