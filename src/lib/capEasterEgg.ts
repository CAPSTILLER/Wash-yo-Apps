/**
 * Optional CAPSTILLER easter egg: one random non-interactive letter shows Cap
 * cutout sticker on press (3× letter height). Default OFF.
 */

import eggUrl from '../assets/cap-easter-egg.png'
import { detectProjectLayout } from './pwaPack'
import {
  basename,
  decodeText,
  encodeText,
  findFileKey,
  joinPath,
  listNormalizedPaths,
  normalizePath,
  pathParts,
} from './zipPaths'

export type CapEasterEggOptions = {
  enabled: boolean
}

export type CapEasterEggApplyResult = {
  assetPath: string | null
  scriptPath: string | null
  htmlPatched: string[]
  tanstackPatched: string | null
  componentPath: string | null
  skippedReason: string | null
}

/** Runtime IIFE — subtle; no console spam. */
export function buildCapEasterEggScript(): string {
  return `/*! Capstiller easter egg */
(function () {
  "use strict";
  var IMG_SRC = "/cap-easter-egg.png";
  var SKIP = "a,button,[role=button],input,textarea,select,label,summary,option";

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  function isSkipped(el) {
    if (!el || el.nodeType !== 1) return true;
    try {
      if (el.closest(SKIP)) return true;
    } catch (e) {}
    var style = window.getComputedStyle(el);
    if (style && style.cursor === "pointer") return true;
    if (typeof el.onclick === "function") return true;
    return false;
  }

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    var style = window.getComputedStyle(el);
    if (!style || style.display === "none" || style.visibility === "hidden")
      return false;
    if (parseFloat(style.opacity || "1") === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function collectLetterTargets(root) {
    var out = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node || !node.nodeValue) return NodeFilter.FILTER_REJECT;
        if (!/\\S/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        var p = node.parentElement;
        if (!p || isSkipped(p) || !visible(p)) return NodeFilter.FILTER_REJECT;
        var tag = (p.tagName || "").toLowerCase();
        if (
          tag === "script" ||
          tag === "style" ||
          tag === "noscript" ||
          tag === "svg" ||
          tag === "code" ||
          tag === "pre"
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var n;
    while ((n = walker.nextNode())) {
      var text = n.nodeValue || "";
      for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        if (/[A-Za-z0-9]/.test(ch)) {
          out.push({ node: n, index: i });
        }
      }
    }
    return out;
  }

  function wrapLetter(target) {
    var node = target.node;
    var index = target.index;
    var text = node.nodeValue || "";
    if (index < 0 || index >= text.length) return null;
    var parent = node.parentNode;
    if (!parent) return null;

    var before = text.slice(0, index);
    var letter = text.charAt(index);
    var after = text.slice(index + 1);

    var span = document.createElement("span");
    span.setAttribute("data-cap-egg", "1");
    span.style.cursor = "inherit";
    span.style.display = "inline";
    span.textContent = letter;

    var frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));
    frag.appendChild(span);
    if (after) frag.appendChild(document.createTextNode(after));
    parent.replaceChild(frag, node);
    return span;
  }

  var sticker = null;

  function hideSticker() {
    if (sticker && sticker.parentNode) sticker.parentNode.removeChild(sticker);
    sticker = null;
  }

  function showSticker(letterEl) {
    hideSticker();
    var r = letterEl.getBoundingClientRect();
    var h = Math.max(12, r.height * 3);
    var img = document.createElement("img");
    img.src = IMG_SRC;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.style.cssText =
      "position:fixed;z-index:2147483647;pointer-events:none;height:" +
      h +
      "px;width:auto;left:" +
      (r.left + r.width / 2) +
      "px;top:" +
      (r.top + r.height / 2) +
      "px;transform:translate(-50%,-50%);user-select:none;-webkit-user-drag:none;";
    document.body.appendChild(img);
    sticker = img;
  }

  function bind(letterEl) {
    var down = function (ev) {
      if (ev && ev.button != null && ev.button !== 0) return;
      showSticker(letterEl);
    };
    letterEl.addEventListener("pointerdown", down);
    letterEl.addEventListener("touchstart", down, { passive: true });
    letterEl.addEventListener("pointerup", hideSticker);
    letterEl.addEventListener("pointercancel", hideSticker);
    letterEl.addEventListener("pointerleave", hideSticker);
    letterEl.addEventListener("touchend", hideSticker);
    letterEl.addEventListener("touchcancel", hideSticker);
    window.addEventListener("blur", hideSticker);
  }

  function start() {
    var targets = collectLetterTargets(document.body || document.documentElement);
    if (!targets.length) return;
    var pick = targets[Math.floor(Math.random() * targets.length)];
    var span = wrapLetter(pick);
    if (span) bind(span);
  }

  ready(function () {
    // Slight delay so SPA text has painted
    setTimeout(start, 400);
  });
})();
`
}

const CAP_EGG_COMPONENT = `/** CAPSTILLER easter egg — Capstiller Zip Ship. */
import { useEffect } from 'react'

const SCRIPT_SRC = '/cap-easter-egg.js'

/** Ensures cap-easter-egg.js loads once (SPA / TanStack root). */
export function CapEasterEgg() {
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (document.querySelector(\`script[src="\${SCRIPT_SRC}"]\`)) return
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.defer = true
    document.body.appendChild(s)
  }, [])
  return null
}

export default CapEasterEgg
`

function injectScriptIntoHtml(
  html: string,
  src: string,
): { html: string; changed: boolean } {
  if (/cap-easter-egg\.js/.test(html)) {
    return { html, changed: false }
  }
  const tag = `<script src="${src}" defer></script>`
  if (/<\/body>/i.test(html)) {
    return {
      html: html.replace(/<\/body>/i, `  ${tag}\n</body>`),
      changed: true,
    }
  }
  if (/<\/head>/i.test(html)) {
    return {
      html: html.replace(/<\/head>/i, `  ${tag}\n</head>`),
      changed: true,
    }
  }
  return { html: `${html}\n${tag}\n`, changed: true }
}

function dirnameOf(p: string): string {
  const parts = pathParts(p)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}

function relativeImport(fromFile: string, toFile: string): string {
  const fromParts = pathParts(dirnameOf(fromFile))
  const toParts = pathParts(toFile.replace(/\.(tsx|jsx|ts|js)$/, ''))
  let i = 0
  while (
    i < fromParts.length &&
    i < toParts.length &&
    fromParts[i] === toParts[i]
  ) {
    i++
  }
  const ups = fromParts.length - i
  const down = toParts.slice(i)
  const rel = (ups === 0 ? './' : '../'.repeat(ups)) + down.join('/')
  return rel.startsWith('.') ? rel : `./${rel}`
}

function findTanstackRoot(
  files: Record<string, Uint8Array>,
  projectRoot: string,
): string | null {
  const candidates = [
    joinPath(projectRoot, 'src/routes/__root.tsx'),
    joinPath(projectRoot, 'src/routes/__root.jsx'),
    joinPath(projectRoot, 'app/routes/__root.tsx'),
    joinPath(projectRoot, 'app/routes/__root.jsx'),
  ]
  for (const c of candidates) {
    if (findFileKey(files, c)) return c
  }
  for (const raw of listNormalizedPaths(files)) {
    const n = normalizePath(raw)
    const parts = pathParts(n)
    if (parts.includes('node_modules')) continue
    if (
      (basename(n) === '__root.tsx' || basename(n) === '__root.jsx') &&
      parts.includes('routes')
    ) {
      return n
    }
  }
  return null
}

function patchTanstackRootSafe(
  source: string,
  componentImportPath: string,
): { text: string; changed: boolean } {
  if (/CapEasterEgg/.test(source) || /cap-easter-egg\.js/.test(source)) {
    return { text: source, changed: false }
  }

  let out = source
  const importLine = `import { CapEasterEgg } from '${componentImportPath}'`

  const singleLine = [
    ...out.matchAll(/^import\s.+from\s+['\"][^'\"]+['\"];?\s*$/gm),
  ]
  const last = singleLine[singleLine.length - 1]
  if (last && last.index != null) {
    const end = last.index + last[0].length
    out = `${out.slice(0, end)}\n${importLine}${out.slice(end)}`
  } else {
    out = `${importLine}\n${out}`
  }

  if (/<Outlet\b/.test(out)) {
    out = out.replace(/<Outlet\b/, '<CapEasterEgg />\n      <Outlet')
  } else if (/<>/.test(out)) {
    out = out.replace(/<>/, '<>\n      <CapEasterEgg />')
  } else if (/<GateLock\s*\/>/.test(out)) {
    out = out.replace(/<GateLock\s*\/>/, '<GateLock />\n      <CapEasterEgg />')
  } else if (/<Head\b/.test(out)) {
    out = out.replace(/<\/Head>/, '</Head>\n      <CapEasterEgg />')
  } else {
    return { text: source, changed: false }
  }

  return { text: out, changed: out !== source }
}

function collectHtmlTargets(
  files: Record<string, Uint8Array>,
  projectRoot: string,
): string[] {
  const layout = detectProjectLayout(files)
  const out = new Set<string>(layout.indexHtmlPaths)
  for (const e of [
    joinPath(projectRoot, 'index.html'),
    joinPath(projectRoot, 'dist/index.html'),
    joinPath(projectRoot, 'public/index.html'),
  ]) {
    if (findFileKey(files, e)) out.add(normalizePath(e))
  }
  return [...out].sort(
    (a, b) => pathParts(a).length - pathParts(b).length || a.localeCompare(b),
  )
}

async function loadEggPngBytes(): Promise<Uint8Array> {
  const res = await fetch(eggUrl)
  if (!res.ok) throw new Error(`Failed to load cap-easter-egg.png (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * Inject CAPSTILLER easter egg assets + script into kept zip files.
 */
export async function applyCapEasterEgg(
  kept: Record<string, Uint8Array>,
  opts: CapEasterEggOptions,
): Promise<CapEasterEggApplyResult> {
  const layout = detectProjectLayout(kept)

  if (!opts.enabled) {
    return {
      assetPath: null,
      scriptPath: null,
      htmlPatched: [],
      tanstackPatched: null,
      componentPath: null,
      skippedReason: 'CAPSTILLER Easter egg off',
    }
  }

  let png: Uint8Array
  try {
    png = await loadEggPngBytes()
  } catch (e) {
    return {
      assetPath: null,
      scriptPath: null,
      htmlPatched: [],
      tanstackPatched: null,
      componentPath: null,
      skippedReason:
        e instanceof Error ? e.message : 'Could not load easter egg asset',
    }
  }

  const assetPath = joinPath(layout.assetDir, 'cap-easter-egg.png')
  const scriptPath = joinPath(layout.assetDir, 'cap-easter-egg.js')
  kept[assetPath] = png
  kept[scriptPath] = encodeText(buildCapEasterEggScript())

  const htmlPatched: string[] = []
  for (const htmlPath of collectHtmlTargets(kept, layout.projectRoot)) {
    const key = findFileKey(kept, htmlPath)
    if (!key || !kept[key]) continue
    const { html, changed } = injectScriptIntoHtml(
      decodeText(kept[key]!),
      '/cap-easter-egg.js',
    )
    if (changed) {
      kept[key] = encodeText(html)
      htmlPatched.push(htmlPath)
    }
  }

  let tanstackPatched: string | null = null
  let componentPath: string | null = null
  const rootPath = findTanstackRoot(kept, layout.projectRoot)
  if (rootPath) {
    const writePath = joinPath(
      layout.projectRoot,
      'src/components/CapEasterEgg.tsx',
    )
    kept[writePath] = encodeText(CAP_EGG_COMPONENT)
    componentPath = writePath
    const importPath = relativeImport(rootPath, writePath)
    const key = findFileKey(kept, rootPath)
    if (key && kept[key]) {
      const patched = patchTanstackRootSafe(decodeText(kept[key]!), importPath)
      if (patched.changed) {
        kept[key] = encodeText(patched.text)
        tanstackPatched = rootPath
      } else {
        tanstackPatched = `${rootPath} (CapEasterEgg.tsx added; root left unchanged — HTML script covers build)`
      }
    }
  }

  return {
    assetPath,
    scriptPath,
    htmlPatched,
    tanstackPatched,
    componentPath,
    skippedReason: null,
  }
}
