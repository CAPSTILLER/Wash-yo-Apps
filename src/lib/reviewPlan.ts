import {
  basename,
  normalizePath,
  pathParts,
} from './zipPaths'
import {
  isBackupZipPath,
  isProtectedMediaPath,
  mediaKindFromPath,
  planMediaPulls,
  type BackupZipInfo,
  type ProtectReason,
  type RemovalBucket,
  type ScanResult,
} from './cleanZip'

/** Plain-words review groups shown before anything is removed (v3.9). */

export type ReviewFile = {
  path: string
  size: number
  protectedBy: ProtectReason | null
  bucket: RemovalBucket | null
}

export type ReviewGroupId =
  | 'remove-junk'
  | 'remove-wav'
  | 'remove-media'
  | 'remove-zips'
  | 'keep-zips'
  | 'keep-media'
  | 'keep-code'
  | 'keep-other'

export type ReviewGroup = {
  id: ReviewGroupId
  title: string
  note: string
  tone: 'remove' | 'warn' | 'keep'
  files: ReviewFile[]
  count: number
  size: number
}

export type ReviewPlan = {
  groups: ReviewGroup[]
  removeCount: number
  removeSize: number
  keepCount: number
  keepSize: number
  /** Images / sounds that will be dropped (your overrides or the WAV opt-in) */
  mediaWarnings: ReviewFile[]
  /** Plain-words notes for backup zips being removed */
  zipWarnings: string[]
  /** Files pulled out of backup zips before they're removed */
  pulledCount: number
  /** Matched a cleanup rule but kept because protected */
  protectedSaved: number
}

export const JUNK_BUCKET_WORDS: Record<RemovalBucket, string> = {
  node_modules: 'node_modules',
  build_dirs: 'build caches (dist, .next, build…)',
  git: '.git history',
  os_junk: '.DS_Store / __MACOSX',
  vercel: '.vercel',
  '.grok': 'grok sandbox leftovers',
  sandbox_crumbs: 'sandbox ID crumbs',
  logs: 'log files',
  wav: 'WAV files',
  other: 'other',
}

const CODE_EXT =
  /\.(tsx?|jsx?|mjs|cjs|vue|svelte|astro|css|scss|sass|less|html?|json|jsonc|webmanifest|toml|ya?ml|sql|lock|lockb|prisma|sh|env\.example)$/i

function isAppCode(path: string): boolean {
  const parts = pathParts(path)
  const name = basename(path).toLowerCase()
  if (parts.slice(0, -1).includes('src')) return true
  if (CODE_EXT.test(name)) return true
  return /^(\.gitignore|\.npmrc|dockerfile|\.env\.example|startup\.sh)$/.test(name)
}

function mk(
  id: ReviewGroupId,
  title: string,
  note: string,
  tone: ReviewGroup['tone'],
  files: ReviewFile[],
): ReviewGroup {
  files.sort((a, b) => a.path.localeCompare(b.path))
  return {
    id,
    title,
    note,
    tone,
    files,
    count: files.length,
    size: files.reduce((s, f) => s + f.size, 0),
  }
}

export function buildReviewPlan(
  scan: Pick<ScanResult, 'entries' | 'protectedSaved'>,
  choices: {
    /** Individual media overrides (Keep unchecked) */
    mediaRemove: Set<string>
    /** Backup zips Cap chose to remove */
    zipRemove: Set<string>
    /** Pull images found only in a removed zip out first */
    pullMissing: boolean
  },
  backupZips: BackupZipInfo[],
): ReviewPlan {
  const junk: ReviewFile[] = []
  const wav: ReviewFile[] = []
  const media: ReviewFile[] = []
  const zipsRemove: ReviewFile[] = []
  const zipsKeep: ReviewFile[] = []
  const keepMedia: ReviewFile[] = []
  const keepCode: ReviewFile[] = []
  const keepOther: ReviewFile[] = []

  for (const e of scan.entries) {
    const path = normalizePath(e.path)
    if (!path || path.endsWith('/')) continue
    const f: ReviewFile = {
      path,
      size: e.size,
      protectedBy: e.protectedBy,
      bucket: e.bucket,
    }
    if (e.remove) {
      if (e.bucket === 'wav') wav.push(f)
      else junk.push(f)
      continue
    }
    if (isBackupZipPath(path)) {
      if (choices.zipRemove.has(path)) zipsRemove.push(f)
      else zipsKeep.push(f)
      continue
    }
    if (choices.mediaRemove.has(path)) {
      media.push(f)
      continue
    }
    if (mediaKindFromPath(path) || isProtectedMediaPath(path)) keepMedia.push(f)
    else if (isAppCode(path)) keepCode.push(f)
    else keepOther.push(f)
  }

  const junkKinds = [...new Set(junk.map((f) => f.bucket).filter(Boolean))]
    .map((b) => JUNK_BUCKET_WORDS[b as RemovalBucket])
    .join(', ')

  const zipWarnings: string[] = []
  const pulls = choices.pullMissing
    ? planMediaPulls(backupZips, choices.zipRemove, scan.entries.map((e) => e.path))
    : []
  const pulledCount = pulls.length
  for (const z of backupZips) {
    if (!choices.zipRemove.has(z.path)) continue
    const n = z.missingMedia.length
    if (n === 0) continue
    const name = basename(z.path)
    const mine = pulls.filter((p) => p.zipPath === z.path)
    const targets = choices.pullMissing ? mine.map((p) => p.targetPath) : z.missingMedia.map((m) => m.targetPath)
    const where = [
      ...new Set(
        targets.map((t) => {
          const parts = pathParts(t)
          return parts.length > 1 ? `${parts.slice(0, -1).join('/')}/` : 'the project root'
        }),
      ),
    ]
      .slice(0, 3)
      .join(', ')
    const head = `${name} has ${n} image/sound file${n === 1 ? '' : 's'} not found elsewhere in the upload.`
    if (!choices.pullMissing) {
      zipWarnings.push(`${head} Removing it deletes the only copy.`)
    } else if (mine.length === 0) {
      zipWarnings.push(`${head} Copies are pulled out of another backup zip, so nothing is lost.`)
    } else {
      zipWarnings.push(
        `${head} ${mine.length === n ? 'They' : `${mine.length} of them`}'ll be pulled out to ${where} before the zip is removed${mine.length < n ? ' (the rest come from another backup zip)' : ''}.`,
      )
    }
  }

  const zipNote =
    'Old copies of your project. They may hold the only copy of images, so they stay unless you remove them.'

  const groups: ReviewGroup[] = [
    mk(
      'remove-junk',
      'Will remove: build junk',
      junkKinds
        ? `Safe to delete, rebuilt automatically: ${junkKinds}.`
        : 'Nothing to clean.',
      'remove',
      junk,
    ),
    mk(
      'remove-wav',
      'Will remove: WAV files (you turned this on)',
      'Loose WAVs not in public/ and not used by your code.',
      'warn',
      wav,
    ),
    mk(
      'remove-media',
      'Will remove: images & sounds you unchecked',
      'You chose these one by one. Your app may break if it uses them.',
      'warn',
      media,
    ),
    mk(
      'remove-zips',
      'Will remove: backup zips',
      choices.pullMissing
        ? 'Images found only inside them are pulled out first.'
        : 'Images inside them are NOT pulled out.',
      'warn',
      zipsRemove,
    ),
    mk('keep-zips', 'Kept: backup zips (may contain your images)', zipNote, 'keep', zipsKeep),
    mk(
      'keep-media',
      'Kept: images & sounds',
      'Protected. Never removed unless you uncheck one in Media review.',
      'keep',
      keepMedia,
    ),
    mk('keep-code', 'Kept: app code', 'Source, config and public files the app needs.', 'keep', keepCode),
    mk('keep-other', 'Kept: other files', 'Docs, notes and anything else.', 'keep', keepOther),
  ].filter((g) => g.count > 0 || g.id === 'remove-junk')

  const removing = [...junk, ...wav, ...media, ...zipsRemove]
  const keeping = [...zipsKeep, ...keepMedia, ...keepCode, ...keepOther]

  return {
    groups,
    removeCount: removing.length,
    removeSize: removing.reduce((s, f) => s + f.size, 0),
    keepCount: keeping.length + pulledCount,
    keepSize: keeping.reduce((s, f) => s + f.size, 0),
    mediaWarnings: [...media, ...wav],
    zipWarnings,
    pulledCount,
    protectedSaved: scan.protectedSaved,
  }
}
