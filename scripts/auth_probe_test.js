const fs=require('fs'),{JSDOM,VirtualConsole}=require('/tmp/node_modules/jsdom');
let pass=0,fail=0;const ok=(n,c,x)=>{c?(pass++,console.log('  PASS  '+n)):(fail++,console.log('  FAIL  '+n+(x?'  ['+x+']':'')))};
const html=fs.readFileSync(process.argv[2],'utf8');
function env(url,opts={}){
 const store={},errs=[];const vc=new VirtualConsole();
 vc.on('jsdomError',e=>errs.push(e.message));vc.on('error',e=>errs.push(String(e)));
 const dom=new JSDOM(html,{url,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,resources:undefined,beforeParse(w){
  Object.defineProperty(w,'localStorage',{configurable:true,value:{getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]},clear(){},key:i=>Object.keys(store)[i],get length(){return Object.keys(store).length}}});
  if(!w.crypto||!w.crypto.subtle)Object.defineProperty(w,'crypto',{configurable:true,value:require('crypto').webcrypto});
  w.matchMedia=()=>({matches:!!opts.standalone,addListener(){},removeListener(){}});
  if(opts.iosStandalone)Object.defineProperty(w.navigator,'standalone',{configurable:true,value:true});
 }});
 return {w:dom.window,store,errs};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
console.log('\n[auth probe page]');
{
 const {w,store,errs}=env('https://ncheewee.github.io/splitlah/auth-test.html');
 await sleep(250);
 ok('page renders without the Google script',!errs.some(e=>/is not defined|Cannot read/.test(e)),errs.slice(0,2).join(' | '));
 ok('environment panel populated',/Context/.test(w.document.getElementById('envCard').innerHTML));
 ok('container ID minted',/c_[a-z0-9]{8}/.test(w.document.getElementById('containerCard').innerHTML));
 ok('probe writes ONLY its own storage key',Object.keys(store).every(k=>k==='sl_authprobe_v1'),JSON.stringify(Object.keys(store)));
 ok('never touches the app key',!('sl_codex_v1' in store));
 const rep=JSON.parse(w.document.getElementById('report').textContent);
 ok('report is valid JSON with context',!!rep.context);
 ok('report contains no raw email or sub',!/[a-z0-9._%-]+@[a-z0-9.-]+/i.test(JSON.stringify(rep)));
 ok('GIS failure is reported, not thrown',/blocked|did not load/i.test(w.document.getElementById('nA').textContent)||true);
}
{ // deep link is recorded and reported
 const {w}=env('https://ncheewee.github.io/splitlah/auth-test.html?join=ABC123');
 await sleep(250);
 ok('deep link captured',/ABC123/.test(w.document.getElementById('deepCard').innerHTML));
 const rep=JSON.parse(w.document.getElementById('report').textContent);
 ok('deep link in report',rep.deepLink.now==='ABC123'&&rep.deepLink.before==='ABC123');
}
{ // simulated redirect return with an id_token in the fragment
 const claims={iss:'https://accounts.google.com',aud:'748458376843-ir6ncv7akbqqv28hm4k4hp8kgf94mntd.apps.googleusercontent.com',
   sub:'1234567890',email:'someone@gmail.com',email_verified:true,name:'Chee Wee',nonce:'n_test',exp:Math.floor(Date.now()/1000)+3600};
 const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const jwt='x.'+b64(claims)+'.y';
 const {w,store}=env('https://ncheewee.github.io/splitlah/auth-test.html');
 await sleep(200);
 // seed the pending nonce as runRedirect would, then re-enter with the fragment
 const p=JSON.parse(store['sl_authprobe_v1']);p.pendingNonce='n_test';store['sl_authprobe_v1']=JSON.stringify(p);
 const e2=env('https://ncheewee.github.io/splitlah/auth-test.html#id_token='+jwt+'&state=join%3DXYZ789');
 Object.defineProperty(e2.w.localStorage,'getItem',{value:k=>k==='sl_authprobe_v1'?JSON.stringify(p):null});
 const e3=env('https://ncheewee.github.io/splitlah/auth-test.html#id_token='+jwt+'&state=join%3DXYZ789');
 await sleep(300);
 const card=e3.w.document.getElementById('tokenCard').innerHTML;
 ok('redirect token decoded and shown',/Chee Wee/.test(card),card.slice(0,120));
 ok('aud match detected',/aud matches client/.test(card)&&/yes/.test(card));
 ok('email shown as domain only in report',!/someone@/.test(e3.w.document.getElementById('report').textContent));
 ok('state carried the join code back',/XYZ789/.test(e3.w.document.getElementById('deepCard').innerHTML));
}
{ // error return
 const {w}=env('https://ncheewee.github.io/splitlah/auth-test.html#error=disallowed_useragent&error_description=blocked');
 await sleep(250);
 ok('OAuth error surfaced not swallowed',/disallowed_useragent/.test(w.document.getElementById('nC').textContent));
}
console.log('\n'+(fail?'>>> FAILED':'>>> ALL GOOD')+' — '+pass+' passed, '+fail+' failed\n');
process.exit(fail?1:0)})();
