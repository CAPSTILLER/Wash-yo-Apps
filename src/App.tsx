import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BUILD_DIR_NAMES,
  DEFAULT_OPTIONS,
  type CleanOptions,
  type GithubUploadHelper,
  type InjectionSummary,
  type PasswordGateOptions,
  type ScanResult,
  type WavConvertFailure,
  analyzeBackupZips,
  buildCleanZip,
  pullMissingMediaFromZips,
  downloadBlob,
  formatBytes,
  listMediaEntries,
  rescanFiles,
  resolveOutputZipName,
  scanZip,
  suggestOutName,
  wavConvertWarning,
  type CapEasterEggOptions,
  type WalletVisibilityOptions,
} from './lib/cleanZip'
import {
  PWA_THEME,
  defaultShortName,
  describePwaPlan,
  detectProjectLayout,
  type PwaPackOptions,
} from './lib/pwaPack'
import { MediaReview } from './MediaReview'
import { CleanReview, ConfirmClean } from './CleanReview'
import { buildReviewPlan } from './lib/reviewPlan'
import { TweakMode } from './TweakMode'

const HUGE_MB = 80

const TOGGLE_META: {
  key: Exclude<keyof CleanOptions, 'keepHostExpose'>
  label: string
  note?: string
  defaultOn: boolean
}[] = [
  {
    key: 'nodeModules',
    label: 'Remove node_modules/ (any depth)',
    defaultOn: true,
  },
  {
    key: 'buildDirs',
    label: `Remove ${BUILD_DIR_NAMES.map((d) => `${d}/`).join(', ')}`,
    defaultOn: true,
  },
  { key: 'git', label: 'Remove .git/', defaultOn: true },
  {
    key: 'osJunk',
    label: 'Remove __MACOSX/, .DS_Store, Thumbs.db',
    defaultOn: true,
  },
  {
    key: 'vercel',
    label: 'Remove .vercel/',
    note: 'Default ON for a fresh deploy zip — turn off if you need linked project settings.',
    defaultOn: true,
  },
  {
    key: 'grok',
    label: 'Remove .grok/ + grok sandbox leftovers',
    note: 'Default ON. Strips .grok/, __grok/ (e.g. public/__grok/), .sandbox-meta, scripts/*grok-pwa*, server grok-pwa / virtual-grok-og leftovers, and with-app-env* (unused after Fix Vite rewrites to plain vite). Path-based only — does not touch src/ comments that mention grok.',
    defaultOn: true,
  },
  {
    key: 'sandboxCrumbs',
    label: 'Sandbox ID crumbs (.project_id, etc.)',
    note: 'Strips .project_id, .node_modules.lock, .sandbox, .project (any path).',
    defaultOn: true,
  },
  { key: 'logs', label: 'Remove *.log', defaultOn: true },
  {
    key: 'wav',
    label: 'Remove *.wav (optional)',
    note: 'OFF by default. If Convert WAV→MP3 is ON, convert wins (wavs are converted then omitted, not just deleted).',
    defaultOn: false,
  },
  {
    key: 'convertWavToMp3',
    label: 'Convert .wav → .mp3 inside zip',
    note: 'Default OFF. After strip rules, encode kept WAVs with ffmpeg.wasm, add .mp3 next to each path, omit originals. First run downloads ffmpeg core; large zips may be slow/OOM.',
    defaultOn: false,
  },
  {
    key: 'fixViteScripts',
    label: 'Fix broken Vite / Vercel-ready (grok sandbox)',
    note: 'Default ON. Rewrites with-app-env.mjs wrappers → plain vite; simplifies scripts.build that chain db:migrate / with-app-env to `vite build`; rewrites vite.config static ./scripts/*.mjs imports (inline isMigrationFile, dynamic await import plugins) to fix Vercel UNRESOLVED_IMPORT. Does not strip scripts/*.mjs (kept for dynamic import). Also patches --host when Keep --host is OFF.',
    defaultOn: true,
  },
  {
    key: 'githubUploadHelper',
    label: 'GitHub upload helper (checklist + GITHUB-UPLOAD.txt)',
    note: 'Default ON. Does not flatten the tree. After clean, shows Must upload for Vercel vs Optional (screenshots, AGENTS.md, GITHUB-UPLOAD.txt). Injects GITHUB-UPLOAD.txt at project root. Prefer GitHub Desktop for one push of the whole tree.',
    defaultOn: true,
  },
]


function Toggle({
  checked,
  onChange,
  label,
  note,
  disabled,
  accent,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  note?: string
  disabled?: boolean
  accent?: 'cyan' | 'gold' | 'amber'
}) {
  const accentClass =
    accent === 'gold'
      ? 'accent-amber-400'
      : accent === 'amber'
        ? 'accent-amber-500'
        : 'accent-cyan-400'
  return (
    <label
      className={[
        'flex gap-3 items-start rounded-lg border px-3 py-2.5 transition-colors',
        accent === 'gold'
          ? 'border-amber-900/60 bg-amber-950/20'
          : accent === 'amber'
            ? 'border-amber-900/80 bg-amber-950/40'
            : 'border-zinc-800 bg-zinc-900/60',
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : accent === 'gold'
            ? 'cursor-pointer hover:border-amber-700/70'
            : 'cursor-pointer hover:border-zinc-700',
      ].join(' ')}
    >
      <input
        type="checkbox"
        className={`mt-1 size-4 ${accentClass} shrink-0`}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm text-zinc-100">{label}</span>
        {note ? (
          <span className="block text-xs text-zinc-500 mt-0.5">{note}</span>
        ) : null}
      </span>
    </label>
  )
}

function injectionLines(inj: InjectionSummary): string[] {
  const lines: string[] = []
  if (inj.iconsWritten.length > 0) {
    lines.push(`Icons written: ${inj.iconsWritten.join(', ')}`)
  }
  if (inj.manifestPath) {
    lines.push(`Manifest: ${inj.manifestPath}`)
  }
  if (inj.htmlPatched.length > 0) {
    lines.push(`HTML patched: ${inj.htmlPatched.join(', ')}`)
  }
  if (inj.grokHrefsRewritten.length > 0) {
    lines.push(
      `__grok hrefs rewritten: ${inj.grokHrefsRewritten.join(', ')}`,
    )
  }
  if (inj.packageNameSet) {
    lines.push(`package.json name → ${inj.packageNameSet}`)
  }
  if (inj.scriptsFixed.length > 0) {
    lines.push(
      `Vite scripts fixed: ${inj.scriptsFixed.map((s) => `"${s}"`).join(', ')}`,
    )
  }
  if (inj.buildSimplified.length > 0) {
    lines.push(`build → vite build: ${inj.buildSimplified.join(', ')}`)
  }
  if (inj.viteConfigFixed.length > 0) {
    lines.push(`vite.config Vercel fix: ${inj.viteConfigFixed.join(', ')}`)
  }
  if (inj.viteConfigManualFix.length > 0) {
    lines.push(
      `vite.config needs manual fix: ${inj.viteConfigManualFix.join(', ')}`,
    )
  }
  if (inj.hostStripped.length > 0) {
    lines.push(`Host stripped: ${inj.hostStripped.join(', ')}`)
  } else {
    lines.push('Host stripped: none left (or Keep --host was ON)')
  }
  if (inj.wavsConverted > 0) {
    lines.push(`WAVs converted: ${inj.wavsConverted}`)
  }
  if (inj.vercelJsonAdded) {
    lines.push('vercel.json added (static SPA rewrite; no vite.config)')
  } else {
    lines.push('vercel.json skipped (Vite auto-detect, already present, or PWA off)')
  }
  if (inj.pwaSkipped && inj.pwaSkipped !== 'PWA off' && !inj.manifestPath) {
    lines.push(`PWA skipped: ${inj.pwaSkipped}`)
  }
  if (inj.gateConfigPath) {
    lines.push(`Password gate config: ${inj.gateConfigPath}`)
  }
  if (inj.gateScriptPath) {
    lines.push(`Password gate script: ${inj.gateScriptPath}`)
  }
  if (inj.gateHtmlPatched.length > 0) {
    lines.push(`Gate HTML patched: ${inj.gateHtmlPatched.join(', ')}`)
  }
  if (inj.gateTanstackPatched) {
    lines.push(`Gate TanStack: ${inj.gateTanstackPatched}`)
  }
  if (inj.gateRemoteConfigUrl) {
    lines.push(`Gate remote config: ${inj.gateRemoteConfigUrl}`)
  }
  if (
    inj.gateSkipped &&
    inj.gateSkipped !== 'Password gate off' &&
    !inj.gateConfigPath
  ) {
    lines.push(`Password gate skipped: ${inj.gateSkipped}`)
  }
  if (inj.walletTitleUsed) {
    lines.push(`Wallet / store title: ${inj.walletTitleUsed}`)
  }
  if (inj.walletOgImagePath) {
    lines.push(
      `Wallet og:image: ${inj.walletOgImagePath}${
        inj.walletOgImageHref ? ` → ${inj.walletOgImageHref}` : ''
      }`,
    )
  }
  if (inj.walletFaviconIcoPath) {
    lines.push(`Favicon.ico: ${inj.walletFaviconIcoPath}`)
  }
  if (inj.walletHtmlPatched.length > 0) {
    lines.push(`Wallet HTML patched: ${inj.walletHtmlPatched.join(', ')}`)
  }
  if (
    inj.walletSkipped &&
    inj.walletSkipped !== 'Wallet / store preview off' &&
    !inj.walletOgImagePath
  ) {
    lines.push(`Wallet preview skipped: ${inj.walletSkipped}`)
  }
  if (inj.eggAssetPath) {
    lines.push(`CAPSTILLER egg asset: ${inj.eggAssetPath}`)
  }
  if (inj.eggScriptPath) {
    lines.push(`CAPSTILLER egg script: ${inj.eggScriptPath}`)
  }
  if (inj.eggHtmlPatched.length > 0) {
    lines.push(`Egg HTML patched: ${inj.eggHtmlPatched.join(', ')}`)
  }
  if (inj.eggTanstackPatched) {
    lines.push(`Egg TanStack: ${inj.eggTanstackPatched}`)
  }
  if (
    inj.eggSkipped &&
    inj.eggSkipped !== 'CAPSTILLER Easter egg off' &&
    !inj.eggAssetPath
  ) {
    lines.push(`Easter egg skipped: ${inj.eggSkipped}`)
  }
  return lines
}

export default function App() {
  const [mode, setMode] = useState<'clean' | 'tweak'>('clean')
  const [opts, setOpts] = useState<CleanOptions>({ ...DEFAULT_OPTIONS })
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileBytes, setFileBytes] = useState<number>(0)
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [convertFailures, setConvertFailures] = useState<WavConvertFailure[]>(
    [],
  )
  const [injections, setInjections] = useState<InjectionSummary | null>(null)
  const [githubUpload, setGithubUpload] = useState<GithubUploadHelper | null>(
    null,
  )
  /** Paths the user opted to remove in Media review (default: keep all) */
  const [mediaRemovePaths, setMediaRemovePaths] = useState<Set<string>>(
    () => new Set(),
  )
  /** Backup zips (*.zip inside the upload) Cap chose to remove — default keep */
  const [zipRemovePaths, setZipRemovePaths] = useState<Set<string>>(
    () => new Set(),
  )
  const [pullMissing, setPullMissing] = useState(true)
  /** Final confirm step — nothing is removed until Cap confirms */
  const [confirming, setConfirming] = useState(false)

  const [appName, setAppName] = useState('')
  const [shortName, setShortName] = useState('')
  const [iconPreview, setIconPreview] = useState<string | null>(null)
  const [iconBytes, setIconBytes] = useState<Uint8Array | null>(null)
  const [iconMime, setIconMime] = useState('image/png')
  const [addPwa, setAddPwa] = useState(false)
  const pwaUserOverride = useRef(false)

  const [addGate, setAddGate] = useState(false)
  const [gateAdminPassword, setGateAdminPassword] = useState('')
  const [gateUserPassword, setGateUserPassword] = useState('')
  const [gateRemoteConfigUrl, setGateRemoteConfigUrl] = useState('')
  const [gateRemoteWriteUrl, setGateRemoteWriteUrl] = useState('')

  const [publicSiteUrl, setPublicSiteUrl] = useState('')
  const [outputZipName, setOutputZipName] = useState('')
  const [wantCapEasterEgg, setWantCapEasterEgg] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const iconInputRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<Record<string, Uint8Array> | null>(null)

  const clearIcon = useCallback(() => {
    setIconPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setIconBytes(null)
    setIconMime('image/png')
    if (iconInputRef.current) iconInputRef.current.value = ''
  }, [])

  const clearAll = useCallback(() => {
    filesRef.current = null
    setScan(null)
    setFileName(null)
    setFileBytes(0)
    setError(null)
    setStatus(null)
    setConvertFailures([])
    setInjections(null)
    setGithubUpload(null)
    setMediaRemovePaths(new Set())
    setZipRemovePaths(new Set())
    setPullMissing(true)
    setConfirming(false)
    setBusy(false)
    setOutputZipName('')
    if (inputRef.current) inputRef.current.value = ''
  }, [])

  useEffect(() => {
    const onUnload = () => {
      filesRef.current = null
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      filesRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (iconPreview) URL.revokeObjectURL(iconPreview)
    }
  }, [iconPreview])

  const maybeEnablePwa = (name: string, hasIcon: boolean) => {
    if (!pwaUserOverride.current && name.trim() && hasIcon) {
      setAddPwa(true)
    }
  }

  const loadZip = useCallback(
    async (file: File) => {
      setError(null)
      setStatus(null)
      setConvertFailures([])
      setInjections(null)
      setGithubUpload(null)
      setMediaRemovePaths(new Set())
      setZipRemovePaths(new Set())
      setPullMissing(true)
      setConfirming(false)
      if (!file.name.toLowerCase().endsWith('.zip')) {
        setError('Please upload a .zip file.')
        return
      }
      const huge = file.size > HUGE_MB * 1024 * 1024
      setBusy(true)
      setFileName(file.name)
      setFileBytes(file.size)
      try {
        if (huge) {
          setStatus(
            `Warning: zip is ${formatBytes(file.size)} (>${HUGE_MB} MB). Browser may struggle — still trying…`,
          )
        } else {
          setStatus('Reading zip…')
        }
        const buf = new Uint8Array(await file.arrayBuffer())
        setStatus('Scanning entries…')
        await new Promise((r) => setTimeout(r, 20))
        const result = scanZip(buf, opts)
        filesRef.current = result.files
        setScan(result)
        setStatus(
          huge
            ? `Loaded (large file). ${result.totalEntries} entries.`
            : `Loaded ${result.totalEntries} entries.`,
        )
      } catch (e) {
        console.error(e)
        clearAll()
        setError(
          e instanceof Error
            ? `Failed to read zip: ${e.message}`
            : 'Failed to read zip.',
        )
      } finally {
        setBusy(false)
      }
    },
    [opts, clearAll],
  )

  useEffect(() => {
    if (!filesRef.current) return
    setScan(rescanFiles(filesRef.current, opts))
  }, [opts])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const f = e.dataTransfer.files?.[0]
      if (f) void loadZip(f)
    },
    [loadZip],
  )

  const pwaOpts: PwaPackOptions = useMemo(
    () => ({
      enabled: addPwa,
      appName: appName.trim(),
      shortName: shortName.trim(),
      icon:
        iconBytes && iconBytes.byteLength > 0
          ? { bytes: iconBytes, mime: iconMime }
          : null,
    }),
    [addPwa, appName, shortName, iconBytes, iconMime],
  )

  const gateOpts: PasswordGateOptions = useMemo(
    () => ({
      enabled: addGate,
      adminPassword: gateAdminPassword,
      userPassword: gateUserPassword,
      remoteConfigUrl: gateRemoteConfigUrl,
      remoteWriteUrl: gateRemoteWriteUrl,
    }),
    [
      addGate,
      gateAdminPassword,
      gateUserPassword,
      gateRemoteConfigUrl,
      gateRemoteWriteUrl,
    ],
  )

  const walletOpts: WalletVisibilityOptions = useMemo(
    () => ({
      enabled: true,
      appName: appName.trim(),
      shortName: shortName.trim(),
      publicSiteUrl: publicSiteUrl.trim(),
    }),
    [appName, shortName, publicSiteUrl],
  )

  const eggOpts: CapEasterEggOptions = useMemo(
    () => ({ enabled: wantCapEasterEgg }),
    [wantCapEasterEgg],
  )

  const onPackDownload = useCallback(async () => {
    if (!filesRef.current || !fileName) return
    if (addPwa && !appName.trim()) {
      setError('App name is required for PWA / install metadata.')
      return
    }
    if (addPwa && !iconBytes) {
      setError('Upload an icon (png / jpg / webp) for install icons.')
      return
    }
    if (addGate && !gateAdminPassword.trim()) {
      setError('Admin password is required when password gate is ON.')
      return
    }
    if (addGate && !gateUserPassword.trim()) {
      setError('User password is required when password gate is ON.')
      return
    }
    setBusy(true)
    setError(null)
    setConvertFailures([])
    setInjections(null)
    setGithubUpload(null)
    try {
      setStatus('Building Vercel-ready zip…')
      const removeSet = new Set([...mediaRemovePaths, ...zipRemovePaths])
      const pulled =
        pullMissing && zipRemovePaths.size > 0
          ? pullMissingMediaFromZips(filesRef.current, zipRemovePaths)
          : null
      const {
        zip: out,
        converted,
        failures,
        injections: inj,
        githubUpload: gh,
      } = await buildCleanZip(
        filesRef.current,
        opts,
        (p) => setStatus(p.message),
        pwaOpts,
        removeSet,
        gateOpts,
        walletOpts,
        eggOpts,
        pulled,
      )
      setConvertFailures(failures)
      setInjections(inj)
      setGithubUpload(gh)
      const outName = resolveOutputZipName(outputZipName, suggestOutName(fileName))
      downloadBlob(out, outName)
      setConfirming(false)
      const extra: string[] = []
      const pulledN = pulled ? Object.keys(pulled).length : 0
      if (pulledN > 0) extra.push(`pulled ${pulledN} image(s) out of backup zips`)
      if (opts.fixViteScripts && scan?.viteScriptFix.willApply) {
        extra.push('Vite scripts fixed')
      }
      if (inj.hostStripped.length > 0) extra.push('host stripped')
      if (inj.iconsWritten.length > 0) extra.push('icons + manifest')
      if (inj.walletOgImagePath) extra.push('wallet / store preview')
      if (inj.gateConfigPath) extra.push('password gate')
      if (inj.eggAssetPath) extra.push('CAPSTILLER egg')
      if (opts.convertWavToMp3 && (converted > 0 || failures.length > 0)) {
        extra.push(
          `converted ${converted} WAV→MP3${
            failures.length > 0
              ? `; ${failures.length} failed (kept as WAV)`
              : ''
          }`,
        )
      }
      setStatus(
        `Downloaded ${outName} (${formatBytes(out.byteLength)} compressed)${
          extra.length ? ` — ${extra.join(', ')}.` : '.'
        }`,
      )
    } catch (e) {
      console.error(e)
      setError(
        e instanceof Error
          ? `Failed to build zip: ${e.message}`
          : 'Failed to build zip.',
      )
    } finally {
      setBusy(false)
    }
  }, [fileName, opts, scan, addPwa, appName, iconBytes, pwaOpts, mediaRemovePaths, addGate, gateAdminPassword, gateUserPassword, gateOpts, walletOpts, eggOpts, outputZipName, zipRemovePaths, pullMissing])

  const setOpt = (key: keyof CleanOptions, value: boolean) => {
    setOpts((prev) => ({ ...prev, [key]: value }))
  }

  const onIconFile = useCallback(async (file: File) => {
    const ok =
      /image\/(png|jpeg|jpg|webp)/i.test(file.type) ||
      /\.(png|jpe?g|webp)$/i.test(file.name)
    if (!ok) {
      setError('Icon must be png, jpg, or webp.')
      return
    }
    setError(null)
    const bytes = new Uint8Array(await file.arrayBuffer())
    setIconBytes(bytes)
    setIconMime(file.type || 'image/png')
    const url = URL.createObjectURL(file)
    setIconPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return url
    })
    maybeEnablePwa(appName, true)
  }, [appName])

  const convertWarn = useMemo(() => {
    if (!scan || !opts.convertWavToMp3) return null
    return wavConvertWarning(scan.wavConvertCandidates)
  }, [scan, opts.convertWavToMp3])

  const layout = useMemo(() => {
    if (!scan) return null
    return detectProjectLayout(scan.files)
  }, [scan])

  const pwaPlan = useMemo(() => {
    if (!layout) return null
    return describePwaPlan(layout, pwaOpts)
  }, [layout, pwaOpts])

  const mediaEntries = useMemo(() => {
    if (!scan) return []
    return listMediaEntries(scan.files, opts)
  }, [scan, opts])

  const mediaRemoveSize = useMemo(() => {
    let size = 0
    let count = 0
    for (const e of mediaEntries) {
      if (mediaRemovePaths.has(e.path)) {
        size += e.size
        count += 1
      }
    }
    return { size, count }
  }, [mediaEntries, mediaRemovePaths])

  const backupZips = useMemo(
    () => (scan ? analyzeBackupZips(scan.files) : []),
    [scan],
  )

  const reviewPlan = useMemo(() => {
    if (!scan) return null
    return buildReviewPlan(
      scan,
      { mediaRemove: mediaRemovePaths, zipRemove: zipRemovePaths, pullMissing },
      backupZips,
    )
  }, [scan, mediaRemovePaths, zipRemovePaths, pullMissing, backupZips])

  const openConfirm = () => {
    setConfirming(true)
    requestAnimationFrame(() =>
      document
        .getElementById('confirm-clean')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    )
  }

  const shortPlaceholder = defaultShortName(appName) || 'e.g. Gear Up'

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className={`mx-auto px-4 py-10 ${mode === 'tweak' ? 'max-w-6xl' : 'max-w-3xl'}`}>
        <header className="mb-8">
          <p className="text-xs uppercase tracking-widest text-amber-400/90 mb-2">
            Capstiller Vercel Ship Packager
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            Zip Ship Cleaner
          </h1>
          <p className="mt-2 text-zinc-400 text-sm leading-relaxed max-w-2xl">
            Drop a project zip, give it an app name and icon, download a cleaned
            zip ready for Vercel. Install metadata (manifest + icons) so device
            home screens show the name under the icon. Everything stays in this
            browser. v3.9.0 never auto-removes images, sounds, public/ or files your code uses, groups everything into a clear review list, and asks before removing anything. v3.8.0 bakes <span className="text-amber-300">Base / OKX wallet preview</span> (Open Graph + Twitter + og.jpg) into Clean/PWA, optional custom output zip name, and an optional <span className="text-cyan-300">CAPSTILLER Easter egg</span>. Soft password gate (v3.7) still available. Tweak mode and Clean still rewrite
            leftover <span className="text-zinc-300">/__grok/</span> hrefs,
            Media review, grok leftovers strip, GitHub helper, Vercel fixes, and
            force-strips{' '}
            <span className="text-zinc-300">--host / 0.0.0.0</span> by default.
          </p>

          <div
            className="mt-6 inline-flex rounded-lg border border-zinc-800 bg-zinc-900/80 p-1 gap-1"
            role="tablist"
            aria-label="Mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'clean'}
              onClick={() => setMode('clean')}
              className={[
                'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                mode === 'clean'
                  ? 'bg-amber-500/20 text-amber-200 border border-amber-700/50'
                  : 'text-zinc-400 hover:text-zinc-200 border border-transparent',
              ].join(' ')}
            >
              Clean
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'tweak'}
              onClick={() => setMode('tweak')}
              className={[
                'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                mode === 'tweak'
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-700/50'
                  : 'text-zinc-400 hover:text-zinc-200 border border-transparent',
              ].join(' ')}
            >
              Tweak
            </button>
          </div>
        </header>

        {mode === 'tweak' ? (
          <TweakMode />
        ) : (
        <>
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={[
            'rounded-xl border-2 border-dashed px-6 py-12 text-center cursor-pointer transition-colors',
            dragOver
              ? 'border-amber-400 bg-amber-400/10'
              : 'border-zinc-700 bg-zinc-900/40 hover:border-zinc-500',
          ].join(' ')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void loadZip(f)
            }}
          />
          <p className="text-lg text-zinc-200">
            Drop a <span className="text-amber-300">.zip</span> here, or click
            to browse
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            Client-side only (fflate + canvas + optional ffmpeg.wasm). Cleared
            when you close the page.
          </p>
          {fileBytes > HUGE_MB * 1024 * 1024 ? (
            <p className="mt-3 text-amber-400 text-sm">
              Large zip detected (&gt;{HUGE_MB} MB) — browser may struggle, but
              we&apos;ll try.
            </p>
          ) : null}
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}
        {status ? (
          <p className="mt-3 text-sm text-zinc-400">{status}</p>
        ) : null}

        <section className="mt-8">
          <h2 className="text-sm font-medium text-amber-200/90 mb-1">
            Vercel / Install
          </h2>
          <p className="text-xs text-zinc-500 mb-3">
            Required for home-screen install name + icon. Toggle turns ON
            automatically when both name and icon are set.
          </p>
          <div className="rounded-xl border border-amber-900/50 bg-gradient-to-b from-amber-950/30 to-zinc-900/40 p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-amber-200/70">
                  App name <span className="text-amber-400">required</span>
                </span>
                <input
                  type="text"
                  value={appName}
                  onChange={(e) => {
                    const v = e.target.value
                    setAppName(v)
                    maybeEnablePwa(v, !!iconBytes)
                  }}
                  placeholder="Gear Up"
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/70 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-zinc-500">
                  Short name <span className="text-zinc-600">optional</span>
                </span>
                <input
                  type="text"
                  value={shortName}
                  onChange={(e) => setShortName(e.target.value)}
                  placeholder={shortPlaceholder}
                  maxLength={12}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/70 focus:outline-none"
                />
                <span className="mt-0.5 block text-[11px] text-zinc-600">
                  Defaults to a 12-char truncation of the app name. Used as
                  manifest short_name under the icon.
                </span>
              </label>
            </div>

            <div className="flex flex-wrap items-start gap-4">
              <div className="flex-1 min-w-[12rem]">
                <span className="text-xs uppercase tracking-wide text-amber-200/70">
                  Icon
                </span>
                <div className="mt-1 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => iconInputRef.current?.click()}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 hover:border-amber-600/60"
                  >
                    Upload png / jpg / webp
                  </button>
                  {iconBytes ? (
                    <button
                      type="button"
                      onClick={clearIcon}
                      className="text-xs text-zinc-500 hover:text-zinc-300 underline"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <input
                  ref={iconInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void onIconFile(f)
                  }}
                />
              </div>
              {iconPreview ? (
                <div className="shrink-0">
                  <div
                    className="size-20 rounded-2xl border border-amber-800/60 overflow-hidden shadow-lg"
                    style={{ background: '#0c0a09' }}
                  >
                    <img
                      src={iconPreview}
                      alt="Icon preview"
                      className="size-full object-cover"
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-center text-zinc-500">
                    Preview
                  </p>
                </div>
              ) : (
                <div
                  className="size-20 rounded-2xl border border-dashed border-zinc-700 grid place-items-center text-[11px] text-zinc-600"
                  style={{ background: '#0c0a09' }}
                >
                  no icon
                </div>
              )}
            </div>

            <Toggle
              checked={addPwa}
              onChange={(v) => {
                pwaUserOverride.current = true
                setAddPwa(v)
              }}
              accent="gold"
              label="Add PWA install icons + manifest"
              note={`Default ON once name + icon are provided. Writes icon-192/512, apple-touch-icon (180), favicon-32, favicon.ico, og.jpg, manifest.webmanifest, Open Graph + Twitter tags for Base/OKX, and patches index.html. Theme ${PWA_THEME} on dark gold Capstiller defaults.`}
            />

            {pwaPlan ? (
              <p className="text-xs text-amber-200/80">{pwaPlan}</p>
            ) : null}

            <label className="block">
              <span className="text-xs uppercase tracking-wide text-zinc-500">
                Public site URL{' '}
                <span className="text-zinc-600">optional · Base / OKX</span>
              </span>
              <input
                type="url"
                value={publicSiteUrl}
                onChange={(e) => setPublicSiteUrl(e.target.value)}
                placeholder="https://your-app.vercel.app"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/70 focus:outline-none"
              />
              <span className="mt-0.5 block text-[11px] text-zinc-600">
                When set, og:image / twitter:image use absolute URLs. When empty,
                root-relative /og.jpg (and matching title tags) are injected so
                Base Discover and OKX can still resolve after deploy.
              </span>
            </label>

            <label className="block">
              <span className="text-xs uppercase tracking-wide text-zinc-500">
                Output zip name{' '}
                <span className="text-zinc-600">optional</span>
              </span>
              <input
                type="text"
                value={outputZipName}
                onChange={(e) => setOutputZipName(e.target.value)}
                placeholder={
                  fileName
                    ? suggestOutName(fileName)
                    : 'my-app-vercel.zip'
                }
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/70 focus:outline-none"
              />
              <span className="mt-0.5 block text-[11px] text-zinc-600">
                If empty, keeps the suggested name. .zip is appended when missing.
              </span>
            </label>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-medium text-cyan-200/90 mb-1">
            Password gate <span className="text-zinc-500 font-normal">(optional)</span>
          </h2>
          <p className="text-xs text-zinc-500 mb-3">
            Soft client-side gate only — not real authentication. Hashes are
            SHA-256 (Web Crypto); plaintext never goes in the zip. Keep the{' '}
            <span className="text-cyan-300">admin</span> password private.
            Without a remote config URL, changing the user password requires
            re-clean / redeploy. With a remote URL, admin can change the user
            password live.
          </p>
          <div className="rounded-xl border border-cyan-900/50 bg-gradient-to-b from-cyan-950/25 to-zinc-900/40 p-4 space-y-3">
            <Toggle
              checked={addGate}
              onChange={setAddGate}
              accent="cyan"
              label="Inject soft password gate"
              note="Default OFF. Writes public/gate-config.json + gate-lock.js and patches index.html (and TanStack __root when present)."
            />
            {addGate ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs uppercase tracking-wide text-cyan-200/70">
                      Admin password <span className="text-cyan-400">required</span>
                    </span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={gateAdminPassword}
                      onChange={(e) => setGateAdminPassword(e.target.value)}
                      placeholder="Cap keeps this"
                      className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500/70 focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs uppercase tracking-wide text-cyan-200/70">
                      User password <span className="text-cyan-400">required</span>
                    </span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={gateUserPassword}
                      onChange={(e) => setGateUserPassword(e.target.value)}
                      placeholder="Visitors type this"
                      className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500/70 focus:outline-none"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="text-xs uppercase tracking-wide text-zinc-500">
                    Remote config URL{' '}
                    <span className="text-zinc-600">optional</span>
                  </span>
                  <input
                    type="url"
                    value={gateRemoteConfigUrl}
                    onChange={(e) => setGateRemoteConfigUrl(e.target.value)}
                    placeholder="https://…/gate-config.json"
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500/70 focus:outline-none"
                  />
                  <span className="mt-0.5 block text-[11px] text-zinc-600">
                    Live app fetches this on load (cache-bust query). Host JSON
                    at {'{'} adminHash, userHash, version: 1 {'}'}. CORS must
                    allow the app origin.
                  </span>
                </label>
                <label className="block">
                  <span className="text-xs uppercase tracking-wide text-zinc-500">
                    Remote write URL{' '}
                    <span className="text-zinc-600">optional · advanced</span>
                  </span>
                  <input
                    type="url"
                    value={gateRemoteWriteUrl}
                    onChange={(e) => setGateRemoteWriteUrl(e.target.value)}
                    placeholder="Defaults to remote config URL (PUT then POST)"
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500/70 focus:outline-none"
                  />
                </label>
                <p className="text-[11px] text-amber-200/80 leading-relaxed rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2">
                  Soft gate warning: anyone can bypass client checks. Remote
                  config is required for live user-password changes without
                  redeploy. Keep the admin password private.
                </p>
              </>
            ) : null}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-medium text-fuchsia-200/90 mb-1">
            Easter egg <span className="text-zinc-500 font-normal">(optional)</span>
          </h2>
          <p className="text-xs text-zinc-500 mb-3">
            Subtle Cap cutout sticker on one random letter — press and hold.
            Default OFF.
          </p>
          <div className="rounded-xl border border-fuchsia-900/40 bg-gradient-to-b from-fuchsia-950/20 to-zinc-900/40 p-4 space-y-3">
            <Toggle
              checked={wantCapEasterEgg}
              onChange={setWantCapEasterEgg}
              accent="cyan"
              label="Want a CAPSTILLER Easteregg?"
              note="Injects public/cap-easter-egg.png + cap-easter-egg.js. One non-interactive letter shows Cap at 3× size while pressed."
            />
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-medium text-zinc-300 mb-3">
            Strip options
          </h2>
          <div className="grid gap-2 sm:grid-cols-1">
            {TOGGLE_META.map((t) => (
              <Toggle
                key={t.key}
                checked={opts[t.key]}
                onChange={(v) => setOpt(t.key, v)}
                label={t.label}
                note={t.note}
              />
            ))}
          </div>
          <div className="mt-3">
            <p className="text-[11px] uppercase tracking-wide text-amber-700/90 mb-1.5">
              Advanced — not recommended
            </p>
            <Toggle
              checked={opts.keepHostExpose}
              onChange={(v) => setOpt('keepHostExpose', v)}
              accent="amber"
              label="Keep --host / 0.0.0.0 expose"
              note="Default OFF and should stay off for Vercel. Host is force-stripped from every package.json script, vite.config server/preview.host, and scripts/with-app-env.mjs (plus other files under scripts/) unless you turn this on. Local vite and Vercel do not need bind-all."
            />
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Never removes package.json, src/, public assets, mp3, images, or
            most{' '}
            <span className="text-zinc-400">scripts/*.mjs</span> (including{' '}
            <span className="text-zinc-400">migration-plan.mjs</span> — needed
            when vite.config dynamic-imports plugins). Exception when grok strip
            is ON: removes <span className="text-zinc-400">*grok-pwa*</span> and{' '}
            <span className="text-zinc-400">with-app-env*</span> path leftovers.
            *.wav only if you enable removal (or convert, which replaces wav with
            mp3).
          </p>
        </section>

        {scan && fileName ? (
          <section className="mt-8 space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                <h2 className="text-lg font-medium text-white truncate">
                  {fileName}
                </h2>
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-xs text-zinc-500 hover:text-zinc-300 underline"
                >
                  Clear
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <Stat label="Entries" value={String(scan.totalEntries)} />
                <Stat
                  label="Uncompressed"
                  value={formatBytes(scan.totalSize)}
                />
                <Stat
                  label="Will remove"
                  value={`${reviewPlan?.removeCount ?? scan.removeCount} · ${formatBytes(reviewPlan?.removeSize ?? scan.removeSize)}`}
                  accent="amber"
                />
                <Stat
                  label="After (est.)"
                  value={`${reviewPlan?.keepCount ?? scan.keepCount} · ${formatBytes(reviewPlan?.keepSize ?? scan.keepSize)}`}
                  accent="cyan"
                />
              </div>

              {opts.convertWavToMp3 &&
              scan.wavConvertCandidates.length > 0 ? (
                <div className="mt-4 rounded-lg border border-violet-800/50 bg-violet-950/30 px-3 py-2.5 text-sm text-violet-200">
                  <span className="font-medium text-violet-300">
                    WAV → MP3 conversion queued
                  </span>
                  <span className="block text-xs text-violet-200/80 mt-1">
                    {scan.wavConvertCandidates.length} file
                    {scan.wavConvertCandidates.length === 1 ? '' : 's'} (
                    {formatBytes(
                      scan.wavConvertCandidates.reduce((s, c) => s + c.size, 0),
                    )}
                    ) will encode during pack. Originals omitted from output.
                    Failed conversions keep the WAV and are listed below.
                  </span>
                </div>
              ) : opts.convertWavToMp3 ? (
                <p className="mt-4 text-xs text-zinc-500">
                  Convert WAV→MP3 is ON, but no kept *.wav files were found.
                </p>
              ) : null}

              {convertWarn ? (
                <div className="mt-3 rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2.5 text-sm text-amber-200">
                  {convertWarn}
                </div>
              ) : null}

              {scan.viteScriptFix.willApply && scan.viteScriptFix.summary ? (
                <div className="mt-4 rounded-lg border border-cyan-800/50 bg-cyan-950/30 px-3 py-2.5 text-sm text-cyan-200">
                  <span className="font-medium text-cyan-300">
                    {scan.viteScriptFix.viteConfigManualFix.length > 0 &&
                    scan.viteScriptFix.viteConfigFixed.length === 0 &&
                    scan.viteScriptFix.scriptsChanged.length === 0 &&
                    scan.viteScriptFix.buildSimplified.length === 0
                      ? 'vite.config needs manual fix'
                      : 'Vite / Vercel fix will be applied'}
                  </span>
                  <span className="block text-xs text-cyan-200/80 mt-1">
                    {scan.viteScriptFix.summary}
                  </span>
                  {scan.viteScriptFix.viteConfigManualFix.length > 0 ? (
                    <span className="block text-xs text-amber-200/90 mt-1.5">
                      Shape too unusual to rewrite safely — left untouched:{' '}
                      {scan.viteScriptFix.viteConfigManualFix.join(', ')}. Inline
                      trivial helpers / convert ./scripts imports to dynamic
                      await import inside defineConfig(async …) manually.
                    </span>
                  ) : null}
                </div>
              ) : opts.fixViteScripts ? (
                <p className="mt-4 text-xs text-zinc-500">
                  No with-app-env wrappers, unsafe build chains, or static
                  ./scripts imports in vite.config detected.
                </p>
              ) : null}

              {scan.hostStrip.willApply && scan.hostStrip.summary ? (
                <div className="mt-3 rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2.5 text-sm text-amber-100">
                  <span className="font-medium text-amber-200">
                    --host / 0.0.0.0 will be stripped
                  </span>
                  <span className="block text-xs text-amber-200/80 mt-1">
                    {scan.hostStrip.summary}
                    {opts.fixViteScripts
                      ? ' Also rewrites vite.config host and patches script files (with-app-env.mjs).'
                      : ' package.json scripts only (turn on Fix Vite to also patch vite.config + scripts/).'}
                  </span>
                </div>
              ) : opts.keepHostExpose ? (
                <p className="mt-3 text-xs text-amber-600">
                  Keep --host is ON — bind-all will remain in the zip. Turn it
                  off for Vercel.
                </p>
              ) : (
                <p className="mt-3 text-xs text-zinc-500">
                  No --host / 0.0.0.0 leftovers detected in package.json
                  {opts.fixViteScripts ? ', vite.config, or scripts/' : ''}.
                </p>
              )}

              {mediaRemoveSize.count > 0 ? (
                <p className="mt-3 text-xs text-rose-300/90">
                  Media review: +{mediaRemoveSize.count} file
                  {mediaRemoveSize.count === 1 ? '' : 's'} ·{' '}
                  {formatBytes(mediaRemoveSize.size)} will be omitted from the
                  clean zip.
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-3 items-center">
                <button
                  type="button"
                  disabled={
                    busy ||
                    confirming ||
                    (reviewPlan ? reviewPlan.keepCount <= 0 : true)
                  }
                  onClick={openConfirm}
                  className="rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-semibold px-5 py-3 text-sm transition-colors"
                >
                  {busy ? 'Working…' : 'Clean & download…'}
                </button>
                <span className="text-xs text-zinc-500">
                  Archive on disk: {formatBytes(fileBytes)} → output is freshly
                  compressed from kept files.
                </span>
              </div>
            </div>

            {confirming && reviewPlan ? (
              <ConfirmClean
                plan={reviewPlan}
                busy={busy}
                onConfirm={() => void onPackDownload()}
                onBack={() => setConfirming(false)}
              />
            ) : null}

            {reviewPlan ? (
              <CleanReview
                plan={reviewPlan}
                zips={backupZips}
                zipRemove={zipRemovePaths}
                onZipRemove={setZipRemovePaths}
                pullMissing={pullMissing}
                onPullMissing={setPullMissing}
              />
            ) : null}

            <MediaReview
              entries={mediaEntries}
              files={filesRef.current}
              removePaths={mediaRemovePaths}
              onChangeRemovePaths={setMediaRemovePaths}
            />

            {injections ? (
              <div className="rounded-xl border border-amber-900/40 bg-amber-950/15 p-5">
                <h3 className="text-sm font-medium text-amber-200 mb-3">
                  Injection summary
                </h3>
                <ul className="space-y-1.5 text-sm text-zinc-300">
                  {injectionLines(injections).map((line) => (
                    <li key={line} className="flex gap-2">
                      <span className="text-amber-500/80">·</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {githubUpload ? (
              <div className="rounded-xl border border-sky-900/50 bg-sky-950/20 p-5">
                <h3 className="text-sm font-medium text-sky-200 mb-2">
                  GitHub upload helper
                </h3>
                <p className="text-xs text-sky-100/80 leading-relaxed mb-3">
                  Prefer{' '}
                  <a
                    href="https://desktop.github.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-300 underline hover:text-sky-200"
                  >
                    GitHub Desktop
                  </a>{' '}
                  — one push, whole tree. Web Upload with Ctrl+A often skips
                  nested folders. Also wrote{' '}
                  <span className="font-mono text-sky-200">
                    {githubUpload.helperPath}
                  </span>{' '}
                  into the zip.
                </p>
                <div className="grid gap-5 sm:grid-cols-2 text-sm">
                  <div className="rounded-lg border border-sky-800/40 bg-sky-950/30 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-emerald-400/90 mb-2">
                      Must upload for Vercel
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-sky-500/80 mb-1">
                      Folders
                    </p>
                    {githubUpload.mustFolders.length > 0 ? (
                      <ul className="space-y-1 font-mono text-xs text-sky-100/90 mb-3">
                        {githubUpload.mustFolders.map((f) => (
                          <li key={`m-f-${f}`} className="flex gap-2">
                            <span className="text-emerald-500">·</span>
                            <span>{f}/</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-zinc-500 mb-3">(none)</p>
                    )}
                    <p className="text-[10px] uppercase tracking-wide text-sky-500/80 mb-1">
                      Root files
                    </p>
                    {githubUpload.mustFiles.length > 0 ? (
                      <ul className="space-y-1 font-mono text-xs text-sky-100/90 max-h-40 overflow-auto">
                        {githubUpload.mustFiles.map((f) => (
                          <li key={`m-r-${f}`} className="flex gap-2">
                            <span className="text-emerald-500">·</span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-zinc-500">(none)</p>
                    )}
                  </div>
                  <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-zinc-400 mb-2">
                      Optional
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">
                      Folders
                    </p>
                    {githubUpload.optionalFolders.length > 0 ? (
                      <ul className="space-y-1 font-mono text-xs text-zinc-400 mb-3">
                        {githubUpload.optionalFolders.map((f) => (
                          <li key={`o-f-${f}`} className="flex gap-2">
                            <span className="text-zinc-600">·</span>
                            <span>{f}/</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-zinc-600 mb-3">(none)</p>
                    )}
                    <p className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">
                      Root files
                    </p>
                    {githubUpload.optionalFiles.length > 0 ? (
                      <ul className="space-y-1 font-mono text-xs text-zinc-400 max-h-40 overflow-auto">
                        {githubUpload.optionalFiles.map((f) => (
                          <li key={`o-r-${f}`} className="flex gap-2">
                            <span className="text-zinc-600">·</span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-zinc-600">(none)</p>
                    )}
                  </div>
                </div>
                <p className="mt-3 text-xs text-zinc-500">
                  After extract, open
                  {githubUpload.projectRoot
                    ? ` the "${githubUpload.projectRoot}" folder`
                    : ' the zip root'}{' '}
                  and drag Must items onto GitHub (attachments/ is Must when the
                  site uses those media files). Or use Desktop / git push for the
                  whole tree.
                </p>
              </div>
            ) : null}

            {convertFailures.length > 0 ? (
              <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-5">
                <h3 className="text-sm font-medium text-amber-200 mb-3">
                  WAV conversion warnings ({convertFailures.length})
                </h3>
                <ul className="space-y-1.5 text-xs font-mono text-amber-200/80 max-h-40 overflow-auto">
                  {convertFailures.map((f) => (
                    <li key={f.path}>
                      <span className="text-amber-100">{f.path}</span>
                      <span className="text-zinc-500"> — {f.error}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-zinc-500">
                  Failed WAVs were kept in the output zip; the rest of the pack
                  completed.
                </p>
              </div>
            ) : null}

          </section>
        ) : null}

        </>
        )}

        <footer className="mt-12 pt-6 border-t border-zinc-900 text-xs text-zinc-600">
          Zip Ship Cleaner v3.9.0 · Protected images + confirm step · Capstiller Vercel Ship Packager · No server
          · Privacy: data stays in this tab · Clean + Tweak modes · Rewrites
          /__grok/ icon+manifest hrefs · Media review · PWA install icons ·
          Force-strips --host · Vercel UNRESOLVED_IMPORT fixes · Grok leftovers
          · Optional WAV→MP3 · Soft password gate · GitHub helper
        </footer>

        <a
          className="gear-home-cutout fixed bottom-3 left-1/2 z-40 inline-flex -translate-x-1/2 opacity-90 transition-opacity hover:opacity-100 active:opacity-70 focus-visible:opacity-100"
          href="https://landonthis.gearup.wtf"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Gear home — landonthis"
        >
          <img
            src="/gear-logo-cutout.png"
            alt=""
            height={56}
            width={213}
            className="h-14 w-auto"
            style={{ imageRendering: 'pixelated' }}
          />
        </a>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: 'cyan' | 'amber'
}) {
  const valueClass =
    accent === 'cyan'
      ? 'text-cyan-300'
      : accent === 'amber'
        ? 'text-amber-300'
        : 'text-white'
  return (
    <div className="rounded-lg bg-zinc-950/60 border border-zinc-800 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className={`mt-0.5 font-medium tabular-nums ${valueClass}`}>
        {value}
      </div>
    </div>
  )
}
