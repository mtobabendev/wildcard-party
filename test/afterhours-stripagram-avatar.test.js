import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext,Script} from 'node:vm'
const html=readFileSync(new URL('../public/stripagram/index.html',import.meta.url),'utf8')
test('StripaGram profile avatar expands and collapses for every creator without replacing media',()=>{
 const source=html.slice(html.indexOf('function profileAvatar('),html.indexOf('function renderProfile('))
 for(const who of ['penny','kandy','ashley']){
  const result=runInNewContext(`
    let avatarExpanded=false;
    const people={penny:{name:'Penny'},kandy:{name:'Kandy'},ashley:{name:'Ashley'}};
    const media={who};
    const ring=()=>media;
    const button=(text,cls,onclick)=>({onclick,attrs:{},append(x){this.child=x},setAttribute(k,v){this.attrs[k]=v}});
    const top={expanded:false,classList:{toggle(k,v){top.expanded=v}}};
    ${source}
    const b=profileAvatar(who,top);
    const initial=[top.expanded,b.attrs['aria-pressed'],b.attrs['aria-label']];
    b.onclick();
    const open=[top.expanded,b.attrs['aria-pressed'],b.attrs['aria-label'],b.child===media];
    b.onclick();
    ({initial,open,closed:[top.expanded,b.attrs['aria-pressed'],b.child===media]})
  `,{who});
  const name=who[0].toUpperCase()+who.slice(1);
  assert.equal(JSON.stringify(result.initial),JSON.stringify([false,'false','Enlarge '+name+' profile picture']));
  assert.equal(JSON.stringify(result.open),JSON.stringify([true,'true','Reduce '+name+' profile picture',true]));
  assert.equal(JSON.stringify(result.closed),JSON.stringify([false,'false',true]));
 }
 assert.match(html,/top\.append\(profileAvatar\(person,top\),info\)/)
 assert.match(html,/if\(person!==who\)avatarExpanded=false/)
 assert.match(html,/if\(v!=='profile'\)avatarExpanded=false/)
 assert.match(html,/width:min\(100%,320px\)/)
 assert.doesNotThrow(()=>new Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]))
})
