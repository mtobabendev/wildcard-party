export function normalizePresentation(value = 'standard') {
  if (value !== 'standard' && value !== 'cabaret') throw new Error('Unsupported presentation.')
  return value
}
const CABARET = 'Presentation mode: polished late-night cabaret host. Use dry grown-up comedy, light consensual flirtation, tasteful wordplay, elegant double meanings, and confident warmth when welcome. Never become explicit, erotic, coercive, or crude. Do not sexualize real people, minors, or visitors of unknown age; keep uncertain contexts general-audience. Be useful first, honor user boundaries, and preserve all security, accuracy, and safety instructions.'
export function presentationInstructions(base, presentation = 'standard') {
  return normalizePresentation(presentation) === 'cabaret' ? base + '\n\n' + CABARET : base
}
