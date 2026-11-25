import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {POLL,nextUnreadDelay,bridgeStateChanged} from '../src/comms/poll-policy.js'
test('idle and list traffic reduced while active message timing stays unchanged',()=>{
 assert.equal(POLL.unread,30000)
 assert.equal(POLL.conversations,30000)
 assert.equal(POLL.activeConversation,4000)
 assert.ok(POLL.presence<90000)
})
test('closed widget backs off errors and signed out sessions and recovers on success',()=>{
 assert.equal(nextUnreadDelay(POLL.unread,503),60000)
 assert.equal(nextUnreadDelay(240000,0),300000)
 assert.equal(nextUnreadDelay(300000,200),30000)
 assert.equal(nextUnreadDelay(30000,401),120000)
})
test('repeated parent state is not a new polling trigger',()=>{
 const state={open:false,visible:true}
 assert.equal(bridgeStateChanged(state,{...state}),false)
 assert.equal(bridgeStateChanged(state,{...state,visible:false}),true)
 assert.equal(bridgeStateChanged(state,{...state,open:true}),true)
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
 assert.match(read('src/comms/messenger-embed.jsx'),/if \(!bridgeStateChanged\(state, next\)\) return/)
 assert.match(read('src/App.jsx'),/setInterval\(refreshUnread, POLL.unread\)/)
 assert.match(read('src/comms/CommsPanel.jsx'),/setInterval\(pollActiveConversation, POLL.activeConversation\)/)
})
