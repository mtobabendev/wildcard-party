// Rebase non-overlapping edits without discarding the saved revision guard.
const equal = (a,b) => {
  if (Object.is(a,b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  const keys=Object.keys(a)
  return keys.length===Object.keys(b).length && keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]))
}
export function mergeCreatorDraft(base,draft,latest) {
  const conflicts=[]
  function merge(a,b,c,path) {
    if(equal(a,b)) return c
    if(equal(a,c)||equal(b,c)) return b
    if(path==='orbitCards' && [a,b,c].every(x=>Array.isArray(x)&&x.length===8))
      return b.map((v,i)=>merge(a[i],v,c[i],path+'.'+(i+1)))
    if([a,b,c].every(x=>x&&typeof x==='object'&&!Array.isArray(x))) {
      const result={}
      for(const key of new Set([...Object.keys(a),...Object.keys(b),...Object.keys(c)])) {
        const value=merge(a[key],b[key],c[key],path?path+'.'+key:key)
        if(value!==undefined)result[key]=value
      }
      return result
    }
    conflicts.push(path)
    return b
  }
  const content=merge(base,draft,latest,'')
  return {content,conflicts}
}
export function browserMediaType(type,name) {
  const reported=String(type||'').toLowerCase()
  const ext=String(name||'').toLowerCase().split('.').pop()
  if (ext==='mp3' && (!reported || ['audio/mpeg','audio/mp3','audio/x-mpeg','application/octet-stream'].includes(reported))) return 'audio/mpeg'
  if(reported && reported!=='application/octet-stream')return reported
  return ({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',mp4:'video/mp4',webm:'video/webm',mp3:'audio/mpeg'})[ext]||''
}
