# Wash yo Apps

Formerly Zip Ship Cleaner (v3.8). Clean and pack Gear apps for GitHub / Vercel.

# Zip Ship Cleaner

**Version 3.9.0** — **Capstiller Vercel Ship Packager**.

Upload a project zip + app name + icon → download a cleaned zip ready for Vercel, with PWA/install metadata so device home screens show the name under the icon.

Still strips sandbox ID crumbs, **fixes broken Vite / Vercel-ready** issues from grok sandbox / Capstiller crabby-clean (`scripts/with-app-env.mjs` → plain `vite`, unsafe `build` chains → `vite build`, vite.config static `./scripts/*.mjs` → inline + dynamic import), **force-removes `--host` / `0.0.0.0`**, and optionally **converts kept `.wav` → `.mp3`** (ffmpeg.wasm; default OFF).

**v3.1** fixes Vercel `UNRESOLVED_IMPORT` for `scripts/*.mjs` imported from `vite.config`.

**v3.2** adds an optional **GitHub upload helper** (default ON): after a successful clean, the UI lists top-level folders + root files to drag onto GitHub web Upload (Ctrl+A often skips nested folders), and injects `GITHUB-UPLOAD.txt` at the project root with the same checklist + a tip to prefer [GitHub Desktop](https://desktop.github.com/). Does **not** flatten the project tree.

**v3.3** extends the **grok** strip toggle to also remove grok.com sandbox leftovers by **path** (not by scanning `src/` comments): `__grok/` (e.g. `public/__grok/`), `scripts/*grok-pwa*`, `server/middleware/grok-pwa.ts`, `server/virtual-grok-og-identity.d.ts`, and `with-app-env*` (unused after Fix Vite rewrites scripts to plain `vite`). The GitHub helper is reorganized into **Must upload for Vercel** vs **Optional** (`screenshots/`, `artifacts/`, `AGENTS.md`, `GITHUB-UPLOAD.txt`). `attachments/` stays under Must — Capstiller southern-cap layouts keep site media there.

**v3.5** rewrites dangling **`/__grok/`** install-asset hrefs when **grok strip** and/or **PWA pack** is ON. Grok sandbox HTML/TS/JS often keep `rel="apple-touch-icon" href="/__grok/icon-180.png"` and `manifest` → `/__grok/manifest.webmanifest` even after the pack injects `/apple-touch-icon.png` + `/manifest.webmanifest` into `public/` (and after `__grok/**` is deleted). Those `__grok` URLs 404 or serve tiny junk → Chrome home-screen letter icons (G/V). Zip Ship now path-rewrites those refs in `*.html`, `*.tsx`, `*.jsx`, `*.ts`, `*.js` (and similar) to the pack assets, and PWA pack still upserts correct `<link rel="apple-touch-icon">` + `<link rel="manifest">` in `index.html`.

**v3.6** adds **Tweak** mode (top-level **Clean | Tweak** switch). Upload a project zip, get a best-effort **live preview** of the lander from `dist/index.html` (else root / `public/index.html`) with asset URLs rewritten to blob object URLs, or an **Editable inventory** fallback when no HTML is previewable. Clicks select elements (links do **not** navigate). Simple edits only: text, image replace/remove, link href change/clear. Download a tweaked zip. Clean mode is unchanged.

**v3.9.0** — **Protected files + organized review + confirm step** (after an I Still clean wiped `public/sprites` / `public/art`).
- **Protected by default, never auto/bulk removed:** everything under `public/`, `static/`, `assets/` (incl. `src/assets/`), anything in `src/`, any image / sound / video / font / 3D file anywhere (png jpg jpeg gif webp avif svg ico bmp mp3 wav ogg m4a aac flac mp4 webm mov glb gltf obj fbx ttf otf woff woff2), and any file whose name appears in `src/**` or `index.html` text. Hard junk folders are still always removed (`node_modules/`, `.git/`, `.vercel/`, `__MACOSX/`, `.grok/`, `__grok/`, top-level `dist/` `build/` `.next/` …). A build-dir name nested under `public/` / `assets/` / `src/` is not junk.
- **Only way to drop a protected file:** uncheck its **Keep** box in Media review (shows a warning). "Remove unprotected videos" skips protected files. The `*.wav` opt-in removes only loose WAVs not in `public/` and not used by code.
- **Review list** in plain words with counts, sizes and collapsible lists: *Will remove: build junk*, *Will remove: images & sounds you unchecked*, *Kept: images & sounds*, *Kept: app code*, *Kept: other files*.
- **Backup zips** (`*.zip` inside the upload) get their own group, **kept by default**. One-tap **Remove backup zips** plus per-zip checkboxes. Each zip is opened to count images inside that aren't anywhere else in the upload; optional **Pull missing images out of the zip, then remove it** (one copy per filename, lands in `public/…`, never overwrites).
- **Nothing is removed until you confirm:** *Clean & download…* opens a confirm step listing every image/sound that would be removed and any backup-zip notes (e.g. "I-Still.zip has 10 image/sound files not found elsewhere in the upload").
- Tests: `npm test` (node --test, loads TS via Vite SSR).

**v3.8.0** bakes **Base app Recents/Discover + OKX wallet / store preview** into every Clean (with PWA pack): Open Graph + Twitter tags (`og:title` / `twitter:title` aligned to PWA app name), `og:image` / `twitter:image` pointing at `/og.jpg` (absolute when optional **Public site URL** is set, else root-relative), favicon links (`/favicon-32.png` + generated `favicon.ico` when possible; SVG favicons kept), and copies `icon-512.png` / apple-touch → `og.jpg` when missing. Optional **Output zip name** on Clean (and Tweak) overrides the download filename (`.zip` appended if omitted). Optional checkbox **Want a CAPSTILLER Easteregg?** (default OFF) injects `public/cap-easter-egg.png` + `cap-easter-egg.js` (and TanStack root like the password gate): one random non-interactive letter shows the Cap cutout sticker at **3×** letter height while pressed.

**v3.7.0** adds an optional **soft password gate** for Clean mode (default OFF). When enabled, the packager injects `public/gate-config.json` (SHA-256 `adminHash` + `userHash`, `version: 1`) and `public/gate-lock.js`, and patches `index.html` / `dist/index.html` (plus best-effort TanStack `src/routes/__root.tsx` via a small `GateLock.tsx` component). Visitors must enter the **user password** to use the live app; Cap’s **admin password** unlocks a panel to **change the user password**. Optional **Remote config URL** lets the app fetch hashes on load (cache-bust query) and admin saves via PUT/POST to **Remote write URL** (or the config URL) so the user password can change **without redeploy**. Without remote URLs, admin downloads an updated `gate-config.json` (or you re-clean). Session unlock uses `sessionStorage` (tab close locks again). **Not real auth** — client-side soft gate only; keep admin private.

**v3.6.1** fixes Tweak persistence: default text/href (and image path-ref) edits **replace all exact occurrences** across eligible text-ish files (including both `src/` and `dist/`) so Clean → Vercel source builds stay in sync with the preview. Shows a clear “Updating N occurrences in M files” summary with a primary **Replace all N matches** button (optional advanced single-match pick). Preview/sidebar edits are **not** saved until Apply mutates the in-memory zip map; download is blocked while edits are unsaved or staged. Zero matches explain that preview-only/compiled/dynamic text was not saved. Change log lists every file touched.

**v3.4** adds **Media review**: after a zip is scanned, list every kept image / audio / video with path, type badge, size, and on-demand preview (`<img>` / `<audio>` / `<video>` via blob URLs). Removals are **opt-in** (default keep) — videos are **not** auto-stripped. Marked paths are passed to `buildCleanZip` as `extraRemovePaths` and omitted in addition to existing strip rules. Helpers: Remove all videos / Keep all. Object URLs are revoked on hide / unmount / zip change.

**Privacy:** everything runs in your browser (`fflate` + canvas + optional `@ffmpeg/ffmpeg`). Nothing is uploaded to a server. Data is cleared when you close the tab.

## Ship gearup.wtf / crabby landing → Vercel

Typical Capstiller flow for a grok sandbox or crabby landing (Gear Up, Crabby, etc.):

1. Download the project zip from grok sandbox / crabby-clean (often includes `node_modules`, `--host 0.0.0.0`, and `scripts/with-app-env.mjs`).
2. Open this app (`npm install && npm run dev`, or the hosted cleaner).
3. Drop the zip.
4. Under **Vercel / Install**, enter the **app name** (`Gear Up`, `Crabby`, …) and upload the store / home-screen **icon** (png / jpg / webp). Optional short name defaults to a 12-character truncation.
5. Leave **Add PWA install icons + manifest** ON (it turns on automatically once name + icon are set).
6. Leave **Keep --host / 0.0.0.0** OFF (default, under Advanced). Host bind-all is stripped from `package.json` scripts, `vite.config`, and `scripts/with-app-env.mjs`.
7. Click **Download Vercel-ready zip**. Check the injection summary (icons, manifest, HTML patches, scripts fixed, vite.config Vercel fix / manual-fix flag, host stripped, wavs converted).
8. In [Vercel](https://vercel.com): **Add New Project** → upload the zip (or unzip and `npx vercel`). **Vite is auto-detected** — this packager does **not** add `vercel.json` when a `vite.config.*` is present, so SSR / framework defaults are not overwritten.
9. After deploy, open the URL on a phone → Share / **Add to Home Screen**. The icon label is your app name (`apple-mobile-web-app-title` + `application-name` + manifest `name` / `short_name`).

Static (non-Vite) zips without `vite.config` get an optional `vercel.json` SPA rewrite (`/(.*) → /index.html`) so client-side routes work.

## What it strips (defaults)

| Toggle | Default | Paths |
|--------|---------|--------|
| `node_modules/` | ON | any depth |
| Build / cache dirs | ON | `.next/`, `dist/`, `build/`, `out/`, `.turbo/`, `.cache/`, `coverage/` |
| `.git/` | ON | |
| OS junk | ON | `__MACOSX/`, `.DS_Store`, `Thumbs.db` |
| `.vercel/` | ON | for a fresh deploy zip (turn off if you need linked settings) |
| `.grok/` + grok sandbox leftovers | ON | `.grok/`, `__grok/`, `.sandbox-meta`, `*grok-pwa*`, `virtual-grok-og-identity*`, `with-app-env*` (path-based) |
| Sandbox ID crumbs | ON | `.project_id` (any path), `.node_modules.lock`, `.sandbox`, `.project` |
| `*.log` | ON | |
| `*.wav` | **OFF** | optional delete — see Convert below |
| Convert `.wav` → `.mp3` | **OFF** | ffmpeg.wasm; see below |
| Fix broken Vite / Vercel-ready | ON | wrappers, build chains, vite.config `./scripts` imports |
| Keep `--host` expose | **OFF** | Advanced; do not leave on for Vercel |
| GitHub upload helper | **ON** | checklist UI + `GITHUB-UPLOAD.txt` (no tree flatten) |

Never removes `package.json`, `src/`, public assets, mp3, images, or most `scripts/*.mjs` (including `scripts/migration-plan.mjs` — kept so vite.config can dynamic-import plugins at build time). When the **grok** toggle is ON, path-based exceptions strip `*grok-pwa*` and `with-app-env*` leftovers (and vite.config drops those plugin imports instead of dynamic-importing missing files). Opt into `*.wav` removal (or convert, which replaces wav with mp3) only if you want audio stripped/converted.

## Media review (v3.4)

Videos (and other media) are **not** auto-stripped. After upload/scan, the **Media review** panel lists kept media files:

| Column | Detail |
|--------|--------|
| Path | Relative path inside the zip |
| Type | Badge: image / audio / video |
| Size | Human-readable |
| Preview | Click **Preview** — lazy blob URL from zip entry bytes (`<img>` / `<audio>` / `<video>`) |
| Remove | Checkbox, default **off** (keep). Opt into removing junk |

Extensions (best-effort): images `jpg/jpeg/png/gif/webp/svg/ico/avif`; audio `mp3/wav/ogg/m4a/aac/flac`; video `mp4/webm/mov/m4v/avi`.

`listMediaEntries(files, opts?)` exports the listing helper. `buildCleanZip(..., extraRemovePaths?)` accepts a `Set<string>` or `string[]` of relative paths to omit on top of strip rules.

## Tweak mode (v3.6 / v3.6.1)

Switch to **Tweak** in the top tab bar (Clean stays the default ship flow).

1. Upload a project `.zip` (kept in memory via `fflate`).
2. **Preview** (best-effort): prefer `dist/index.html`, else root `index.html`, else `public/index.html`. CSS/image/`src`/`href` assets are rewritten to `blob:` object URLs so the lander renders in an iframe `srcdoc`. An injected script `preventDefault`s clicks on links and `postMessage`s `{ kind:'text'|'image'|'link', text?, src?, href?, tag }` to the parent for editing. Preview DOM edits are **not** considered saved.
3. If no previewable HTML: **Editable inventory** lists string literals / hrefs / image paths from `src/**/*.{tsx,jsx,html}` plus `public/**` (and similar) images with a clear fallback note — same edit → match → patch path.
4. Editor panel: change text, change/clear `href` on anchors/buttons, replace or remove images. Click **Apply…** to scan matches.
5. **Matching / patching (v3.6.1):** `findExactMatches` scans text-ish files (`tsx/jsx/ts/js/html/css/json/md/svg`, …) excluding `node_modules`. Default path is **replace all exact occurrences** across every matching file (so both `src/` and `dist/` stay in sync). UI shows “Updating N occurrences in M files: …” then a primary **Replace all N matches** button; optional collapsed **Advanced: edit only selected match**. Zero matches → clear warning that preview-only / compiled / dynamic text was **not** saved. Image replace overwrites zip path bytes; remove deletes the path and **replace-all**s exact path string refs. After Apply, the in-memory zip map is mutated immediately and the preview `srcdoc` is rebuilt from that map.
6. **Download tweaked zip** (`*-tweaked.zip`) only from the mutated map. Download is disabled / hard-warned while sidebar edits are unsaved or a replace is staged but not confirmed. Change log lists every file touched.

Modules live under `src/lib/tweak/` (`preview`, `match`, `patch`, `inventory`).


## Vercel / Install (PWA metadata)


When the toggle is ON and an **app name + icon** are provided, the packager writes into the project’s public folder (`public/`, or `static/` if that is the detected asset root; otherwise it creates `public/` for Vite/npm projects, or the zip root for a bare static site):

| File | Size / role |
|------|-------------|
| `icon-192.png` | 192×192 install icon |
| `icon-512.png` | 512×512 install icon |
| `apple-touch-icon.png` | 180×180 iOS |
| `favicon-32.png` | tab favicon |

Icons are generated **client-side with canvas** (cover-center on a dark `#0c0a09` field).

`manifest.webmanifest` (or existing `site.webmanifest`) is written/updated:

- `name`, `short_name` (≤12 chars)
- `display`: `standalone`
- `start_url`: `/`
- icons 192 + 512
- `background_color` `#0c0a09` and `theme_color` `#c9a227` (dark gold Capstiller defaults) unless the existing manifest already set colors

`index.html` (project root and/or `public/index.html`) is patched:

- `<link rel="manifest" href="/manifest.webmanifest">`
- apple-touch-icon
- `<meta name="apple-mobile-web-app-title" content="App Name">`
- `<meta name="application-name" content="App Name">`
- `<meta name="theme-color" content="#c9a227">`
- `<title>` updated to the app name

### __grok href rewrite (v3.5)

When **grok** strip and/or **PWA pack** is ON, text files that can hold head links (`*.html`, `*.tsx`, `*.jsx`, `*.ts`, `*.js`, …) are path-rewritten:

| Before (sandbox leftover) | After |
|---------------------------|--------|
| `/__grok/icon-180.png` (and similar `__grok` icon / apple-touch / favicon PNGs) | `/apple-touch-icon.png` (or `/icon-192.png` / `/icon-512.png` / `/favicon-32.png` when the filename size matches) |
| `/__grok/manifest.webmanifest` (or `site.webmanifest`) | `/manifest.webmanifest` |

This runs **before** PWA HTML upserts, and always when grok strip deletes `public/__grok/**`, so cleaned zips never leave dangling `__grok` install URLs. Unrelated code is left alone (substring path replace only).

If `package.json` exists, `"name"` is set to an npm-safe slug of the app name (`Gear Up` → `gear-up`).

### vercel.json policy

- **Vite project** (`vite.config.ts` / `.js` / `.mts` / `.mjs` / … present): **do not add** `vercel.json`. Vercel auto-detects Vite; a catch-all rewrite can break SSR.
- **No vite.config** and no existing `vercel.json`: add a minimal SPA rewrite `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`.
- Existing `vercel.json` is left untouched.

## Host strip (default ON — Keep --host is OFF)

v2.2 only dropped `--host` while rewriting `with-app-env.mjs` wrappers. Sandbox zips still forced bind-all via:

1. **`package.json` scripts** — `--host`, `--host 0.0.0.0`, `--host=0.0.0.0`, `HOST=0.0.0.0`, positional `vite 0.0.0.0`
2. **`vite.config.*`** — `server.host` / `preview.host` set to `true`, `'0.0.0.0'`, `"0.0.0.0"`, or `'::'`
3. **`scripts/with-app-env.mjs`** (and other files under `scripts/`) injecting `HOST=0.0.0.0` or `--host` even after the npm script wrapper is gone

v3 **force-removes** those unless **Keep --host** is explicitly turned on (Advanced, default OFF, not recommended).

| Source | When | Action |
|--------|------|--------|
| Every `package.json` `scripts` value (not only the wrapper) | Always (unless Keep --host) | Strip `--host` / `0.0.0.0` / `HOST=0.0.0.0` |
| `vite.config.*` `host: true` / `host: '0.0.0.0'` | Fix Vite ON | Rewrite to `host: 'localhost'` |
| `scripts/with-app-env.mjs`, other `scripts/*.{mjs,js,ts,sh}`, root `*.sh` | Fix Vite ON | Patch flags, `HOST=`, `host:` / `'0.0.0.0'` literals → localhost |

`--port` is kept. Local `vite` and Vercel do not need bind-all.

## Convert .wav → .mp3 inside zip (default OFF)

When **Convert .wav → .mp3 inside zip** is ON during pack:

1. After normal strip rules, find remaining `*.wav` / `*.WAV` entries among kept files.
2. Decode/encode each with **ffmpeg.wasm** (`@ffmpeg/ffmpeg` + `@ffmpeg/util`) → MP3 (`libmp3lame`, `-q:a 2`).
3. Add the `.mp3` next to where the wav was (same path, `.mp3` extension).
4. **Do not** include the original `.wav` in the output when convert is ON.
5. Progress: `Converting song 2/5…`
6. If a wav fails, keep that wav (listed as a warning) — do not abort the whole zip.

**Precedence:** if both **Remove \*.wav** and **Convert** are ON, **convert wins**.

**Limits / warnings**

- First convert may download ffmpeg core (~25–30 MB) from a CDN (needs network once).
- Many or large WAVs may be slow or hit browser memory (OOM).
- Dev/preview servers set COOP/COEP headers so SharedArrayBuffer works for ffmpeg.wasm.

## Fix broken Vite / Vercel-ready (grok sandbox) — default ON

Grok / Capstiller sandbox zips often ship `package.json` scripts like:

```json
"dev": "node scripts/with-app-env.mjs vite --host 0.0.0.0 --port 8080",
"build": "node scripts/with-app-env.mjs vite build && npm run db:migrate"
```

Outside the sandbox, `scripts/with-app-env.mjs` is missing → **ENOENT**. On Vercel, `db:migrate` in `build` is usually wrong. With this toggle on, the cleaner rewrites **every** `package.json` it finds:

| Script | Result |
|--------|--------|
| `dev` | `vite` or `vite --port 8080` (`--host` dropped unless Keep --host is ON) |
| `build` | **`vite build`** — drops `db:migrate` / `with-app-env` chains and any `vite build && …` tail (unsafe on Vercel) |
| `build:dev` | `vite build --mode development` |
| `preview` | `vite preview` |

Also ensures `vite` is listed in `devDependencies` (`^8.3.0`, or matches an existing version) when a wrapper was rewritten. Leaves `@vitejs/plugin-react` alone if already present.

### vite.config `./scripts/*.mjs` → Vercel-safe (v3.1)

Capstiller apps often have static imports in `vite.config.ts`:

```ts
import { grokPwaPlugin } from "./scripts/grok-pwa-plugin.mjs";
import { appEnvPlugin } from "./scripts/app-env-plugin.mjs";
import { isMigrationFile } from "./scripts/migration-plan.mjs";

export default defineConfig({ /* … plugins: [appEnvPlugin(), grokPwaPlugin()] */ });
```

Vercel/rolldown frequently fails with **`UNRESOLVED_IMPORT` Could not resolve `./scripts/….mjs` in vite.config.ts**.

Auto-fix (same pattern as the manual southern-cap ship):

1. **Inline trivial helpers** when possible (e.g. `isMigrationFile` → `path.endsWith(".sql")`) and drop that static import.
2. Convert remaining `./scripts/*.mjs` plugin imports to **dynamic** `await import(...)` inside `defineConfig(async (...) => { … return { … } })`.
3. If `defineConfig` is already a function callback, make it `async` and dynamic-import plugins before `return`.
4. If the `vite.config` shape is too weird to rewrite safely, **leave the file untouched** and flag in the summary UI: **`vite.config needs manual fix`**.

Most `scripts/*.mjs` files are **not** stripped — dynamic import still needs them in the zip. Exception (grok toggle ON): `*grok-pwa*` and `with-app-env*` are removed as sandbox leftovers; vite.config drops those plugin imports instead of rewriting them to dynamic `import()`.


## GitHub upload helper (default ON)

GitHub’s web **Upload files** UI often misses nested folders when you Ctrl+A. With this toggle on:

1. Prefer [GitHub Desktop](https://desktop.github.com/) — one push, whole tree (shown first in UI + `GITHUB-UPLOAD.txt`).
2. After **Download Vercel-ready zip**, the app shows a **GitHub upload helper** panel with two sections:
   - **Must upload for Vercel** — typically `src/`, `public/`, `server/`, `scripts/`, `migrations/`, `attachments/` (site media used by Capstiller apps), `package.json`, `package-lock.json`, `vite.config.*`, `tsconfig*`, and other root configs that matter.
   - **Optional** — `screenshots/`, `artifacts/`, `AGENTS.md`, `GITHUB-UPLOAD.txt`, and similar non-deploy docs/media.
3. The cleaned zip includes `GITHUB-UPLOAD.txt` at the project root with the same Must / Optional checklist.

This does **not** restructure or flatten `src/` / nesting.

## Base / OKX wallet preview (v3.8, always on with Clean/PWA)

On every successful Clean, after PWA icons/manifest (when enabled) the packager ensures store-style metadata so **Base** Discover/Recents and **OKX** show the app name + image:

| Piece | Behavior |
|-------|----------|
| `og:title` / `twitter:title` / `<title>` | Aligned to PWA **App name** (or existing manifest / HTML title) |
| `og:image` / `twitter:image` | `/og.jpg` — absolute if **Public site URL** is set |
| `og.jpg` | Created from `icon-512.png` / `apple-touch-icon.png` / `icon-192.png` when missing |
| Favicons | Keeps/ensures `/favicon-32.png`; generates `favicon.ico` (PNG-in-ICO) when missing; leaves SVG favicon links alone |
| Manifest | Existing PWA pack `name` / `short_name` / icons unchanged |

Optional **Public site URL** (e.g. `https://your-app.vercel.app`) makes OG/Twitter image URLs absolute for crawlers that do not resolve root-relative paths well.

### Custom output zip name

Optional **Output zip name** on Clean and Tweak. If filled, the download uses that name (`.zip` appended when missing). If empty, Clean keeps `*-vercel.zip` and Tweak keeps its existing suggested name.

### CAPSTILLER Easter egg (default OFF)

Checkbox label exactly: **Want a CAPSTILLER Easteregg?**

When ON, injects:

- `public/cap-easter-egg.png` — transparent Cap cutout
- `public/cap-easter-egg.js` — after load, picks **one** random letter outside links/buttons/inputs/labels (and pointer-cursor controls), wraps it, and on press shows the sticker at **3×** the letter’s rendered height (`pointer-events: none`); hide on release/cancel/leave

Also patches HTML / TanStack `__root` like the password gate. Subtle — no console spam.

## Soft password gate (v3.7, default OFF)


Optional Clean-mode injection. Soft / client-side only — **not real authentication**. Anyone can bypass by disabling JS or inspecting the client. Document that clearly to visitors and Cap.

### Cleaner UI

When **Inject soft password gate** is ON:

| Field | Role |
|-------|------|
| Admin password | Cap keeps; unlocks admin panel + app |
| User password | What normal visitors type |
| Remote config URL | Optional. Live app `fetch`es `{ adminHash, userHash, version }` from this URL on load (cache-bust `?_t=`). |
| Remote write URL | Optional / advanced. Admin “save new user password” **PUT**s then **POST**s updated JSON here; if empty, uses remote config URL. |

Without a remote URL, changing the user password means re-clean + redeploy (or manually replace `gate-config.json`). With remote URL(s), admin can change the **user** password live (admin hash stays put unless you re-clean).

### What gets injected

| Path | Contents |
|------|----------|
| `public/gate-config.json` (or project public / asset root) | `{ "adminHash", "userHash", "version": 1 }` — SHA-256 hex, never plaintext |
| `public/gate-lock.js` | IIFE: full-viewport dark/cyan lock UI, config fetch, verify, `sessionStorage` unlock flags, admin change-password UI |
| `index.html` / `dist/index.html` / root HTML | `<script src="/gate-lock.js" defer></script>` |
| TanStack `src/routes/__root.tsx` (best-effort) | Import + `<GateLock />` before `<Outlet />`; writes `src/components/GateLock.tsx` |

### Remote change flow

1. Host initial `gate-config.json` at a URL that allows CORS from the app origin (and supports PUT/POST if you want live writes — e.g. a small Worker / API, or a gist/raw with a write proxy).
2. Set **Remote config URL** (and optional write URL) in Cleaner before pack.
3. Live app loads → fetches remote config (not the baked file) → compares typed password’s SHA-256 to `userHash` / `adminHash`.
4. Admin unlock → **Change user password** → rehash → PUT/POST updated JSON to write URL (or config URL). No redeploy.
5. If no remote write path: browser downloads updated `gate-config.json` for Cap to upload manually.

### Limitations

- Soft gate only; not authorization, not CSRF-safe, not secret-keeping.
- Remote host must allow CORS; write endpoint must accept PUT or POST JSON.
- Closing the tab clears `sessionStorage` unlock; refresh in-tab stays open.
- Admin password changes still require re-clean (only **user** hash is updated remotely).

## Requirements

- Node.js 18+ (20 recommended)
- npm 9+

## Run (Windows)

In **Command Prompt** or **PowerShell**:

```bat
cd path\to\zip-ship-cleaner
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

### Production build

```bat
npm run build
npm run preview
```

Built files land in `dist\`. Deploy that folder to any static host (Vercel, GitHub Pages, Netlify, etc.).

**Note:** For WAV→MP3 conversion, the host must serve pages with COOP/COEP (or equivalent) so ffmpeg.wasm can use SharedArrayBuffer. Vite `dev` / `preview` already set these headers.

### Tips for Windows paths

- Prefer `cd` into the project folder before `npm` commands.
- If `npm` is not found, reinstall Node from [nodejs.org](https://nodejs.org/) and reopen the terminal.
- PowerShell execution policy errors: run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use Command Prompt.

## Run (macOS / Linux)

```bash
cd zip-ship-cleaner
npm install
npm run dev
```

## Out of scope

- No server or cloud processing
- Standalone audio UI (use Capstiller Audio Converter for single-file convert)
- Service worker (manifest + icons are enough for the home-screen name/icon; a SW is not injected)
- Real authentication / server-side auth (password gate is soft client-side only)

## Stack

Vite + React + TypeScript + Tailwind CSS + `fflate` + canvas (icon gen) + `@ffmpeg/ffmpeg` / `@ffmpeg/util`
