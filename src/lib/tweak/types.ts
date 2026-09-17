/** Shared types for Zip Ship Tweak mode (v3.6.1). */

export type TweakKind = 'text' | 'image' | 'link'

export type PreviewSelection = {
  kind: TweakKind
  text?: string
  src?: string
  href?: string
  tag: string
}

export type MatchOccurrence = {
  path: string
  /** Byte/char index of this occurrence in the file text */
  index: number
  /** 0-based occurrence number within this file */
  occurrenceInFile: number
  /** Short context snippet around the match */
  snippet: string
}

export type FindMatchesResult = {
  value: string
  matches: MatchOccurrence[]
}

export type ChangeLogEntry = {
  id: string
  at: number
  kind: 'text' | 'href' | 'image-replace' | 'image-remove'
  summary: string
  /** Primary / first path (compat) */
  path?: string
  /** Every file touched by this change */
  paths?: string[]
}

export type InventoryItem = {
  id: string
  kind: TweakKind
  value: string
  /** Path hint (source file or image path in zip) */
  sourcePath?: string
  /** For images: zip path of the asset if found */
  assetPath?: string
}

export type PreviewBuildResult = {
  mode: 'preview' | 'inventory'
  /** srcdoc HTML when mode=preview */
  srcdoc?: string
  /** Blob URLs created for assets (caller must revoke) */
  blobUrls: string[]
  /** HTML entry used, if any */
  htmlPath?: string
  note?: string
}

/** Result of a replace-all across the zip map. */
export type ReplaceAllResult = {
  occurrenceCount: number
  fileCount: number
  paths: string[]
  /** Per-path occurrence counts */
  perFile: { path: string; count: number }[]
  log: ChangeLogEntry
}
