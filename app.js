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
 if(r.ok)return{status:r.status,json:j};
 const st=j&&j.error&&j.error.status||'';
 if(r.status===404)return{status:404,json:null};
 if(r.status===409||r.status===412||st==='FAILED_PRECONDITION'||st==='ABORTED'||(r.status===400&&/precondition/i.test(JSON.stringify(j||{}))))throw{code:'precondition'};
 if(r.status===403||r.status===401||st==='PERMISSION_DENIED'||st==='UNAUTHENTICATED')throw{code:'denied',msg:j&&j.error&&j.error.message};
 if(r.status===400&&/API key/i.test(JSON.stringify(j||{})))throw{code:'denied'};
 if(r.status===429||r.status>=500)throw{code:'unavailable'};
 throw{code:'invalid',msg:j&&j.error&&j.error.message}}
async function listAll(coll,mask){const out=[];let tok='';for(let i=0;i<40;i++){const qs=[['pageSize','300']];if(tok)qs.push(['pageToken',tok]);(mask||[]).forEach(m=>qs.push(['mask.fieldPaths',m]));const r=await api('GET',coll,qs);const j=r.json||{};(j.documents||[]).forEach(d=>out.push(d));tok=j.nextPageToken;if(!tok)break}return out}
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
return `<div class="glance"><div class="gl-n"><b>${k}</b>/${n}<span>done</span></div><div class="gl-t">${txt}</div><button class="btn ghost gl-b" data-a="pack">Pack</button></div>`}catch(e){return''}}
function viewToday(){
 const c=clock();if(sel==null||!dayOf(sel))sel=c.day;const d=dayOf(sel);const its=itemsFor(sel);const dn=new Set(ST.done);for(const kk in ST.syn.chk)if(kk.startsWith('a_')){const id0=kk.slice(2);ST.syn.chk[kk]?dn.add(id0):dn.delete(id0)}
 let h=`<div class="top"><div><div class="eyebrow">${dow(d)}</div><h1>${esc(d.title)}</h1></div></div>${installBanner()}${stat()}`;
 h+=`<div class="chips" role="group" aria-label="Pick a day">${DAYS.map(x=>`<button class="chip${x.n===c.day&&(c.live||c.pv)?' today':''}" data-d="${x.n}" aria-pressed="${x.n===sel}"><b>${x.n}</b><span>${x.dow}</span></button>`).join('')}</div>`;
 if(!c.live&&!c.pv)h+=`<div class="note" style="margin:0 0 14px;background:var(--sky)"><b style="color:var(--sky-s)">${c.before?`Trip starts in ${c.diff} day${c.diff===1?'':'s'}.`:'Trip is over.'}</b> The Now card goes live on Oct 10. <button class="btn ghost" data-a="pvon" style="padding:4px 10px;min-height:0;border-radius:10px">Preview a time</button></div>`;
 if(c.pv)h+=`<div class="card" style="margin-bottom:14px"><div class="eyebrow" style="margin-bottom:8px">Preview mode</div><div class="pv"><select class="in" id="pvd" aria-label="Preview day">${DAYS.map(x=>`<option value="${x.n}"${x.n===c.day?' selected':''}>${dow(x)}</option>`).join('')}</select><input class="in" id="pvt" type="time" value="${hm(c.m)}" aria-label="Preview time"></div><button class="btn ghost" data-a="pvoff">Use real clock</button></div>`;
 const isNow=(c.live||c.pv)&&c.day===sel;
 if(isNow)h+=`<div id="leavec"></div><section class="now" style="${theme(d)}" id="nowc"></section>`;
 const cover=getPh('cover-'+sel);
 h+=`<div class="cover" style="${theme(d)}"><div class="art">${cover?`<img src="${cover}" alt="">`:SC[d.sc]||''}</div><button class="photo" data-ph="cover-${sel}" data-q="${esc(d.title)}">${cover?'Change photo':'Add photo'}</button><div class="meta"><div style="display:flex;gap:6px;flex-wrap:wrap">${early(its)?'<span class="pill rose">Early start '+its[0].t+'</span>':''}<span class="pill mint">${esc(d.stay.replace(/ \(.*\)/,''))}</span></div></div></div><div class="dinfo" id="dinfo"></div>${glance(its,dn,isNow,c)}`;
 h+=`<div class="addrow"><button class="btn" data-a="add">+ Add activity</button></div>`;
 h+=`<ol class="tl" style="${theme(d)}">${its.length?its.map(it=>row(it,dn)).join(''):'<li><span></span><div class="x" style="color:var(--soft)">No activities yet. Tap Add activity.</div><span></span></li>'}</ol>`;
 if(d.note)h+=`<div class="note"><b>Note.</b> ${esc(d.note)}</div>`;
 $('pane').innerHTML=h;status();paintInfo();wxFetch();if(isNow)paintNow()}
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
 let h=`<div class="top"><div><div class="eyebrow">All confirmed</div><h1>Bookings</h1></div><span class="pill mint">${BOOK.length} items</span></div>${stat()}${comingUp()}<div class="bk">`;
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
 ST.ui.tab=tab;ST.ui.sel=sel;ST.ui.day=ist().d;save()}
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
 <div class="row"><button class="btn ghost" data-a="guide">Offline guide</button></div>
 <div class="row"><button class="btn ghost" data-a="check">Check connection</button><button class="btn plain" data-a="reload">Reload latest version</button></div>
 <div class="err" id="s-e" hidden></div>
 <div><div class="eyebrow" style="margin-bottom:8px">Bottom bar (this phone)</div>
 <div class="srow"><span>Stretch screen down</span><span id="v-fit">${fitVal()}</span></div><input class="ios" type="range" id="r-fit" min="0" max="70" step="1" value="${fitVal()}" style="--p:${100*fitVal()/70}%">
 <div class="srow" style="margin-top:6px"><span>Lift bar up</span><span id="v-lift">${lsGet('an_lift','0')}</span></div><input class="ios" type="range" id="r-lift" min="0" max="40" step="1" value="${lsGet('an_lift','0')}" style="--p:${100*lsGet('an_lift','0')/40}%">
 <button class="btn ghost" data-a="fitreset" style="width:100%;margin-top:8px">Reset to standard position</button><p class="route" style="margin:6px 0 0">Stretch fills a blank strip under the bar. Lift raises the bar if it is cut off. Reset puts both back to the standard position and keeps them there.</p></div>
  <div class="swrow"><div><b>Child mode</b><p class="route" style="margin:2px 0 0">Adds a short tip for your child under each activity.</p></div><input class="sw" type="checkbox" switch data-a="kidsw" ${kidOn()?'checked':''} aria-label="Child mode"></div>
 <div><div class="eyebrow" style="margin-bottom:8px">Text size (this phone)</div><div class="fsz" role="group" aria-label="Text size">${[['s','Small','14px'],['m','Normal','17px'],['l','Large','20px'],['xl','Extra large','23px']].map(([k,l,s])=>`<button data-fs="${k}" aria-pressed="${k===curFs()}"><span style="font-size:${s};display:block">Aa</span><span style="font-size:11px">${l}</span></button>`).join('')}</div></div>
 <div><div class="eyebrow" style="margin-bottom:8px">Colour mode (this phone)</div><div class="pals" role="group" aria-label="Colour mode">${Object.keys(window.PALS).map(k=>`<button class="pal" data-pal="${k}" aria-pressed="${k===curPal()}"><i><b style="background:${window.PALS[k][1]}"></b><b style="background:${window.PALS[k][3]}"></b><b style="background:${window.PALS[k][2]}"></b></i>${window.PALS[k][0]}</button>`).join('')}</div></div>
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
function xtra(it){try{const m=mapLink(placeFor(it.x)),k=kidOn()?kidHint(it.x):'';return(m||k)?`<div class="xtra">${m}${k?`<span class="tag lav">${esc(KN())}: ${esc(k)}</span>`:''}</div>`:''}catch(e){return''}}
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
function paintInfo(){try{const el=$('dinfo');if(!el)return;const n=sel,loc=dayLoc(n),[sr,ss]=sunTimes(loc[0],loc[1],2026,9,n);
 let h=`<span class="pill butter">Sunrise ${hm(sr)}</span><span class="pill peach">Sunset ${hm(ss)}</span>`;
 const w=WX.d&&WX.d[n<=11?'mum':'pb']&&WX.d[n<=11?'mum':'pb']['2026-10-'+n];
 if(!w)h+=`<span class="pill muted">Forecast appears when online</span>`;
 if(w)h+=`<span class="pill sky">${wxName(w[0])} ${w[2]}° to ${w[1]}°C${w[3]!=null?' · rain '+w[3]+'%':''}</span>`;
 el.innerHTML=h||''}catch(e){}}
/* leave-now countdown */
const CRIT=/ferry|makruzz|nautika|flight|indigo|boarding|bag drop|jetty|check out|leave|cab (to|from)|light & sound|report at|at the .* counter/i;
function paintLeave(){try{const el=$('leavec');if(!el)return;const c=clock(),its=itemsFor(sel);
 const nx=its.find(i=>mins(i.t)>c.m&&CRIT.test(i.x));if(!nx||mins(nx.t)-c.m>240){el.innerHTML='';return}
 const left=mins(nx.t)-c.m,tone=left<=30?'r':left<=90?'w':'',t=left>=60?Math.floor(left/60)+' h '+(left%60)+' min':left+' min';
 el.innerHTML=`<div class="leave ${tone}"><b>Be ready in ${t}</b><span>${nx.t} · ${esc(nx.x.slice(0,90))}</span></div>`}catch(e){}}
/* emergency card */
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
<ul class="gtips"><li>Andaman: carry enough cash. Cards and UPI can fail on the islands and ATMs are fewer at Havelock and Neil.</li><li>Mobile signal is patchy on the islands. Save tickets and documents here before you go; they open offline.</li><li>Ferries: carry photo ID for every traveller and reach the jetty early. The ticket shows the reporting time, so follow that.</li><li>Rough sea day: take motion-sickness tablets before boarding, not after.</li><li>Airport cabs: use the official prepaid counter or a booked cab and agree the fare before you start.</li><li>October is hot and humid: water, a hat and sunscreen for ${esc(KN())}, and a light jacket for cold ferry cabins and flights.</li><li>Confirm timings on the day. Schedules, ferry slots and opening hours can change.</li></ul>
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
 else if(a==='pack')packSheet();
 else if(a==='kidsw'){lsSet('an_kiana',b.checked?'1':'0');render('keep')}
 else if(a==='fit'){const v=b.dataset.v;try{localStorage.setItem('an_fit',v)}catch(e){}if(window.fitApp)window.fitApp();document.querySelectorAll('[data-a="fit"]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.v===v)))}
 else if(a==='kid'){lsSet('an_kiana',kidOn()?'0':'1');b.textContent='Child mode: '+(kidOn()?'ON':'OFF');render('keep')}
 else if(a==='savecfg'){const p=$('s-p').value.trim(),k=$('s-k').value.trim();if(p&&k){ST.cfg={projectId:p,apiKey:k};save();SYNC.denied=false;checkConn()}}
 else if(a==='check')checkConn();
 else if(a==='reload'){(async()=>{try{for(const k of await caches.keys())await caches.delete(k);const rs=await navigator.serviceWorker.getRegistrations();for(const r of rs)await r.unregister()}catch(x){}location.reload()})()}
 else if(a==='lock'){(async()=>{await IDB.del('kv','key');location.reload()})()}
 else if(a==='hint'){ST.ui.nohint=true;save();render('keep')}
 else if(a==='pvon'){ST.ui.pv={day:sel||10,m:480};save();render('saved')}
 else if(a==='pvoff'){delete ST.ui.pv;sel=null;save();render('saved')}
 }catch(err){fixed(err);try{render('keep')}catch(x){}}});
document.addEventListener('submit',e=>{e.preventDefault();if(e.target.id!=='exf')return;
 const a=parseFloat($('exa').value);if(!(a>0))return;const n=ist();const id='e'+Date.now().toString(36)+Math.random().toString(36).slice(2,4);
 const doc={a,c:$('exc').value,n:$('exn').value.trim().slice(0,120),d:n.d+' Oct',by:DEV(),at:Date.now()};ST.syn.exp[id]=doc;queueSet('expenses/'+id,doc);viewMoney();toast('Added')});
document.addEventListener('input',e=>{try{const t=e.target;if(t.dataset&&t.dataset.pk){let o={};try{o=JSON.parse(localStorage.getItem('an_pk'+t.dataset.pk)||'{}')}catch(x){}o[t.dataset.i]=t.checked?1:0;lsSet('an_pk'+t.dataset.pk,JSON.stringify(o));window.haptic&&window.haptic();return}if(t.id==='r-fit'||t.id==='r-lift'){const fit=t.id==='r-fit',v=t.value;lsSet(fit?'an_fit':'an_lift',v);$(fit?'v-fit':'v-lift').textContent=v;t.style.setProperty('--p',(100*v/t.max)+'%');if(fit){if(window.fitApp)window.fitApp()}else document.documentElement.style.setProperty('--lift',v+'px');haptic()}if(e.target.id==='sq')doSearch(e.target.value);if(e.target.id==='med')lsSet('an_med',e.target.value)}catch(x){}});
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
window.__app={loadExtras,get ST(){return ST},get healed(){return healed},heal,flush,poll,itemsFor,sunTimes,spendChart,get sync(){return SYNC},get trip(){return TRIP}};
boot();
})();
