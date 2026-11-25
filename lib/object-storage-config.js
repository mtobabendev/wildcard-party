// Server-only configuration. Provider selection is explicit and never retries another store.
export const RECOVERY_PREFIX='recovery-v1/'
export const LEGACY_FILE_LIMIT=150*1024*1024
export const RECOVERY_FILE_LIMIT=50000000
export function storageProvider(env=process.env){
 const provider=env.PARTY_STORAGE_PROVIDER||'legacy'
 if(!['legacy','supabase'].includes(provider))throw configurationError()
 return provider
}
function configurationError(){
 const error=new Error('Private storage configuration unavailable.')
 error.code='STORAGE_NOT_CONFIGURED'
 return error
}
export function storageProviderForKey(key){
 return typeof key==='string'&&key.startsWith(RECOVERY_PREFIX)?'supabase':'legacy'
}
export function storageKeyPrefix(env=process.env){
 return storageProvider(env)==='supabase'?RECOVERY_PREFIX:''
}
export function storageFileLimit(env=process.env){
 return storageProvider(env)==='supabase'?RECOVERY_FILE_LIMIT:LEGACY_FILE_LIMIT
}
export function storageConfig(provider,env=process.env){
 if(!['legacy','supabase'].includes(provider))throw configurationError()
 const recovery=provider==='supabase'
 const endpoint=recovery?env.PARTY_STORAGE_ENDPOINT:env.AWS_ENDPOINT_URL_S3
 const region=recovery?env.PARTY_STORAGE_REGION:env.AWS_REGION
 const bucket=recovery?env.PARTY_STORAGE_BUCKET:env.NEON_STORAGE_BUCKET
 const accessKeyId=recovery?env.PARTY_STORAGE_ACCESS_KEY_ID:env.AWS_ACCESS_KEY_ID
 const secretAccessKey=recovery?env.PARTY_STORAGE_SECRET_ACCESS_KEY:env.AWS_SECRET_ACCESS_KEY
 if(!endpoint||!region||!bucket||!accessKeyId||!secretAccessKey)throw configurationError()
 let url
 try{url=new URL(endpoint)}catch{throw configurationError()}
 if(recovery&&(url.protocol!=='https:'||!/^([a-z0-9]+)\.storage\.supabase\.co$/.test(url.hostname)||url.pathname!=='/storage/v1/s3'||url.username||url.password||url.search||url.hash))throw configurationError()
 return {bucket,clientOptions:{endpoint,region,forcePathStyle:true,credentials:{accessKeyId,secretAccessKey},...(recovery?{requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'}:{})}}
}
