import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const entry=readFileSync(new URL('../src/nexus/entry.jsx',import.meta.url),'utf8')
test('TeamWorks enrollment and restore require one explicit local approval; external export retains review',()=>{
 assert.match(entry,/Approve & connect workstation/)
 assert.match(entry,/deviceId:bridge.id,approved:true/)
 assert.match(entry,/Approve & restore selected memories/)
 assert.match(entry,/!bridge&&<label className="nx-check"/)
 assert.match(entry,/if\(m.ok&&m.count===delivery.current.length&&m.sessionId===bridge.id\)/)
 assert.match(entry,/if\(!bridgeReady\|\|!window.opener\|\|window.opener.closed\)/)
})
