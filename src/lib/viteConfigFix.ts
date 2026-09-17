/**
 * Capstiller / Vercel fix for vite.config.* that statically import ./scripts/*.mjs.
 *
 * Vercel/rolldown often fails with UNRESOLVED_IMPORT on those static imports.
 * Pattern we applied manually on southern-cap:
 *  1. Inline trivial helpers (isMigrationFile → path.endsWith(".sql"))
 *  2. Convert remaining ./scripts/* plugin imports to dynamic
 *     `await import(...)` inside `defineConfig(async (...) => { ... return { ... } })`
 *  3. If defineConfig shape is too weird, do not corrupt — flag needsManualFix.
 */

export type ScriptStaticImport = {
  statement: string
  start: number
  end: number
  source: string
  locals: string[]
  imported: string[]
  kind: 'named' | 'default' | 'namespace'
  typeOnly: boolean
}

export type ViteConfigFixResult = {
  changed: boolean
  text: string
  dynamicImports: string[]
  inlined: string[]
  needsManualFix: boolean
  manualReason: string | null
  summary: string | null
}

const TRIVIAL_INLINES: Record<string, string> = {
  isMigrationFile: `/** Inline — Vercel/rolldown often fails static ./scripts/*.mjs imports from vite.config.ts */
function isMigrationFile(path: string): boolean {
  return path.endsWith(".sql");
}
`,
}

/** Sandbox leftover scripts that Zip Ship strips under the grok toggle — drop, do not dynamic-import. */
export function isDroppableGrokScriptImport(source: string): boolean {
  const s = source.replace(/\\/g, '/')
  const base = s.split('/').pop() ?? s
  return /grok-pwa/i.test(base) || /with-app-env/i.test(base)
}

/** Remove plugin() / identifier() call sites left after dropping a sandbox import. */
export function stripDroppedPluginCalls(src: string, locals: string[]): string {
  let next = src
  for (const local of locals) {
    if (!/^[A-Za-z_$][\w$]*$/.test(local)) continue
    const callRe = new RegExp(`\\b${local}\\s*\\([^)]*\\)\\s*,?`, 'g')
    next = next.replace(callRe, '')
    const bareRe = new RegExp(
      `(^|[\\[,\\s])${local}(?=[\\],\\s])\\s*,?`,
      'g',
    )
    next = next.replace(bareRe, '')
  }
  next = next.replace(/,(\s*),+/g, ',$1')
  next = next.replace(/\[\s*,/g, '[')
  next = next.replace(/,\s*\]/g, ']')
  return next
}


/**
 * Match a single-line `import … from "./scripts/…"`.
 * Does NOT use [\s\S] across lines — that wrongly swallowed earlier imports
 * (e.g. `import { defineConfig } from "vite"`) until the scripts from-clause.
 */
const SCRIPT_IMPORT_LINE_RE =
  /^[ \t]*import\s+(type\s+)?(\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*(?:\s*,\s*\{[^}]*\})?)\s+from\s+(['"])(\.\/scripts\/[^'"]+)\3\s*;?[ \t]*$/

export function findScriptStaticImports(src: string): ScriptStaticImport[] {
  const out: ScriptStaticImport[] = []
  const lines = src.split(/(?<=\n)/)
  let offset = 0
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!
    const trimmedLine = line.replace(/\n$/, '')
    const m = SCRIPT_IMPORT_LINE_RE.exec(trimmedLine)
    if (!m) {
      offset += line.length
      continue
    }
    const typeOnly = Boolean(m[1])
    const clause = (m[2] ?? '').trim()
    const source = m[4] ?? ''
    let start = offset
    let statement = trimmedLine
    // Include one preceding // comment line (e.g. @ts-expect-error)
    if (li > 0) {
      const prev = lines[li - 1]!.replace(/\n$/, '')
      if (/^[ \t]*\/\//.test(prev)) {
        start = offset - lines[li - 1]!.length
        statement = prev + '\n' + trimmedLine
      }
    }
    // end includes trailing newline of this line if present
    const end = offset + line.length
    const locals: string[] = []
    const imported: string[] = []
    let kind: ScriptStaticImport['kind'] = 'named'

    if (clause.startsWith('*')) {
      kind = 'namespace'
      const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)
      if (ns?.[1]) {
        locals.push(ns[1])
        imported.push('*')
      }
    } else if (clause.startsWith('{')) {
      kind = 'named'
      const inner = clause.replace(/^\{|\}$/g, '')
      for (const part of inner.split(',')) {
        const p = part.trim()
        if (!p) continue
        const asMatch = p.match(
          /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/,
        )
        if (asMatch) {
          imported.push(asMatch[1]!)
          locals.push(asMatch[2]!)
        } else {
          const name = p.match(/^([A-Za-z_$][\w$]*)$/)
          if (name) {
            imported.push(name[1]!)
            locals.push(name[1]!)
          }
        }
      }
    } else {
      kind = 'default'
      // default import, optional `* as` already handled; also `foo, { bar }`
      const def = clause.match(/^([A-Za-z_$][\w$]*)/)
      if (def?.[1]) {
        locals.push(def[1])
        imported.push('default')
      }
      const named = clause.match(/\{([^}]*)\}/)
      if (named) {
        kind = 'named'
        // rare hybrid — treat named parts too
        for (const part of named[1]!.split(',')) {
          const p = part.trim()
          if (!p) continue
          const asMatch = p.match(
            /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/,
          )
          if (asMatch) {
            imported.push(asMatch[1]!)
            locals.push(asMatch[2]!)
          } else {
            const name = p.match(/^([A-Za-z_$][\w$]*)$/)
            if (name) {
              imported.push(name[1]!)
              locals.push(name[1]!)
            }
          }
        }
      }
    }

    out.push({
      statement,
      start,
      end,
      source,
      locals,
      imported,
      kind,
      typeOnly,
    })
    offset += line.length
  }
  return out
}

function isTrivial(local: string): boolean {
  return Object.prototype.hasOwnProperty.call(TRIVIAL_INLINES, local)
}

export function findMatchingBrace(src: string, openIdx: number): number {
  if (src[openIdx] !== '{') return -1
  let depth = 0
  let i = openIdx
  let mode: 'code' | 'sq' | 'dq' | 'ti' | 'lc' | 'bc' = 'code'
  while (i < src.length) {
    const c = src[i]!
    const n = src[i + 1]
    if (mode === 'code') {
      if (c === '/' && n === '/') {
        mode = 'lc'
        i += 2
        continue
      }
      if (c === '/' && n === '*') {
        mode = 'bc'
        i += 2
        continue
      }
      if (c === "'") {
        mode = 'sq'
        i++
        continue
      }
      if (c === '"') {
        mode = 'dq'
        i++
        continue
      }
      if (c === '`') {
        mode = 'ti'
        i++
        continue
      }
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) return i
      }
      i++
      continue
    }
    if (mode === 'lc') {
      if (c === '\n') mode = 'code'
      i++
      continue
    }
    if (mode === 'bc') {
      if (c === '*' && n === '/') {
        mode = 'code'
        i += 2
        continue
      }
      i++
      continue
    }
    if (mode === 'sq' || mode === 'dq') {
      if (c === '\\') {
        i += 2
        continue
      }
      if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"')) mode = 'code'
      i++
      continue
    }
    if (mode === 'ti') {
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === '`') {
        mode = 'code'
        i++
        continue
      }
      if (c === '$' && n === '{') {
        let d = 1
        i += 2
        while (i < src.length && d > 0) {
          if (src[i] === '{') d++
          else if (src[i] === '}') d--
          i++
        }
        continue
      }
      i++
    }
  }
  return -1
}

function dynamicImportLines(imps: ScriptStaticImport[]): string {
  const lines: string[] = []
  for (const imp of imps) {
    if (imp.typeOnly) continue
    if (imp.kind === 'named') {
      lines.push(
        `  const { ${imp.locals.join(', ')} } = await import("${imp.source}");`,
      )
    } else if (imp.kind === 'default') {
      const local = imp.locals[0] ?? 'mod'
      lines.push(
        `  const ${local} = (await import("${imp.source}")).default;`,
      )
    } else {
      const local = imp.locals[0] ?? 'mod'
      lines.push(`  const ${local} = await import("${imp.source}");`)
    }
  }
  return lines.join('\n')
}

function insertAfterImports(src: string, snippet: string): string {
  if (!snippet.trim()) return src
  const lines = src.split(/(?<=\n)/)
  let i = 0
  let insertAt = 0
  while (i < lines.length) {
    const t = lines[i]!.trim()
    if (
      t === '' ||
      t.startsWith('//') ||
      t.startsWith('/*') ||
      t.startsWith('*') ||
      t.startsWith('import ') ||
      t.startsWith('import{') ||
      t.startsWith('import type')
    ) {
      if (
        (t.startsWith('import ') || t.startsWith('import{')) &&
        !/\bfrom\b/.test(t) &&
        !t.includes(';')
      ) {
        i++
        while (i < lines.length && !/\bfrom\b/.test(lines[i]!)) i++
        if (i < lines.length) i++
        insertAt = i
        continue
      }
      i++
      insertAt = i
      continue
    }
    break
  }
  const before = lines.slice(0, insertAt).join('')
  const after = lines.slice(insertAt).join('')
  const pad = before.endsWith('\n') || before === '' ? '' : '\n'
  const snip = snippet.endsWith('\n') ? snippet : `${snippet}\n`
  return `${before}${pad}${snip}${after}`
}

function removeImportStatements(
  src: string,
  imps: ScriptStaticImport[],
): string {
  let next = src
  const sorted = [...imps].sort((a, b) => b.start - a.start)
  for (const imp of sorted) {
    next = next.slice(0, imp.start) + next.slice(imp.end)
  }
  return next
}

type Shape =
  | { kind: 'object'; matchStart: number; matchEnd: number; objectOpen: number }
  | {
      kind: 'arrow-paren'
      matchStart: number
      matchEnd: number
      params: string
      objectOpen: number
      alreadyAsync: boolean
    }
  | {
      kind: 'arrow-block'
      matchStart: number
      matchEnd: number
      params: string
      blockOpen: number
      alreadyAsync: boolean
    }

/**
 * Locate `export default defineConfig(...)` and classify its argument.
 * matchStart/matchEnd cover from `export default` through `defineConfig(`.
 */
function detectShape(src: string): Shape | { kind: 'unknown'; reason: string } {
  const headRe = /export\s+default\s+defineConfig\s*\(/
  const m = headRe.exec(src)
  if (!m) return { kind: 'unknown', reason: 'no export default defineConfig() found' }

  const matchStart = m.index
  const matchEnd = m.index + m[0].length // index right after `defineConfig(`
  let i = matchEnd
  while (i < src.length && /\s/.test(src[i]!)) i++

  // defineConfig({
  if (src[i] === '{') {
    return { kind: 'object', matchStart, matchEnd, objectOpen: i }
  }

  // defineConfig(async? (params) => …
  let alreadyAsync = false
  if (src.slice(i, i + 5) === 'async' && /\s|\(/.test(src[i + 5] ?? '')) {
    alreadyAsync = true
    i += 5
    while (i < src.length && /\s/.test(src[i]!)) i++
  }

  if (src[i] !== '(') {
    return {
      kind: 'unknown',
      reason: 'defineConfig argument is not an object or arrow function',
    }
  }

  // parse params paren
  const paramsOpen = i
  let depth = 0
  let j = paramsOpen
  for (; j < src.length; j++) {
    const c = src[j]!
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) {
        j++
        break
      }
    }
  }
  if (depth !== 0) {
    return { kind: 'unknown', reason: 'unbalanced params in defineConfig callback' }
  }
  const params = src.slice(paramsOpen + 1, j - 1).trim()
  i = j
  while (i < src.length && /\s/.test(src[i]!)) i++
  if (src.slice(i, i + 2) !== '=>') {
    return { kind: 'unknown', reason: 'expected => after defineConfig params' }
  }
  i += 2
  while (i < src.length && /\s/.test(src[i]!)) i++

  // => ({
  if (src[i] === '(') {
    i++
    while (i < src.length && /\s/.test(src[i]!)) i++
    if (src[i] !== '{') {
      return {
        kind: 'unknown',
        reason: 'defineConfig arrow returns a non-object expression',
      }
    }
    return {
      kind: 'arrow-paren',
      matchStart,
      matchEnd,
      params,
      objectOpen: i,
      alreadyAsync,
    }
  }

  // => {
  if (src[i] === '{') {
    return {
      kind: 'arrow-block',
      matchStart,
      matchEnd,
      params,
      blockOpen: i,
      alreadyAsync,
    }
  }

  return {
    kind: 'unknown',
    reason: 'defineConfig arrow body is not { or ({',
  }
}

function skipWs(src: string, i: number): number {
  while (i < src.length && /\s/.test(src[i]!)) i++
  return i
}

function applyDynamicWrap(
  src: string,
  shape: Shape,
  dynBlock: string,
): string {
  const paramsExpr = shape.kind === 'object' ? '()' : `(${shape.params})`

  if (shape.kind === 'object') {
    const close = findMatchingBrace(src, shape.objectOpen)
    if (close < 0) throw new Error('could not match config object braces')
    let after = skipWs(src, close + 1)
    if (src[after] !== ')') throw new Error('expected ) after config object')
    const afterCloseParen = after + 1

    // export default defineConfig(  + async () => {\n dyn \n return { OBJ };\n })
    const prefix = src.slice(0, shape.matchEnd)
    const objBody = src.slice(shape.objectOpen + 1, close)
    const suffix = src.slice(afterCloseParen)
    return (
      `${prefix}async () => {\n` +
      `${dynBlock}` +
      `  return {${objBody}\n  };\n` +
      `})${suffix}`
    )
  }

  if (shape.kind === 'arrow-paren') {
    const close = findMatchingBrace(src, shape.objectOpen)
    if (close < 0) throw new Error('could not match returned object braces')
    // after object: ) )
    let i = skipWs(src, close + 1)
    if (src[i] !== ')') throw new Error('expected ) closing arrow paren return')
    i = skipWs(src, i + 1)
    if (src[i] !== ')') throw new Error('expected ) closing defineConfig')
    const afterCloseParen = i + 1

    const prefix = src.slice(0, shape.matchEnd)
    const objBody = src.slice(shape.objectOpen + 1, close)
    const suffix = src.slice(afterCloseParen)
    return (
      `${prefix}async ${paramsExpr} => {\n` +
      `${dynBlock}` +
      `  return {${objBody}\n  };\n` +
      `})${suffix}`
    )
  }

  // arrow-block
  let next = src
  if (!shape.alreadyAsync) {
    // Insert `async ` right after `defineConfig(`
    next =
      next.slice(0, shape.matchEnd) + 'async ' + next.slice(shape.matchEnd)
  }

  // Re-detect to get updated blockOpen
  const again = detectShape(next)
  if (again.kind !== 'arrow-block') {
    throw new Error('expected arrow-block after async insert')
  }
  let insertAt = again.blockOpen + 1
  if (next[insertAt] === '\r') insertAt++
  if (next[insertAt] === '\n') insertAt++
  next = next.slice(0, insertAt) + dynBlock + next.slice(insertAt)
  return next
}

/**
 * Rewrite vite.config source for Vercel-safe ./scripts imports.
 */
export function rewriteViteConfigForVercel(src: string): ViteConfigFixResult {
  const imports = findScriptStaticImports(src)
  const valueImports = imports.filter((i) => !i.typeOnly)

  if (valueImports.length === 0) {
    return {
      changed: false,
      text: src,
      dynamicImports: [],
      inlined: [],
      needsManualFix: false,
      manualReason: null,
      summary: null,
    }
  }

  const toRemove: ScriptStaticImport[] = []
  const needDynamic: ScriptStaticImport[] = []
  const inlined: string[] = []
  const inlineSnippets: string[] = []

  const droppedLocals: string[] = []

  for (const imp of valueImports) {
    // Drop grok-pwa / with-app-env leftovers entirely (files are stripped by grok toggle)
    if (isDroppableGrokScriptImport(imp.source)) {
      toRemove.push(imp)
      for (const loc of imp.locals) {
        if (!droppedLocals.includes(loc)) droppedLocals.push(loc)
      }
      continue
    }

    if (imp.kind === 'named' && imp.locals.length > 0) {
      const trivialLocals = imp.locals.filter((l) => isTrivial(l))
      const nonTrivial = imp.locals.filter((l) => !isTrivial(l))

      for (const name of trivialLocals) {
        if (!inlined.includes(name)) {
          inlined.push(name)
          inlineSnippets.push(TRIVIAL_INLINES[name]!)
        }
      }

      toRemove.push(imp)
      if (nonTrivial.length > 0) {
        needDynamic.push({
          ...imp,
          locals: nonTrivial,
          imported: imp.imported.filter((_, idx) =>
            nonTrivial.includes(imp.locals[idx]!),
          ),
        })
      }
    } else {
      toRemove.push(imp)
      needDynamic.push(imp)
    }
  }

  // Only inlines / drops — no defineConfig surgery needed
  if (needDynamic.length === 0) {
    let next = removeImportStatements(src, toRemove)
    next = insertAfterImports(next, inlineSnippets.join('\n'))
    if (droppedLocals.length > 0) {
      next = stripDroppedPluginCalls(next, droppedLocals)
    }
    const bits: string[] = []
    if (inlined.length) bits.push(`inlined ${inlined.join(', ')}`)
    if (droppedLocals.length) {
      bits.push(`dropped sandbox plugins ${droppedLocals.join(', ')}`)
    }
    return {
      changed: next !== src,
      text: next,
      dynamicImports: [],
      inlined,
      needsManualFix: false,
      manualReason: null,
      summary: bits.join('; ') || null,
    }
  }

  const shape = detectShape(src)
  if (shape.kind === 'unknown') {
    return {
      changed: false,
      text: src,
      dynamicImports: [],
      inlined: [],
      needsManualFix: true,
      manualReason: shape.reason,
      summary: null,
    }
  }

  let next = removeImportStatements(src, toRemove)
  if (inlineSnippets.length > 0) {
    next = insertAfterImports(next, inlineSnippets.join('\n'))
  }

  const shape2 = detectShape(next)
  if (shape2.kind === 'unknown') {
    return {
      changed: false,
      text: src,
      dynamicImports: [],
      inlined: [],
      needsManualFix: true,
      manualReason: `after import removal: ${shape2.reason}`,
      summary: null,
    }
  }

  const dyn = dynamicImportLines(needDynamic)
  const dynBlock = dyn ? `${dyn}\n` : ''

  try {
    next = applyDynamicWrap(next, shape2, dynBlock)
  } catch (e) {
    return {
      changed: false,
      text: src,
      dynamicImports: [],
      inlined: [],
      needsManualFix: true,
      manualReason: e instanceof Error ? e.message : 'rewrite failed',
      summary: null,
    }
  }

  if (droppedLocals.length > 0) {
    next = stripDroppedPluginCalls(next, droppedLocals)
  }

  const dynSources = [...new Set(needDynamic.map((i) => i.source))]
  const parts: string[] = []
  if (inlined.length) parts.push(`inlined ${inlined.join(', ')}`)
  if (dynSources.length) parts.push(`dynamic import ${dynSources.join(', ')}`)
  if (droppedLocals.length) {
    parts.push(`dropped sandbox plugins ${droppedLocals.join(', ')}`)
  }

  return {
    changed: true,
    text: next,
    dynamicImports: dynSources,
    inlined,
    needsManualFix: false,
    manualReason: null,
    summary: parts.join('; '),
  }
}

export function isViteConfigFileName(name: string): boolean {
  return /^vite\.config\.(ts|mts|js|mjs|cts|cjs)$/i.test(name)
}

/**
 * Simplify package.json scripts.build when it chains db:migrate / with-app-env
 * or otherwise looks like `vite build && …` (unsafe / pointless on Vercel).
 */
export function simplifyBuildScriptForVercel(script: string): string | null {
  const s = script.trim()
  if (!s) return null
  const unsafe =
    /\bdb:migrate\b/.test(s) ||
    /with-app-env/.test(s) ||
    /\bvite\s+build\s*&&/.test(s)
  if (!unsafe) return null
  if (/\bvite\s+build\b/.test(s) || /\bvite\b/.test(s)) {
    return s === 'vite build' ? null : 'vite build'
  }
  return null
}
