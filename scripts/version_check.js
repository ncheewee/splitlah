const fs=require('fs'),{JSDOM,VirtualConsole}=require('/tmp/node_modules/jsdom');
const html=fs.readFileSync(process.argv[2],'utf8');let pass=0,fail=0;
const ok=(n,c,x)=>{c?(pass++,console.log('  PASS  '+n)):(fail++,console.log('  FAIL  '+n+(x?'  ['+x+']':'')))};
function env(deployedHtml,opts={}){
 const store={};let reloaded=0;const vc=new VirtualConsole();
 vc.on('jsdomError',e=>{if(/navigation|reload/i.test(e&&e.message||''))reloaded++});
 const jr=(b,s,text)=>({ok:s>=200&&s<300,status:s,json:async()=>b,text:async()=>text||'',clone(){return this}});
 const swReg={updated:0,waiting:opts.waiting?{postMessage(m){swReg.skipMsg=m}}:null,async update(){swReg.updated++}};
 const dom=new JSDOM(html,{url:'https://splitlah.example/splitlah/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  Object.defineProperty(w,'localStorage',{configurable:true,value:{getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]},clear(){},key:i=>Object.keys(store)[i],get length(){return Object.keys(store).length}}});
  if(!w.crypto||!w.crypto.randomUUID)Object.defineProperty(w,'crypto',{configurable:true,value:require('crypto').webcrypto});
  w.fetch=async(u)=>{u=String(u);
   if(/index\.html/.test(u)){if(opts.fetchFails)throw new TypeError('Failed to fetch');return jr({},opts.status||200,deployedHtml)}
   return jr({error:'Not found'},404)};
  Object.defineProperty(w.navigator,'serviceWorker',{configurable:true,value:{async getRegistration(){return swReg}}});
  if(opts.offline)Object.defineProperty(w.navigator,'onLine',{configurable:true,value:false});
  w.matchMedia=w.matchMedia||(()=>({matches:false,addListener(){},removeListener(){}}));w.scrollTo=()=>{};w.Chart=function(){return{destroy(){}}};
 }});
 const w=dom.window;
 return {w,ev:e=>w.eval(e),swReg,reloaded:()=>reloaded,toastText:()=>w.document.getElementById('toast').textContent,
         modalHtml:()=>w.document.getElementById('modal').innerHTML};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
console.log('\n[version tag + update check]');
const running=(html.match(/APP_VERSION\s*=\s*(\d+)/)||[])[1];

{ // header tag renders the running version
  const {w}=env(html);await sleep(120);
  const tags=[...w.document.querySelectorAll('.vTag')].map(e=>e.textContent);
  ok('header shows the running version',tags.length>0&&tags.every(t=>t==='v'+running),JSON.stringify(tags));
}
{ // settings shows version + button
  const {w,ev}=env(html);await sleep(120);
  ev('state.name="Chee Wee";state.onboarded=true');ev('openSettings()');await sleep(30);
  const h=w.document.getElementById('modal').innerHTML;
  ok('Edit profile shows the version',new RegExp('v'+running+'</b>').test(h));
  ok('Edit profile has a Check for update button',/checkForUpdate\(\)/.test(h));
}
{ // up to date
  const {ev,toastText}=env(html,{});await sleep(120);
  await ev('checkForUpdate()');await sleep(60);
  ok('reports up to date when versions match',/up to date/i.test(toastText()),toastText());
}
{ // newer version deployed
  const newer=html.replace(/APP_VERSION\s*=\s*\d+/,'APP_VERSION=999');
  const {ev,modalHtml,swReg}=env(newer);await sleep(120);
  await ev('checkForUpdate()');await sleep(60);
  ok('offers the update when a newer build is live',/Update available/.test(modalHtml())&&/v999/.test(modalHtml()));
  ok('asked the service worker to re-check',swReg.updated>0);
}
{ // applying the update tells a waiting SW to take over, then reloads
  const newer=html.replace(/APP_VERSION\s*=\s*\d+/,'APP_VERSION=999');
  const e=env(newer,{waiting:true});await sleep(120);
  await e.ev('applyUpdate()');await sleep(60);
  ok('waiting service worker told to skip waiting',e.swReg.skipMsg&&e.swReg.skipMsg.type==='SKIP_WAITING');
  ok('page reloaded',e.reloaded()===1);
}
{ // offline / network failure must not break anything
  const {ev,toastText}=env(html,{fetchFails:true,offline:true});await sleep(120);
  await ev('checkForUpdate()');await sleep(60);
  ok('offline check fails gracefully',/offline/i.test(toastText()),toastText());
}
{ // server returns garbage
  const {ev,toastText}=env('<html>no version here</html>');await sleep(120);
  await ev('checkForUpdate()');await sleep(60);
  ok('unparseable response fails gracefully',/failed/i.test(toastText()),toastText());
}
console.log('\n'+(fail?'>>> FAILED':'>>> ALL GOOD')+' — '+pass+' passed, '+fail+' failed\n');
process.exit(fail?1:0)})();
