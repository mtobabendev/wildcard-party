import test from 'node:test'
import assert from 'node:assert/strict'
import { CITIES, SIGNS, horoscope, localDay } from '../src/components/penny-awareness-data.js'
test('all signs have stable date-based reflections and preset cities',()=>{const d=new Date(2026,10,13,12);assert.equal(localDay(d),'2026-11-13');assert.equal(CITIES.omaha.label,'Omaha, NE');assert.equal(SIGNS.length,12);for(const sign of SIGNS){assert.deepEqual(horoscope(sign,d),horoscope(sign,d));assert.notEqual(horoscope(sign,d).text,horoscope(sign,new Date(2026,10,14,12)).text);assert.match(horoscope(sign,d).source,/entertainment/)}})
