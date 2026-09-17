import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'

const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm'

let ffmpegInstance: FFmpeg | null = null
let loadPromise: Promise<FFmpeg> | null = null

export async function ensureFFmpeg(
  onStatus?: (message: string) => void,
): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    onStatus?.('Downloading ffmpeg core (one-time)…')
    const ffmpeg = new FFmpeg()

    ffmpeg.on('log', ({ message }) => {
      if (import.meta.env.DEV) {
        console.debug('[ffmpeg]', message)
      }
    })

    const coreURL = await toBlobURL(
      `${CORE_BASE}/ffmpeg-core.js`,
      'text/javascript',
    )
    const wasmURL = await toBlobURL(
      `${CORE_BASE}/ffmpeg-core.wasm`,
      'application/wasm',
    )

    await ffmpeg.load({ coreURL, wasmURL })
    ffmpegInstance = ffmpeg
    return ffmpeg
  })()

  try {
    return await loadPromise
  } catch (err) {
    loadPromise = null
    ffmpegInstance = null
    throw err
  }
}

/**
 * Convert WAV bytes to MP3 via ffmpeg.wasm (libmp3lame, -q:a 2).
 */
export async function convertWavBytesToMp3(
  wavBytes: Uint8Array,
  opts?: { onStatus?: (message: string) => void },
): Promise<Uint8Array> {
  const ffmpeg = await ensureFFmpeg(opts?.onStatus)

  const inputName = 'input.wav'
  const outputName = 'output.mp3'

  try {
    try {
      await ffmpeg.deleteFile(inputName)
    } catch {
      /* ignore */
    }
    try {
      await ffmpeg.deleteFile(outputName)
    } catch {
      /* ignore */
    }

    await ffmpeg.writeFile(inputName, wavBytes)
    const code = await ffmpeg.exec([
      '-i',
      inputName,
      '-vn',
      '-acodec',
      'libmp3lame',
      '-q:a',
      '2',
      outputName,
    ])

    if (code !== 0) {
      throw new Error(`ffmpeg exited with code ${code}`)
    }

    const data = await ffmpeg.readFile(outputName)
    if (typeof data === 'string') {
      return new TextEncoder().encode(data)
    }
    return new Uint8Array(data)
  } finally {
    try {
      await ffmpeg.deleteFile(inputName)
    } catch {
      /* ignore */
    }
    try {
      await ffmpeg.deleteFile(outputName)
    } catch {
      /* ignore */
    }
  }
}

export function isWavPath(path: string): boolean {
  const lower = path.replace(/\\/g, '/').toLowerCase()
  return lower.endsWith('.wav')
}

export function wavPathToMp3(path: string): string {
  return path.replace(/\.wav$/i, '.mp3')
}
