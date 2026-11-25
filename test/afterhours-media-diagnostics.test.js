import test from 'node:test'
import assert from 'node:assert/strict'
import {mediaStage,mediaDiagnostic} from '../lib/afterhours-media-diagnostics.js'
import {readFileSync} from 'node:fs'
test('diagnostics preserve nested stages without exposing provider messages',async()=>{
 const secret=new Error('postgres://secret@example.invalid')
 secret.code='42501'
 try{await mediaStage('start',()=>mediaStage('catalog-reserve',()=>{throw secret}));assert.fail('expected exception')}catch(e){
 const d=mediaDiagnostic(e,'start')
 assert.deepEqual(d,{stage:'catalog-reserve',reason:'SQL_42501',error:'Reserve media catalog entry failed (SQL_42501).'})
 assert.doesNotMatch(JSON.stringify(d),/secret|postgres:\/\//)
 }
})
test('known storage and network categories are safe and unknown errors are generic',()=>{
 assert.equal(mediaDiagnostic({name:'AccessDenied'},'finish').reason,'STORAGE_AUTH')
 assert.equal(mediaDiagnostic({code:'STORAGE_NOT_CONFIGURED'},'start').reason,'STORAGE_NOT_CONFIGURED')
 assert.equal(mediaDiagnostic({code:'ETIMEDOUT'},'relay').reason,'NETWORK_ERROR')
 assert.equal(mediaDiagnostic({name:'NoSuchKey'},'finish').reason,'STORAGE_NOT_FOUND')
 assert.equal(mediaDiagnostic({code:'secret'},'evil-input').stage,'request')
 assert.equal(mediaDiagnostic({code:'secret'},'evil-input').reason,'SERVICE_ERROR')
})
test('browser reports failed phase and server protects diagnostic details',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
 const ui=read('src/afterhours/OwnerMedia.jsx'),api=read('api/afterhours/media-admin.js')
 for(const phase of ['Check catalog','Request upload ticket','Transfer to private storage','Verify and register upload'])assert.ok(ui.includes(phase))
 assert.match(api,/authorized\?diagnostic:/)
 assert.doesNotMatch(api,/console\.error\('after hours private upload failed', error\)/)
})
