import {emptyContent,normalizeContent} from './contentModel.js'
export const STRIPAGRAM_PROFILES={
 penny:{name:'Penny Bella Morningstar',handle:'penny',mark:'♠',bio:'Hostess, creative director and keeper of the velvet curtain. WildCard DEV.',role:'House management'},
 kandy:{name:'Kandy',handle:'kandy',mark:'K',bio:'Music, art and violet-lit creative experiments. WildCard DEV.',role:'Featured artist'},
 ashley:{name:'Ashley',handle:'ashley',mark:'A',bio:'Remembering Ashley through her WildCard DEV creative legacy.',role:'Creator'}
}
const DEMO=[
 ['penny','Main Stage','stage','The Velvet Hour','A WildCard cabaret','♠','#913456','The house is open. Tonight’s program: music, art, and a little theatrical glamour.',216],
 ['kandy','Sound booth','stage','Violet Frequency','Original music showcase','♫','#653b94','A little violet for the soundtrack. Original music takes the stage.',89],
 ['penny','Backstage','backstage','Behind the Curtain','Lighting design study','✧','#a22e4b','A spotlight, a velvet curtain, and the art of making an entrance.',113],
 ['kandy','Gallery','backstage','Color After Dark','Creative studio','◇','#754281','From the sketchbook to the gallery wall. A night of color and sound.',77],
 ['penny','VIP Lounge','vip','Lucky You','An invitation to the arts','♠','#9b5438','Tonight’s house special: a front-row seat to the creative showcase.',144],
 ['kandy','Main Stage','stage','Encore','The final number','♬','#742c82','One more track before the lights go down.',108]
]
export const STRIPAGRAM_POST_DEFAULTS={place:'Main Stage',type:'stage',subtitle:'',mark:'♠',spot:'#913456',likes:0}
export function emptyStripagram(area){
 const posts=DEMO.map(([who,place,type,title,subtitle,mark,spot,body,likes],i)=>({who,id:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),place,type,title,subtitle,mark,spot,body,likes,mediaId:null,link:''})).filter(p=>p.who===area).map(({who,...p})=>p)
 return {...emptyContent(),profile:{...STRIPAGRAM_PROFILES[area]},posts}
}
export function normalizeStripagram(value){
 const base=normalizeContent(value)
 if(!base||!value.profile||typeof value.profile!=='object')return null
 const p=value.profile
 const text=(v,n)=>typeof v==='string'&&v.length<=n
 if(!text(p.name,120)||!p.name.trim()||!text(p.handle,40)||!/^([a-zA-Z0-9_.-]+)$/.test(p.handle)||!text(p.mark,12)||!p.mark.trim()||!text(p.bio,2000)||!text(p.role,100))return null
 const posts=[]
 for(let i=0;i<base.posts.length;i++){
  const raw=value.posts[i]
  if(!text(raw.place,100)||!['stage','vip','backstage'].includes(raw.type)||!text(raw.subtitle,160)||!text(raw.mark,12)||!text(raw.spot,7)||!/^#[0-9a-f]{6}$/i.test(raw.spot)||!Number.isSafeInteger(raw.likes)||raw.likes<0||raw.likes>1000000)return null
  posts.push({...base.posts[i],place:raw.place,type:raw.type,subtitle:raw.subtitle,mark:raw.mark,spot:raw.spot,likes:raw.likes})
 }
 return {...base,orbitCards:emptyContent().orbitCards,profile:{name:p.name.trim(),handle:p.handle,mark:p.mark,bio:p.bio,role:p.role},posts}
}
