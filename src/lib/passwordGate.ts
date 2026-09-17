/**
 * Optional soft password gate injection for cleaned zips.
 * Client-side only — not real auth. SHA-256 hashes only; never plaintext in zip.
 */

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

export type PasswordGateOptions = {
  enabled: boolean
  adminPassword: string
  userPassword: string
  /** Optional URL the live app fetches for { adminHash, userHash, version } */
  remoteConfigUrl: string
  /** Optional write URL for admin password updates; falls back to remoteConfigUrl */
  remoteWriteUrl: string
}

export type GateConfig = {
  adminHash: string
  userHash: string
  version: 1
}

export type PasswordGateApplyResult = {
  configPath: string | null
  scriptPath: string | null
  htmlPatched: string[]
  tanstackPatched: string | null
  componentPath: string | null
  remoteConfigUrl: string | null
  remoteWriteUrl: string | null
  skippedReason: string | null
}

export async function sha256Hex(plaintext: string): Promise<string> {
  const data = new TextEncoder().encode(plaintext)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function buildGateConfig(
  adminPassword: string,
  userPassword: string,
): Promise<GateConfig> {
  const [adminHash, userHash] = await Promise.all([
    sha256Hex(adminPassword),
    sha256Hex(userPassword),
  ])
  return { adminHash, userHash, version: 1 }
}

function jsStringLiteral(s: string): string {
  return JSON.stringify(s)
}

/**
 * Full-viewport soft lock UI (dark / cyan Gear-friendly).
 * Fetches remote config when REMOTE_CONFIG_URL is set; else /gate-config.json.
 */
export function buildGateLockScript(opts: {
  remoteConfigUrl: string
  remoteWriteUrl: string
}): string {
  const remoteConfig = jsStringLiteral(opts.remoteConfigUrl.trim())
  const remoteWrite = jsStringLiteral(opts.remoteWriteUrl.trim())

  return `/*! Capstiller soft password gate — NOT real auth. SHA-256 client hashes only. */
(function () {
  "use strict";
  var REMOTE_CONFIG_URL = ${remoteConfig};
  var REMOTE_WRITE_URL = ${remoteWrite};
  var LOCAL_CONFIG = "/gate-config.json";
  var SS_USER = "cap-gate-user-ok";
  var SS_ADMIN = "cap-gate-admin-ok";
  var CFG_VERSION = 1;

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  function sha256Hex(text) {
    var data = new TextEncoder().encode(text);
    return crypto.subtle.digest("SHA-256", data).then(function (buf) {
      return Array.from(new Uint8Array(buf))
        .map(function (b) {
          return b.toString(16).padStart(2, "0");
        })
        .join("");
    });
  }

  function configUrl() {
    if (REMOTE_CONFIG_URL) {
      var sep = REMOTE_CONFIG_URL.indexOf("?") >= 0 ? "&" : "?";
      return REMOTE_CONFIG_URL + sep + "_t=" + Date.now();
    }
    return LOCAL_CONFIG + "?_t=" + Date.now();
  }

  function writeUrl() {
    return REMOTE_WRITE_URL || REMOTE_CONFIG_URL || "";
  }

  function fetchConfig() {
    return fetch(configUrl(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("gate config HTTP " + r.status);
      return r.json();
    });
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "style" && typeof attrs[k] === "object") {
          Object.assign(n.style, attrs[k]);
        } else if (k === "text") {
          n.textContent = attrs[k];
        } else if (k.slice(0, 2) === "on" && typeof attrs[k] === "function") {
          n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else {
          n.setAttribute(k, attrs[k]);
        }
      });
    }
    (kids || []).forEach(function (c) {
      if (c != null)
        n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }

  var STYLE = {
    overlay: {
      position: "fixed",
      inset: "0",
      zIndex: "2147483646",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background:
        "radial-gradient(ellipse at top, #0f172a 0%, #020617 55%, #000 100%)",
      fontFamily:
        "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      color: "#e2e8f0",
      padding: "24px",
    },
    card: {
      width: "100%",
      maxWidth: "380px",
      background: "rgba(15, 23, 42, 0.92)",
      border: "1px solid rgba(34, 211, 238, 0.35)",
      borderRadius: "16px",
      boxShadow: "0 0 40px rgba(34, 211, 238, 0.12)",
      padding: "28px 24px 22px",
    },
    title: {
      margin: "0 0 6px",
      fontSize: "1.25rem",
      fontWeight: "600",
      color: "#67e8f9",
      letterSpacing: "0.02em",
    },
    sub: {
      margin: "0 0 18px",
      fontSize: "0.75rem",
      color: "#94a3b8",
      lineHeight: "1.4",
    },
    label: {
      display: "block",
      fontSize: "0.7rem",
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      color: "#64748b",
      marginBottom: "6px",
    },
    input: {
      width: "100%",
      boxSizing: "border-box",
      background: "#020617",
      border: "1px solid #334155",
      borderRadius: "10px",
      color: "#f1f5f9",
      padding: "10px 12px",
      fontSize: "0.95rem",
      outline: "none",
      marginBottom: "14px",
    },
    btn: {
      width: "100%",
      border: "none",
      borderRadius: "10px",
      padding: "11px 14px",
      fontSize: "0.9rem",
      fontWeight: "600",
      cursor: "pointer",
      background: "linear-gradient(135deg, #0891b2, #22d3ee)",
      color: "#082f49",
    },
    link: {
      display: "block",
      marginTop: "14px",
      textAlign: "center",
      fontSize: "0.75rem",
      color: "#67e8f9",
      background: "none",
      border: "none",
      cursor: "pointer",
      textDecoration: "underline",
      padding: "0",
      width: "100%",
    },
    err: {
      color: "#fca5a5",
      fontSize: "0.8rem",
      minHeight: "1.2em",
      marginBottom: "10px",
    },
    warn: {
      marginTop: "12px",
      fontSize: "0.65rem",
      color: "#64748b",
      lineHeight: "1.35",
    },
    adminBar: {
      position: "fixed",
      bottom: "16px",
      right: "16px",
      zIndex: "2147483645",
      display: "flex",
      gap: "8px",
      alignItems: "center",
    },
    adminBtn: {
      border: "1px solid rgba(34, 211, 238, 0.4)",
      background: "rgba(15, 23, 42, 0.9)",
      color: "#67e8f9",
      borderRadius: "999px",
      padding: "8px 14px",
      fontSize: "0.75rem",
      cursor: "pointer",
      fontFamily: "inherit",
    },
  };

  var overlay = null;
  var configCache = null;

  function removeOverlay() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }

  function showAdminPanel() {
    var existing = document.getElementById("cap-gate-admin-bar");
    if (existing) return;
    var bar = el("div", { id: "cap-gate-admin-bar", style: STYLE.adminBar }, [
      el(
        "button",
        {
          type: "button",
          style: STYLE.adminBtn,
          text: "Change user password",
          onClick: function () {
            openChangePassword();
          },
        },
        []
      ),
      el(
        "button",
        {
          type: "button",
          style: STYLE.adminBtn,
          text: "Lock",
          onClick: function () {
            try {
              sessionStorage.removeItem(SS_USER);
              sessionStorage.removeItem(SS_ADMIN);
            } catch (e) {}
            var b = document.getElementById("cap-gate-admin-bar");
            if (b && b.parentNode) b.parentNode.removeChild(b);
            startGate(true);
          },
        },
        []
      ),
    ]);
    document.body.appendChild(bar);
  }

  function downloadJson(obj, name) {
    var blob = new Blob([JSON.stringify(obj, null, 2) + "\\n"], {
      type: "application/json",
    });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name || "gate-config.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function persistConfig(next) {
    var url = writeUrl();
    if (!url) {
      downloadJson(next, "gate-config.json");
      return Promise.resolve({ ok: true, downloaded: true });
    }
    return fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    }).then(function (r) {
      if (r.ok) return { ok: true };
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      }).then(function (r2) {
        if (!r2.ok) throw new Error("Write failed HTTP " + r2.status);
        return { ok: true };
      });
    });
  }

  function openChangePassword() {
    removeOverlay();
    var errBox = el("div", { style: STYLE.err }, []);
    var pwInput = el("input", {
      type: "password",
      autocomplete: "new-password",
      placeholder: "New user password",
      style: STYLE.input,
    });
    var pw2 = el("input", {
      type: "password",
      autocomplete: "new-password",
      placeholder: "Confirm new user password",
      style: STYLE.input,
    });
    overlay = el("div", { id: "cap-gate-overlay", style: STYLE.overlay }, [
      el("div", { style: STYLE.card }, [
        el("h1", { style: STYLE.title, text: "Change user password" }, []),
        el("p", {
          style: STYLE.sub,
          text: writeUrl()
            ? "Updates remote gate-config (no redeploy)."
            : "No remote write URL — downloads updated gate-config.json for you to upload.",
        }),
        el("label", { style: STYLE.label, text: "New user password" }, []),
        pwInput,
        el("label", { style: STYLE.label, text: "Confirm" }, []),
        pw2,
        errBox,
        el(
          "button",
          {
            type: "button",
            style: STYLE.btn,
            text: "Save",
            onClick: function () {
              errBox.textContent = "";
              var a = pwInput.value || "";
              var b = pw2.value || "";
              if (!a) {
                errBox.textContent = "Enter a password.";
                return;
              }
              if (a !== b) {
                errBox.textContent = "Passwords do not match.";
                return;
              }
              sha256Hex(a)
                .then(function (hash) {
                  var base = configCache || {
                    adminHash: "",
                    userHash: "",
                    version: CFG_VERSION,
                  };
                  var next = {
                    adminHash: base.adminHash,
                    userHash: hash,
                    version: CFG_VERSION,
                  };
                  return persistConfig(next).then(function (res) {
                    configCache = next;
                    removeOverlay();
                    showAdminPanel();
                    if (res && res.downloaded) {
                      alert(
                        "Downloaded gate-config.json. Upload it to replace the live config (or re-clean without remote)."
                      );
                    }
                  });
                })
                .catch(function (e) {
                  errBox.textContent =
                    e && e.message ? e.message : "Save failed.";
                });
            },
          },
          []
        ),
        el(
          "button",
          {
            type: "button",
            style: STYLE.link,
            text: "Cancel",
            onClick: function () {
              removeOverlay();
              showAdminPanel();
            },
          },
          []
        ),
        el("p", {
          style: STYLE.warn,
          text: "Soft gate only — hashes are client-side. Keep the admin password private.",
        }),
      ]),
    ]);
    document.body.appendChild(overlay);
    setTimeout(function () {
      pwInput.focus();
    }, 30);
  }

  function renderLock(mode) {
    removeOverlay();
    var isAdmin = mode === "admin";
    var errBox = el("div", { style: STYLE.err }, []);
    var pwInput = el("input", {
      type: "password",
      autocomplete: "current-password",
      placeholder: isAdmin ? "Admin password" : "Password",
      style: STYLE.input,
    });
    overlay = el("div", { id: "cap-gate-overlay", style: STYLE.overlay }, [
      el("div", { style: STYLE.card }, [
        el(
          "h1",
          {
            style: STYLE.title,
            text: isAdmin ? "Admin unlock" : "Enter password",
          },
          []
        ),
        el("p", {
          style: STYLE.sub,
          text: isAdmin
            ? "Admin unlocks Change user password (and the app)."
            : "This app is password-gated. Soft client gate — not real authentication.",
        }),
        el("label", {
          style: STYLE.label,
          text: isAdmin ? "Admin password" : "User password",
        }, []),
        pwInput,
        errBox,
        el(
          "button",
          {
            type: "button",
            style: STYLE.btn,
            text: "Unlock",
            onClick: function () {
              doUnlock(pwInput.value || "", isAdmin, errBox);
            },
          },
          []
        ),
        el(
          "button",
          {
            type: "button",
            style: STYLE.link,
            text: isAdmin ? "← Back to user login" : "Admin login",
            onClick: function () {
              renderLock(isAdmin ? "user" : "admin");
            },
          },
          []
        ),
        el("p", {
          style: STYLE.warn,
          text: "Soft gate · SHA-256 hashes · session only (closing the tab locks again).",
        }),
      ]),
    ]);
    document.body.appendChild(overlay);
    pwInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") doUnlock(pwInput.value || "", isAdmin, errBox);
    });
    setTimeout(function () {
      pwInput.focus();
    }, 30);
  }

  function doUnlock(password, asAdmin, errBox) {
    errBox.textContent = "";
    if (!password) {
      errBox.textContent = "Enter a password.";
      return;
    }
    var cfgP = configCache
      ? Promise.resolve(configCache)
      : fetchConfig().then(function (c) {
          configCache = c;
          return c;
        });
    cfgP
      .then(function (cfg) {
        return sha256Hex(password).then(function (hash) {
          if (asAdmin) {
            if (hash !== cfg.adminHash) {
              throw new Error("Wrong admin password.");
            }
            try {
              sessionStorage.setItem(SS_ADMIN, "1");
              sessionStorage.setItem(SS_USER, "1");
            } catch (e) {}
            removeOverlay();
            showAdminPanel();
            return;
          }
          if (hash !== cfg.userHash && hash !== cfg.adminHash) {
            throw new Error("Wrong password.");
          }
          try {
            sessionStorage.setItem(SS_USER, "1");
            if (hash === cfg.adminHash) {
              sessionStorage.setItem(SS_ADMIN, "1");
            }
          } catch (e) {}
          removeOverlay();
          if (hash === cfg.adminHash) showAdminPanel();
        });
      })
      .catch(function (e) {
        errBox.textContent =
          e && e.message ? e.message : "Could not verify password.";
      });
  }

  function startGate(force) {
    var userOk = false;
    var adminOk = false;
    try {
      userOk = sessionStorage.getItem(SS_USER) === "1";
      adminOk = sessionStorage.getItem(SS_ADMIN) === "1";
    } catch (e) {}
    if (!force && userOk) {
      if (adminOk) showAdminPanel();
      return;
    }
    fetchConfig()
      .then(function (cfg) {
        configCache = cfg;
        if (!cfg || !cfg.userHash || !cfg.adminHash) {
          console.warn("[cap-gate] invalid gate-config; skipping lock");
          return;
        }
        renderLock("user");
      })
      .catch(function (e) {
        console.warn("[cap-gate] config fetch failed", e);
        renderLock("user");
      });
  }

  ready(function () {
    startGate(false);
  });
})();
`
}

function injectScriptIntoHtml(
  html: string,
  src: string,
): { html: string; changed: boolean } {
  if (/gate-lock\.js/.test(html)) {
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

const GATE_LOCK_COMPONENT = `/** Soft password gate — Capstiller. Not real auth. */
import { useEffect } from 'react'

const SCRIPT_SRC = '/gate-lock.js'

/** Ensures gate-lock.js loads once (SPA / TanStack root). */
export function GateLock() {
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

export default GateLock
`

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

/**
 * Add import + <GateLock /> before <Outlet /> (TanStack) or first fragment child.
 */
export function patchTanstackRootSafe(
  source: string,
  componentImportPath: string,
): { text: string; changed: boolean } {
  if (/GateLock/.test(source) || /gate-lock\.js/.test(source)) {
    return { text: source, changed: false }
  }

  let out = source
  const importLine = `import { GateLock } from '${componentImportPath}'`

  const singleLine = [
    ...out.matchAll(/^import\s.+from\s+['"][^'"]+['"];?\s*$/gm),
  ]
  const last = singleLine[singleLine.length - 1]
  if (last && last.index != null) {
    const end = last.index + last[0].length
    out = `${out.slice(0, end)}\n${importLine}${out.slice(end)}`
  } else {
    out = `${importLine}\n${out}`
  }

  if (/<Outlet\b/.test(out)) {
    out = out.replace(/<Outlet\b/, '<GateLock />\n      <Outlet')
  } else if (/<>/.test(out)) {
    out = out.replace(/<>/, '<>\n      <GateLock />')
  } else if (/<Head\b/.test(out)) {
    out = out.replace(/<\/Head>/, '</Head>\n      <GateLock />')
  } else {
    // Could not find a safe mount point — leave source unchanged (HTML script still covers)
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

/**
 * Inject soft password gate into kept zip files.
 */
export async function applyPasswordGate(
  kept: Record<string, Uint8Array>,
  opts: PasswordGateOptions,
): Promise<PasswordGateApplyResult> {
  const layout = detectProjectLayout(kept)

  if (!opts.enabled) {
    return {
      configPath: null,
      scriptPath: null,
      htmlPatched: [],
      tanstackPatched: null,
      componentPath: null,
      remoteConfigUrl: null,
      remoteWriteUrl: null,
      skippedReason: 'Password gate off',
    }
  }

  const admin = opts.adminPassword
  const user = opts.userPassword
  if (!admin || !user) {
    return {
      configPath: null,
      scriptPath: null,
      htmlPatched: [],
      tanstackPatched: null,
      componentPath: null,
      remoteConfigUrl: null,
      remoteWriteUrl: null,
      skippedReason: 'Admin and user passwords required',
    }
  }

  const config = await buildGateConfig(admin, user)
  const remoteConfigUrl = opts.remoteConfigUrl.trim()
  const remoteWriteUrl = opts.remoteWriteUrl.trim()

  const configPath = joinPath(layout.assetDir, 'gate-config.json')
  const scriptPath = joinPath(layout.assetDir, 'gate-lock.js')

  kept[configPath] = encodeText(`${JSON.stringify(config, null, 2)}\n`)
  kept[scriptPath] = encodeText(
    buildGateLockScript({ remoteConfigUrl, remoteWriteUrl }),
  )

  const htmlPatched: string[] = []
  for (const htmlPath of collectHtmlTargets(kept, layout.projectRoot)) {
    const key = findFileKey(kept, htmlPath)
    if (!key || !kept[key]) continue
    const { html, changed } = injectScriptIntoHtml(
      decodeText(kept[key]),
      '/gate-lock.js',
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
    const writePath = joinPath(layout.projectRoot, 'src/components/GateLock.tsx')
    kept[writePath] = encodeText(GATE_LOCK_COMPONENT)
    componentPath = writePath
    const importPath = relativeImport(rootPath, writePath)
    const key = findFileKey(kept, rootPath)
    if (key && kept[key]) {
      const patched = patchTanstackRootSafe(decodeText(kept[key]), importPath)
      if (patched.changed) {
        kept[key] = encodeText(patched.text)
        tanstackPatched = rootPath
      } else {
        tanstackPatched = `${rootPath} (GateLock.tsx added; root left unchanged — HTML script covers build)`
      }
    }
  }

  return {
    configPath,
    scriptPath,
    htmlPatched,
    tanstackPatched,
    componentPath,
    remoteConfigUrl: remoteConfigUrl || null,
    remoteWriteUrl: remoteWriteUrl || null,
    skippedReason: null,
  }
}
