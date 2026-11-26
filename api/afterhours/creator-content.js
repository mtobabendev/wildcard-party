import { currentAccount, sameOrigin } from '../../lib/auth-db.js'
import { isOwner } from '../../lib/penny-owner.js'
import { hasAreaGrant, validArea } from '../../lib/afterhours-access.js'
import { listAllPrivateMedia } from '../../lib/afterhours-media.js'
import { readContent, saveContent, readStripagram, saveStripagram } from '../../lib/creator-content.js'
import { normalizeContent, contentMediaValid } from '../../src/afterhours/contentModel.js'
import { normalizeStripagram } from '../../src/afterhours/stripagramModel.js'
const READ_ORIGINS=new Set(['https://wildcarddev.com','https://www.wildcarddev.com'])
export function createContentHandler({account=currentAccount,owner=isOwner,grant=hasAreaGrant,list=listAllPrivateMedia,read=readContent,save=saveContent,stripRead=readStripagram,stripSave=saveStripagram}={}) {
 return async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store')
  res.setHeader('X-Content-Type-Options','nosniff')
  res.setHeader('Vary','Origin')
  const origin=req.headers.origin
  if (req.method==='GET' && READ_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin',origin)
    res.setHeader('Access-Control-Allow-Credentials','true')
  }
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({error:'Method not allowed.'})
  if (req.method==='POST' && (!origin || !sameOrigin(req))) return res.status(403).json({error:'Owner browser origin required.'})
  const surface=req.query?.surface??'afterhours'
  if(!['afterhours','stripagram'].includes(surface))return res.status(400).json({error:'Invalid surface.'})
  const strip=surface==='stripagram'
  const area=validArea(req.query?.area)
  if (!area) return res.status(400).json({error:'Invalid creator.'})
  try {
    const user=await account(req)
    if (!user) return res.status(401).json({error:'Sign in to Messenger.'})
    const own=owner(user,process.env)
    if (req.method==='POST' && !own) return res.status(403).json({error:'Owner only.'})
    if (!own && !await grant(user.id,area)) return res.status(403).json({error:'Membership required.'})
    const media=await list(area)
    if (req.method==='GET') {
      const result=await (strip?stripRead:read)(area)
      const byId=new Map(media.map(x=>[x.id,x.type]))
      const content=result.content
      return res.status(200).json({revision:result.revision,content,media:media.map(x=>({id:x.id,name:x.name,type:x.type})),
        bannerType:byId.get(content.bannerId)||null})
    }
    let body=req.body
    if (typeof body==='string') {try{body=JSON.parse(body)}catch{return res.status(400).json({error:'Invalid JSON.'})}}
    const content=strip?normalizeStripagram(body?.content):normalizeContent(body?.content,area)
    if (!content || !Number.isSafeInteger(body.revision) || body.revision<0 || !contentMediaValid(content,media)) return res.status(400).json({error:'Invalid content or unavailable media.'})
    const result=await (strip?stripSave:save)(area,body.revision,content)
    return result ? res.status(200).json(result) : res.status(409).json({error:'Content changed in another session. Reload before editing.'})
  } catch {return res.status(503).json({error:'Content service unavailable.'})}
 }
}
export default createContentHandler()
