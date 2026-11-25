import test from 'node:test'
import assert from 'node:assert/strict'
import {storageProvider,storageProviderForKey,storageKeyPrefix,storageFileLimit,storageConfig} from '../lib/object-storage-config.js'
const legacy={AWS_ENDPOINT_URL_S3:'https://legacy.example',AWS_REGION:'us-east-1',NEON_STORAGE_BUCKET:'old',AWS_ACCESS_KEY_ID:'fake-old-id',AWS_SECRET_ACCESS_KEY:'fake-old-secret'}
const recovery={...legacy,PARTY_STORAGE_PROVIDER:'supabase',PARTY_STORAGE_ENDPOINT:'https://example.storage.supabase.co/storage/v1/s3',PARTY_STORAGE_REGION:'us-east-2',PARTY_STORAGE_BUCKET:'new',PARTY_STORAGE_ACCESS_KEY_ID:'fake-new-id',PARTY_STORAGE_SECRET_ACCESS_KEY:'fake-new-secret'}
test('old configuration is unchanged by default',()=>{
 assert.equal(storageProvider(legacy),'legacy')
 assert.equal(storageConfig('legacy',legacy).bucket,'old')
 assert.equal(storageFileLimit(legacy),150*1024*1024)
 assert.equal(storageKeyPrefix(legacy),'')
})
test('recovery configuration is separate and uses current upload limit',()=>{
 assert.equal(storageConfig('supabase',recovery).bucket,'new')
 assert.equal(storageConfig('legacy',recovery).bucket,'old')
 assert.equal(storageFileLimit(recovery),50000000)
 assert.equal(storageConfig('supabase',recovery).clientOptions.requestChecksumCalculation,'WHEN_REQUIRED')
})
test('persisted key namespace routes reads to their original provider',()=>{
 assert.equal(storageProviderForKey('afterhours/example'),'legacy')
 assert.equal(storageProviderForKey(storageKeyPrefix(recovery)+'afterhours/example'),'supabase')
})
test('missing or invalid recovery config never falls back',()=>{
 assert.throws(()=>storageConfig('supabase',{...recovery,PARTY_STORAGE_SECRET_ACCESS_KEY:''}),{code:'STORAGE_NOT_CONFIGURED'})
 assert.throws(()=>storageConfig('supabase',{...recovery,PARTY_STORAGE_ENDPOINT:'https://example.invalid'}),{code:'STORAGE_NOT_CONFIGURED'})
 assert.throws(()=>storageProvider({PARTY_STORAGE_PROVIDER:'typo'}),{code:'STORAGE_NOT_CONFIGURED'})
})
