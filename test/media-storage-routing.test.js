import test from 'node:test'
import assert from 'node:assert/strict'
import {mediaStorageConfig,newObjectKey,storageProviderForKey,uploadLimit} from '../lib/media-storage-routing.js'
const legacy={AWS_ENDPOINT_URL_S3:'https://old.example',AWS_REGION:'us-east-1',AWS_ACCESS_KEY_ID:'test',AWS_SECRET_ACCESS_KEY:'test',NEON_STORAGE_BUCKET:'old'}
const fresh={PARTY_MEDIA_STORAGE_PROVIDER:'supabase',PARTY_MEDIA_S3_ENDPOINT:'https://example.storage.supabase.co/storage/v1/s3',PARTY_MEDIA_S3_REGION:'us-east-2',PARTY_MEDIA_S3_ACCESS_KEY_ID:'test',PARTY_MEDIA_S3_SECRET_ACCESS_KEY:'test',PARTY_MEDIA_S3_BUCKET:'new'}
const metadata={area:'penny',id:'11111111-1111-4111-8111-111111111111',name:'test.png'}
test('legacy remains default and existing object keys remain on original provider',()=>{
 const key=newObjectKey(metadata,legacy)
 assert.match(key,/^afterhours\//)
 assert.equal(mediaStorageConfig(key,{...legacy,...fresh}).bucket,'old')
 assert.equal(uploadLimit(legacy),150*1024*1024)
})
test('new provider uses opaque key and dedicated S3 credentials',()=>{
 const key=newObjectKey(metadata,fresh)
 assert.match(key,/^afterhours-v2\//)
 assert.equal(mediaStorageConfig(key,{...legacy,...fresh}).bucket,'new')
 assert.equal(mediaStorageConfig(key,fresh).clientOptions.requestChecksumCalculation,'WHEN_REQUIRED')
 assert.equal(uploadLimit(fresh),50_000_000)
 assert.equal(storageProviderForKey(key,{...legacy,...fresh,PARTY_MEDIA_STORAGE_PROVIDER:'legacy'}),'supabase')
})
test('missing or invalid alternative config fails closed instead of writing to legacy',()=>{
 assert.throws(()=>mediaStorageConfig(null,{...legacy,PARTY_MEDIA_STORAGE_PROVIDER:'supabase'}),{code:'STORAGE_NOT_CONFIGURED'})
 assert.throws(()=>mediaStorageConfig(null,{...fresh,PARTY_MEDIA_S3_ENDPOINT:'http://example.storage.supabase.co/storage/v1/s3'}),{code:'STORAGE_NOT_CONFIGURED'})
 assert.throws(()=>storageProviderForKey('unexpected/key',legacy),{code:'STORAGE_NOT_CONFIGURED'})
 assert.throws(()=>storageProviderForKey(null,{PARTY_MEDIA_STORAGE_PROVIDER:'typo'}),{code:'STORAGE_NOT_CONFIGURED'})
})
