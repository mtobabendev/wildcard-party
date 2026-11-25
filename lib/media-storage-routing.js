// Route immutable object keys to their original backend; never retry a write in another bucket.
const PREFIX='afterhours-v2/'
export const LEGACY_MAX_BYTES=150*1024*1024
export const SUPABASE_MAX_BYTES=50_000_000
export const newUploadProvider=(env=process.env)=>{
 const value=env.PARTY_MEDIA_STORAGE_PROVIDER
 if(value==null||value===''||value==='legacy')return 'legacy'
 if(value==='supabase')return value
 throw storageError()
}
function storageError(){
 const error=new Error('Private storage is not configured.')
 error.code='STORAGE_NOT_CONFIGURED'
 return error
}
export function storageProviderForKey(key,env=process.env){
 if(key==null)return newUploadProvider(env)
 if(typeof key!=='string')throw storageError()
 if(key.startsWith(PREFIX))return 'supabase'
 if(key.startsWith('afterhours/'))return 'legacy'
 throw storageError()
}
export function newObjectKey({area,id,name},env=process.env){
 return newUploadProvider(env)==='supabase'?PREFIX+area+'/'+id:'afterhours/'+area+'/'+id+'-'+name
}
export function uploadLimit(env=process.env){
 return newUploadProvider(env)==='supabase'?SUPABASE_MAX_BYTES:LEGACY_MAX_BYTES
}
export function mediaStorageConfig(key,env=process.env){
 const provider=storageProviderForKey(key,env)
 const values=provider==='supabase'
  ? {endpoint:env.PARTY_MEDIA_S3_ENDPOINT,region:env.PARTY_MEDIA_S3_REGION,accessKeyId:env.PARTY_MEDIA_S3_ACCESS_KEY_ID,secretAccessKey:env.PARTY_MEDIA_S3_SECRET_ACCESS_KEY,bucket:env.PARTY_MEDIA_S3_BUCKET}
  : {endpoint:env.AWS_ENDPOINT_URL_S3,region:env.AWS_REGION,accessKeyId:env.AWS_ACCESS_KEY_ID,secretAccessKey:env.AWS_SECRET_ACCESS_KEY,bucket:env.NEON_STORAGE_BUCKET}
 if(Object.values(values).some(v=>typeof v!=='string'||!v.trim()))throw storageError()
 const {endpoint,region,accessKeyId,secretAccessKey,bucket}=values
 if(provider==='supabase'){
  let url
  try{url=new URL(endpoint)}catch{throw storageError()}
  if(url.protocol!=='https:'||!url.hostname.endsWith('.storage.supabase.co')||url.pathname.replace(/\/$/,'')!=='/storage/v1/s3'||url.username||url.password||url.search||url.hash)throw storageError()
 }
 return {provider,bucket,clientOptions:{endpoint,region,forcePathStyle:true,credentials:{accessKeyId,secretAccessKey},
  ...(provider==='supabase'?{requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'}:{})}}
}
