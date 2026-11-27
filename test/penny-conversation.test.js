import test from 'node:test'
import assert from 'node:assert/strict'
import { conversationSubject, validateExchange, MAX_EXCHANGES } from '../lib/penny-conversation.js'

test('conversation scope isolates user, guild, and channel', () => {
 const a=conversationSubject('1575767857747202129','1575767857747202130','1531868631325999256')
 assert.equal(a,'discord:1575767857747202129:1575767857747202130:1531868631325999256')
 assert.notEqual(a,conversationSubject('1575767857747202129','1575767857747202131','1531868631325999256'))
 assert.notEqual(a,conversationSubject('1575767857747202129','1575767857747202130','1531868631325999257'))
 assert.equal(conversationSubject('bad','1575767857747202130','1531868631325999256'),'')
})
test('history stores only bounded, valid exchanges', () => {
 const x={interactionId:'1531868631325999256',question:'What is Magic?',answer:'A game.'}
 assert.equal(validateExchange(x),true)
 assert.equal(validateExchange({...x,question:'q'.repeat(1801)}),false)
 assert.equal(validateExchange({...x,answer:'a'.repeat(1901)}),false)
 assert.equal(validateExchange({...x,interactionId:'not-id'}),false)
 assert.equal(MAX_EXCHANGES,4)
})
