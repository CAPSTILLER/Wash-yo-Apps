import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, unzipSync, strToU8 } from 'fflate'
import { loadLib, closeLib } from './load.mjs'

after(closeLib)

const png = (n = 64) => new Uint8Array(n).fill(7)

/** Upload shaped like Cap's I Still game zip */
function capLikeFiles({ withSprites = true } = {}) {
  const backup = zipSync({
    'I-Still/public/sprites/door.png': png(),
    'I-Still/public/sprites/eye.png': png(),
    'I-Still/public/art/title.jpg': png(),
    'I-Still/node_modules/x/logo.png': png(),
    'I-Still/src/main.ts': strToU8('x'),
  })
  const f = {
    'package.json': strToU8('{"name":"i-still","scripts":{"build":"vite build"}}'),
    'index.html': strToU8('<link rel="icon" href="/favicon.ico">'),
    'src/game/sprites.ts': strToU8("const a = '/sprites/door.png'; const b = 'art/title.jpg'; const c='levels.log'"),
    'src/build/levels.ts': strToU8('export const x = 1'),
    'public/favicon.ico': png(),
    'public/manifest.webmanifest': strToU8('{}'),
    'public/data/level1.json': strToU8('{}'),
    'public/build/cached.png': png(),
    'screenshots/one.png': png(),
    'levels.log': strToU8('used by code'),
    'debug.log': strToU8('junk'),
    'sfx/raw-take.wav': png(),
    'public/sfx/hit.wav': png(),
    'node_modules/react/index.js': strToU8('x'),
    'node_modules/pkg/logo.png': png(),
    '.vercel/output/static/sprites/door.png': png(),
    '.git/HEAD': strToU8('ref'),
    '.DS_Store': png(4),
    'dist/assets/door-abc.png': png(),
    'I-Still.zip': backup,
  }
  if (withSprites) {
    f['public/sprites/door.png'] = png()
    f['public/sprites/eye.png'] = png()
    f['public/art/title.jpg'] = png()
  }
  return f
}

test('public/ images, media and referenced files survive default clean', async () => {
  const { buildCleanZip, DEFAULT_OPTIONS } = await loadLib('/src/lib/cleanZip.ts')
  const files = capLikeFiles()
  const opts = { ...DEFAULT_OPTIONS, githubUploadHelper: false }
  const out = unzipSync((await buildCleanZip(files, opts, undefined, { enabled: false }, null, undefined, { enabled: false, appName: '', shortName: '', publicSiteUrl: '' })).zip)
  const keys = Object.keys(out)
  for (const p of ['public/sprites/door.png', 'public/sprites/eye.png', 'public/art/title.jpg', 'public/build/cached.png', 'public/data/level1.json', 'src/build/levels.ts', 'screenshots/one.png', 'levels.log', 'I-Still.zip']) {
    assert.ok(keys.includes(p), `kept ${p}`)
  }
  for (const p of keys) {
    assert.ok(!/(^|\/)(node_modules|\.vercel|\.git)\//.test(p), `removed ${p}`)
  }
  assert.ok(!keys.includes('.DS_Store'))
  assert.ok(!keys.includes('debug.log'))
  assert.ok(!keys.includes('dist/assets/door-abc.png'))
})

test('protection reasons + soft rules skip protected files', async () => {
  const { computeProtection, classifyWithProtection, DEFAULT_OPTIONS, isInsideJunkFolder } = await loadLib('/src/lib/cleanZip.ts')
  const files = capLikeFiles()
  const prot = computeProtection(files)
  assert.equal(prot.get('public/sprites/door.png'), 'public')
  assert.equal(prot.get('screenshots/one.png'), 'media')
  assert.equal(prot.get('levels.log'), 'referenced')
  assert.equal(prot.get('src/build/levels.ts'), 'src')
  assert.equal(prot.get('node_modules/pkg/logo.png'), undefined)
  assert.equal(prot.get('.vercel/output/static/sprites/door.png'), undefined)
  assert.equal(prot.get('dist/assets/door-abc.png'), undefined)
  assert.ok(isInsideJunkFolder('dist/assets/x.png'))
  assert.ok(!isInsideJunkFolder('public/dist/x.png'))

  const wavOn = { ...DEFAULT_OPTIONS, wav: true }
  // explicit WAV opt-in removes loose wavs but never public/ ones
  assert.equal(classifyWithProtection('sfx/raw-take.wav', wavOn, prot).remove, true)
  const pub = classifyWithProtection('public/sfx/hit.wav', wavOn, prot)
  assert.equal(pub.remove, false)
  assert.equal(pub.savedFrom, 'wav')
  assert.equal(classifyWithProtection('public/build/cached.png', DEFAULT_OPTIONS, prot).savedFrom, 'build_dirs')
  // hard junk always goes
  assert.equal(classifyWithProtection('node_modules/pkg/logo.png', DEFAULT_OPTIONS, prot).remove, true)
})

test('scan + review plan groups in plain words; zips kept by default', async () => {
  const { rescanFiles, analyzeBackupZips, DEFAULT_OPTIONS } = await loadLib('/src/lib/cleanZip.ts')
  const { buildReviewPlan } = await loadLib('/src/lib/reviewPlan.ts')
  const files = capLikeFiles()
  const scan = rescanFiles(files, DEFAULT_OPTIONS)
  const zips = analyzeBackupZips(files)
  assert.equal(zips.length, 1)
  assert.equal(zips[0].mediaCount, 3) // node_modules png inside zip skipped
  assert.equal(zips[0].missingMedia.length, 0)
  const plan = buildReviewPlan(scan, { mediaRemove: new Set(), zipRemove: new Set(), pullMissing: true }, zips)
  const ids = plan.groups.map((g) => g.id)
  assert.deepEqual(ids, ['remove-junk', 'keep-zips', 'keep-media', 'keep-code', 'keep-other'])
  const media = plan.groups.find((g) => g.id === 'keep-media')
  assert.ok(media.files.some((f) => f.path === 'public/sprites/door.png'))
  assert.equal(plan.mediaWarnings.length, 0)
  assert.ok(scan.protectedSaved >= 2)
})

test('removing a backup zip warns about images found only inside it, and can pull them out', async () => {
  const { analyzeBackupZips, pullMissingMediaFromZips, rescanFiles, buildCleanZip, DEFAULT_OPTIONS } = await loadLib('/src/lib/cleanZip.ts')
  const { buildReviewPlan } = await loadLib('/src/lib/reviewPlan.ts')
  const files = capLikeFiles({ withSprites: false })
  const zips = analyzeBackupZips(files)
  assert.equal(zips[0].missingMedia.length, 3)
  const scan = rescanFiles(files, DEFAULT_OPTIONS)
  const zipRemove = new Set(['I-Still.zip'])
  const noPull = buildReviewPlan(scan, { mediaRemove: new Set(), zipRemove, pullMissing: false }, zips)
  assert.match(noPull.zipWarnings[0], /I-Still\.zip has 3 image\/sound files not found elsewhere/)
  assert.match(noPull.zipWarnings[0], /only copy/)

  const pulled = pullMissingMediaFromZips(files, zipRemove)
  assert.deepEqual(Object.keys(pulled).sort(), ['public/art/title.jpg', 'public/sprites/door.png', 'public/sprites/eye.png'])
  const out = unzipSync((await buildCleanZip(files, { ...DEFAULT_OPTIONS, githubUploadHelper: false }, undefined, { enabled: false }, zipRemove, undefined, { enabled: false, appName: '', shortName: '', publicSiteUrl: '' }, undefined, pulled)).zip)
  assert.ok(!('I-Still.zip' in out))
  assert.ok('public/sprites/door.png' in out)
})

test('individual override removes a protected file and shows in confirm warnings', async () => {
  const { rescanFiles, DEFAULT_OPTIONS } = await loadLib('/src/lib/cleanZip.ts')
  const { buildReviewPlan } = await loadLib('/src/lib/reviewPlan.ts')
  const files = capLikeFiles()
  const scan = rescanFiles(files, DEFAULT_OPTIONS)
  const plan = buildReviewPlan(scan, { mediaRemove: new Set(['public/sprites/eye.png']), zipRemove: new Set(), pullMissing: true }, [])
  assert.equal(plan.mediaWarnings.length, 1)
  assert.equal(plan.mediaWarnings[0].protectedBy, 'public')
})
