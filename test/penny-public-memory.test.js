import test from 'node:test'
import assert from 'node:assert/strict'
import {authorized,subjectId,normalizeNote} from '../api/penny-memory.js'
test('each Discord identity gets an isolated key',()=>{
 assert.notEqual(subjectId('1575767857747202129','1531868631325999256'),subjectId('1575767857747202129','1531868631325999257'))
 assert.equal(subjectId('bad','1531868631325999256'),'')
})
test('service-to-service secret is enforced',()=>{
 assert.equal(authorized('Bearer '+'a'.repeat(48),'a'.repeat(48)),true)
 assert.equal(authorized('Bearer '+'b'.repeat(48),'a'.repeat(48)),false)
 assert.equal(authorized('Bearer foo','short'),false)
})
test('explicit notes are bounded',()=>{
 assert.equal(normalizeNote(' my cat is Luna '),'my cat is Luna')
 assert.equal(normalizeNote('x'.repeat(501)),'')
})
