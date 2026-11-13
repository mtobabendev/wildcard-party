import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePresentation, presentationInstructions } from '../lib/penny-presentation.js'
test('standard instructions are unchanged',()=>{assert.equal(presentationInstructions('baseline'),'baseline');assert.equal(normalizePresentation(undefined),'standard')})
test('cabaret is fixed and preserves baseline and nonexplicit boundaries',()=>{const s=presentationInstructions('baseline','cabaret');assert.ok(s.startsWith('baseline\n\n'));assert.match(s,/Never become explicit/);assert.match(s,/security, accuracy, and safety/);assert.throws(()=>normalizePresentation('arbitrary prompt'));assert.throws(()=>normalizePresentation({}));assert.throws(()=>normalizePresentation(null))})
