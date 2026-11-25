import test from 'node:test'
import assert from 'node:assert/strict'
import {createCatalog,parseCatalog,restoreDraft,CATALOG_AREAS,CATALOG_SURFACES} from '../src/afterhours/catalogBackup.js'
import {emptyContent} from '../src/afterhours/contentModel.js'
import {emptyStripagram} from '../src/afterhours/stripagramModel.js'
const id='11111111-1111-4111-8111-111111111111', replacement='22222222-2222-4222-8222-222222222222', third='33333333-3333-4333-8333-333333333333'
const item={id,name:'sample.png',type:'image/png'}
const fixture=()=>createCatalog(CATALOG_AREAS.flatMap(area=>CATALOG_SURFACES.map(surface=>({
 area,surface,media:[item],content:{...(surface==='stripagram'?emptyStripagram(area):emptyContent()),bannerId:id}
}))))
test('six layouts round trip',()=>assert.deepEqual(parseCatalog(JSON.parse(JSON.stringify(fixture()))),fixture()))
test('unique filename and MIME recover changed ID',()=>assert.equal(restoreDraft(fixture(),'penny','afterhours',[{...item,id:replacement}]).bannerId,replacement))
test('missing and duplicate names reject restore',()=>{
 assert.throws(()=>restoreDraft(fixture(),'penny','afterhours',[]),/missing/)
 assert.throws(()=>restoreDraft(fixture(),'penny','afterhours',[{...item,id:replacement},{...item,id:third}]),/ambiguous/)
})
test('exact ID preferred',()=>assert.equal(restoreDraft(fixture(),'penny','stripagram',[item,{...item,id:replacement}]).bannerId,id))
test('invalid and incomplete backups rejected',()=>{
 const c=fixture()
 assert.throws(()=>parseCatalog({...c,pages:c.pages.slice(1)}))
 assert.throws(()=>parseCatalog({...c,pages:[c.pages[0],...c.pages.slice(0,5)]}))
 assert.throws(()=>parseCatalog({...c,pages:c.pages.map(p=>({...p,media:[]}))}),/unresolved/)
})
test('post IDs preserved and original unmodified',()=>{
 const c=fixture(),p=c.pages.find(p=>p.area==='penny'&&p.surface==='afterhours')
 p.content.posts=[{id:third,title:'Sample',body:'',mediaId:id,link:''}]
 p.content.orbitCards[0]=id
 const result=restoreDraft(c,'penny','afterhours',[{...item,id:replacement}])
 assert.equal(result.posts[0].id,third);assert.equal(result.posts[0].mediaId,replacement);assert.equal(result.orbitCards[0],replacement);assert.equal(p.content.bannerId,id)
})
