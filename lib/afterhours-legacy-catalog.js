const ROOT = '/static/'
const classic = ['PennyCard1.webm','Card2.webm','PennyCard3.webm','Yoga.mp4','PennyCard4.webm','PennyQueen.mp4',
  ...Array.from({ length: 6 }, (_, i) => 'poster-' + (i + 1) + '.jpg')]
const friends = ['aisha-moon-slides.webp','angel-jessy-slides.webp','annabella.webp',
  'brooke-slides.webp','evemarie-slides.webp','karley-stokes-slides.webp',
  'lacie-heart-slides.webp','lala.webp','mia-slides.webp','snow-bird-slides.webp']
const primary = [...Array.from({ length: 8 }, (_, i) => (i + 1) + '.jpg'),
  'PennyOnlyFansBanner.jpg','KandyOnlyFans2.jpg','PennySeatAtTheTable.webm',
  'AnimePenny.webm','PennyAfterHoursPatchNotes.webm','PennyAfterHoursPatchNotes.webp',
  'PennyNewFansBanner.webm','PennyOnlyFanzProfile-web.webm','penny-after-hours-cover.webp']
const suffixType = Object.freeze({ jpg: 'image/jpeg', webp: 'image/webp', webm: 'video/webm', mp4: 'video/mp4' })
const mapping = [
  ...primary.map(name => ({ name, path: ROOT + name })),
  ...classic.map(name => ({ name, path: ROOT + 'penny-classic-cards/' + name })),
  ...friends.map(name => ({ name, path: ROOT + 'friends/' + name })),
]
export const LEGACY_PENNY_ASSETS = Object.freeze(mapping.map(entry => Object.freeze({
  ...entry, type: suffixType[entry.name.split('.').pop()],
})))
if (LEGACY_PENNY_ASSETS.length !== 39 ||
    new Set(LEGACY_PENNY_ASSETS.map(item => item.name)).size !== 39 ||
    LEGACY_PENNY_ASSETS.some(item => !item.type || !/^\/static\/[a-z0-9\/-]+\.(jpg|webp|webm|mp4)$/i.test(item.path))) {
  throw new Error('After Hours legacy import allowlist is invalid.')
}
export function legacyPennyAsset(name) {
  return typeof name === 'string' ? LEGACY_PENNY_ASSETS.find(item => item.name === name) || null : null
}
