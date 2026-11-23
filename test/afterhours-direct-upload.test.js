import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseArgs, mimeOf, tokenValid, run } from '../scripts/afterhours-upload.mjs'
import { uploadTokenHash, bearerUploadToken } from '../lib/afterhours-agent-token.js'

const TOKEN = 'wcu1_' + 'A'.repeat(43)
const fake = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' }
})

test('upload-only tokens cannot be used as regular browser-session hashes', () => {
  assert.equal(tokenValid(TOKEN), true)
  const hash = uploadTokenHash(TOKEN)
  assert.match(hash, /^au1_[0-9a-f]{60}$/)
  assert.equal(hash.length, 64)
  assert.equal(bearerUploadToken('Bearer ' + TOKEN), TOKEN)
  assert.equal(bearerUploadToken('Basic ' + TOKEN), '')
  assert.equal(bearerUploadToken('Bearer wcdu-invalid'), '')
  assert.equal(uploadTokenHash(''), '')
})

test('uploader validates area, filenames and explicit upload intent', () => {
  assert.deepEqual(parseArgs([]), {
    mode:'check',area:'penny',file:'',name:'',newVersion:false
  })
  assert.equal(parseArgs(['--area','kandy','--name','Kandy.webp']).name,'Kandy.webp')
  assert.throws(()=>parseArgs(['--mode','upload']), /File required/)
  assert.throws(()=>parseArgs(['--mode','upload','--file','asset.webp']), /absolute/)
  assert.throws(()=>parseArgs(['--area','bad']), /Invalid area/)
  assert.throws(()=>parseArgs(['--name','../unsafe.webp']), /Invalid filename/)
  assert.throws(()=>parseArgs(['--new-version']), /requires upload/)
  assert.throws(()=>parseArgs(['--unknown','x']), /Unknown option/)
  assert.equal(mimeOf('x.webp'), 'image/webp')
  assert.equal(mimeOf('x.webm'), 'video/webm')
  assert.equal(mimeOf('x.html'), '')
})

test('read-only status uses a scoped bearer; no cookie or production secret', async () => {
  let actual
  const lines=[]
  const result = await run(['--mode','check','--area','ashley','--name','portrait.webp'], {
    token:TOKEN, output:line=>lines.push(line),
    fetcher:async (url,options) => {
      actual={url,headers:options.headers,body:JSON.parse(options.body)}
      return fake({ ok:true,exists:false,type:null })
    }
  })
  assert.equal(result.checked,true)
  assert.equal(actual.url,'https://party.wildcarddev.com/api/afterhours/media-admin')
  assert.equal(actual.headers.Authorization,'Bearer '+TOKEN)
  assert.equal(actual.headers.Cookie,undefined)
  assert.deepEqual(actual.body,{action:'check',area:'ashley',name:'portrait.webp'})
  assert.equal(lines.length,2)
  await assert.rejects(()=>run([],{ token:'not-a-token' }),/not paired/)
})

test('mock complete upload reuses Party start/PUT/finish and verifies ready asset', async () => {
  const dir=await mkdtemp(join(tmpdir(),'wcd-media-test-'))
  const file=join(dir,'test.webp')
  const steps=[]
  let uploaded=false
  try {
    await writeFile(file,Buffer.from('test-image-content'))
    const answer=await run(['--mode','upload','--area','penny','--file',file],{
      token:TOKEN, output:()=>{},
      fetcher:async (url,opts)=>{
        if(url==='https://private.example/upload'){
          steps.push('PUT')
          assert.equal(opts.method,'PUT')
          assert.equal(opts.headers['Content-Type'],'image/webp')
          uploaded=true
          return {ok:true,status:200}
        }
        const body=JSON.parse(opts.body)
        steps.push(body.action)
        if(body.action==='check') return fake({ok:true,exists:uploaded,type:uploaded?'image/webp':null})
        if(body.action==='start') return fake({upload:{
          id:'123e4567-e89b-12d3-a456-426614174000',
          uploadUrl:'https://private.example/upload',contentType:'image/webp'
        }},201)
        if(body.action==='finish') return fake({ok:true})
        throw Error('Unexpected action')
      }
    })
    assert.equal(answer.verified,true)
    assert.deepEqual(steps,['check','start','PUT','finish','check'])
  } finally { await rm(dir,{recursive:true,force:true}) }
})

test('existing upload is skipped, not duplicated', async () => {
  const dir=await mkdtemp(join(tmpdir(),'wcd-media-test-'))
  const file=join(dir,'test.webp')
  await writeFile(file,'already available')
  const steps=[]
  try {
    const result=await run(['--mode','upload','--file',file],{
      token:TOKEN,output:()=>{},fetcher:async (_url,opts)=>{
        const body=JSON.parse(opts.body)
        steps.push(body.action)
        return fake({ok:true,exists:true,type:'image/webp'})
      }
    })
    assert.equal(result.uploaded,false)
    assert.deepEqual(steps,['check'])
  } finally {await rm(dir,{recursive:true,force:true})}
})

test('pairing stays in existing session table; local token is DPAPI encrypted', () => {
  const tokens=readFileSync(new URL('../lib/afterhours-agent-token.js',import.meta.url),'utf8')
  const wrapper=readFileSync(new URL('../scripts/afterhours-upload.ps1',import.meta.url),'utf8')
  const api=readFileSync(new URL('../api/afterhours/media-admin.js',import.meta.url),'utf8')
  assert.match(tokens,/INSERT INTO wildcard_sessions/)
  assert.match(tokens,/substring\(token_hash,1,4\) = 'au1_'/)
  assert.match(wrapper,/ProtectedData\]::Protect/)
  assert.match(wrapper,/ProtectedData\]::Unprotect/)
  assert.match(wrapper,/DataProtectionScope\]::CurrentUser/)
  assert.match(wrapper,/PairFromClipboard/)
  assert.match(wrapper,/Set-Clipboard -Value ''/)
  assert.match(wrapper,/ZeroFreeBSTR/)
  assert.doesNotMatch(wrapper,/vercel\.cmd env pull|DATABASE_URL/)
  assert.match(api,/body\.action === 'pair' \|\| body\.action === 'revoke-pairings'/)
  assert.match(api,/if \(!ownerBrowser\)/)
})
