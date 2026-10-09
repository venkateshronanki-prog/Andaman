(function(){
'use strict';
const $=id=>document.getElementById(id);
const te=new TextEncoder(),td=new TextDecoder();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inr=n=>'₹'+Math.round(n).toLocaleString('en-IN');
const mins=t=>{const[a,b]=t.split(':');return +a*60+ +b};
const hm=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
function normT(t){const m=/^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(String(t));if(!m)return null;const h=+m[1],n=+m[2];if(h>23||n>59)return null;return String(h).padStart(2,'0')+':'+m[2]}
const b64=u8=>{let s='';for(let i=0;i<u8.length;i+=0x8000)s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));return btoa(s)};
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));

/* ================= storage (IndexedDB, with memory fallback) ================= */
const IDB={db:null,fail:false,mem:{kv:{},ph:{}},
 open(){return new Promise(res=>{try{const r=indexedDB.open('an-trip',1);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains('kv'))d.createObjectStore('kv');if(!d.objectStoreNames.contains('ph'))d.createObjectStore('ph')};r.onsuccess=()=>{IDB.db=r.result;res(true)};r.onerror=()=>{IDB.fail=true;res(false)};r.onblocked=()=>{IDB.fail=true;res(false)}}catch(e){IDB.fail=true;res(false)}})},
 get(s,k){if(IDB.fail)return Promise.resolve(IDB.mem[s][k]);return new Promise(res=>{try{const q=IDB.db.transaction(s).objectStore(s).get(k);q.onsuccess=()=>res(q.result);q.onerror=()=>res(undefined)}catch(e){res(undefined)}})},
 set(s,k,v){IDB.mem[s][k]=v;if(IDB.fail)return Promise.resolve(true);return new Promise(res=>{try{const t=IDB.db.transaction(s,'readwrite');t.objectStore(s).put(v,k);t.oncomplete=()=>res(true);t.onerror=()=>res(false);t.onabort=()=>res(false)}catch(e){res(false)}})},
 del(s,k){delete IDB.mem[s][k];if(IDB.fail)return Promise.resolve(true);return new Promise(res=>{try{const t=IDB.db.transaction(s,'readwrite');t.objectStore(s).delete(k);t.oncomplete=()=>res(true);t.onerror=()=>res(false)}catch(e){res(false)}})},
 all(s){if(IDB.fail)return Promise.resolve(Object.assign({},IDB.mem[s]));return new Promise(res=>{try{const out={};const q=IDB.db.transaction(s).objectStore(s).openCursor();q.onsuccess=()=>{const c=q.result;if(c){out[c.key]=c.value;c.continue()}else res(out)};q.onerror=()=>res(out)}catch(e){res({})}})}};

/* ================= state, validation, self-repair ================= */
let ST=null;      // {syn,ob,cf,done,ui,dev,cfg}
const phMem={};
const okItem=v=>v&&typeof v==='object'&&Number.isInteger(v.rev)&&(v.del===true||(typeof v.x==='string'&&v.x.trim()&&normT(v.t)&&v.d>=10&&v.d<=20));
const okDoc=d=>d&&typeof d==='object'&&(d.del===true||(typeof d.x==='string'&&d.x.trim()&&normT(d.t)&&d.d>=10&&d.d<=20));
const okOp=o=>o&&typeof o==='object'&&((o.k==='item'&&typeof o.id==='string'&&/^[\w.~:@+-]+$/.test(o.id)&&okDoc(o.doc)&&Number.isInteger(o.base))||((o.k==='set'||o.k==='del')&&typeof o.path==='string'&&/^(photos|expenses|checks|meta)\/[\w.~:@+-]+$/.test(o.path)&&(o.k==='del'||(o.doc&&typeof o.doc==='object'))));
let healed=0;
function blank(){return{syn:{items:{},exp:{},chk:{},meta:{}},ob:[],cf:[],done:[],ui:{tab:'today',sel:null,sc:{},day:null},dev:null,cfg:null}}
function heal(){let n=0;
 try{
  if(!ST||typeof ST!=='object'){ST=blank();n++}
  const B=blank();
  for(const k of Object.keys(B)){if(ST[k]===undefined||(B[k]!==null&&typeof ST[k]!==typeof B[k])||(Array.isArray(B[k])&&!Array.isArray(ST[k]))){ST[k]=B[k];n++}}
  for(const k of['items','exp','chk','meta'])if(!ST.syn[k]||typeof ST.syn[k]!=='object'){ST.syn[k]={};n++}
  for(const id in ST.syn.items)if(!okItem(ST.syn.items[id])){delete ST.syn.items[id];n++}
  ST.ob=ST.ob.filter(o=>{const k=okOp(o);if(!k)n++;return k});
  ST.ob.forEach(o=>{if(o.k==='item'&&o.doc&&o.doc.del!==true){const t=normT(o.doc.t);if(t&&t!==o.doc.t){o.doc.t=t;n++}o.doc.x=String(o.doc.x).trim().slice(0,400)}});
  const seen=new Set();ST.ob=ST.ob.filter(o=>{if(o.k!=='item')return true;if(seen.has(o.id)){n++;return false}seen.add(o.id);return true});
  ST.cf=ST.cf.filter(c=>c&&typeof c.id==='string'&&okDoc(c.mine));
  if(!ST.ui||typeof ST.ui!=='object'){ST.ui=B.ui;n++}
  if(!ST.ui.sc||typeof ST.ui.sc!=='object')ST.ui.sc={};
  if(!['today','trip','book','list','money'].includes(ST.ui.tab))ST.ui.tab='today';
 }catch(e){ST=blank();n++}
 if(n){healed+=n;save()}
 return n}
let saveT=0;
function save(now){if(!ST)return;clearTimeout(saveT);const go=()=>{IDB.set('kv','state',JSON.parse(JSON.stringify(ST)));try{localStorage.setItem('an-ui',JSON.stringify(ST.ui))}catch(e){}};if(now)go();else saveT=setTimeout(go,120)}
window.addEventListener('pagehide',()=>save(true));
document.addEventListener('visibilitychange',()=>{if(document.hidden)save(true);else{poll();}});
function getPh(id){return phMem[id]||null}
async function setPh(id,img){if(img){phMem[id]=img;await IDB.set('ph',id,img)}else{delete phMem[id];await IDB.del('ph',id)}}

/* ================= crypto ================= */
let K=null,KRAW=null,TRIP=null;
async function deriveRaw(pass,salt,iter){const base=await crypto.subtle.importKey('raw',te.encode(pass),'PBKDF2',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:iter},base,256))}
async function setKey(raw){KRAW=raw;K=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
 const h=new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array([...raw,...te.encode('trip')])));TRIP=[...h].slice(0,16).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function sealBytes(u8){const iv=crypto.getRandomValues(new Uint8Array(12));const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},K,u8));const o=new Uint8Array(12+ct.length);o.set(iv);o.set(ct,12);return o}
async function openBytes(u8){return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:u8.subarray(0,12)},K,u8.subarray(12)))}
const seal=async o=>b64(await sealBytes(te.encode(JSON.stringify(o))));
const unseal=async s=>JSON.parse(td.decode(await openBytes(unb64(s))));

/* ================= data (decrypted payload) ================= */
let D=null,DAYS=[],DOCS=[],BOOK=[],TODO0=[];
const SC=window.SCENES||{};
async function loadPayload(){const P=window.PAYLOAD;if(!P)throw new Error('payload missing');D=JSON.parse(td.decode(await openBytes(unb64(P.ct))));
 DAYS=D.days;DOCS=D.docs;BOOK=D.book;TODO0=D.todo}

/* ================= Firestore REST sync ================= */
const FS={base:'https://firestore.googleapis.com/v1'};
const SYNC={live:false,ro:false,denied:false,err:'',busy:false,ut:{},phut:{},last:0};
function cfg(){const c=window.FB&&window.FB.projectId&&window.FB.apiKey?window.FB:(ST&&ST.cfg&&ST.cfg.projectId&&ST.cfg.apiKey?ST.cfg:null);return c}
function enc(v){if(v===null||v===undefined)return{nullValue:null};if(typeof v==='string')return{stringValue:v};if(typeof v==='boolean')return{booleanValue:v};if(typeof v==='number')return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};if(typeof v==='object'){const f={};for(const k in v)f[k]=enc(v[k]);return{mapValue:{fields:f}}}return{nullValue:null}}
function dec(x){if(!x)return null;if('stringValue'in x)return x.stringValue;if('integerValue'in x)return Number(x.integerValue);if('doubleValue'in x)return x.doubleValue;if('booleanValue'in x)return x.booleanValue;if('mapValue'in x){const o={},f=x.mapValue.fields||{};for(const k in f)o[k]=dec(f[k]);return o}if('arrayValue'in x)return(x.arrayValue.values||[]).map(dec);return null}
const decFields=f=>{const o={};for(const k in(f||{}))o[k]=dec(f[k]);return o};
const encFields=o=>{const f={};for(const k in o)f[k]=enc(o[k]);return f};
async function api(method,path,qs,body){
 const c=cfg();if(!c)throw{code:'nocfg'};
 const base=(c.apiBase||FS.base);const url=`${base}/projects/${encodeURIComponent(c.projectId)}/databases/${encodeURIComponent(c.databaseId||"(default)")}/documents/trips/${TRIP}${path?'/'+path:''}`;
 const q=new URLSearchParams();q.set('key',c.apiKey);(qs||[]).forEach(([k,v])=>q.append(k,v));
 let r;try{r=await fetch(url+'?'+q.toString(),{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined})}catch(e){throw{code:'unavailable'}}
 let j=null;try{j=await r.json()}catch(e){}
 if(r.ok){if(j===null||typeof j!=='object')throw{code:'unavailable'};return{status:r.status,json:j}}
 if(j===null&&r.status!==404)throw{code:'unavailable'};
 const st=j&&j.error&&j.error.status||'';
 if(r.status===404)return{status:404,json:null};
 if(r.status===409||r.status===412||st==='FAILED_PRECONDITION'||st==='ABORTED'||(r.status===400&&/precondition/i.test(JSON.stringify(j||{}))))throw{code:'precondition'};
 if(r.status===403||r.status===401||st==='PERMISSION_DENIED'||st==='UNAUTHENTICATED')throw{code:'denied',msg:j&&j.error&&j.error.message};
 if(r.status===400&&/API key/i.test(JSON.stringify(j||{})))throw{code:'denied'};
 if(r.status===429||r.status>=500)throw{code:'unavailable'};
 throw{code:'invalid',msg:j&&j.error&&j.error.message}}
async function listAll(coll,mask){const out=[];let tok='';for(let i=0;i<40;i++){const qs=[['pageSize','300']];if(tok)qs.push(['pageToken',tok]);(mask||[]).forEach(m=>qs.push(['mask.fieldPaths',m]));const r=await api('GET',coll,qs);if(r.status!==200||!r.json)throw{code:'unavailable'};const j=r.json;(j.documents||[]).forEach(d=>out.push(d));tok=j.nextPageToken;if(!tok)break}return out}
const idOf=d=>d.name.split('/').pop();
async function wire(path,doc){const[c]=path.split('/');if(c==='photos')return{by:doc.by||'',at:doc.at||0,ct:await seal({img:doc.img})};if(c==='expenses')return{by:doc.by||'',at:doc.at||0,ct:await seal(doc)};return doc}
async function itemFromRemote(d){const f=decFields(d.fields);if(!Number.isInteger(f.rev)||typeof f.ct!=='string')return null;try{const o=await unseal(f.ct);const v=Object.assign({},o,{rev:f.rev,ut:d.updateTime});return okItem(v)?v:null}catch(e){return null}}
async function poll(){
 if(!cfg()||!K||SYNC.busy||document.hidden)return;SYNC.busy=true;
 try{
  let ch=false;
  // items
  const its=await listAll('items');const seen={};
  for(const d of its){const id=idOf(d);const o=ST.syn.items[id];seen[id]=1;if(o&&o.ut===d.updateTime)continue;const v=await itemFromRemote(d);if(v){ST.syn.items[id]=v;ch=true}}
  for(const id in ST.syn.items)if(!seen[id]){delete ST.syn.items[id];ch=true}
  // photos (metadata only first)
  const phs=await listAll('photos',['at']);const pseen={};
  for(const d of phs){const id=idOf(d);pseen[id]=1;if(SYNC.phut[id]===d.updateTime||pendingPath('photos/'+id))continue;
   try{const r=await api('GET','photos/'+id);if(r.status===200){const f=decFields(r.json.fields);const o=await unseal(f.ct);await setPh(id,o.img);SYNC.phut[id]=d.updateTime;ch=true}}catch(e){if(e&&e.code!=='precondition')throw e}}
  for(const id in SYNC.phut)if(!pseen[id]&&!pendingPath('photos/'+id)){delete SYNC.phut[id];await setPh(id,null);ch=true}
  // expenses
  const exs=await listAll('expenses');const eseen={};
  for(const d of exs){const id=idOf(d);eseen[id]=1;if(pendingPath('expenses/'+id))continue;const f=decFields(d.fields);try{const o=await unseal(f.ct);if(o&&typeof o.a==='number'&&JSON.stringify(ST.syn.exp[id])!==JSON.stringify(o)){ST.syn.exp[id]=o;ch=true}}catch(e){}}
  for(const id in ST.syn.exp)if(!eseen[id]&&!pendingPath('expenses/'+id)){delete ST.syn.exp[id];ch=true}
  // checks + budget
  const cks=await listAll('checks');for(const d of cks){const id=idOf(d);const f=decFields(d.fields);if(typeof f.v==='boolean'&&!pendingPath('checks/'+id)&&ST.syn.chk[id]!==f.v){ST.syn.chk[id]=f.v;ch=true}}
  const mt=await listAll('meta');for(const d of mt){if(idOf(d)==='budget'){const f=decFields(d.fields);if(typeof f.v==='number'&&!pendingPath('meta/budget')&&ST.syn.meta.budget!==f.v){ST.syn.meta.budget=f.v;ch=true}}}
  SYNC.live=true;SYNC.denied=false;SYNC.err='';SYNC.last=Date.now();
  if(ch){detect();save();softRender()}
  status();
 }catch(e){SYNC.live=false;if(e&&e.code==='denied'){SYNC.denied=true;SYNC.err=e.msg||'Access denied'}else if(e&&e.code!=='unavailable'){SYNC.err=(e&&(e.msg||e.code))||'error'}status()}
 finally{SYNC.busy=false}}
const pendingPath=p=>ST.ob.some(o=>o.path===p);

/* ================= outbox and conflicts ================= */
const sameItem=(a,b)=>!!a.del===!!b.del&&(a.del||(a.t===b.t&&a.x===b.x));
function queueItem(id,doc){const b=ST.syn.items[id]?ST.syn.items[id].rev:0;const ex=ST.ob.find(o=>o.k==='item'&&o.id===id);if(ex)ex.doc=doc;else ST.ob.push({k:'item',id,doc,base:b});save();flush();status()}
function queueSet(path,doc){ST.ob=ST.ob.filter(o=>o.path!==path);ST.ob.push({k:'set',path,doc});save();flush()}
function queueDel(path){ST.ob=ST.ob.filter(o=>o.path!==path);ST.ob.push({k:'del',path});save();flush()}
let flushing=false,retry=0;
async function runOp(op){
 if(op.k==='item'){
  for(let tries=0;tries<4;tries++){
   const g=await api('GET','items/'+op.id);let r=null,ut=null;if(g.status===200){const f=decFields(g.json.fields);ut=g.json.updateTime;r=await itemFromRemote(g.json)}
   const rr=g.status===200?(Number.isInteger(decFields(g.json.fields).rev)?decFields(g.json.fields).rev:0):0;
   if(rr!==op.base){if(r&&sameItem(r,op.doc)){ST.syn.items[op.id]=r;return}throw{code:'conflict',remote:r,rr}}
   const body={fields:encFields({rev:rr+1,by:DEV(),at:Date.now(),ct:await seal(op.doc)})};
   const pre=g.status===200?[['currentDocument.updateTime',ut]]:[['currentDocument.exists','false']];
   try{const w=await api('PATCH','items/'+op.id,pre,body);const nv=await itemFromRemote(w.json);if(nv)ST.syn.items[op.id]=nv;else ST.syn.items[op.id]=Object.assign({},op.doc,{rev:rr+1});return}
   catch(e){if(e&&e.code==='precondition')continue;throw e}}
  throw{code:'unavailable'}}
 else if(op.k==='set'){const[c,id]=op.path.split('/');await api('PATCH',op.path,[],{fields:encFields(await wire(op.path,op.doc))});if(c==='expenses')ST.syn.exp[id]=op.doc;if(c==='checks')ST.syn.chk[id]=op.doc.v;if(c==='meta'&&id==='budget')ST.syn.meta.budget=op.doc.v}
 else if(op.k==='del'){await api('DELETE',op.path,[])}}
async function flush(){
 if(flushing||!cfg()||!K||SYNC.ro||SYNC.denied)return;flushing=true;
 try{while(ST.ob.length){const op=ST.ob[0];
  try{await runOp(op);ST.ob.shift();retry=0;save()}
  catch(e){
   if(e&&e.code==='conflict'){ST.ob.shift();ST.cf.push({id:op.id,mine:op.doc,theirs:e.remote,rr:e.rr||0});save();status();showConflict();continue}
   if(e&&e.code==='denied'){SYNC.denied=true;SYNC.err=e.msg||'Access denied';break}
   if(e&&e.code==='invalid'){toast('One change could not be shared and was kept on this phone.');ST.ob.shift();save();continue}
   retry++;setTimeout(flush,Math.min(30000,1500*Math.pow(2,Math.min(retry,4))));break}}
 }finally{flushing=false;status();softRender()}}
function detect(){let moved=false;ST.ob=ST.ob.filter(o=>{if(o.k!=='item')return true;const r=ST.syn.items[o.id];const rr=r?r.rev:0;if(rr===o.base)return true;
  if(r&&sameItem(r,o.doc)){moved=true;return false}
  ST.cf.push({id:o.id,mine:o.doc,theirs:r||null,rr});moved=true;return false});
 if(moved){save();showConflict()}}
setInterval(()=>{if(ST&&ST.ob.length)flush()},20000);
setInterval(()=>poll(),12000);
window.addEventListener('online',()=>{retry=0;flush();poll()});
const DEV=()=>{if(!ST.dev){ST.dev='d'+Math.random().toString(36).slice(2,8);save()}return ST.dev};

/* ================= derived data ================= */
const dayOf=n=>DAYS.find(d=>d.n===n);
function ovMap(){const m=Object.assign({},ST.syn.items);ST.ob.forEach(o=>{if(o.k==='item')m[o.id]=Object.assign({},o.doc,{pending:true})});return m}
function itemsFor(n){const m=ovMap(),day=dayOf(n),out=[];if(!day)return out;
 day.items.forEach((b,i)=>{const o=m[b.id];if(o&&o.del)return;out.push({id:b.id,t:o&&o.t?o.t:b.t,x:o&&o.x?o.x:b.x,g:b.g,docs:b.docs||[],ord:i,pending:!!(o&&o.pending),base:true,edited:!!o})});
 for(const id in m){const o=m[id];if(o.own&&o.d===n&&!o.del&&okDoc(o))out.push({id,t:o.t,x:o.x,g:[],docs:[],ord:999,pending:!!o.pending,base:false})}
 out.sort((a,b)=>mins(a.t)-mins(b.t)||a.ord-b.ord);return out}
function kindOf(x){const s=x.toLowerCase();
 if(/sunset|sunrise/.test(s))return'sun';if(/wake up|alarm/.test(s))return'alarm';
 if(/breakfast|lunch|dinner|snack|tea\b|meal|ice cream/.test(s))return'food';
 if(/snorkel|speedboat|glass-bottom|elephant beach|coral/.test(s))return'snorkel';
 if(/theme park|water park|rides|imagicaa|splash|wave pool/.test(s))return'park';
 if(/cellular|light & sound|show|ross island|ruins|north bay|lighthouse|natural bridge|jail/.test(s))return'sight';
 if(/ferry|makruzz|nautika|jetty|boat/.test(s))return'ferry';
 if(/flight|indigo|airport|land at|bag drop|security|gate|terminal/.test(s))return'plane';
 if(/cab|drive|transfer|pick-?up/.test(s))return'cab';
 if(/beach|radhanagar|kalapathar|bharatpur|laxmanpur|cove|sand|swim|pool/.test(s))return'beach';
 if(/check in|check-in|check out|hotel|nap|rest|bed|sleep|lights out|freshen|resort/.test(s))return'bed';
 if(/pack|id\b|print|ticket/.test(s))return'pack';return'pin'}
function ist(){const d=new Date(Date.now()+19800000);return{y:d.getUTCFullYear(),mo:d.getUTCMonth(),d:d.getUTCDate(),m:d.getUTCHours()*60+d.getUTCMinutes()}}
const TRIP0=Date.UTC(2026,9,10);
function clock(){const p=ST.ui.pv;if(p&&p.day>=10&&p.day<=20&&p.m>=0)return{day:p.day,m:p.m,pv:true};
 const n=ist();if(n.y===2026&&n.mo===9&&n.d>=10&&n.d<=20)return{day:n.d,m:n.m,live:true};
 const diff=Math.ceil((TRIP0-Date.UTC(n.y,n.mo,n.d))/864e5);return{day:diff>0?10:20,m:0,before:diff>0,after:diff<=0,diff}}
let tab='today',sel=null;
const theme=d=>`--tbg:var(--${d.th});--ts:var(--${d.th}-s)`;
const dow=d=>d.dow+' '+d.n+' Oct';
const early=its=>its.length&&mins(its[0].t)<360;
const ICON={today:'<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>',trip:'<path d="M3 12l18-8-7 18-3-8z"/>',book:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',list:'<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',money:'<circle cx="12" cy="12" r="9"/><path d="M9 9h5a2 2 0 010 4h-4a2 2 0 000 4h5"/>'};
const TABS=[['today','Today'],['trip','Trip'],['book','Bookings'],['list','Lists'],['money','Money']];
function toast(m){const t=$('toast');t.textContent=m;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>t.hidden=true,2600)}
function fixed(e){healed++;try{heal()}catch(x){}try{console.warn('auto-fixed',e&&(e.message||e.code))}catch(x){}}
function status(){const el=$('stat');if(!el)return;const n=ST.ob.length,c=ST.cf.length;let h;
 if(!cfg())h=`<b class="w">Not shared yet</b><span>${n?n+' change'+(n>1?'s':'')+' saved here':'Saved on this phone'}</span><button data-a="settings">Set up sync</button>`;
 else if(SYNC.denied)h=`<b class="r">Sync blocked</b><span>Check the Firebase rules</span><button data-a="settings">Fix</button>`;
 else if(c)h=`<b class="r">Needs your decision</b><button data-a="conf">Review</button>`;
 else if(!SYNC.live)h=`<b class="w">Offline</b><span>${n?n+' waiting to send':'Everything saved on this phone'}</span>`;
 else if(n)h=`<b class="w">${n} waiting</b><span>Sending…</span>`;
 else h=`<b>Synced</b><span>Shared with your partner</span>`;
 el.innerHTML=h+`<span class="sbtns${/<button/.test(h)?'':' push'}"><button class="gear" data-a="search" aria-label="Search"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg></button><button class="sos" data-a="sos" aria-label="Emergency card">SOS</button>${cfg()?'<button class="gear" data-a="settings" aria-label="Settings">⚙</button>':''}</span>`}
const stat=()=>`<div class="stat" id="stat"></div>`;

/* ================= views ================= */
function drawNav(){$('nav').innerHTML=TABS.map(([k,l])=>`<button data-t="${k}" aria-selected="${tab===k}" aria-label="${l}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>${l}</button>`).join('')}
function thumb(it){const ph=getPh(it.id),k=kindOf(it.x);
 return `<button class="th" data-ph="${esc(it.id)}" data-q="${esc(it.x.slice(0,60))}" aria-label="${ph?'Change photo':'Add photo'}">${ph?`<img src="${ph}" alt="">`:`<svg viewBox="0 0 96 96" width="52" height="52" aria-hidden="true"><use href="#k-${k}"/></svg>`}<i>${ph?'✎':'+'}</i></button>`}
function installBanner(){const standalone=window.navigator.standalone||matchMedia('(display-mode: standalone)').matches;if(standalone||ST.ui.nohint)return'';
 return `<div class="install"><div><b>Install this app.</b> Tap the Share button in Safari, then Add to Home Screen. It then opens full screen and works with no signal.</div><button data-a="hint">Got it</button></div>`}
function glance(its,dn,isNow,c){try{const n=its.length,k=its.filter(i=>dn.has(i.id)).length;const hmn=t=>{const m=/^(\d+):(\d+)/.exec(t||'');return m?(+m[1])*60+(+m[2]):-1};
let nx=its.find(i=>!dn.has(i.id)&&(!isNow||hmn(i.t)>=c.m))||its.find(i=>!dn.has(i.id));
const txt=!n?'Nothing planned yet':(k===n?'All done. Enjoy the rest of the day.':nx?`Next ${esc(nx.t||'')} ${esc(String(nx.x||'').slice(0,46))}`:'');
return `<div class="glance"><div class="gl-n"><b>${k}</b>/${n}<span>done</span></div><div class="gl-t">${txt}</div><div class="gl-bs">${flightsAll().some(f=>f.day===sel)?'<button class="btn ghost gl-b" data-a="checkin">Check-in</button>':''}<button class="btn ghost gl-b" data-a="pack">Pack</button></div></div>`}catch(e){return''}}
const TA_APP='https://apps.apple.com/in/app/tripadvisor-plan-book-trips/id284876795';
const TA_PLACE={10:'Khopoli',11:'Andheri East Mumbai',12:'Port Blair',13:'Havelock Island',14:'Havelock Island',15:'Havelock Island',16:'Havelock Island',17:'Neil Island Andaman',18:'Port Blair',19:'Port Blair',20:'Port Blair'};
function taCard(n){const p=TA_PLACE[n]||'Andaman',q=encodeURIComponent(p);
 return `<div class="card ta"><div class="eyebrow" style="margin-bottom:8px">Activities and food · ${esc(p)}</div><div class="tarow"><a class="btn ghost" data-ta="1" href="https://www.tripadvisor.in/Search?q=${q}%20things%20to%20do" target="_blank" rel="noopener noreferrer">Things to do</a><a class="btn ghost" data-ta="1" href="https://www.tripadvisor.in/Search?q=${q}%20restaurants" target="_blank" rel="noopener noreferrer">Where to eat</a><a class="btn ghost" href="${TA_APP}" target="_blank" rel="noopener noreferrer">TripAdvisor app</a></div></div>`}
function viewToday(){
 const c=clock();if(sel==null||!dayOf(sel))sel=c.day;const d=dayOf(sel);const its=itemsFor(sel);const dn=new Set(ST.done);for(const kk in ST.syn.chk)if(kk.startsWith('a_')){const id0=kk.slice(2);ST.syn.chk[kk]?dn.add(id0):dn.delete(id0)}
 let h=`<div class="top"><div><div class="eyebrow">${dow(d)}</div><h1>${esc(d.title)}</h1></div></div>${installBanner()}${stat()}`;
 h+=`<div class="chips" role="group" aria-label="Pick a day">${DAYS.map(x=>`<button class="chip${x.n===c.day&&(c.live||c.pv)?' today':''}" data-d="${x.n}" aria-pressed="${x.n===sel}"><b>${x.n}</b><span>${x.dow}</span></button>`).join('')}</div>`;
 if(!c.live&&!c.pv)h+=`<div class="note" style="margin:0 0 14px;background:var(--sky)"><b style="color:var(--sky-s)">${c.before?`Trip starts in ${c.diff} day${c.diff===1?'':'s'}.`:'Trip is over.'}</b> The Now card goes live on Oct 10. <button class="btn ghost" data-a="pvon" style="padding:4px 10px;min-height:0;border-radius:10px">Preview a time</button></div>`;
 if(c.pv)h+=`<div class="card" style="margin-bottom:14px"><div class="eyebrow" style="margin-bottom:8px">Preview mode</div><div class="pv"><select class="in" id="pvd" aria-label="Preview day">${DAYS.map(x=>`<option value="${x.n}"${x.n===c.day?' selected':''}>${dow(x)}</option>`).join('')}</select><input class="in" id="pvt" type="time" value="${hm(c.m)}" aria-label="Preview time"></div><button class="btn ghost" data-a="pvoff">Use real clock</button></div>`;
 const isNow=(c.live||c.pv)&&c.day===sel;
 if(isNow)h+=`<div id="leavec"></div><section class="now" style="${theme(d)}" id="nowc"></section>`;
 h+=kidCard(d,its,dn);
 const cover=getPh('cover-'+sel);
 h+=`<div class="cover" style="${theme(d)}"><div class="art">${cover?`<img src="${cover}" alt="">`:SC[d.sc]||''}</div><button class="photo" data-ph="cover-${sel}" data-q="${esc(d.title)}">${cover?'Change photo':'Add photo'}</button><div class="meta"><div style="display:flex;gap:6px;flex-wrap:wrap">${early(its)?'<span class="pill rose">Early start '+its[0].t+'</span>':''}<span class="pill mint">${esc(d.stay.replace(/ \(.*\)/,''))}</span></div></div></div><div class="dinfo" id="dinfo"></div>${glance(its,dn,isNow,c)}`;
 h+=taCard(sel);
 h+=`<div class="addrow"><button class="btn" data-a="add">+ Add activity</button></div>`;
 h+=`<ol class="tl" style="${theme(d)}">${its.length?its.map(it=>row(it,dn)).join(''):'<li><span></span><div class="x" style="color:var(--soft)">No activities yet. Tap Add activity.</div><span></span></li>'}</ol>`;
 if(d.note)h+=`<div class="note"><b>Note.</b> ${esc(d.note)}</div>`;
 $('pane').innerHTML=h;status();paintInfo();wxFetch();tdFetch();if(isNow)paintNow()}
function row(it,dn){const k=it.id;
 return `<li data-id="${esc(k)}" class="${dn.has(k)?'done':''}">${thumb(it)}<div class="x"><div class="tt">${it.t}${it.pending?'<span class="pend" title="Not shared yet"></span>':''}</div>${esc(it.x)}${it.g.map(g=>`<div class="tag ${g[0]}">${esc(g[1])}</div>`).join('')}${it.docs.length?`<div class="dchips">${it.docs.map(i=>`<button class="dchip" data-doc="${i}">${esc(docShort(i))}</button>`).join('')}</div>`:''}${xtra(it)}</div><div class="acts"><button class="ck" data-k="${esc(k)}" aria-label="Mark done"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg></button><button data-edit="${esc(k)}" aria-label="Edit activity"><svg viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16z"/></svg></button></div></li>`}
function paintNow(){
 const c=clock();const el=$('nowc');if(!el)return;const its=itemsFor(sel);if(!its.length){el.innerHTML='<div class="big">No activities today.</div>';return}
 let cur=-1;its.forEach((it,i)=>{if(mins(it.t)<=c.m)cur=i});let html;
 if(cur===its.length-1&&c.m>=mins(its[cur].t)+90)html=`<div class="lbl"><span class="eyebrow">Day complete</span></div><div class="big">That's a wrap for day ${sel-9}. Rest well.</div>`;
 else{const ci=cur>=0?its[cur]:null,ni=its[cur+1];const left=ni?mins(ni.t)-c.m:0;const span=ci&&ni?mins(ni.t)-mins(ci.t):1;const pr=ci&&ni?Math.min(100,Math.max(0,100*(c.m-mins(ci.t))/span)):0;
  html=`<div class="lbl"><span class="eyebrow">${ci?'Now':'Up first'}</span><span class="tm">${hm(c.m)} IST${c.pv?' · preview':''}</span></div><div class="big">${esc(ci?ci.x:ni.x)}</div>${ci&&ni?`<div class="bar" aria-hidden="true"><i style="width:${pr}%"></i></div>`:''}${ni&&ci?`<div class="nx"><small>Next at ${ni.t} · in ${left>=60?Math.floor(left/60)+' h '+(left%60)+' min':left+' min'}</small><div>${esc(ni.x)}</div></div>`:''}`}
 el.innerHTML=html;
 document.querySelectorAll('.tl li[data-id]').forEach((li,i)=>{li.classList.toggle('cur',i===cur);li.classList.toggle('past',i<cur)});paintLeave()}
function viewTrip(){const c=clock();
 const sub=c.pv?'Preview mode':c.before?`Starts in ${c.diff} day${c.diff===1?'':'s'}`:c.live?`Day ${c.day-9} of 11`:'Trip complete';
 let h=`<div class="top"><div><div class="eyebrow">Oct 10 to 20, 2026</div><h1>Imagicaa and the islands</h1></div><span class="pill">${sub}</span></div>${installBanner()}${stat()}
 <div class="hero"><div class="art">${SC.sunset||''}</div><div class="meta"><div class="route">Hyderabad → Mumbai → Imagicaa → Port Blair → Havelock → Neil → Port Blair → Hyderabad</div><div style="display:flex;gap:6px;flex-wrap:wrap"><span class="pill mint">2 adults + 1 child</span><span class="pill butter">11 days</span><span class="pill peach">6 hotels booked</span></div></div></div>
 <div class="sec"><h2>Day by day</h2><span class="prog">Tap a day to open it</span></div><div class="dcards">`;
 DAYS.forEach(d=>{const its=itemsFor(d.n),cv=getPh('cover-'+d.n);h+=`<button class="dc" data-go="${d.n}" style="${theme(d)}"><div class="th">${cv?`<img src="${cv}" alt="">`:SC[d.sc]||''}</div><div class="tx"><small>${dow(d)}${early(its)?' · early start':''} · ${its.length} activities</small><b>${esc(d.title)}</b><small>${esc(d.stay.replace(/ \(.*\)/,''))}</small></div></button>`});
 h+=`</div><p class="route" style="text-align:center;margin:20px 0 4px">Edits are shared with your partner when you are online.</p>`;
 $('pane').innerHTML=h;status()}
const docById=id=>DOCS.find(x=>x.id===id)||{id,title:'Document',grp:'',pages:0};
const docShort=id=>{const d=docById(id);return d.grp==='Flights'||d.grp==='Ferries'?'Ticket':d.grp==='Plan'?'Plan':'Voucher'};
function viewBook(){const tot=BOOK.reduce((a,b)=>a+b.amt,0);
 let h=`<div class="top"><div><div class="eyebrow">All confirmed</div><h1>Bookings</h1></div><span class="pill mint">${BOOK.length} items</span></div>${stat()}${comingUp()}${myDocs()}<div class="bk">`;
 BOOK.forEach(b=>{h+=`<article class="bc"><div class="h"><div><span class="pill ${b.c}">${b.k}</span><h3 style="margin-top:6px">${esc(b.t)}</h3><div class="w">${esc(b.w)}</div></div><div class="amt">${inr(b.amt)}</div></div>
 <div class="kv"><span class="k">Ref</span><code>${esc(b.ref)}</code><button class="cp" data-cp="${esc(b.ref)}">Copy</button></div>
 ${b.ph?`<div class="kv"><span class="k">Phone</span><code>${esc(b.ph)}</code><button class="cp" data-cp="${esc(b.ph)}">Copy</button></div>`:''}
 <div class="w">${esc(b.pol)}</div><div class="dchips">${b.docs.map(i=>`<button class="dchip" data-doc="${i}">Open ${esc(docById(i).title.replace(/^[^:]*: /,'').slice(0,34))}</button>`).join('')}</div></article>`});
 h+=`</div><div class="card" style="margin-top:14px;display:flex;justify-content:space-between"><b>Total paid</b><span class="amt">${inr(tot)}</span></div><div class="sec"><h2>All documents</h2><span class="prog">${DOCS.length} originals · work offline</span></div>`;
 ['Flights','Ferries','Stays','Plan'].forEach(g=>{h+=`<div class="eyebrow" style="margin:12px 0 6px">${g}</div><div class="dgrp">${DOCS.filter(d=>d.grp===g).map(d=>`<button class="drow" data-doc="${d.id}"><span>${esc(d.title)}</span><small>${d.mime==='application/pdf'?'PDF':'Image'}</small></button>`).join('')}</div>`});
 $('pane').innerHTML=h;status()}
function viewList(){const st=ST.syn.chk;
 let h=`<div class="top"><div><div class="eyebrow">Tick as you go</div><h1>Lists</h1></div></div>${stat()}`;
 const secs=[...TODO0,...D.ess.map(([a,b])=>['Pack: '+a,b])];
 secs.forEach(([name,items],si)=>{const n=items.filter((_,i)=>st[si+'-'+i]).length;h+=`<section class="card" style="margin-bottom:12px"><div class="sec" style="margin:0 0 6px"><h2>${esc(name)}</h2><span class="prog">${n}/${items.length}</span></div><div class="ls">${items.map((t,i)=>`<label><input type="checkbox" data-c="${si}-${i}" ${st[si+'-'+i]?'checked':''}><span>${esc(t)}</span></label>`).join('')}</div></section>`});
 h+=`<div class="two"><section class="card dd do"><h3>Do</h3><ul>${D.do.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section><section class="card dd dont"><h3>Don't</h3><ul>${D.dont.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section></div>`;
 $('pane').innerHTML=h;status()}
const CATS=['Food','Cabs','Tickets','Shopping','Other'];
function expList(){const m=ST.syn.exp;return Object.keys(m).map(id=>Object.assign({id},m[id])).sort((a,b)=>(a.at||0)-(b.at||0))}
function viewMoney(){const ex=expList();const env=typeof ST.syn.meta.budget==='number'?ST.syn.meta.budget:37800;
 const paid=BOOK.reduce((a,b)=>a+b.amt,0),spent=ex.reduce((a,b)=>a+b.a,0);const by={};CATS.forEach(c=>by[c]=0);ex.forEach(e=>{by[e.c]=(by[e.c]||0)+e.a});const mx=Math.max(1,...Object.values(by));
 let h=`<div class="top"><div><div class="eyebrow">On-trip spending</div><h1>Money</h1></div></div>${stat()}
 <div class="sum"><div class="card"><small>Paid in advance</small><b>${inr(paid)}</b></div><div class="card"><small>Logged on trip</small><b>${inr(spent)}</b></div><div class="card"><small>Budget for cabs, tickets, food</small><b>${inr(env)}</b></div><div class="card"><small>${env-spent>=0?'Left':'Over'}</small><b style="color:var(${env-spent>=0?'--ok':'--bad'})">${inr(Math.abs(env-spent))}</b></div></div>
 ${spendChart(ex,env,spent)}
 <div class="card" style="margin-top:12px"><div class="eyebrow" style="margin-bottom:8px">Paid in advance, by type</div>${['Flights','Ferries','Stays','Park'].map(c=>{const v=BOOK.filter(b=>b.cat===c).reduce((a,b)=>a+b.amt,0);return `<div class="cat"><span>${c}</span><div class="tr"><i style="width:${100*v/paid}%"></i></div><b>${inr(v)}</b></div>`}).join('')}</div>
 <div class="sec"><h2>Add an expense</h2></div><form class="ex card" id="exf"><input class="in" id="exa" type="number" inputmode="decimal" min="0" step="any" placeholder="Amount in ₹" required aria-label="Amount"><select class="in" id="exc" aria-label="Category">${CATS.map(c=>`<option>${c}</option>`).join('')}</select><input class="in full" id="exn" placeholder="What was it for? (optional)" aria-label="Note"><button class="btn full" type="submit">Add expense</button></form>
 <div class="sec"><h2>Your spending</h2><span class="prog">${ex.length} entr${ex.length===1?'y':'ies'}</span></div>`;
 if(ex.length)h+=`<div class="card" style="margin-bottom:12px">${CATS.map(c=>`<div class="cat"><span>${c}</span><div class="tr"><i style="width:${100*by[c]/mx}%"></i></div><b>${inr(by[c])}</b></div>`).join('')}</div><div class="card">${ex.slice().reverse().map(e=>`<div class="rowx"><div><b>${esc(e.n||e.c)}</b><br><small>${esc(e.c)} · ${esc(e.d||'')}${e.by&&e.by!==DEV()?' · partner':''}</small></div><b>${inr(e.a)}</b><button class="dl" data-del="${esc(e.id)}" aria-label="Delete">×</button></div>`).join('')}</div>`;
 else h+=`<div class="card empty">Nothing logged yet. Add your first cab, meal or ticket above.</div>`;
 h+=`<div class="sec"><h2>Budget</h2></div><div class="card"><label class="eyebrow" for="env">Spending budget (₹)</label><input class="in" id="env" type="number" inputmode="numeric" value="${env}" style="margin-top:6px"><p class="route" style="margin:8px 0 0">Starts at my upper estimate for cabs and activities. Food is extra, so raise it if you like.</p></div>`;
 $('pane').innerHTML=h;status()}
const VIEWS={today:viewToday,trip:viewTrip,book:viewBook,list:viewList,money:viewMoney};
let errs=0;
const scKey=()=>tab==='today'?'today-'+sel:tab;
function enter(){const p=$('pane');if(!p)return;p.classList.remove('enter');void p.offsetWidth;p.classList.add('enter');clearTimeout(enter.t);enter.t=setTimeout(()=>p.classList.remove('enter'),320)}
function centerChip(){try{const c=document.querySelector('.chips');if(!c)return;const a=c.querySelector('[aria-pressed="true"]');if(!a)return;c.scrollLeft+=(a.getBoundingClientRect().left-c.getBoundingClientRect().left)-(c.clientWidth-a.offsetWidth)/2}catch(e){}}
function render(restore){const p=$('pane');drawNav();
 try{VIEWS[tab]()}catch(e){errs++;fixed(e);try{VIEWS[tab]()}catch(e2){if(errs<4){sel=null;tab='today';try{VIEWS.today()}catch(e3){p.innerHTML='<div class="card empty">We repaired the saved data. Close and reopen the app if this stays blank.</div>'}}}}
 const k=scKey();
 if(restore==='keep'){}
 else if(restore==='saved'){p.scrollTop=(ST.ui.sc&&ST.ui.sc[k])||0}
 else{p.scrollTop=0;if(tab==='today'){const cl=document.querySelector('.tl li.cur');if(cl)setTimeout(()=>cl.scrollIntoView({block:'center'}),60)}}
 centerChip();requestAnimationFrame(centerChip);
 kidApply();ST.ui.tab=tab;ST.ui.sel=sel;ST.ui.day=ist().d;save()}
let lastTop=0;
function softRender(){if(softRender.r)return;softRender.r=requestAnimationFrame(()=>{softRender.r=0;if($('layer').childElementCount||!D)return;const p=$('pane'),t=p.scrollTop;render('keep');p.scrollTop=t})}
document.addEventListener('scroll',e=>{if(e.target&&e.target.id==='pane'&&ST){ST.ui.sc[scKey()]=e.target.scrollTop;save()}},true);

/* ================= sheets, documents, photos ================= */
function openLayer(html){$('layer').innerHTML=`<div class="ov" id="ovl"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`}
function closeLayer(){$('layer').innerHTML='';if(ST&&ST.cf.length)showConflict()}
function itemSheet(id){
 const isNew=!id;const d=dayOf(sel);const it=id?itemsFor(sel).find(x=>x.id===id):null;if(id&&!it){toast('That activity was removed');return}
 openLayer(`<h2>${isNew?'Add activity':'Edit activity'}</h2><div class="eyebrow">${dow(d)}</div>
 <label>Time<input class="in" id="f-t" type="time" value="${it?it.t:'12:00'}" required></label>
 <label>What<textarea id="f-x" maxlength="400" placeholder="For example: Ice cream at the beach">${it?esc(it.x):''}</textarea></label>
 <div class="err" id="f-e" hidden></div>
 <div class="row"><button class="btn" data-a="save" data-id="${it?esc(it.id):''}">Save</button><button class="btn plain" data-a="close">Cancel</button></div>
 ${it?`<div class="row">${it.base&&it.edited?`<button class="btn plain" data-a="reset" data-id="${esc(it.id)}">Reset to original</button>`:''}<button class="btn bad" data-a="del" data-id="${esc(it.id)}">Delete</button></div>`:''}`)}
function saveSheet(id){
 const t=normT($('f-t').value),x=$('f-x').value.trim(),er=$('f-e');
 if(!t){er.textContent='Pick a time.';er.hidden=false;return}
 if(!x){er.textContent='Add a short description.';er.hidden=false;$('f-x').focus();return}
 const nid=id||('c'+Date.now().toString(36)+Math.random().toString(36).slice(2,5));
 const base=id&&dayOf(sel).items.some(b=>b.id===id);
 queueItem(nid,{d:sel,t,x:x.slice(0,400),own:!base,del:false});
 closeLayer();render('keep');toast(id?'Saved':'Activity added')}
let undo=null;
function delItem(id){const it=itemsFor(sel).find(x=>x.id===id);if(!it)return;
 queueItem(id,{d:sel,t:it.t,x:it.x,own:!it.base,del:true});closeLayer();render('keep');
 const t=$('toast');t.innerHTML=`Deleted <button class="btn ghost" data-a="undo" style="padding:2px 10px;min-height:0;margin-left:8px">Undo</button>`;t.hidden=false;clearTimeout(toast.h);
 undo={id,it};toast.h=setTimeout(()=>{t.hidden=true;undo=null},6000)}
function restoreItem(){if(!undo)return;const{id,it}=undo;queueItem(id,{d:sel,t:it.t,x:it.x,own:!it.base,del:false});undo=null;$('toast').hidden=true;render('keep')}
function showConflict(){if(!ST.cf.length||$('layer').childElementCount)return;const c=ST.cf[0];
 const fmt=v=>!v?'Not in the shared plan':v.del?'Deleted':`${esc(v.t)} · ${esc(v.x)}`;
 openLayer(`<div data-conf="1"></div><h2>Your partner changed this too</h2><p class="route" style="margin:0">You both edited the same activity. Pick the version to keep.${ST.cf.length>1?` (${ST.cf.length} to review)`:''}</p>
 <div class="cmp"><div><small>Yours</small>${fmt(c.mine)}</div><div><small>Your partner's</small>${fmt(c.theirs)}</div></div>
 <div class="row"><button class="btn" data-a="mine">Keep mine</button><button class="btn ghost" data-a="theirs">Keep theirs</button></div>`)}
function resolve(mine){const c=ST.cf.shift();if(!c)return;if(mine){ST.ob=ST.ob.filter(o=>!(o.k==='item'&&o.id===c.id));ST.ob.push({k:'item',id:c.id,doc:c.mine,base:c.rr||0})}else if(c.theirs){ST.syn.items[c.id]=c.theirs}
 save();closeLayer();if(ST.cf.length)showConflict();else render('keep');flush();status()}
let docUrls=[];
function cleanupDoc(){docUrls.forEach(u=>URL.revokeObjectURL(u));docUrls=[]}
async function loadDocBytes(d){const r=await fetch(d.file);if(!r.ok)throw new Error('missing '+d.file);return openBytes(new Uint8Array(await r.arrayBuffer()))}
async function docViewer(id){const d=DOCS.find(x=>x.id===id);if(!d)return;cleanupDoc();
 $('layer').innerHTML=`<div class="viewer"><header><button class="btn ghost" data-a="closedoc" style="min-height:40px">Close</button><b>${esc(d.title)}</b><button class="btn plain" data-a="shareoriginal" data-id="${esc(d.id)}" style="min-height:40px">Original</button></header><div class="pg"><div class="vc" id="vc"><div class="hint">Opening…</div></div><div class="hint">Tap a page to zoom. This is your original file, stored in the app, so it opens with no signal.</div></div></div>`;
 try{const bytes=await loadDocBytes(d);const vc=$('vc');vc.innerHTML='';
  if(d.mime==='application/pdf'&&window.pdfjsLib){
   pdfjsLib.GlobalWorkerOptions.workerSrc='pdf.worker.min.js';
   const pdf=await pdfjsLib.getDocument({data:bytes.slice(0)}).promise;const dpr=Math.min(window.devicePixelRatio||2,3);
   for(let i=1;i<=pdf.numPages;i++){const pg=await pdf.getPage(i);const base=pg.getViewport({scale:1});const cssW=Math.min(window.innerWidth-20,900);const scale=Math.min(3.2,(cssW*dpr*1.6)/base.width);const vp=pg.getViewport({scale});
    const cv=document.createElement('canvas');cv.width=Math.floor(vp.width);cv.height=Math.floor(vp.height);cv.dataset.z='1';vc.appendChild(cv);
    await pg.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise}
   vc.dataset.ready='1'
  }else{const u=URL.createObjectURL(new Blob([bytes],{type:d.mime}));docUrls.push(u);vc.innerHTML=`<img data-z="1" alt="${esc(d.title)}" src="${u}" style="width:100%;border-radius:8px;border:1px solid var(--line)">`;vc.dataset.ready='1'}
 }catch(e){fixed(e);const vc=$('vc');if(vc){vc.dataset.ready='1';vc.innerHTML=`<div class="card empty">Could not open this file. Close and try again. If it keeps happening, open Settings and tap Reload latest version.</div>`}}}
async function shareOriginal(id){const d=DOCS.find(x=>x.id===id);if(!d)return;try{const bytes=await loadDocBytes(d);const f=new File([bytes],d.src,{type:d.mime});
  if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:d.title})}
  else{const u=URL.createObjectURL(f);docUrls.push(u);const a=document.createElement('a');a.href=u;a.download=d.src;document.body.appendChild(a);a.click();a.remove()}}catch(e){if(!e||e.name!=='AbortError')toast('Could not share the original')}}
function photoSheet(id,q){const has=!!getPh(id);
 openLayer(`<h2>${has?'Change photo':'Add photo'}</h2><p class="route" style="margin:0">Use your own photo, or find a real one on the web, save it to Photos, then choose it here.</p>
 <div class="ph-a"><button class="btn" data-a="choose" data-id="${esc(id)}">Choose or take a photo</button><a class="btn ghost" target="_blank" rel="noopener" href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q+' Andaman')}">Search the web for a photo</a>${has?`<button class="btn bad" data-a="rmph" data-id="${esc(id)}">Remove photo</button>`:''}<button class="btn plain" data-a="close">Cancel</button></div>`)}
function pickPhoto(id){const pk=$('pick');pk.onchange=()=>{const f=pk.files&&pk.files[0];if(!f)return;const r=new FileReader();
 r.onerror=()=>toast('Could not read that photo');
 r.onload=()=>{const im=new Image();im.onerror=()=>toast('That file is not a photo');im.onload=async()=>{
  let w=Math.min(720,im.width),q=.66,url;const cv=document.createElement('canvas');
  for(let i=0;i<6;i++){cv.width=w;cv.height=Math.max(1,Math.round(im.height*w/im.width));cv.getContext('2d').drawImage(im,0,0,cv.width,cv.height);url=cv.toDataURL('image/jpeg',q);if(url.length<200000)break;w=Math.round(w*.8);q=Math.max(.4,q-.05)}
  await setPh(id,url);queueSet('photos/'+id,{img:url,by:DEV(),at:Date.now()});closeLayer();render('keep');toast('Photo saved')};im.src=r.result};r.readAsDataURL(f);pk.value=''};pk.click()}
async function rmPhoto(id){await setPh(id,null);delete SYNC.phut[id];queueDel('photos/'+id);closeLayer();render('keep');toast('Photo removed')}
function curPal(){try{return localStorage.getItem('an_pal')||'lagoon'}catch(e){return'lagoon'}}
function setPal(n){try{localStorage.setItem('an_pal',n)}catch(e){}if(window.applyPal)window.applyPal(n);document.querySelectorAll('.pal').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.pal===n)))}
function screenInfo(){try{const p=document.createElement('div');p.style.cssText='position:fixed;top:0;visibility:hidden;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';document.body.appendChild(p);const cs=getComputedStyle(p),t=cs.paddingTop,b=cs.paddingBottom;p.remove();return 'Screen '+screen.width+'x'+screen.height+' \u00b7 view '+innerWidth+'x'+innerHeight+' \u00b7 edges '+t+' / '+b+(document.documentElement.classList.contains('sa')?' \u00b7 fitted':'')}catch(e){return''}}
function curFs(){try{return localStorage.getItem('an_fs')||'m'}catch(e){return'm'}}
function setFs(n){try{localStorage.setItem('an_fs',n)}catch(e){}const r=document.documentElement;if(n==='m')r.removeAttribute('data-fs');else r.setAttribute('data-fs',n);document.querySelectorAll('.fsz button').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.fs===n)))}
function settingsSheet(){const c=cfg();const fromFile=!!(window.FB&&window.FB.projectId&&window.FB.apiKey);
 openLayer(`<h2>Settings</h2>
 <div class="cmp"><div><small>Sync</small>${c?(SYNC.denied?'Blocked. Check the Firebase rules.':SYNC.live?'Connected. Changes are shared.':'Offline right now. Changes are saved here and sent later.'):'Not set up. The app works on this phone only.'}</div></div>
 ${fromFile?'':`<label>Firebase project ID<input class="in" id="s-p" autocapitalize="none" autocorrect="off" spellcheck="false" value="${esc((ST.cfg&&ST.cfg.projectId)||'')}"></label><label>Firebase web API key<input class="in" id="s-k" autocapitalize="none" autocorrect="off" spellcheck="false" value="${esc((ST.cfg&&ST.cfg.apiKey)||'')}"></label><div class="row"><button class="btn" data-a="savecfg">Save and connect</button></div>`}
 <div class="row"><button class="btn ghost" data-a="checkin">Flight check-in</button><button class="btn ghost" data-a="guide">Offline guide</button></div>
 <div class="row"><button class="btn ghost" data-a="check">Check connection</button><button class="btn plain" data-a="reload">Reload latest version</button></div>
 <div class="err" id="s-e" hidden></div>
 <div><div class="eyebrow" style="margin-bottom:8px">Bottom bar (this phone)</div>
 <div class="srow"><span>Stretch screen down</span><span id="v-fit">${fitVal()}</span></div><input class="ios" type="range" id="r-fit" min="0" max="70" step="1" value="${fitVal()}" style="--p:${100*fitVal()/70}%">
 <div class="srow" style="margin-top:6px"><span>Lift bar up</span><span id="v-lift">${lsGet('an_lift','0')}</span></div><input class="ios" type="range" id="r-lift" min="0" max="40" step="1" value="${lsGet('an_lift','0')}" style="--p:${100*lsGet('an_lift','0')/40}%">
 <button class="btn ghost" data-a="fitreset" style="width:100%;margin-top:8px">Reset to standard position</button><p class="route" style="margin:6px 0 0">Stretch fills a blank strip under the bar. Lift raises the bar if it is cut off. Reset puts both back to the standard position and keeps them there.</p></div>
  <div class="swrow"><div><b>Kiana mode</b><p class="route" style="margin:2px 0 0">A fun theme for every day, falling stars, a short tune and playful notes for Kiana.</p></div><input class="sw" type="checkbox" switch data-a="kidsw" ${kidOn()?'checked':''} aria-label="Kiana mode"></div>
  ${true?`<div class="swrow"><div><b>Kiana sounds</b><p class="route" style="margin:2px 0 0">A 2 to 3 second tune. Silent if the phone is on silent.</p></div><input class="sw" type="checkbox" switch data-a="ksnd" ${lsGet('an_ksnd','1')!=='0'?'checked':''} aria-label="Kiana sounds"></div><div class="swrow"><div><b>Falling effects</b><p class="route" style="margin:2px 0 0">Snow, stars and bubbles falling on screen.</p></div><input class="sw" type="checkbox" switch data-a="kfx" ${lsGet('an_kfx','1')!=='0'?'checked':''} aria-label="Falling effects"></div><button class="btn ghost" data-a="kplay" style="width:100%">Play today’s tune</button>`:''}
 <div><div class="eyebrow" style="margin-bottom:8px">Text size (this phone)</div><div class="fsz" role="group" aria-label="Text size">${[['s','Small','14px'],['m','Normal','17px'],['l','Large','20px'],['xl','Extra large','23px']].map(([k,l,s])=>`<button data-fs="${k}" aria-pressed="${k===curFs()}"><span style="font-size:${s};display:block">Aa</span><span style="font-size:11px">${l}</span></button>`).join('')}</div></div>
 <div><div class="eyebrow" style="margin-bottom:8px">Colour mode (this phone)</div><div class="pals" role="group" aria-label="Colour mode">${Object.keys(window.PALS).map(k=>`<button class="pal" data-pal="${k}" aria-pressed="${k===curPal()}"><i><b style="background:${window.PALS[k][1]}"></b><b style="background:${window.PALS[k][3]}"></b><b style="background:${window.PALS[k][2]}"></b></i>${window.PALS[k][0]}</button>`).join('')}</div></div>
 <div class="eyebrow" style="text-align:center;margin-top:10px;opacity:.6">${BUILD}</div>
 <div class="row"><button class="btn plain" data-a="lock">Lock app (forget passphrase)</button><button class="btn plain" data-a="close">Close</button></div>
 <p class="route" style="margin:0">Version 2 · ${DEV()}<br>${screenInfo()}</p>`)}
async function checkConn(){const er=$('s-e');er.hidden=false;er.style.color='var(--ink)';er.textContent='Checking…';try{await api('GET','items',[['pageSize','1']]);SYNC.live=true;SYNC.denied=false;er.textContent='Connected. Sync is working.';flush();poll()}catch(e){er.style.color='var(--bad)';er.textContent=e&&e.code==='denied'?'Firebase refused the request. Check the rules and API key.':e&&e.code==='nocfg'?'Add the project ID and API key first.':'Could not reach Firebase. Check your connection.'}}

/* ================= extras: maps, sun and weather, countdown, child tips, emergency, search, reminders, spending ================= */
function fitVal(){try{const f=lsGet('an_fit',null);if(f!==null&&f!==''&&f!=='fill'){const v=parseInt(f,10);return isFinite(v)?v:0}const r=document.documentElement;return r.classList.contains('sa')?Math.max(0,Math.round(parseFloat(r.style.getPropertyValue('--vh'))-innerHeight)):0}catch(e){return 0}}
function lsGet(k,d){try{const v=localStorage.getItem(k);return v==null?d:v}catch(e){return d}}
function lsSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}

let XT={kid:'',places:[],deads:[],hosp:[]};
async function loadExtras(){try{const r=await fetch('x-extras.bin');if(!r.ok)return;const o=JSON.parse(td.decode(await openBytes(new Uint8Array(await r.arrayBuffer()))));if(o&&Array.isArray(o.places)){o.places=o.places.map(([a,q])=>[new RegExp(a,'i'),q]);XT=Object.assign(XT,o);if(!document.querySelector('#layer>*'))render('keep')}}catch(e){}}
const KN=()=>XT.kid||'your child';
function placeFor(x){try{for(const [re,q] of XT.places)if(re.test(x))return q}catch(e){}return''}
const mapUrl=q=>'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(q);
const mapLink=q=>q?`<a class="nav" href="${mapUrl(q)}" target="_blank" rel="noopener noreferrer" aria-label="Open in Google Maps">Map</a>`:'';
/* child mode */
const kidOn=()=>lsGet('an_kiana','0')==='1';
function kidHint(x){const s=x.toLowerCase();
 if(/flight|airport|gate|bag drop|security|boarding/.test(s))return'Snacks, tablet and a light jacket for the wait';
 if(/ferry|makruzz|nautika|boat|speedboat/.test(s))return'Life jacket on. Hold her hand when boarding';
 if(/snorkel|glass-bottom|elephant beach|north bay|coral/.test(s))return'Shallow water only, an adult within arm’s reach';
 if(/beach|sand|swim|pool|cove/.test(s))return'Hat, sunscreen and water. Shallow end only';
 if(/theme park|water park|rides|splash/.test(s))return'Check each ride’s height limit. Shade and water breaks';
 if(/nap|rest|bed|lights out|sleep|quiet/.test(s))return'Rest time';
 if(/breakfast|lunch|dinner|snack|tea\b/.test(s))return'Ask for mild food. Keep a snack handy';
 if(/cab|drive|transfer/.test(s))return'Water and a small toy. Let her nap on the way';
 if(/light & sound|show|sunset/.test(s))return'Carry a jacket. Fine to leave early if she is tired';
 if(/wake up/.test(s))return'Let her sleep in the cab';return''}
function xtra(it){try{const m=mapLink(placeFor(it.x)),on=kidOn(),k=on?kidHint(it.x):'',fun=on?kidFun(it):'';return(m||k||fun)?`<div class="xtra">${m}${k?`<span class="tag lav">${esc(KN())}: ${esc(k)}</span>`:''}${fun?`<span class="kfun">${esc(fun)}</span>`:''}</div>`:''}catch(e){return''}}
/* ================= Kiana mode: themes, falling effects, music, fun notes ================= */
const KT={
 ice:{n:'Ice Kingdom',e:'❄️',t:'Snow, sparkle and a very cool day',p:['❄','❅','❆','✨','❄','❆'],bg:'#EAF5FF',g:'linear-gradient(180deg,#D6EAFF 0,#EEF7FF 40%,#EAF5FF 100%)',card:'#FFFFFF',ink:'#17304D',soft:'#51698A',line:'#CCE0F4',ac:'#3C86D6',bar:'#1D3F6B',m:[79,240,'sine',[0,4,7,12,9,7,4,7,9,12,16,12]]},
 pups:{n:'Rescue Pups',e:'🐶',t:'Ready for a rescue mission, team',p:['🐾','🦴','⭐','🐾','🚒'],bg:'#FFF8E3',g:'linear-gradient(180deg,#FFEFB8 0,#FFF8E3 40%,#FFF8E3 100%)',card:'#FFFFFF',ink:'#1B3358',soft:'#5A6B86',line:'#F0E3B5',ac:'#1E6FD0',bar:'#14396B',m:[72,200,'triangle',[0,4,7,4,9,7,12,7,9,7,4,0]]},
 hero:{n:'Super Hero City',e:'🦸',t:'Capes on, super traveller',p:['⭐','⚡','💫','⭐','🌟'],bg:'#F1F4FF',g:'linear-gradient(180deg,#DCE3FF 0,#F1F4FF 40%,#F1F4FF 100%)',card:'#FFFFFF',ink:'#1D2550',soft:'#5B6490',line:'#D3D9F3',ac:'#D8333F',bar:'#232C66',m:[67,200,'sawtooth',[0,0,7,7,12,7,12,16,12,7,12,19]]},
 puddle:{n:'Puddle Pals',e:'🐷',t:'Jump in every muddy puddle',p:['💧','🐷','💧','🌧️','💦'],bg:'#FFF1F5',g:'linear-gradient(180deg,#FFD9E5 0,#FFF1F5 40%,#FFF1F5 100%)',card:'#FFFFFF',ink:'#4A2234',soft:'#8A5A6D',line:'#F6D5E0',ac:'#E04C7A',bar:'#6B2A44',m:[69,220,'triangle',[0,2,4,2,0,7,4,2,4,5,4,0]]},
 rainbow:{n:'Rainbow Sunset',e:'🦄',t:'Sparkles, rainbows and magic',p:['🦄','🌈','⭐','💖','✨'],bg:'#F6F0FF',g:'linear-gradient(180deg,#E8DAFF 0,#FFEAF4 45%,#F6F0FF 100%)',card:'#FFFFFF',ink:'#33224F',soft:'#6E5C8F',line:'#E3D8F6',ac:'#8E55D6',bar:'#44287A',m:[72,260,'sine',[0,2,4,7,9,12,9,7,4,2,4,0]]},
 reef:{n:'Mermaid Reef',e:'🧜‍♀️',t:'Bubbles, shells and friendly fish',p:['🫧','🐠','🐚','🫧','🐟'],up:1,bg:'#E6FAFA',g:'linear-gradient(0deg,#BDEEF0 0,#E6FAFA 45%,#E6FAFA 100%)',card:'#FFFFFF',ink:'#10404A',soft:'#4B7F88',line:'#C5E9EB',ac:'#13A3A8',bar:'#0B4D55',m:[70,280,'sine',[0,3,7,10,7,3,5,8,12,8,5,0]]},
 pirate:{n:'Pirate Cove',e:'🏴‍☠️',t:'Yo ho ho, treasure ahead',p:['⚓','💰','🦜','⭐','🗝️'],bg:'#FBF3E4',g:'linear-gradient(180deg,#F3DFB8 0,#FBF3E4 40%,#FBF3E4 100%)',card:'#FFFFFF',ink:'#3E2A14',soft:'#7C6444',line:'#EBDDBF',ac:'#B8601B',bar:'#5A3813',m:[62,230,'triangle',[0,3,7,3,0,-2,0,3,7,10,7,3]]},
 safari:{n:'Jungle Safari',e:'🦁',t:'Whispers in the jungle',p:['🍃','🦋','🌿','🐒','🍃'],bg:'#EFF9E8',g:'linear-gradient(180deg,#D5EFC2 0,#EFF9E8 40%,#EFF9E8 100%)',card:'#FFFFFF',ink:'#1F3D1B',soft:'#587A52',line:'#D3E9C6',ac:'#3E8E2F',bar:'#25521C',m:[65,210,'triangle',[0,4,7,9,7,4,0,2,4,7,4,0]]},
 space:{n:'Space Explorers',e:'🚀',t:'Three, two, one, blast off',p:['⭐','🪐','✨','🚀','☄️','🌟'],dark:1,bg:'#0E1230',g:'linear-gradient(180deg,#0A0E28 0,#151B4A 60%,#0E1230 100%)',card:'#1A2150',ink:'#EAEEFF',soft:'#A9B3E6',line:'#2C3578',ac:'#7C8BFF',bar:'#0A0E28',m:[60,300,'sine',[0,7,12,14,12,7,19,14,12,7,5,0]]},
 dino:{n:'Dino Land',e:'🦖',t:'Stomp, roar and explore',p:['🦕','🥚','🌴','🦖','🌋','🍃'],bg:'#FFF4E5',g:'linear-gradient(180deg,#FFE0B8 0,#FFF4E5 40%,#FFF4E5 100%)',card:'#FFFFFF',ink:'#43280F',soft:'#85684A',line:'#F2DEC1',ac:'#D9731A',bar:'#5E3511',m:[55,230,'square',[0,0,5,0,7,5,0,0,5,7,10,7]]},
 cloud:{n:'Sky Express',e:'✈️',t:'Up in the clouds, heading home',p:['☁️','✈️','🎈','☁️','🌤️'],bg:'#E8F6FF',g:'linear-gradient(180deg,#BFE5FF 0,#E8F6FF 45%,#E8F6FF 100%)',card:'#FFFFFF',ink:'#13365A',soft:'#4E7195',line:'#C9E3F6',ac:'#1E8AE0',bar:'#12457A',m:[74,250,'sine',[0,4,7,11,7,4,2,5,9,12,9,4]]}};
const KDAY={10:'ice',11:'pups',12:'hero',13:'puddle',14:'rainbow',15:'reef',16:'pirate',17:'safari',18:'space',19:'dino',20:'cloud'};
const KMIS={10:'Spot 3 aeroplanes and wave goodbye to home',11:'Make the biggest splash and count 5 slides',12:'Be a super traveller: find the first palm tree you see',13:'Count the waves and spot a dolphin from the boat',14:'Collect 5 shells and watch the sun go to bed',15:'Count 10 colourful fish in the water',16:'Find a crab and give it a funny name',17:'Find a shell shaped like a heart',18:'Wake up early and say good morning to the sun',19:'Find the lighthouse and wave to the boats',20:'Spot a cloud that looks like an animal'};
const KFUN={alarm:['Rise and shine, explorer! Today is an adventure day 🌞','Wake-up wiggle: stretch like a cat, then roar like a lion 🦁','Put on your explorer hat and shoes 🎒'],
 food:['Try one new bite and give it a score out of 5 ⭐','Be a food detective: how many colours are on your plate? 🍽️','Eat like a hero 💪 then ask for a little treat'],
 plane:['Seat belt on like a pilot: ready for take-off! ✈️','Look out of the window: find a cloud shaped like an animal ☁️','Count how many aeroplanes you can spot ✈️'],
 ferry:['Wave to the waves and count the boats 🚤','Look out for a dolphin or a flying fish 🐬','Life jacket on, Captain! Hold the rail with a grown-up ⚓'],
 snorkel:['Peek under the water: count the colourful fish 🐠','Be a sea explorer: can you spot a starfish? ⭐','Breathe slow and calm like a fish 🫧'],
 park:['Pick your favourite ride and tell us why 🎢','Do a big happy scream, then a tiny one 😄','Count the splashes you make 💦'],
 sight:['Be a history detective: find the oldest thing here 🔍','Whisper like an explorer 🤫','Find a bird and give it a name 🕊️'],
 cab:['I spy: find something red, something green, something tall 🚗','Count the white cars. Who reaches 10 first? 🏁','Sing your favourite song in the car 🎶'],
 beach:['Build a sand castle and name the king 🏰','Find 3 shells and make a treasure box 🐚','Write your name in the sand ✍️'],
 bed:['Cuddle time: tell us your best part of today 💤','Close your eyes and take 10 slow breaths 🌙','Rest like a sleepy bear 🐻'],
 pack:['Pack your own bag: teddy, hat, water bottle 🧸','You are bag captain: check each bag ✅'],
 sun:['Say hello to the sun and make a wish 🌅','Wave at the sun, it is waving back ☀️'],
 pin:['Look around: what is the coolest thing you can see? 👀','Take a deep breath and smile for a photo 📸']};
function kHash(s){let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return Math.abs(h)}
function kidFun(it){try{const L=KFUN[kindOf(it.x)]||KFUN.pin;return L[kHash(String(it.id))%L.length]}catch(e){return''}}
function kidKey(){const n=sel!=null?sel:clock().day;return KDAY[n]||'ice'}
function kidCss(){if(document.getElementById('kcss'))return;
 const L={'--sky':'#DCEFF8','--sky-s':'#2F6F9E','--mint':'#D8F1E4','--mint-s':'#2A7A58','--peach':'#FFE4D6','--peach-s':'#B0573A','--lav':'#E9E2F8','--lav-s':'#6A52A8','--butter':'#FFF3C9','--butter-s':'#85690F','--rose':'#FADCE0','--rose-s':'#A5485A','--ok':'#2A7A58','--warn':'#85690F','--bad':'#A5485A'};
 const Dk={'--sky':'#1F3A4D','--sky-s':'#9CCBEE','--mint':'#1D4136','--mint-s':'#8FDDB8','--peach':'#4A3329','--peach-s':'#F2AE93','--lav':'#33305A','--lav-s':'#BBA8F0','--butter':'#453D22','--butter-s':'#EAD37E','--rose':'#472A31','--rose-s':'#F0A0B0','--ok':'#8FDDB8','--warn':'#EAD37E','--bad':'#F0A0B0'};
 let c='';for(const k in KT){const T=KT[k],tn=Object.entries(T.dark?Dk:L).map(([a,b])=>a+':'+b).join(';');
  c+=`html.kn[data-kt="${k}"]{--bg:${T.bg};--card:${T.card};--ink:${T.ink};--soft:${T.soft};--line:${T.line};--accent:${T.ac};--accent-ink:${T.dark?'#0E1230':'#FFFFFF'};${tn};--shadow:0 6px 20px rgba(0,0,0,${T.dark?.4:.1});color-scheme:${T.dark?'dark':'light'}}html.kn[data-kt="${k}"] body{background:${T.g}}`}
 const el=document.createElement('style');el.id='kcss';el.textContent=c;document.head.appendChild(el)}
const kReduce=()=>{try{return window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){return false}};
function kidFx(key){let f=document.getElementById('kfx');
 if(!key){if(f)f.remove();return}
 if(!f){f=document.createElement('div');f.id='kfx';f.setAttribute('aria-hidden','true');document.body.appendChild(f)}
 f.innerHTML='';if(kReduce()||lsGet('an_kfx','1')==='0')return;
 const T=KT[key];for(let i=0;i<18;i++){const s=document.createElement('i');s.textContent=T.p[i%T.p.length];
  s.style.cssText=`left:${Math.round(Math.random()*96)}%;font-size:${14+Math.round(Math.random()*16)}px;animation-name:${T.up?'krise':'kfall'};animation-duration:${(7+Math.random()*8).toFixed(1)}s;animation-delay:-${(Math.random()*12).toFixed(1)}s;--dx:${Math.round((Math.random()-.5)*90)}px`;f.appendChild(s)}}
/* music: tiny synthesised tunes made for this app, started only by a tap */
let KA=null,kGest=0;
['click','touchend'].forEach(ev=>document.addEventListener(ev,()=>{kGest=Date.now()},true));
function kSnd(key,full){try{
 if(lsGet('an_ksnd','1')==='0'||document.hidden)return;const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
 if(!KA)KA=new AC();const t0=Date.now();
 const go=()=>{if(Date.now()-t0>1500||KA.state!=='running')return;
  const T=KT[key]||KT.ice,[root,ms,wave,notes]=T.m,n=full?notes.length:8,step=ms/1000,t=KA.currentTime+0.05;
  if(kSnd.g){try{kSnd.g.gain.cancelScheduledValues(KA.currentTime);kSnd.g.gain.setTargetAtTime(0,KA.currentTime,.05)}catch(e){}}
  const m=KA.createGain();m.gain.value=full?0.16:0.13;const f=KA.createBiquadFilter();f.type='lowpass';f.frequency.value=wave==='sine'?6000:2200;m.connect(f);f.connect(KA.destination);kSnd.g=m;
  const hz=x=>440*Math.pow(2,(x-69)/12);
  const tone=(fr,st,dur,vol)=>{const o=KA.createOscillator(),g=KA.createGain();o.type=wave;o.frequency.value=fr;g.gain.setValueAtTime(0.0001,st);g.gain.exponentialRampToValueAtTime(vol,st+.012);g.gain.exponentialRampToValueAtTime(0.0001,st+dur);o.connect(g);g.connect(m);o.start(st);o.stop(st+dur+.05);
   if(wave==='sine'){const b=KA.createOscillator(),bg=KA.createGain();b.type='sine';b.frequency.value=fr*2;bg.gain.setValueAtTime(0.0001,st);bg.gain.exponentialRampToValueAtTime(vol*.35,st+.01);bg.gain.exponentialRampToValueAtTime(0.0001,st+dur*.6);b.connect(bg);bg.connect(m);b.start(st);b.stop(st+dur)}};
  for(let i=0;i<n;i++)tone(hz(root+notes[i]),t+i*step,step*1.8,.5);
  if(full){const e=t+n*step;[0,4,7].forEach(x=>tone(hz(root+x),e,1.0,.35))}
  else{tone(hz(root),t+n*step,.7,.35)}};
 if(KA.state==='running')go();else KA.resume().then(go).catch(()=>{})}catch(e){}}
function kidApply(){try{const r=document.documentElement,on=kidOn();
 if(!on){if(r.classList.contains('kn')){r.classList.remove('kn');r.removeAttribute('data-kt');kidFx(null);if(window.applyPal)window.applyPal(curPal())}kidApply.k=null;return}
 kidCss();const key=kidKey(),T=KT[key];
 if(kidApply.k===key&&r.classList.contains('kn'))return;
 const first=kidApply.k==null;kidApply.k=key;
 r.classList.add('kn');r.setAttribute('data-kt',key);r.setAttribute('data-theme',T.dark?'dark':'light');
 const m=document.querySelector('meta[name=theme-color]');if(m)m.setAttribute('content',T.bar);
 kidFx(key);
 if(!first&&Date.now()-kGest<1500)kSnd(key,false)}catch(e){}}
function kidCard(d,its,dn){try{if(!kidOn())return'';const T=KT[kidKey()],tot=its.length,done=its.filter(i=>dn.has(i.id)).length,st=tot?Math.round(5*done/tot):0;
 return `<div class="kcard"><div class="kbn"><span class="ke" aria-hidden="true">${T.e}</span><div><b>${esc(T.n)}</b><small>${esc(T.t)}</small></div></div><div class="kms"><b>Kiana’s mission</b>${esc(KMIS[d.n]||'Have a happy day')}</div><div class="kst" aria-label="${done} of ${tot} done"><span>${'⭐'.repeat(st)}${'☆'.repeat(5-st)}</span><small>${done} of ${tot} done</small></div></div>`}catch(e){return''}}

/* sunrise and sunset (offline maths), IST */
function sunTimes(lat,lon,y,mo,d){const J=Date.UTC(y,mo,d,12)/864e5+2440587.5,n=Math.ceil(J-2451545+0.0008),rad=Math.PI/180;
 const Js=n-lon/360,M=(357.5291+0.98560028*Js)%360,C=1.9148*Math.sin(M*rad)+0.02*Math.sin(2*M*rad)+0.0003*Math.sin(3*M*rad),L=(M+C+180+102.9372)%360;
 const Jt=2451545+Js+0.0053*Math.sin(M*rad)-0.0069*Math.sin(2*L*rad),dec=Math.asin(Math.sin(L*rad)*Math.sin(23.44*rad));
 const w=Math.acos((Math.sin(-0.833*rad)-Math.sin(lat*rad)*Math.sin(dec))/(Math.cos(lat*rad)*Math.cos(dec)))/rad;
 const toM=j=>Math.round((((j-2440587.5)*864e5+19800000)%864e5)/6e4);return[toM(Jt-w/360),toM(Jt+w/360)]}
const dayLoc=n=>n<=11?[19.07,72.88]:[11.62,92.73];
/* weather (online when possible, last forecast kept for offline) */
const WX={d:null,busy:false};
try{const o=JSON.parse(lsGet('an_wx','null'));if(o&&o.mum&&o.pb)WX.d=o}catch(e){}
function wxName(c){return c===0?'Clear':c<=2?'Mostly sunny':c===3?'Cloudy':c<=48?'Foggy':c<=57?'Drizzle':c<=67?'Rain':c<=77?'Snow':c<=82?'Showers':'Thunderstorms'}
async function wxFetch(){if(WX.busy||!navigator.onLine)return;if(WX.d&&Date.now()-(WX.d.t||0)<3*3600e3)return;WX.busy=true;
 try{const g=async(lat,lon)=>{const ac=new AbortController(),to=setTimeout(()=>ac.abort(),8000);try{const r=await fetch('https://api.open-meteo.com/v1/forecast?latitude='+lat+'&longitude='+lon+'&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FKolkata&forecast_days=16',{signal:ac.signal});if(!r.ok)throw new Error('wx');return await r.json()}finally{clearTimeout(to)}};
  const [m,p]=await Promise.all([g(19.07,72.88),g(11.62,92.73)]);
  const pick=j=>{const o={};j.daily.time.forEach((dt,i)=>{o[dt]=[j.daily.weathercode[i],Math.round(j.daily.temperature_2m_max[i]),Math.round(j.daily.temperature_2m_min[i]),j.daily.precipitation_probability_max[i]]});return o};
  WX.d={t:Date.now(),mum:pick(m),pb:pick(p)};lsSet('an_wx',JSON.stringify(WX.d));paintInfo()}catch(e){}WX.busy=false}
/* tides: Open-Meteo marine sea level (about 8 km grid, so approximate). Hourly values are refined to the minute. */
const TD={d:null,busy:false};
try{const o=JSON.parse(lsGet('an_td','null'));if(o&&o.mum&&o.pb)TD.d=o}catch(e){}
function tideExtremes(times,vals){const raw=[];
 for(let i=1;i<vals.length-1;i++){const a=vals[i-1],b=vals[i],c=vals[i+1];if([a,b,c].some(x=>typeof x!=='number'||!isFinite(x)))continue;
  const hi=b>a&&b>=c,lo=b<a&&b<=c;if(!hi&&!lo)continue;const den=a-2*b+c,off=den!==0?0.5*(a-c)/den:0,o=Math.max(-.5,Math.min(.5,off));
  const t=Date.parse(times[i]+':00Z');if(!isFinite(t))continue;raw.push({k:hi?'H':'L',m:t/60000+o*60,val:b-0.25*(a-c)*o})}
 const f=[];for(const e of raw){const p=f[f.length-1];if(p&&p.k===e.k){if((e.k==='H'&&e.val>p.val)||(e.k==='L'&&e.val<p.val))f[f.length-1]=e}else f.push(e)}
 const out={};for(const e of f){const day=new Date(e.m*60000).toISOString().slice(0,10);const mm=((Math.round(e.m)%1440)+1440)%1440;(out[day]=out[day]||[]).push([e.k,mm,Math.round(e.val*100)/100])}
 return out}
async function tdFetch(){if(TD.busy||!navigator.onLine)return;if(TD.d&&Date.now()-(TD.d.t||0)<3*3600e3)return;TD.busy=true;
 try{const g=async(lat,lon)=>{const ac=new AbortController(),to=setTimeout(()=>ac.abort(),8000);try{const r=await fetch('https://marine-api.open-meteo.com/v1/marine?latitude='+lat+'&longitude='+lon+'&hourly=sea_level_height_msl&timezone=Asia%2FKolkata&start_date=2026-10-09&end_date=2026-10-21',{signal:ac.signal});if(!r.ok)throw new Error('td');const j=await r.json();if(!j||!j.hourly||!Array.isArray(j.hourly.time)||!Array.isArray(j.hourly.sea_level_height_msl)||j.hourly.time.length<48)throw new Error('td shape');return tideExtremes(j.hourly.time,j.hourly.sea_level_height_msl)}finally{clearTimeout(to)}};
  const [m,p]=await Promise.all([g(19.07,72.88),g(11.62,92.73)]);
  if(!Object.keys(m).length||!Object.keys(p).length)throw new Error('td empty');
  TD.d={t:Date.now(),mum:m,pb:p};lsSet('an_td',JSON.stringify(TD.d));paintInfo()}catch(e){}TD.busy=false}
function tidePills(n){try{const t=TD.d&&TD.d[n<=11?'mum':'pb']&&TD.d[n<=11?'mum':'pb']['2026-10-'+String(n).padStart(2,'0')];
 if(!t||!t.length)return '<span class="pill muted">Tides appear when online</span>';
 const H=t.filter(x=>x[0]==='H').map(x=>hm(x[1])),L=t.filter(x=>x[0]==='L').map(x=>hm(x[1]));
 let h=(H.length?`<span class="pill sky">High tide ~${H.join(' · ')}</span>`:'')+(L.length?`<span class="pill mint">Low tide ~${L.join(' · ')}</span>`:'');
 const c=clock();if(c.live&&c.day===n){const nx=t.find(x=>x[1]>c.m);if(nx){const d=nx[1]-c.m,w=d>=60?Math.floor(d/60)+'h '+(d%60)+'m':d+'m';h+=`<span class="pill peach">${nx[0]==='H'?'Rising, high':'Falling, low'} in ${w}</span>`}}
 return h}catch(e){return ''}}
function paintInfo(){try{const el=$('dinfo');if(!el)return;const n=sel,loc=dayLoc(n),[sr,ss]=sunTimes(loc[0],loc[1],2026,9,n);
 let h=`<span class="pill butter">Sunrise ${hm(sr)}</span><span class="pill peach">Sunset ${hm(ss)}</span>`;
 const w=WX.d&&WX.d[n<=11?'mum':'pb']&&WX.d[n<=11?'mum':'pb']['2026-10-'+n];
 if(!w)h+=`<span class="pill muted">Forecast appears when online</span>`;
 if(w)h+=`<span class="pill sky">${wxName(w[0])} ${w[2]}° to ${w[1]}°C${w[3]!=null?' · rain '+w[3]+'%':''}</span>`;
 h+=tidePills(n);
 el.innerHTML=h||''}catch(e){}}
/* leave-now countdown */
const CRIT=/ferry|makruzz|nautika|flight|indigo|boarding|bag drop|jetty|check out|leave|cab (to|from)|light & sound|report at|at the .* counter/i;
function paintLeave(){try{const el=$('leavec');if(!el)return;const c=clock(),its=itemsFor(sel);
 const nx=its.find(i=>mins(i.t)>c.m&&CRIT.test(i.x));if(!nx||mins(nx.t)-c.m>240){el.innerHTML='';return}
 const left=mins(nx.t)-c.m,tone=left<=30?'r':left<=90?'w':'',t=left>=60?Math.floor(left/60)+' h '+(left%60)+' min':left+' min';
 el.innerHTML=`<div class="leave ${tone}"><b>Be ready in ${t}</b><span>${nx.t} · ${esc(nx.x.slice(0,90))}</span></div>`}catch(e){}}
/* emergency card */
/* flight check-in: IndiGo web check-in link, window timer and DigiYatra steps */
const BUILD='build 9 Oct 2026 D';
const IGO_URL='https://www.goindigo.in/web-check-in.html',DY_URL='https://apps.apple.com/in/app/digi-yatra/id6479873321';
function flightsAll(){const out=[];try{for(const d of DAYS){const its=itemsFor(d.n);const hmn=t=>{const m=/^(\d{1,2}):(\d{2})/.exec(t||'');return m?(+m[1])*60+(+m[2]):-1};
 for(const it of its){const m=/IndiGo\s+(6E\s*\d+)\s+departs\s+([^,(]+)/i.exec(it.x||'');const t=/^(\d{1,2}):(\d{2})/.exec(it.t||'');if(!m||!t)continue;
 const no=m[1].replace(/\s+/,' ').toUpperCase(),digits=no.replace(/^6E\s*/,'');const dm=(+t[1])*60+(+t[2]);const dep=Date.UTC(2026,9,d.n,+t[1],+t[2])-19800000;
 const rx=new RegExp('6E\\s*'+digits+'\\b','i'),bk=BOOK.find(b=>rx.test(JSON.stringify(b)));
 const reachIt=its.find(x=>hmn(x.t)>=0&&hmn(x.t)<dm&&hmn(x.t)>=dm-420&&/reach|arrive|bag drop|check-in/i.test(x.x)&&!/cab|wake/i.test(x.x));
 const cabIt=its.find(x=>hmn(x.t)>=0&&hmn(x.t)<dm&&/cab/i.test(x.x));
 const base=Date.UTC(2026,9,d.n,0,0)-19800000;
 out.push({day:d.n,no,from:m[2].trim(),time:it.t,dep,ref:bk&&bk.ref||'',title:bk&&bk.t||'',docs:bk&&bk.docs||[],pol:bk&&bk.pol||'',reach:reachIt?{t:reachIt.t,at:base+hmn(reachIt.t)*60000}:null,leave:cabIt?{t:cabIt.t,at:base+hmn(cabIt.t)*60000}:null})}}}catch(e){}return out}
function ferriesAll(){const out=[];try{for(const b of BOOK){if(b.k!=='Ferry')continue;const dm=/(\d{1,2})\s+Oct/.exec(b.w||''),tm=/(\d{1,2}):(\d{2})/.exec(b.w||'');if(!dm||!tm)continue;
 const day=+dm[1],dep=Date.UTC(2026,9,day,+tm[1],+tm[2])-19800000;const rp=/Report\s+(\d+)\s*(hours?|hrs?|min)/i.exec(b.pol||'');const cl=/closes\s+(\d+)\s*min/i.exec(b.pol||'');const seats=/seats\s+([^·]+)/i.exec(b.w||'');
 const off=rp?(/min/i.test(rp[2])?+rp[1]:(+rp[1])*60):0;
 out.push({day,t:b.t,time:tm[1].padStart(2,'0')+':'+tm[2],dep,report:off?dep-off*60000:0,close:cl?dep-(+cl[1])*60000:0,seats:seats?seats[1].trim():'',docs:b.docs||[],pol:b.pol||''})}}catch(e){}return out}
const dur=ms=>{const m=Math.max(0,Math.round(ms/60000));const d=Math.floor(m/1440),h=Math.floor(m%1440/60),mi=m%60;return (d?d+'d ':'')+(h?h+'h ':'')+(!d?mi+'m':'')};
function ciState(f,now){const o=f.dep-48*3600e3,c=f.dep-60*60e3;if(now>=f.dep)return['Departed','muted'];if(now>=c)return['Web check-in closed. Use the airport counter','rose'];if(now>=o)return['Web check-in is open. Closes in '+dur(c-now),'mint'];return['Web check-in opens in '+dur(o-now),'butter']}
const hmI=ms=>{const m=(((Math.floor((ms+19800000)/60000))%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
function clList(key,items){let ck={};try{ck=JSON.parse(localStorage.getItem('an_cl'+key)||'{}')}catch(e){}return items.map((x,i)=>`<label class="pk"><input type="checkbox" data-cl="${esc(key)}" data-i="${i}" ${ck[i]?'checked':''}><span>${esc(x)}</span></label>`).join('')}
const docBtns=ids=>{const ds=(ids||[]).map(i=>DOCS.find(x=>x.id===i)).filter(Boolean);return ds.map((d,n)=>{const p=d.title.includes(':')?d.title.split(':')[0].trim():d.title;const dup=ds.filter(x=>(x.title.split(':')[0].trim())===p).length>1;return `<button class="btn ghost" data-doc="${esc(d.id)}">Open ${esc(p.replace(/\s*\(.*$/,'').slice(0,30))}${dup?' ('+(n+1)+')':''}</button>`}).join('')};
function checkinSheet(){const L=flightsAll(),F=ferriesAll(),now=Date.now();
 const cards=L.map(f=>{const [st,cl]=ciState(f,now);const dt=new Date(f.dep+19800000);
  const bag=/(\d+)\s*kg/i.exec(f.pol||'');const key='f'+f.day+f.no.replace(/\s/g,'');
  const chk=['Photo ID for every adult. For '+KN()+', carry any ID proof you have (Aadhaar or birth certificate)','Boarding pass saved offline (screenshot or PDF)','Bags within '+(bag?bag[1]+' kg':'the printed limit')+' per person','Power bank, lighters and spare batteries in hand luggage only','Medicines and '+KN()+"'s snacks in hand luggage"];
  return `<div class="card" style="display:grid;gap:8px"><div><b>${esc(f.no)}</b> · ${esc(f.from)}<br><small>${dt.getUTCDate()} Oct, departs ${esc(f.time)}</small></div><span class="pill ${cl}" style="justify-self:start">${esc(st)}</span>
  ${f.reach?`<div class="kv"><span class="k">Reach airport</span><b>${esc(f.reach.t)}</b><small>${f.reach.at>now?'in '+dur(f.reach.at-now):'time has passed'}</small></div>`:''}${f.leave?`<div class="kv"><span class="k">Leave home</span><b>${esc(f.leave.t)}</b><small>${f.leave.at>now?'in '+dur(f.leave.at-now):'time has passed'}</small></div>`:''}
  <a class="btn" href="${IGO_URL}" target="_blank" rel="noopener noreferrer">IndiGo web check-in</a>${f.ref?`<button class="btn ghost" data-cp="${esc(f.ref)}">Copy booking reference ${esc(f.ref)}</button>`:''}${docBtns(f.docs)}
  <div class="eyebrow">Before you leave</div>${clList(key,chk)}</div>`}).join('')||'<div class="card empty">No IndiGo flights found.</div>';
 const fcards=F.map(f=>{const dt=new Date(f.dep+19800000);const key='b'+f.day+f.time;const chk=['Printed photo ID for every traveller (needed for the ferry)',f.seats?'Ferry ticket. Seats '+f.seats:'Ferry ticket','Bags within the weight limit on the ticket','Motion-sickness tablets before boarding',KN()+': jacket and snack for the cabin'];
  let st='',cl='butter';if(now>=f.dep){st='Departed';cl='muted'}else if(f.close&&now>=f.close){st='Check-in closed';cl='rose'}else if(f.report&&now>=f.report){st='Report now';cl='mint'}else if(f.report){st='Report in '+dur(f.report-now);cl='butter'}else st='Departs in '+dur(f.dep-now);
  return `<div class="card" style="display:grid;gap:8px"><div><b>${esc(f.t)}</b><br><small>${dt.getUTCDate()} Oct, departs ${esc(f.time)}</small></div><span class="pill ${cl}" style="justify-self:start">${esc(st)}</span>
  ${f.report?`<div class="kv"><span class="k">Report by</span><b>${hmI(f.report)}</b></div>`:''}${f.close?`<div class="kv"><span class="k">Check-in closes</span><b>${hmI(f.close)}</b></div>`:''}${docBtns(f.docs)}<div class="eyebrow">Before you leave</div>${clList(key,chk)}</div>`}).join('');
 openLayer(`<h2>Travel check-in</h2><p class="route" style="margin:0">Flights: web check-in is free, opens 48 hours before departure and closes 60 minutes before for domestic flights. Confirm on your ticket.</p>${cards}
 ${fcards?'<div class="eyebrow" style="margin-top:6px">Ferries</div>'+fcards:''}
 <div class="eyebrow" style="margin-top:6px">Digi Yatra (paperless entry)</div>
 <ol class="gtips"><li>Do web check-in first and keep the boarding pass (email or WhatsApp).</li><li>Open Digi Yatra and add that boarding pass. Each adult needs their own Digi Yatra ID.</li><li>At the airport use the Digi Yatra e-gate, and carry your ID in case the face scan fails.</li></ol>
 <a class="btn ghost" href="${DY_URL}" target="_blank" rel="noopener noreferrer">Open Digi Yatra (App Store page)</a>
 <p class="route" style="margin:0">A web page cannot launch another app directly. If Digi Yatra is installed, that page shows an Open button. Digi Yatra is listed at Hyderabad, Mumbai and Port Blair airports; check at the airport as lists change.</p>
 <div class="row"><button class="btn plain" data-a="close">Close</button></div>`)}
/* user-added booking documents (PDF or photo). Stored like photos, so they sync between phones when small enough. */
const udLocal=()=>{try{return JSON.parse(lsGet('an_udl','[]'))}catch(e){return[]}};
const udIds=()=>Object.keys(phMem).filter(k=>k.startsWith('ud-')).sort();
const udName=u=>{const m=/^data:[^;,]+;name=([^;,]*)[;,]/.exec(u||'');try{return m?decodeURIComponent(m[1]):'Document'}catch(e){return 'Document'}};
const udIsPdf=u=>/^data:application\/pdf/i.test(u||'');
function myDocs(){try{const ids=udIds();return `<div class="card" style="margin:0 0 12px"><div class="eyebrow" style="margin-bottom:8px">My added documents</div>${ids.length?ids.map(i=>{const u=getPh(i);return `<button class="drow" data-ud="${esc(i)}"><span>${esc(udName(u))}</span><small>${udIsPdf(u)?'PDF':'Photo'}${udLocal().includes(i)?' · this phone only':''}</small></button>`}).join(''):'<p class="route" style="margin:0 0 8px">Add tickets, vouchers or IDs as a PDF or photo.</p>'}<button class="btn ghost" data-a="addud" style="width:100%;margin-top:8px">+ Add a document</button></div>`}catch(e){return ''}}
function pickUserDoc(){const pk=document.createElement('input');pk.type='file';pk.accept='application/pdf,image/*';pk.style.display='none';document.body.appendChild(pk);
 const done=()=>{setTimeout(()=>pk.remove(),500)};
 pk.onchange=()=>{const f=pk.files&&pk.files[0];if(!f){done();return}const isPdf=f.type==='application/pdf'||/\.pdf$/i.test(f.name);const nm=encodeURIComponent((f.name||'Document').replace(/\.[^.]+$/,'').slice(0,60));
  const add=async(url,share)=>{const id='ud-'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);url=url.replace(/^(data:[^;,]+)(;base64,)/,'$1;name='+nm+'$2');await setPh(id,url);if(share)queueSet('photos/'+id,{img:url,by:DEV(),at:Date.now()});else lsSet('an_udl',JSON.stringify(udLocal().concat([id])));render('keep');toast(share?'Document saved and shared':'Saved on this phone only (too big to share)')};
  const r=new FileReader();r.onerror=()=>{toast('Could not read that file');done()};
  if(isPdf){if(f.size>10e6){toast('That PDF is over 10 MB. Please pick a smaller one.');done();return}
   r.onload=()=>{let url=String(r.result||'');if(!url.startsWith('data:application/pdf'))url=url.replace(/^data:[^;,]*/,'data:application/pdf');add(url,url.length<=640000).catch(()=>toast('Could not save that file'));done()};r.readAsDataURL(f)}
  else{r.onload=()=>{const im=new Image();im.onerror=()=>{toast('That file is not a photo or PDF');done()};im.onload=async()=>{let w=Math.min(1600,im.width),q=.75,url;const cv=document.createElement('canvas');
    for(let i=0;i<8;i++){cv.width=w;cv.height=Math.max(1,Math.round(im.height*w/im.width));cv.getContext('2d').drawImage(im,0,0,cv.width,cv.height);url=cv.toDataURL('image/jpeg',q);if(url.length<=600000)break;w=Math.round(w*.82);q=Math.max(.45,q-.05)}
    try{await add(url,url.length<=640000)}catch(e){toast('Could not save that file')}done()};im.src=r.result};r.readAsDataURL(f)}};
 pk.click()}
async function udViewer(id){const u=getPh(id);if(!u)return;cleanupDoc();
 $('layer').innerHTML=`<div class="viewer"><header><button class="btn ghost" data-a="closedoc" style="min-height:40px">Close</button><b>${esc(udName(u))}</b><button class="btn plain" data-a="udel" data-id="${esc(id)}" style="min-height:40px">Delete</button></header><div class="pg"><div class="vc" id="vc"><div class="hint">Opening…</div></div><div class="hint">Pinch to zoom. Stored in the app, so it opens with no signal.</div></div></div>`;
 try{const vc=$('vc');vc.innerHTML='';
  if(udIsPdf(u)&&window.pdfjsLib){const b64=u.slice(u.indexOf(',')+1);const bin=atob(b64);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
   pdfjsLib.GlobalWorkerOptions.workerSrc='pdf.worker.min.js';const pdf=await pdfjsLib.getDocument({data:bytes}).promise;const dpr=Math.min(window.devicePixelRatio||2,3);
   for(let i=1;i<=pdf.numPages;i++){const pg=await pdf.getPage(i);const base=pg.getViewport({scale:1});const cssW=Math.min(window.innerWidth-20,900);const scale=Math.min(3.2,(cssW*dpr*1.6)/base.width);const vp=pg.getViewport({scale});
    const cv=document.createElement('canvas');cv.width=Math.floor(vp.width);cv.height=Math.floor(vp.height);vc.appendChild(cv);await pg.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise}}
  else{const im=new Image();im.alt=udName(u);im.style.cssText='width:100%;border-radius:8px';im.src=u;vc.appendChild(im)}
  vc.dataset.ready='1'}catch(e){const vc=$('vc');if(vc){vc.dataset.ready='1';vc.innerHTML='<div class="card empty">Could not open this file.</div>'}}}
let udArm=null;
async function udDelete(id,b){if(udArm!==id){udArm=id;b.textContent='Tap again to delete';setTimeout(()=>{if(udArm===id){udArm=null;try{b.textContent='Delete'}catch(e){}}},3500);return}udArm=null;await rmUd(id)}
async function rmUd(id){lsSet('an_udl',JSON.stringify(udLocal().filter(x=>x!==id)));await setPh(id,null);delete SYNC.phut[id];queueDel('photos/'+id);cleanupDoc();$('layer').innerHTML='';render('keep');toast('Document deleted')}
function packList(day){const its=itemsFor(day),T=its.map(i=>(i.x||'')+' '+(i.t||'')).join(' | ').toLowerCase(),k=KN(),L=[];
const add=(g,a)=>{if(!L.some(x=>x[1]===a))L.push([g,a])};
add('Always','Water bottle and snacks');add('Always','Sunscreen and hats');add('Always','Phone, power bank and charger');add('Always',k+': favourite snack, wipes and a change of clothes');
if(/flight|airport|indigo|boarding|check-in/.test(T)){add('Travel','IDs and tickets (offline copies are in Bookings)');add('Travel','Medicines and chargers in hand luggage')}
if(/ferry|boat|makruzz|nautika|cruise|jetty/.test(T)){add('Ferry','Motion-sickness tablets');add('Ferry','Light jacket (cold inside)');add('Ferry','Ferry tickets and IDs')}
if(/beach|snorkel|swim|scuba|glass|sea|island|bay|lagoon/.test(T)){add('Beach','Swimwear and quick-dry towel');add('Beach','Reef-safe sunscreen');add('Beach','Water shoes and a dry bag')}
if(/jail|sound|light show|museum|ross|fort/.test(T)){add('Sights','Mosquito repellent');add('Sights','Comfortable walking shoes')}
if(/imagicaa|park|ride|water park/.test(T)){add('Park','Change of clothes and a towel');add('Park','Cash or card for lockers')}
if(/early|wake up|0[0-4]:/.test(T))add('Early start','Pack the night before, keep documents together');
return L}
function packSheet(){let d=sel;if(d==null)d=clock().day;const L=packList(d);let ck={};try{ck=JSON.parse(localStorage.getItem('an_pk'+d)||'{}')}catch(e){}let g='',h='';
L.forEach(([a,b],i)=>{if(a!==g){g=a;h+=`<div class="eyebrow" style="margin-top:6px">${esc(a)}</div>`}h+=`<label class="pk"><input type="checkbox" data-pk="${d}" data-i="${i}" ${ck[i]?'checked':''}><span>${esc(b)}</span></label>`});
openLayer(`<h2>Pack for day ${d}</h2><p class="route" style="margin:0">Suggestions from this day's plan. Ticks are saved on this phone.</p>${h}<div class="row"><button class="btn plain" data-a="close">Close</button></div>`)}
function guideSheet(){const P=[['Hello','Namaste','Namaskaram','Vanakkam'],['Thank you','Dhanyavaad','Dhanyavaadalu','Nandri'],['How much?','Kitna hua?','Idi entha?','Evvalavu?'],['Please go to ...','... chaliye','... ki vellandi','... ku ponga'],['Stop here','Yahin rokiye','Ikkada aapandi','Inge niruthunga'],['Water','Paani','Neellu','Thanni'],['Less spicy (for child)','Mirch kam','Karam takkuva','Kaaram kammi'],['Where is the toilet?','Toilet kahan hai?','Toilet ekkada undi?','Toilet enga irukku?'],['I need a doctor','Doctor chahiye','Doctor kavali','Doctor venum'],['Please help','Madad kijiye','Sahayam cheyandi','Udhavi pannunga']];
const R=[['Hyderabad','Hyderabad'],['Mumbai','Mumbai'],['Port Blair','Port Blair'],['Havelock (Swaraj Dweep)','Havelock Island'],['Neil (Shaheed Dweep)','Neil Island']];
openLayer(`<h2>Offline guide</h2><p class="route" style="margin:0">Everything on this page works with no internet. The Maps links open Google Maps, which needs a connection unless you downloaded that area there.</p>
<div class="eyebrow" style="margin-top:6px">Tips for ${esc(KN())} and the trip</div>
<ul class="gtips"><li>Andaman: carry enough cash. Cards and UPI can fail on the islands and ATMs are fewer at Havelock and Neil.</li><li>Mobile signal is patchy on the islands. Save tickets and documents here before you go; they open offline.</li><li>Ferries: carry photo ID for every traveller and reach the jetty early. The ticket shows the reporting time, so follow that.</li><li>Rough sea day: take motion-sickness tablets before boarding, not after.</li><li>Airport cabs: use the official prepaid counter or a booked cab and agree the fare before you start.</li><li>October is hot and humid: water, a hat and sunscreen for ${esc(KN())}, and a light jacket for cold ferry cabins and flights.</li><li>Tide times are estimates from a coarse sea model, not a tide table. Check locally before swimming, snorkelling or crossing at low tide.</li><li>Confirm timings on the day. Schedules, ferry slots and opening hours can change.</li></ul>
<div class="eyebrow">Useful phrases</div><div class="gph"><div class="gh"><b>English</b><b>Hindi</b><b>Telugu</b><b>Tamil</b></div>${P.map(r=>`<div class="gr">${r.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`).join('')}</div>
<div class="eyebrow">Pharmacies and ATMs near you (needs Maps)</div><div class="sosg">${R.map(([l,q])=>`<a class="btn ghost" href="${mapUrl('24 hour pharmacy near '+q)}" target="_blank" rel="noopener noreferrer">Pharmacy, ${esc(l)}</a><a class="btn ghost" href="${mapUrl('ATM near '+q)}" target="_blank" rel="noopener noreferrer">ATM, ${esc(l)}</a>`).join('')}</div>
<div class="row"><button class="btn plain" data-a="close">Close</button></div>`)}
function sosSheet(){const stays=BOOK.filter(b=>b.k==='Stay'||b.k==='Flight'||b.k==='Ferry');
 openLayer(`<h2>Emergency card</h2><div class="eyebrow">Tap a number to call</div>
 <div class="sosg"><a class="btn sosb" href="tel:112">112 All emergencies</a><a class="btn sosb" href="tel:108">108 Ambulance</a><a class="btn sosb" href="tel:100">100 Police</a><a class="btn sosb" href="tel:101">101 Fire</a><a class="btn sosb" href="tel:1098">1098 Child helpline</a><a class="btn sosb" href="tel:1091">1091 Women helpline</a></div>
 <div class="eyebrow">Hospitals (opens Google Maps)</div>
 <div class="sosg">${(XT.hosp||[]).map(([l,q])=>`<a class="btn ghost" href="${mapUrl(q)}" target="_blank" rel="noopener noreferrer">${esc(l)}</a>`).join('')}</div>
 <div class="eyebrow">Health notes for this phone only</div><textarea id="med" class="in" rows="3" maxlength="500" placeholder="Allergies, blood groups, medicines, doctor’s number">${esc(lsGet('an_med',''))}</textarea>
 <div class="eyebrow">Booking references</div><div class="card" style="padding:8px 12px">${stays.map(b=>`<div class="kv"><span class="k">${esc(b.k)}</span><span style="flex:1;min-width:0">${esc(b.t.slice(0,40))}<br><small>${esc(b.w.slice(0,38))}</small></span><code>${esc(b.ref)}</code></div>`).join('')}</div>
 <div class="row"><button class="btn plain" data-a="close">Close</button></div>`)}
/* search */
function searchSheet(){openLayer(`<h2>Search</h2><input class="in" id="sq" type="search" placeholder="Activities, bookings, tickets, places" autocomplete="off" autocapitalize="none" aria-label="Search"><div id="sr" class="srl"></div><div class="row"><button class="btn plain" data-a="close">Close</button></div>`);setTimeout(()=>{const q=$('sq');if(q)q.focus()},120)}
function doSearch(v){const el=$('sr');if(!el)return;const q=v.trim().toLowerCase();if(q.length<2){el.innerHTML='<p class="route">Type at least 2 letters.</p>';return}
 const out=[];DAYS.forEach(d=>itemsFor(d.n).forEach(i=>{if(i.x.toLowerCase().includes(q)||i.t.includes(q))out.push(`<button class="drow" data-sg="d:${d.n}:${esc(i.id)}"><span>${esc(i.x.slice(0,90))}</span><small>${d.dow} ${d.n} Oct ${i.t}</small></button>`)}));
 BOOK.forEach((b,ix)=>{if((b.t+' '+b.ref+' '+b.w+' '+b.pol).toLowerCase().includes(q))out.push(`<button class="drow" data-sg="b:${ix}"><span>${esc(b.t)}</span><small>${esc(b.k)} · ${esc(b.ref)}</small></button>`)});
 DOCS.forEach(d=>{if(d.title.toLowerCase().includes(q))out.push(`<button class="drow" data-sg="o:${esc(d.id)}"><span>${esc(d.title)}</span><small>Original</small></button>`)});
 el.innerHTML=out.length?out.slice(0,40).join(''):'<p class="route">Nothing found.</p>'}
function goSearch(v){const [k,a,b]=v.split(':');
 if(k==='d'){closeLayer();sel=+a;tab='today';render('saved');setTimeout(()=>{const li=document.querySelector('.tl li[data-id="'+(b||'').replace(/"/g,'')+'"]');if(li){li.scrollIntoView({block:'center'});li.classList.add('hit');setTimeout(()=>li.classList.remove('hit'),2200)}},120)}
 else if(k==='b'){closeLayer();tab='book';render('saved')}else if(k==='o'){closeLayer();docViewer(a)}}
/* booking reminders */

function comingUp(){try{const n=ist(),now=n.y===2026&&n.mo===9?n.d*1440+n.m:(n.y*12+n.mo<2026*12+9?0:1e9),list=[];
 BOOK.forEach(b=>{const m=/(\d{1,2}) (?:to \d+ )?Oct/.exec(b.w);if(!m)return;const t=/(\d{1,2}:\d{2})/.exec(b.w),tm=t?t[1]:/check-in (\d{1,2}:\d{2})/.exec(b.w+' '+b.pol)?.[1]||'12:00';list.push([+m[1],tm,(b.k==='Stay'?'Check-in: ':b.k+': ')+b.t.slice(0,44)])});
 (XT.deads||[]).forEach(d=>list.push(d.slice()));
 list.forEach(x=>x.at=x[0]*1440+mins(x[1]));const up=list.filter(x=>x.at>=now).sort((a,b)=>a.at-b.at).slice(0,4);if(!up.length)return'';
 return `<div class="card rem"><div class="eyebrow" style="margin-bottom:6px">Coming up</div>${up.map(x=>{const dl=x.at-now,t=now===0?'':dl<1440?(dl>=60?Math.floor(dl/60)+' h':dl+' min'):Math.floor(dl/1440)+' d';return `<div class="rowx"><div><b>${esc(x[2])}</b><br><small>${x[0]} Oct, ${x[1]}</small></div>${t?`<span class="pill ${dl<1440?'rose':'sky'}">in ${t}</span>`:''}</div>`}).join('')}</div>`}catch(e){return''}}
/* spending by day */
function spendChart(ex,env,spent){try{if(!ex.length)return'';const by={};ex.forEach(e=>{const m=/(\d{1,2})/.exec(e.d||'');const k=m?+m[1]:0;by[k]=(by[k]||0)+e.a});const ks=Object.keys(by).map(Number).sort((a,b)=>a-b),mx=Math.max(1,...Object.values(by)),n=ist();
 const left=env-spent,daysLeft=n.y===2026&&n.mo===9&&n.d>=10&&n.d<20?20-n.d:0;
 return `<div class="card" style="margin-top:12px"><div class="eyebrow" style="margin-bottom:8px">Spending by day</div>${ks.map(k=>`<div class="cat"><span>${k?k+' Oct':'Other'}</span><div class="tr"><i style="width:${100*by[k]/mx}%"></i></div><b>${inr(by[k])}</b></div>`).join('')}<p class="route" style="margin:8px 0 0">${left>=0?`Left to spend: ${inr(left)}${daysLeft?` (about ${inr(Math.round(left/daysLeft))} a day for the ${daysLeft} days left)`:''}`:`Over budget by ${inr(-left)}`}</p></div>`}catch(e){return''}}

/* ================= events ================= */
document.addEventListener('click',e=>{
 try{
 const ta=e.target.closest('a[data-ta]');if(ta&&!navigator.onLine){e.preventDefault();toast('You are offline. Open this when you have signal.');return}
 const z=e.target.closest('[data-z]');if(z&&!e.target.closest('button')){z.classList.toggle('z');return}
 if(e.target.id==='ovl'){if(!$('layer').querySelector('[data-conf]'))closeLayer();return}
 const b=e.target.closest('button,input,a');if(!b)return;const a=b.dataset.a;
 if(b.tagName==='A')return;
 if(b.dataset.t){tab=b.dataset.t;enter();render('saved');return}
 if(b.dataset.d){sel=+b.dataset.d;enter();render('keep');return}
 if(b.dataset.pal){setPal(b.dataset.pal);return}
 if(b.dataset.sg){goSearch(b.dataset.sg);return}
 if(b.dataset.fs){setFs(b.dataset.fs);return}
 if(b.dataset.go){sel=+b.dataset.go;tab='today';render('saved');return}
 if(b.dataset.k){const k=b.dataset.k;const nv=!b.closest('li').classList.contains('done');const ck='a_'+k.replace(/[^\w-]/g,'_');ST.done=ST.done.filter(x=>x!==k);ST.syn.chk[ck]=nv;queueSet('checks/'+ck,{v:nv,at:Date.now()});save();b.closest('li').classList.toggle('done',nv);return}
 if(b.dataset.cp){const v=b.dataset.cp;const ok=()=>toast('Copied '+v);try{navigator.clipboard.writeText(v).then(ok,()=>toast(v))}catch(x){toast(v)}return}
 if(b.dataset.del){const id=b.dataset.del;delete ST.syn.exp[id];queueDel('expenses/'+id);viewMoney();return}
 if(b.dataset.ud){udViewer(b.dataset.ud);return}
 if(b.dataset.doc){docViewer(b.dataset.doc);return}
 if(b.dataset.ph){photoSheet(b.dataset.ph,b.dataset.q||'Andaman');return}
 if(b.dataset.edit){itemSheet(b.dataset.edit);return}
 if(b.dataset.c){const v=b.checked,id=b.dataset.c;ST.syn.chk[id]=v;queueSet('checks/'+id,{v,at:Date.now()});const sec=b.closest('section');const all=sec.querySelectorAll('input');sec.querySelector('.prog').textContent=[...all].filter(i=>i.checked).length+'/'+all.length;return}
 if(a==='add')itemSheet(null);
 else if(a==='save')saveSheet(b.dataset.id||null);
 else if(a==='close')closeLayer();
 else if(a==='closedoc'){cleanupDoc();$('layer').innerHTML=''}
 else if(a==='shareoriginal')shareOriginal(b.dataset.id);
 else if(a==='del')delItem(b.dataset.id);
 else if(a==='undo')restoreItem();
 else if(a==='reset'){const id=b.dataset.id,bi=dayOf(sel).items.find(x=>x.id===id);if(bi)queueItem(id,{d:sel,t:bi.t,x:bi.x,own:false,del:false});closeLayer();render('keep');toast('Back to the original')}
 else if(a==='choose')pickPhoto(b.dataset.id);
 else if(a==='rmph')rmPhoto(b.dataset.id);
 else if(a==='mine')resolve(true);
 else if(a==='theirs')resolve(false);
 else if(a==='conf')showConflict();
 else if(a==='settings')settingsSheet();
 else if(a==='sos')sosSheet();
 else if(a==='search')searchSheet();
 else if(a==='fitreset'){try{localStorage.removeItem('an_fit');localStorage.removeItem('an_lift')}catch(e){}document.documentElement.style.removeProperty('--lift');if(window.fitApp)window.fitApp();const f=fitVal();const rf=$('r-fit'),rl=$('r-lift');if(rf){rf.value=f;rf.style.setProperty('--p',(100*f/70)+'%');$('v-fit').textContent=f}if(rl){rl.value=0;rl.style.setProperty('--p','0%');$('v-lift').textContent='0'}toast('Bottom bar reset')}
 else if(a==='guide')guideSheet();
 else if(a==='addud')pickUserDoc();
 else if(a==='udel')udDelete(b.dataset.id,b);
 else if(a==='checkin')checkinSheet();
 else if(a==='pack')packSheet();
 else if(a==='kidsw'){lsSet('an_kiana',b.checked?'1':'0');render('keep');if(kidOn())kSnd(kidKey(),true)}
 else if(a==='ksnd'){lsSet('an_ksnd',b.checked?'1':'0');if(b.checked)kSnd(kidKey(),false)}
 else if(a==='kfx'){lsSet('an_kfx',b.checked?'1':'0');kidFx(kidOn()?kidKey():null)}
 else if(a==='kplay'){kSnd(kidKey(),true)}
 else if(a==='fit'){const v=b.dataset.v;try{localStorage.setItem('an_fit',v)}catch(e){}if(window.fitApp)window.fitApp();document.querySelectorAll('[data-a="fit"]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.v===v)))}
 else if(a==='kid'){lsSet('an_kiana',kidOn()?'0':'1');b.textContent='Kiana mode: '+(kidOn()?'ON':'OFF');render('keep')}
 else if(a==='savecfg'){const p=$('s-p').value.trim(),k=$('s-k').value.trim();if(p&&k){ST.cfg={projectId:p,apiKey:k};save();SYNC.denied=false;checkConn()}}
 else if(a==='check')checkConn();
 else if(a==='reload'){(async()=>{try{if(navigator.onLine===false){toast('You are offline. The app keeps working from this phone.');return}
 const c=await caches.open('an-v1');const L=['./','index.html','app.css','app.js','payload.js','scenes.js','config.js','manifest.webmanifest','pdf.min.js','pdf.worker.min.js','scenes.js'];
 try{const r=await fetch('docs.json',{cache:'reload'});if(r.ok)(await r.json()).forEach(u=>L.push(u))}catch(x){}
 const first=await fetch('index.html',{cache:'reload'});if(!first||!first.ok){toast('Could not reach the server. Nothing was changed.');return}
 await c.put('index.html',first.clone());let bad=0;
 await Promise.all(L.map(async u=>{try{const r=await fetch(u,{cache:'reload'});if(r&&r.ok)await c.put(u,r);else bad++}catch(x){bad++}}));
 try{const rs=await navigator.serviceWorker.getRegistrations();for(const r of rs)await r.update()}catch(x){}
 toast(bad?'Updated most files. Reloading…':'Updated. Reloading…');setTimeout(()=>location.reload(),600)}catch(x){toast('Could not update. Nothing was changed.')}})()}
 else if(a==='lock'){(async()=>{await IDB.del('kv','key');location.reload()})()}
 else if(a==='hint'){ST.ui.nohint=true;save();render('keep')}
 else if(a==='pvon'){ST.ui.pv={day:sel||10,m:480};save();render('saved')}
 else if(a==='pvoff'){delete ST.ui.pv;sel=null;save();render('saved')}
 }catch(err){fixed(err);try{render('keep')}catch(x){}}});
document.addEventListener('submit',e=>{e.preventDefault();if(e.target.id!=='exf')return;
 const a=parseFloat($('exa').value);if(!(a>0))return;const n=ist();const id='e'+Date.now().toString(36)+Math.random().toString(36).slice(2,4);
 const doc={a,c:$('exc').value,n:$('exn').value.trim().slice(0,120),d:n.d+' Oct',by:DEV(),at:Date.now()};ST.syn.exp[id]=doc;queueSet('expenses/'+id,doc);viewMoney();toast('Added')});
document.addEventListener('input',e=>{try{const t=e.target;if(t.dataset&&t.dataset.cl){let o={};try{o=JSON.parse(localStorage.getItem('an_cl'+t.dataset.cl)||'{}')}catch(x){}o[t.dataset.i]=t.checked?1:0;lsSet('an_cl'+t.dataset.cl,JSON.stringify(o));window.haptic&&window.haptic();return}if(t.dataset&&t.dataset.pk){let o={};try{o=JSON.parse(localStorage.getItem('an_pk'+t.dataset.pk)||'{}')}catch(x){}o[t.dataset.i]=t.checked?1:0;lsSet('an_pk'+t.dataset.pk,JSON.stringify(o));window.haptic&&window.haptic();return}if(t.id==='r-fit'||t.id==='r-lift'){const fit=t.id==='r-fit',v=t.value;lsSet(fit?'an_fit':'an_lift',v);$(fit?'v-fit':'v-lift').textContent=v;t.style.setProperty('--p',(100*v/t.max)+'%');if(fit){if(window.fitApp)window.fitApp()}else document.documentElement.style.setProperty('--lift',v+'px');haptic()}if(e.target.id==='sq')doSearch(e.target.value);if(e.target.id==='med')lsSet('an_med',e.target.value)}catch(x){}});
document.addEventListener('change',e=>{
 if(e.target.id==='pvd'||e.target.id==='pvt'){const day=+$('pvd').value;const v=normT($('pvt').value)||'08:00';ST.ui.pv={day,m:mins(v)};sel=day;save();render('saved')}
 if(e.target.id==='env'){const v=Math.max(0,+e.target.value||0);ST.syn.meta.budget=v;queueSet('meta/budget',{v,at:Date.now()});viewMoney()}});
window.addEventListener('error',e=>{if(errs<6&&ST&&D){errs++;fixed(e.error||e);softRender()}});
window.addEventListener('unhandledrejection',e=>{fixed(e.reason)});
setInterval(()=>{if(tab==='today'&&$('nowc'))paintNow()},30000);

/* ================= boot, unlock ================= */
function showLock(msg){$('nav').innerHTML='';$('pane').innerHTML=`<div class="lock"><form class="card" id="lf"><h1>Andaman Trip</h1><p class="route" style="margin:0">Enter the trip passphrase once. This phone will remember it.</p><input class="in" id="pp" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off" placeholder="xxxx-xxxx-xxxx-xxxx" required><div class="err" id="pe" ${msg?'':'hidden'}>${esc(msg||'')}</div><button class="btn" type="submit" id="pb">Unlock</button></form></div>`;
 $('lf').onsubmit=async ev=>{ev.preventDefault();const pb=$('pb');pb.disabled=true;pb.textContent='Unlocking…';const pass=$('pp').value.trim().toLowerCase().replace(/\s+/g,'');
  try{const P=window.PAYLOAD;const raw=await deriveRaw(pass,unb64(P.salt),P.iter);await setKey(raw);await loadPayload();await IDB.set('kv','key',b64(raw));start()}
  catch(e){K=null;showLock('That passphrase did not work. Check it and try again.')}}}
async function boot(){
 await IDB.open();
 try{const saved=await IDB.get('kv','state');ST=saved||blank()}catch(e){ST=blank()}
 heal();
 try{const all=await IDB.all('ph');for(const k in all)if(typeof all[k]==='string')phMem[k]=all[k]}catch(e){}
 if('serviceWorker'in navigator&&location.protocol.startsWith('http')){navigator.serviceWorker.register('sw.js').catch(()=>{})}
 try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}
 const k=await IDB.get('kv','key');
 if(k){try{await setKey(unb64(k));await loadPayload();start();return}catch(e){await IDB.del('kv','key');showLock('The trip plan was updated. Enter the passphrase again.');return}}
 showLock()}
function start(){
 // restore where the user was; on a new live trip day jump to today
 const c=clock();tab=ST.ui.tab||'today';sel=ST.ui.sel&&dayOf(ST.ui.sel)?ST.ui.sel:c.day;
 if(c.live&&ST.ui.day&&ST.ui.day!==c.day&&!ST.ui.pv){sel=c.day;tab='today'}
 render('saved');loadExtras();
 if(ST.cf.length)showConflict();
 poll();flush()}
(function(){let x0=0,y0=0,t0=0,ok=false,pull=0;const P=()=>document.getElementById('pane');
document.addEventListener('touchstart',e=>{const p=P();ok=!!p&&p.contains(e.target)&&!e.target.closest('.chips,input,textarea,.viewer,.ov')&&e.touches.length===1;if(!ok)return;x0=e.touches[0].clientX;y0=e.touches[0].clientY;t0=Date.now();pull=p.scrollTop<=0},{passive:true});
document.addEventListener('touchend',e=>{if(!ok)return;ok=false;const t=e.changedTouches[0],dx=t.clientX-x0,dy=t.clientY-y0;if(Date.now()-t0>700)return;
if(pull&&dy>90&&Math.abs(dx)<50){toast('Syncing…');try{flush();poll()}catch(_){}return}
if(Math.abs(dx)>70&&Math.abs(dy)<45&&tab==='today'){const i=DAYS.findIndex(d=>d.n===sel),j=i+(dx<0?1:-1);if(DAYS[j]){sel=DAYS[j].n;enter();render('keep')}}},{passive:true})})();
(function(){let L=null;function mk(){if(L)return;L=document.createElement('label');L.className='hapt';L.innerHTML='<input type="checkbox" switch tabindex="-1" aria-hidden="true">';document.body.appendChild(L)}
window.haptic=function(){try{mk();L.click()}catch(e){}try{if(navigator.vibrate)navigator.vibrate(8)}catch(e){}};
document.addEventListener('pointerdown',e=>{if(e.target.closest&&e.target.closest('button,.chip,nav button')&&!e.target.closest('input'))window.haptic()},{passive:true})})();
(function(){let tm=0,on=false,last=null;const chipAt=(x,y)=>{const el=document.elementFromPoint(x,y);return el&&el.closest&&el.closest('.chip')};
document.addEventListener('touchstart',e=>{const ch=e.target.closest&&e.target.closest('.chips');on=false;clearTimeout(tm);if(!ch||e.touches.length!==1)return;tm=setTimeout(()=>{on=true;last=null;window.haptic&&window.haptic()},320)},{passive:true});
document.addEventListener('touchmove',e=>{if(!on){clearTimeout(tm);return}if(e.cancelable)e.preventDefault();const t=e.touches[0],c=chipAt(t.clientX,t.clientY);if(c&&c.dataset.d&&c.dataset.d!==last){last=c.dataset.d;sel=+last;document.querySelectorAll('.chip').forEach(x=>x.setAttribute('aria-pressed',String(x===c)));window.haptic&&window.haptic()}},{passive:false});
document.addEventListener('touchend',()=>{clearTimeout(tm);if(on){on=false;if(last){enter();render('keep')}last=null}},{passive:true});
document.addEventListener('touchcancel',()=>{clearTimeout(tm);on=false},{passive:true});
['gesturestart','gesturechange','gestureend'].forEach(g=>document.addEventListener(g,e=>{if(!(e.target.closest&&e.target.closest('.viewer')))e.preventDefault()}));
document.addEventListener('touchmove',e=>{if(e.touches.length>1&&e.cancelable&&!(e.target.closest&&e.target.closest('.viewer')))e.preventDefault()},{passive:false});
const pill=document.createElement('div');pill.className='offpill';pill.textContent='Offline. Changes are saved on this phone and sync later.';pill.hidden=navigator.onLine!==false;document.body.appendChild(pill);
const up=()=>{pill.hidden=navigator.onLine!==false};window.addEventListener('online',up);window.addEventListener('offline',up)})();
try{lsSet('an_badge','');if(navigator.clearAppBadge)navigator.clearAppBadge()}catch(e){}
window.__app={get book(){return BOOK},get flights(){return flightsAll()},loadExtras,get ST(){return ST},get healed(){return healed},heal,flush,poll,itemsFor,sunTimes,spendChart,get sync(){return SYNC},get trip(){return TRIP}};
boot();
})();
