export const CITIES = Object.freeze({
  omaha: { label: 'Omaha, NE', point: '41.2565,-95.9345' },
  chicago: { label: 'Chicago, IL', point: '41.8781,-87.6298' },
  newyork: { label: 'New York, NY', point: '40.7128,-74.0060' },
  losangeles: { label: 'Los Angeles, CA', point: '34.0522,-118.2437' },
  denver: { label: 'Denver, CO', point: '39.7392,-104.9903' },
  dallas: { label: 'Dallas, TX', point: '32.7767,-96.7970' },
  miami: { label: 'Miami, FL', point: '25.7617,-80.1918' },
  seattle: { label: 'Seattle, WA', point: '47.6062,-122.3321' },
})
export const SIGNS = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces']
export function localDay(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-')
}
const reflections = [
  'Give one unfinished idea the attention it deserves. Leave the rest of the noise outside the door.',
  'A small, deliberate choice can make the day feel less crowded. Protect your time.',
  'Curiosity is useful today. Ask the question you have been saving, and listen to the answer.',
  'Make room for the people and projects that feel nourishing. You do not have to say yes to everything.',
  'Try the simpler route before the spectacular one. Elegance often hides in the smallest details.',
  'Put your energy into something you can finish. A little momentum is worth more than a perfect plan.',
  'Invite a different perspective. A good conversation might change the shape of an old problem.',
  'Reinvention begins with choosing what to keep. Give yourself permission to retire one old habit.',
  'Explore something unfamiliar, without expecting an instant result. Discovery is its own reward.',
  'Set a reasonable boundary around your attention. Progress and rest both belong on the schedule.',
  'Your imagination deserves a practical outlet. Sketch the idea before building the entire universe.',
  'Notice what feels meaningful, not just urgent. A quieter evening might help you find your next move.',
  'Leave space for an unexpected possibility. You can be prepared without controlling every detail.',
  'Make the next decision from evidence rather than pressure. The right question can unlock the whole puzzle.',
  'A thoughtful gesture can matter more than a grand announcement. Keep the small things intentional.',
  'Give an old project a fresh look. Perhaps the answer was waiting in a detail you overlooked.',
  'Balance ambition with patience. Some worthwhile things need time, not another layer of complexity.',
]
export function horoscope(sign, date = new Date()) {
  const chosen = SIGNS.includes(sign) ? sign : 'Scorpio'
  const day = localDay(date)
  const ordinal = Math.floor(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())/86400000)
  return { kind:'horoscope', label:chosen+' · daily reflection', text:reflections[((ordinal + SIGNS.indexOf(chosen)*5)%reflections.length+reflections.length)%reflections.length], day, source:'Original Penny reflection · for entertainment' }
}
