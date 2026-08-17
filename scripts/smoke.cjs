const fs=require('fs'),{JSDOM,VirtualConsole}=require('/tmp/node_modules/jsdom');
const html=fs.readFileSync(process.argv[2],'utf8');let pass=0,fail=0;
const ok=(n,c,x)=>{c?(pass++,console.log('  PASS  '+n)):(fail++,console.log('  FAIL  '+n+(x?'  ['+x+']':'')))};
const server={},store={};const vc=new VirtualConsole();vc.on('jsdomError',()=>{});
const jr=(b,s)=>({ok:s>=200&&s<300,status:s,json:async()=>b,clone(){return this}});
const dom=new JSDOM(html,{url:'https://splitlah.example/app/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
 Object.defineProperty(w,'localStorage',{configurable:true,value:{getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]},clear(){},key:i=>Object.keys(store)[i],get length(){return Object.keys(store).length}}});
 if(!w.crypto||!w.crypto.randomUUID)Object.defineProperty(w,'crypto',{configurable:true,value:require('crypto').webcrypto});
 w.fetch=async(u,i={})=>{u=String(u);const m=u.match(/\/trips\/([A-Z0-9]{6})$/);
  if(m){const c=m[1];if((i.method||'GET')==='GET'){return server[c]?jr({trip:JSON.parse(JSON.stringify(server[c]))},200):jr({error:'Trip not found'},404)}
   if(i.method==='PUT'){const t=JSON.parse(i.body);t.updated_at=new Date().toISOString();server[c]=t;return jr({trip:JSON.parse(JSON.stringify(t))},200)}}
  const pm=u.match(/\/trips\/([A-Z0-9]{6})\/patch$/);
  if(pm&&i.method==='POST'){const c=pm[1];if(!server[c])return jr({error:'Trip not found'},404);
   const p=JSON.parse(i.body),t=server[c];
   if(p.expenses){const by={};(t.expenses||[]).forEach(e=>{if(e&&e.id)by[e.id]=e});p.expenses.forEach(e=>{if(e&&e.id)by[e.id]=e});t.expenses=Object.values(by)}
   t.updated_at=new Date().toISOString();return jr({trip:JSON.parse(JSON.stringify(t))},200)}
  if(/\/restore$/.test(u))return jr({ok:true,token:'123456',tripCount:1},200);
  if(/\/fx\//.test(u))return jr({rate:0.29,source:'test'},200);
  return jr({error:'Not found'},404)};
 w.matchMedia=w.matchMedia||(()=>({matches:false,addListener(){},removeListener(){}}));w.scrollTo=()=>{};w.Chart=function(){return{destroy(){}}};
}});
const w=dom.window,ev=e=>w.eval(e),st=()=>w.eval('state'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await sleep(120);
 console.log('\n[smoke] happy path, fully online');
 ev('state.name="Chee Wee";state.paynowProxy="+6591234567";state.onboarded=true;state.config={allowAnonymous:true};save()');
 // create a trip through the real UI path
 ev('openNewTrip()');await sleep(30);
 w.document.getElementById('ntName').value='Kuantan trip';
 w.document.getElementById('ntCur').value='SGD';
 ev('createTrip()');await sleep(150);
 const codes=Object.keys(st().trips);
 ok('trip created locally',codes.length===1,JSON.stringify(codes));
 const c=codes[0];
 ok('trip uploaded to server',!!server[c],'server has '+JSON.stringify(Object.keys(server)));
 ok('marked synced, nothing pending',!!st().trips[c].syncedAt&&!Object.keys(st().outbox||{}).length);
 ok('no local-only fields leaked to server',!('pendingSync' in server[c])&&!('syncedAt' in server[c]),'server keys: '+JSON.stringify(Object.keys(server[c])));
 ok('trip visible on home',ev('visibleTrips().length')===1);
 // add an expense via the app
 ev('cur=state.trips["'+c+'"]');
 const uid=st().uid;
 ev('cur.expenses.push({id:"x1",desc:"Petrol",amount:80,originalAmount:80,currency:"SGD",fxRate:1,paidBy:"'+uid+'",splitMode:"equal",splits:null,at:new Date().toISOString(),date:"2026-08-09"})');
 await ev('push(cur)');await sleep(50);
 ok('expense persisted to server',(server[c].expenses||[]).length===1);
 ok('balances compute',typeof ev('tripTotal(state.trips["'+c+'"]) ')==='number');
 // refresh loop should be a no-op, not destructive
 for(let i=0;i<3;i++){await ev('refreshTrip(true)');await sleep(20)}
 ok('trip survives normal refreshes',!!st().trips[c]&&(st().trips[c].expenses||[]).length===1);
 // restore bundle still enumerates self-created trips (the v53 regression)
 await ev('showMyRestoreCode()');await sleep(60);
 ok('restore bundle includes self-created trip',ev('Object.keys(Object.fromEntries(visibleTrips().map(t=>[t.code,me(t)]))).length')===1);
 // recovery UI is empty when nothing is missing
 ok('nothing offered for recovery when healthy',ev('recoverableTrips().length')===0);
 // home renders
 ev('goHome()');await sleep(30);
 ok('home renders the trip card',/Kuantan trip/.test(w.document.getElementById('tripList').innerHTML));
 console.log('\n'+(fail?'>>> FAILED':'>>> ALL GOOD')+' — '+pass+' passed, '+fail+' failed\n');
 process.exit(fail?1:0)})();
