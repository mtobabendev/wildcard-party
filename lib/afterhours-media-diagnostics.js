// Only fixed stage names and bounded error categories leave the server.
const stages={
 'catalog-schema':'Prepare media database schema',
 'catalog-check':'Check existing media catalog',
 'storage-config':'Initialize private object storage',
 'storage-sign':'Create signed upload ticket',
 'catalog-reserve':'Reserve media catalog entry',
 'storage-write':'Write object to private storage',
 'catalog-pending':'Look up pending upload',
 'storage-verify':'Verify stored object',
 'catalog-finalize':'Mark verified media ready',
 'check':'Check media catalog',
 'start':'Prepare upload',
 'relay':'Relay small file',
 'finish':'Verify upload',
 'move':'Move catalog entry',
 'remove':'Remove catalog entry',
 'pair':'Create workstation pairing',
 'revoke-pairings':'Revoke workstation pairings',
 'session':'Check owner session',
 'request':'Process media request'
}
export async function mediaStage(stage,operation){
 try{return await operation()}catch(cause){
  if(cause instanceof MediaStageError)throw cause
  throw new MediaStageError(stage,cause)
 }
}
class MediaStageError extends Error{
 constructor(stage,cause){super('Media operation failed',{cause});this.stage=stage}
}
export function mediaDiagnostic(error,fallback='request'){
 const stage=error instanceof MediaStageError&&Object.hasOwn(stages,error.stage)?error.stage:Object.hasOwn(stages,fallback)?fallback:'request'
 const cause=error instanceof MediaStageError?error.cause:error
 const code=cause?.code, name=cause?.name, status=cause?.$metadata?.httpStatusCode
 let reason='SERVICE_ERROR'
 if(['DATABASE_NOT_CONFIGURED','STORAGE_NOT_CONFIGURED'].includes(code))reason=code
 else if(status===401||status===403||['AccessDenied','InvalidAccessKeyId','SignatureDoesNotMatch','ExpiredToken'].includes(name))reason='STORAGE_AUTH'
 else if(status===404||['NoSuchKey','NoSuchBucket','NotFound'].includes(name))reason='STORAGE_NOT_FOUND'
 else if(status===429||status===503||['SlowDown','Throttling','ServiceUnavailable'].includes(name))reason='SERVICE_UNAVAILABLE'
 else if(['ETIMEDOUT','ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN'].includes(code)||['TimeoutError','AbortError'].includes(name))reason='NETWORK_ERROR'
 else if(typeof code==='string'&&/^[0-9A-Z]{5}$/.test(code)&&/^(08|22|23|28|42|53|57)/.test(code))reason='SQL_'+code
 return {stage,reason,error:stages[stage]+' failed ('+reason+').'}
}
