/** Browser-only canvas rendering for the App icon step. */
import { buildIco, type IconFiles } from './appIcon'

export type IconLook = { fit: 'crop' | 'fit'; bg: string; zoom: number; transparent: boolean }

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image()
    im.onload = () => res(im)
    im.onerror = () => rej(new Error('Could not read that image'))
    im.src = url
  })
}

/** Draw the picked image into a w×h canvas (square area centered for OG). */
export function drawIcon(im: HTMLImageElement, w: number, h: number, look: IconLook, opaque = false): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const x = c.getContext('2d')!
  if (!look.transparent || opaque) { x.fillStyle = look.bg; x.fillRect(0, 0, w, h) }
  const box = Math.min(w, h) * (w === h ? 1 : 0.86)
  const iw = im.naturalWidth, ih = im.naturalHeight
  const scale = (look.fit === 'crop' ? Math.max(box / iw, box / ih) : Math.min(box / iw, box / ih)) * look.zoom
  const dw = iw * scale, dh = ih * scale
  x.save()
  x.beginPath(); x.rect((w - box) / 2, (h - box) / 2, box, box); x.clip()
  x.imageSmoothingQuality = 'high'
  x.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh)
  x.restore()
  return c
}

async function png(c: HTMLCanvasElement): Promise<Uint8Array> {
  const b: Blob = await new Promise((r, j) => c.toBlob((x) => (x ? r(x) : j(new Error('canvas'))), 'image/png'))
  return new Uint8Array(await b.arrayBuffer())
}

export async function renderIconFiles(im: HTMLImageElement, look: IconLook): Promise<IconFiles> {
  const ico = await Promise.all([16, 32, 48].map(async (s) => ({ size: s, png: await png(drawIcon(im, s, s, look)) })))
  return {
    'favicon.ico': buildIco(ico),
    'favicon-32.png': ico[1]!.png,
    'apple-touch-icon.png': await png(drawIcon(im, 180, 180, look, true)),
    'icon-192.png': await png(drawIcon(im, 192, 192, look, true)),
    'icon-512.png': await png(drawIcon(im, 512, 512, look, true)),
    'og-image.png': await png(drawIcon(im, 1200, 630, look, true)),
  }
}
