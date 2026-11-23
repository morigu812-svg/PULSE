const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function app(){
 const els=new Map();
 const el=id=>{if(!els.has(id))els.set(id,{value:id==='filter'?'all':'',style:{setProperty(){}},classList:{toggle(){}},addEventListener(){},replaceChildren(){this.innerHTML=''},setAttribute(){},close(){this.open=false},showModal(){this.open=true}});return els.get(id)};
 const c={window:{PULSE_CONFIG:{url:'https://example.supabase.co',key:'public'}},document:{getElementById:el,querySelectorAll:()=>[],addEventListener(){},hidden:false},sessionStorage:{getItem(){return null},removeItem(){},setItem(){}},location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},Intl,Date,URL,URLSearchParams,AbortSignal,setInterval(){},console};
 vm.createContext(c);vm.runInContext(fs.readFileSync('app.js','utf8'),c);return{c,el};
}
test('dashboard counts, HTML escaping, pause filtering and stale warnings',()=>{
 const {c,el}=app();c.testRows=[{id:'a',name:'<script>',url:'https://test.onrender.com/',enabled:true,created_at:new Date().toISOString(),points:[{at:new Date().toISOString(),ok:true,status:200,ms:52}]},{id:'b',name:'Paused',url:'https://other.pages.dev/',enabled:false,points:[],created_at:new Date().toISOString()}];
 vm.runInContext('rows=testRows;render()',c);assert.equal(el('count').textContent,'2');assert.equal(el('healthy').textContent,'1');assert(el('servicesList').innerHTML.includes('&lt;script&gt;'));
 el('filter').value='paused';c.render();assert(el('servicesList').innerHTML.includes('PAUSED'));assert(!el('servicesList').innerHTML.includes('&lt;script&gt;'));
 c.testRows[0].points[0].at='2020-01-01T00:00:00Z';c.render();assert(el('liveState').textContent.includes('更新遅延'));
});
test('logout clears all user records and dialogs',()=>{const{c,el}=app();vm.runInContext('session={access_token:"private"};rows=[{id:"a"}];',c);el('siteDialog').open=true;c.clearSession();assert.equal(el('dashboard').hidden,true);assert.equal(el('authScreen').hidden,false);assert.equal(el('servicesList').innerHTML,'');assert.equal(el('siteDialog').open,false);assert.equal(vm.runInContext('rows.length',c),0);});
test('monitor validation rejects custom domains, credentials and query strings',()=>{const{c}=app();for(const url of ['http://x.onrender.com/','https://localhost/','https://example.com/','https://test.onrender.com/?secret=1','https://user:pass@test.onrender.com/'])assert.throws(()=>c.validateUrl(url));assert.equal(c.validateUrl('https://test.onrender.com'),'https://test.onrender.com/');});

test('XHR auth requests preserve error details and never retry a failed mutation',async()=>{
 const{c}=app();let sent=0,latest;
 c.XMLHttpRequest=class {constructor(){latest=this;}open(method,url){this.method=method;this.url=url;}setRequestHeader(){}getResponseHeader(){return 'test-request';}send(){sent++;this.status=422;this.responseText=JSON.stringify({msg:'Email not allowed',error_code:'email_address_not_authorized'});this.onload();}};
 await assert.rejects(c.request('/functions/v1/pulse-api',{method:'POST',body:{email:'test@example.invalid'}}),e=>e.status===422&&e.code==='email_address_not_authorized');assert.equal(sent,1);assert.equal(latest.timeout,30000);assert.equal(latest.withCredentials,false);
 c.XMLHttpRequest=class {open(){}setRequestHeader(){}send(){sent++;this.onerror();}};
 await assert.rejects(c.request('/functions/v1/pulse-api',{method:'POST',body:{}}),e=>e.code==='network_error');assert.equal(sent,2);
});
test('XHR connection test reads settings without cookies',async()=>{const{c}=app();c.XMLHttpRequest=class{open(){}setRequestHeader(){}send(){assert.equal(this.withCredentials,false);this.status=200;this.responseText='{"external":{"email":true}}';this.onload();}};const settings=await c.request('/functions/v1/pulse-api');assert.equal(settings.external.email,true);});
