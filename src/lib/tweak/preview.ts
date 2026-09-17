import {
  basename,
  decodeText,
  dirname,
  findFileKey,
  isUnderNodeModules,
  joinPath,
  normalizePath,
} from '../zipPaths'
import type { PreviewBuildResult, PreviewSelection } from './types'

const PREVIEW_MSG_TYPE = 'zip-ship-tweak-select'

export const TWEAK_PREVIEW_MESSAGE_TYPE = PREVIEW_MSG_TYPE

/** Prefer dist/index.html, else root index.html, else public/index.html. */
export function findPreviewHtmlPath(
  files: Record<string, Uint8Array>,
): string | null {
  const paths = Object.keys(files)
    .map(normalizePath)
    .filter((p) => !isUnderNodeModules(p) && !p.endsWith('/'))

  const prefer = (pred: (p: string) => boolean): string | null => {
    const hits = paths.filter(pred).sort((a, b) => {
      const da = a.split('/').length
      const db = b.split('/').length
      if (da !== db) return da - db
      return a.localeCompare(b)
    })
    return hits[0] ?? null
  }

  return (
    prefer(
      (p) =>
        basename(p).toLowerCase() === 'index.html' &&
        (p === 'dist/index.html' || p.startsWith('dist/')),
    ) ||
    prefer(
      (p) =>
        basename(p).toLowerCase() === 'index.html' &&
        !p.includes('/') /* root */,
    ) ||
    prefer(
      (p) =>
        basename(p).toLowerCase() === 'index.html' &&
        (p === 'public/index.html' || p.startsWith('public/')),
    ) ||
    prefer((p) => basename(p).toLowerCase() === 'index.html')
  )
}

function mimeForPath(path: string): string {
  const ext = basename(path).split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    mjs: 'text/javascript',
    json: 'application/json',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    ico: 'image/x-icon',
    avif: 'image/avif',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    webm: 'video/webm',
    webmanifest: 'application/manifest+json',
  }
  return map[ext] ?? 'application/octet-stream'
}

function blobUrlFor(
  files: Record<string, Uint8Array>,
  path: string,
  blobUrls: string[],
): string | null {
  const key = findFileKey(files, path)
  if (!key) return null
  const bytes = files[key]!
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const url = URL.createObjectURL(
    new Blob([copy.buffer], { type: mimeForPath(path) }),
  )
  blobUrls.push(url)
  return url
}

/** Resolve a relative/absolute URL against an HTML base path inside the zip. */
function resolveZipPath(htmlPath: string, ref: string): string | null {
  if (!ref || /^(https?:|data:|blob:|mailto:|tel:|#|javascript:)/i.test(ref)) {
    return null
  }
  let clean = ref.split('?')[0]!.split('#')[0]!
  if (!clean) return null
  if (clean.startsWith('./')) clean = clean.slice(2)

  const htmlDir = dirname(htmlPath)

  if (clean.startsWith('/')) {
    const abs = clean.slice(1)
    // When HTML lives under dist/, absolute /assets/... maps to dist/assets/...
    if (htmlPath.startsWith('dist/')) {
      return joinPath('dist', abs)
    }
    if (htmlPath.startsWith('public/')) {
      return joinPath('public', abs)
    }
    return abs
  }

  // Relative to HTML directory
  const parts = [...htmlDir.split('/').filter(Boolean), ...clean.split('/')]
  const stack: string[] = []
  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

const ATTR_URL_RE =
  /(\b(?:src|href|poster|data)\s*=\s*)(["'])([^"']+)\2/gi
const CSS_URL_RE = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi

function rewriteHtmlAssets(
  html: string,
  htmlPath: string,
  files: Record<string, Uint8Array>,
  blobUrls: string[],
): string {
  const rewriteRef = (ref: string): string => {
    const zipPath = resolveZipPath(htmlPath, ref)
    if (!zipPath) return ref
    // Try exact, then common fallbacks
    const tries = [
      zipPath,
      zipPath.replace(/^dist\//, ''),
      zipPath.replace(/^public\//, ''),
      joinPath('public', zipPath.replace(/^(dist|public)\//, '')),
      joinPath('dist', zipPath.replace(/^(dist|public)\//, '')),
    ]
    for (const t of tries) {
      const url = blobUrlFor(files, t, blobUrls)
      if (url) return url
    }
    return ref
  }

  let out = html.replace(ATTR_URL_RE, (full, prefix: string, q: string, ref: string) => {
    if (/^(https?:|data:|blob:|mailto:|tel:|#|javascript:)/i.test(ref)) {
      return full
    }
    const next = rewriteRef(ref)
    // Preserve original path for tweak matching when next is a blob URL
    const attrName = prefix.match(/\b(src|href|poster|data)\b/i)?.[1]?.toLowerCase() ?? ''
    const origAttr =
      next !== ref && (attrName === 'src' || attrName === 'href')
        ? ` data-zip-ship-orig-${attrName}=${q}${ref}${q}`
        : ''
    return `${prefix}${q}${next}${q}${origAttr}`
  })

  out = out.replace(CSS_URL_RE, (full, q: string, ref: string) => {
    if (/^(https?:|data:|blob:|#)/i.test(ref)) return full
    const next = rewriteRef(ref)
    return `url(${q}${next}${q})`
  })

  return out
}

const INJECT_SCRIPT = `
<script data-zip-ship-tweak>
(function () {
  var TYPE = ${JSON.stringify(PREVIEW_MSG_TYPE)};
  function pickKind(el) {
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'img') return 'image';
    if (tag === 'a' || (tag === 'button' && el.getAttribute('href')) || el.closest('a[href]')) {
      return 'link';
    }
    return 'text';
  }
  function textOf(el) {
    if (!el) return '';
    var t = (el.innerText || el.textContent || '').trim();
    if (t.length > 500) t = t.slice(0, 500);
    return t;
  }
  function payloadFrom(el) {
    var tag = (el.tagName || '').toLowerCase();
    var kind = pickKind(el);
    var msg = { type: TYPE, kind: kind, tag: tag };
    if (kind === 'image') {
      msg.src = el.getAttribute('data-zip-ship-orig-src') || el.getAttribute('src') || el.currentSrc || '';
      msg.alt = el.getAttribute('alt') || '';
    } else if (kind === 'link') {
      var a = tag === 'a' ? el : (el.closest && el.closest('a[href]')) || el;
      msg.href = a.getAttribute('data-zip-ship-orig-href') || a.getAttribute('href') || '';
      // Ignore blob hrefs if orig missing
      if (msg.href && msg.href.indexOf('blob:') === 0) {
        msg.href = a.getAttribute('data-zip-ship-orig-href') || '';
      }
      msg.text = textOf(a);
      msg.tag = (a.tagName || tag).toLowerCase();
      if (tag === 'img' || a.querySelector) {
        var img = tag === 'img' ? el : a.querySelector && a.querySelector('img');
        if (img) msg.src = img.getAttribute('data-zip-ship-orig-src') || img.getAttribute('src') || '';
      }
    } else {
      msg.text = textOf(el);
    }
    return msg;
  }
  function isEditableTarget(el) {
    if (!el || el === document.documentElement || el === document.body) return false;
    var tag = (el.tagName || '').toLowerCase();
    if (['script', 'style', 'html', 'head', 'meta', 'link', 'noscript'].indexOf(tag) >= 0) {
      return false;
    }
    return true;
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t) return;
    // Always block navigation
    var a = t.closest && t.closest('a[href]');
    if (a) {
      e.preventDefault();
      e.stopPropagation();
    } else {
      e.preventDefault();
      e.stopPropagation();
    }
    var el = t;
    // Prefer meaningful ancestors for text
    while (el && !isEditableTarget(el)) el = el.parentElement;
    if (!el) return;
    var tag = (el.tagName || '').toLowerCase();
    if (tag !== 'img' && tag !== 'a' && tag !== 'button') {
      // climb to a text-bearing element with short text, or img/a/button
      var cur = el;
      for (var i = 0; i < 4 && cur; i++) {
        var ct = (cur.tagName || '').toLowerCase();
        if (ct === 'img' || ct === 'a' || ct === 'button') { el = cur; break; }
        var tx = (cur.innerText || '').trim();
        if (tx && tx.length <= 200) { el = cur; break; }
        cur = cur.parentElement;
      }
    }
    try {
      parent.postMessage(payloadFrom(el), '*');
    } catch (err) {}
  }, true);
  // Soft outline on hover for affordance
  var last;
  document.addEventListener('mouseover', function (e) {
    var t = e.target;
    if (last && last !== t) try { last.style.outline = ''; } catch (_) {}
    if (t && t.style) {
      t.style.outline = '2px solid #22d3ee';
      t.style.outlineOffset = '2px';
      last = t;
    }
  }, true);
  document.addEventListener('mouseout', function (e) {
    var t = e.target;
    if (t && t.style) try { t.style.outline = ''; } catch (_) {}
  }, true);
})();
</script>
`

function injectPreviewScript(html: string): string {
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, INJECT_SCRIPT + '</body>')
  }
  return html + INJECT_SCRIPT
}

/**
 * Build an iframe srcdoc preview from zip entries, rewriting assets to blob URLs
 * and injecting click-to-select (no navigation).
 */
export function buildPreview(
  files: Record<string, Uint8Array>,
): PreviewBuildResult {
  const blobUrls: string[] = []
  const htmlPath = findPreviewHtmlPath(files)
  if (!htmlPath) {
    return {
      mode: 'inventory',
      blobUrls,
      note: 'No previewable index.html found (looked for dist/, root, public/). Showing editable inventory fallback.',
    }
  }
  const key = findFileKey(files, htmlPath)
  if (!key) {
    return {
      mode: 'inventory',
      blobUrls,
      note: 'Could not read HTML entry. Showing editable inventory fallback.',
    }
  }
  let html = decodeText(files[key]!)
  html = rewriteHtmlAssets(html, htmlPath, files, blobUrls)
  html = injectPreviewScript(html)

  // Base tag not useful with blob URLs; leave as-is
  return {
    mode: 'preview',
    srcdoc: html,
    blobUrls,
    htmlPath,
    note: `Preview from ${htmlPath} (assets via blob URLs; clicks select, do not navigate).`,
  }
}

export function parsePreviewMessage(
  data: unknown,
): PreviewSelection | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (d.type !== PREVIEW_MSG_TYPE) return null
  const kind = d.kind
  if (kind !== 'text' && kind !== 'image' && kind !== 'link') return null
  return {
    kind,
    tag: typeof d.tag === 'string' ? d.tag : 'div',
    text: typeof d.text === 'string' ? d.text : undefined,
    src: typeof d.src === 'string' ? d.src : undefined,
    href: typeof d.href === 'string' ? d.href : undefined,
  }
}

export function revokeBlobUrls(urls: string[]) {
  for (const u of urls) {
    try {
      URL.revokeObjectURL(u)
    } catch {
      /* ignore */
    }
  }
}
