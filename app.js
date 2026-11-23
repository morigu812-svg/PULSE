'use strict';
const $=id=>document.getElementById(id);
const {url:API,key:PUBLIC_KEY}=window.PULSE_CONFIG;
const API_BASE=(window.PULSE_CONFIG.apiBase||API).replace(/\/$/,'');
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=value=>value?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(value)):'—';
let session=null,rows=[],mode='login',generation=0,loading=false,checking=false,pendingDelete=null;
const STORE='pulse.isolated.session.v2';
const errorMessage=error=>{
 const text=error.message||'通信に失敗しました';
 if(/rate.limit|too many|429/i.test(text))return '操作が集中しています。しばらく待ってからお試しください。';
 if(/duplicate key/i.test(text))return 'このURLは登録済みです。';
 if(/check constraint.*url/i.test(text))return '対応する公開HTTPS URLを入力してください。';
 return text.slice(0,200)+(error.status?' ［HTTP '+error.status+' / '+(error.code||'error')+'］':'');
};
function request(path,{method='GET',body,token,prefer,timeoutMs=30000}={}){
 // All requests use the same-origin PULSE relay.
 // Mutations are sent once; do not retry account creation after an ambiguous failure.
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();
  const label='PULSEサーバー';
  xhr.open(method,API_BASE+path,true);xhr.timeout=timeoutMs;xhr.withCredentials=false;
  xhr.setRequestHeader('apikey',PUBLIC_KEY);
  if(body!==undefined)xhr.setRequestHeader('Content-Type','application/json');
  if(token)xhr.setRequestHeader('x-pulse-session',token);
  if(prefer)xhr.setRequestHeader('Prefer',prefer);
  const failure=(message,code)=>{const error=new Error(message);error.code=code;reject(error);};
  xhr.onerror=()=>failure(label+'に接続できませんでした。通信回線・コンテンツブロッカーを確認して、接続確認をお試しください。［NETWORK］','network_error');
  xhr.ontimeout=()=>failure(label+'の応答が制限時間内に届きませんでした。しばらく待ってから再度お試しください。［TIMEOUT］','timeout');
  xhr.onabort=()=>failure('通信が中断されました。［ABORTED］','aborted');
  xhr.onload=()=>{
   if(xhr.status===0)return failure(label+'との通信を完了できませんでした。［NETWORK］','network_error');
   let data;try{data=xhr.responseText?JSON.parse(xhr.responseText):null;}catch{return failure('中継先からJSON応答を取得できませんでした。RenderのRewrite設定を確認してください。［HTTP '+xhr.status+'］','invalid_response');}
   if(xhr.status<200||xhr.status>=300){const error=new Error(xhr.status===404&&API_BASE.startsWith('/')?'PULSEの通信中継が未設定です。Renderに /pulse-api/* のRewriteを追加してください。':data?.msg||data?.message||data?.error_description||data?.error||'HTTP '+xhr.status);error.status=xhr.status;error.code=data?.error_code||data?.code||'http_error';error.requestId=xhr.getResponseHeader('sb-request-id');return reject(error);}
   resolve(data);
  };
  xhr.send(body===undefined?null:JSON.stringify(body));
 });
}
function persist(){try{if(session)sessionStorage.setItem(STORE,JSON.stringify(session));else sessionStorage.removeItem(STORE);}catch{/* Private browsing may disallow storage. */}}
function acceptSession(data){if(!data?.access_token||!/^[a-f0-9]{64}$/.test(data.access_token))throw new Error('PULSEのログイン情報を取得できませんでした。');session={access_token:data.access_token,expires_at:Date.now()+(data.expires_in||604800)*1000,user:data.user};persist();}
async function pulse(action,input={},protectedRequest=true){
 const epoch=generation;
 if(protectedRequest&&(!session||session.expires_at<=Date.now())){clearSession('PULSEにログインしてください。');throw new Error('PULSEにログインしてください。');}
 try{return await request('/functions/v1/pulse-api',{method:'POST',body:{action,input},token:protectedRequest?session.access_token:undefined,timeoutMs:action==='check_monitors'?60000:30000});}
 catch(e){if(protectedRequest&&epoch===generation&&e.status===401&&e.code==='session_expired')clearSession('ログインの有効期限が切れました。再度ログインしてください。');throw e;}
}
const RECOVERY_STORE='pulse.pending-recovery.v1';
const recoveryBindings=new WeakSet();
function recoveryDialog(){
 let dialog=$('recoveryDialog');
 if(!dialog){dialog=document.createElement('dialog');dialog.id='recoveryDialog';dialog.setAttribute('aria-labelledby','recoveryTitle');document.body.append(dialog);}
 if(!$('recoveryCode')||!$('recoveryCopyMessage')||!$('copyRecovery')||!$('closeRecovery')){
  // Static markup only: secret values are assigned with textContent below.
  dialog.innerHTML='<h2 id="recoveryTitle">復旧コードを保存してください</h2><p>パスワードの再設定に使います。安全な場所に保存してください。</p><div id="recoveryCode" class="recovery-code"></div><button id="copyRecovery" type="button">コピーする</button><p id="recoveryCopyMessage" role="status"></p><button id="closeRecovery" type="button" class="primary">保存したので閉じる</button>';
 }
 if(!recoveryBindings.has(dialog)){
  dialog.addEventListener('click',async e=>{
   const button=e.target.closest('button');if(!button)return;
   if(button.id==='closeRecovery'){
    try{sessionStorage.removeItem(RECOVERY_STORE);}catch{}
    if($('recoveryCode'))$('recoveryCode').textContent='';
    if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');
   }else if(button.id==='copyRecovery'){
    const code=$('recoveryCode')?.textContent||'';
    try{await navigator.clipboard.writeText(code);$('recoveryCopyMessage').textContent='コピーしました。安全な場所に保存してください。';}
    catch{if($('recoveryCopyMessage'))$('recoveryCopyMessage').textContent='コードを長押し・選択してコピーしてください。';}
   }
  });
  dialog.addEventListener('cancel',e=>{e.preventDefault();if($('recoveryCopyMessage'))$('recoveryCopyMessage').textContent='復旧コードを保存してから閉じてください。';});
  recoveryBindings.add(dialog);
 }
 return dialog;
}
function showRecovery(code){
 if(!/^[a-f0-9]{32}$/.test(code||''))return;
 try{sessionStorage.setItem(RECOVERY_STORE,JSON.stringify({account_id:session?.user?.id,code}));}catch{}
 try{
  const dialog=recoveryDialog();$('recoveryCode').textContent=code;$('recoveryCopyMessage').textContent='';
  if(!dialog.open){if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');}
 }catch{
  // A recovery popup failure must never turn successful registration into a login failure.
  if($('authMessage'))$('authMessage').textContent='登録は完了しました。復旧コードの表示に失敗したため、再読み込みしてください。';
 }
}
function restoreRecovery(){
 try{const saved=JSON.parse(sessionStorage.getItem(RECOVERY_STORE)||'null');if(saved?.account_id===session?.user?.id)showRecovery(saved.code);}catch{}
}
function clearSession(message=''){
 generation++;session=null;rows=[];persist();$('dashboard').hidden=true;$('authScreen').hidden=false;
 $('servicesList').replaceChildren();$('eventRows').replaceChildren();$('userEmail').textContent='';
 for(const id of ['count','healthy','down','latency','uptime'])$(id).textContent='—';
 for(const id of ['siteDialog','deleteDialog','recoveryDialog','renewRecoveryDialog']){const dialog=$(id);if(dialog?.open){if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');}}
 if($('recoveryCode'))$('recoveryCode').textContent='';try{sessionStorage.removeItem(RECOVERY_STORE);}catch{}$('authMessage').textContent=message;
}
function markNotice(message,error=false){$('notice').textContent=message;$('notice').className='notice'+(error?' error':'');}
function render(){
 const all=rows.map(m=>({...m,last:m.points?.at(-1)||null}));
 const measured=all.filter(m=>m.enabled&&m.last),healthy=measured.filter(m=>m.last.ok);
 $('count').textContent=String(all.length);$('healthy').textContent=String(healthy.length);$('down').textContent=String(measured.length-healthy.length);
 const latencies=healthy.map(m=>m.last.ms).filter(Number.isFinite);
 $('latency').textContent=latencies.length?Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length)+' ms':'—';
 const points=all.flatMap(m=>m.points||[]),pct=points.length?Math.round(points.filter(p=>p.ok).length/points.length*1000)/10:null;
 $('uptime').textContent=pct===null?'—':pct+'%';$('ring').style.setProperty('--percent',(pct??0)+'%');
 const term=$('search').value.trim().toLowerCase(),filter=$('filter').value;
 const visible=all.filter(m=>(m.name+' '+m.url).toLowerCase().includes(term)&&(filter==='all'||filter===(m.enabled?(m.last?(m.last.ok?'ok':'down'):'unknown'):'paused')));
 $('servicesList').innerHTML=visible.length?visible.map(m=>{
 const state=!m.enabled?'PAUSED':!m.last?'PENDING':m.last.ok?'ONLINE':'DOWN';const kind=state==='ONLINE'?'ok':state==='DOWN'?'down':'unknown';
 const uptime=m.points.length?Math.round(m.points.filter(p=>p.ok).length/m.points.length*1000)/10+'%':'—';
 return `<article class="service"><div class="service-icon">⌁</div><div class="service-main"><strong>${escapeHtml(m.name)}</strong><a href="${escapeHtml(m.url)}" target="_blank" rel="noopener noreferrer" class="site-link">${escapeHtml(m.url)}</a><small>最終計測 ${escapeHtml(time(m.last?.at))}</small></div><div class="service-right"><div class="indicator ${kind}">● ${state}</div><small>${m.last?.ms===null||!m.last?'—':escapeHtml(m.last.ms)+' ms'} · ${uptime}</small></div><div class="service-actions"><button data-action="edit" data-id="${m.id}">編集</button><button data-action="toggle" data-id="${m.id}">${m.enabled?'一時停止':'再開'}</button><button data-action="delete" data-id="${m.id}" class="text-danger">削除</button></div></article>`;
 }).join(''):`<div class="empty">${all.length?'条件に一致するサイトはありません。':'まだ監視サイトがありません。「サイトを追加」から登録してください。'}</div>`;
 const events=all.flatMap(m=>(m.points||[]).map(p=>({...p,name:m.name}))).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,20);
 $('eventRows').innerHTML=events.length?events.map(p=>`<tr><td>${escapeHtml(time(p.at))}</td><td>${escapeHtml(p.name)}</td><td><span class="indicator ${p.ok?'ok':'down'}">${p.ok?'OK':'FAILED'}</span>${p.error?'<small class="event-error">'+escapeHtml(p.error)+'</small>':''}</td><td>${p.ms===null?'—':escapeHtml(p.ms)+' ms'}</td><td>${p.status??'—'}</td></tr>`).join(''):'<tr><td colspan="5">まだ監視履歴がありません。</td></tr>';
 const latest=events[0]?.at;$('updated').textContent=latest?'最終計測 '+time(latest):'計測待ち';
 const stale=all.some(m=>m.enabled&&(m.last?Date.now()-Date.parse(m.last.at)>20*60000:Date.now()-Date.parse(m.created_at)>20*60000));
 $('liveState').textContent=stale?'● 更新遅延':!latest?'● 計測待ち':'● 接続中';
 markNotice(stale?'一部のサイトが20分以上計測されていません。表示中の結果は過去の記録です。':'登録サイトは約5分ごとに計測されます。新規登録後は最初の計測をお待ちください。');
 $('addSite').disabled=all.length>=10;
}
async function refresh(){
 if(!session||loading||checking)return;loading=true;const epoch=generation;$('refresh').disabled=true;
 try{const data=await pulse('list_monitors');if(epoch!==generation)return;rows=data.monitors;render();}
 catch(e){if(epoch===generation&&session){$('liveState').textContent='● 接続失敗';markNotice(errorMessage(e)+' 最後に取得した結果を表示しています。',true);}}
 finally{loading=false;$('refresh').disabled=false;}
}
async function showDashboard(){
 const epoch=generation;const result=await pulse('me');const user=result.user;if(epoch!==generation)return;
 session.user=user;persist();$('authScreen').hidden=true;$('dashboard').hidden=false;$('userEmail').textContent=user.email||'マイダッシュボード';$('password').value='';await refresh();
}
function setMode(next){mode=next;$('loginTab').classList.toggle('primary',mode==='login');$('signupTab').classList.toggle('primary',mode==='signup');$('loginTab').setAttribute('aria-pressed',String(mode==='login'));$('signupTab').setAttribute('aria-pressed',String(mode==='signup'));$('authSubmit').textContent=mode==='login'?'ログイン':'アカウントを作成';$('password').autocomplete=mode==='login'?'current-password':'new-password';$('authMessage').textContent='';}
$('loginTab').addEventListener('click',()=>setMode('login'));$('signupTab').addEventListener('click',()=>setMode('signup'));
$('authForm').addEventListener('submit',async e=>{
 e.preventDefault();$('authSubmit').disabled=true;$('authMessage').textContent='確認中…';
 const email=$('email').value.trim(),password=$('password').value;
 try{
 const data=await pulse(mode==='signup'?'signup':'login',{email,password},false);
 generation++;acceptSession(data);showRecovery(data.recovery_code);await showDashboard();
 }catch(e){$('authMessage').textContent=errorMessage(e);}finally{$('authSubmit').disabled=false;}
});
$('logout').addEventListener('click',async()=>{const oldToken=session?.access_token;clearSession();if(oldToken)try{await request('/functions/v1/pulse-api',{method:'POST',body:{action:'logout',input:{}},token:oldToken});}catch{}});
async function checkNow(){
 if(!session||checking||loading)return;
 const epoch=generation;checking=true;const button=$('refresh');button.disabled=true;button.textContent='確認中…';button.setAttribute('aria-busy','true');
 markNotice('登録サイトへ接続して、最新のステータスを確認しています…');
 try{
  const result=await pulse('check_monitors');if(epoch!==generation)return;
  rows=result.monitors;render();
  markNotice(result.checked?result.checked+'件のサイトを確認し、ステータスと履歴を更新しました。':'監視中のサイトがありません。サイトを登録するか、一時停止を解除してください。');
 }catch(e){if(epoch===generation&&session)markNotice(errorMessage(e),true);}
 finally{checking=false;button.disabled=false;button.textContent='ステータス確認';button.setAttribute('aria-busy','false');}
}
$('refresh').addEventListener('click',checkNow);
for(const id of ['search','filter'])$(id).addEventListener('input',render);
function openEditor(row){$('siteForm').reset();$('siteId').value=row?.id||'';$('siteName').value=row?.name||'';$('siteUrl').value=row?.url||'';$('siteEnabled').checked=row?.enabled??true;$('siteTitle').textContent=row?'監視サイトを編集':'サイトを追加';$('siteMessage').textContent='';$('siteDialog').showModal();}
$('addSite').addEventListener('click',()=>openEditor());$('closeDialog').addEventListener('click',()=>$('siteDialog').close());
function validateUrl(raw){const u=new URL(raw);if(u.protocol!=='https:'||u.port||u.username||u.password||u.search||u.hash||!['github.io','onrender.com','pages.dev','vercel.app','netlify.app'].some(d=>u.hostname.endsWith('.'+d)))throw new Error('対応する公開HTTPS URLを指定してください（認証情報・クエリ・カスタムドメインは未対応）。');return u.href;}
$('siteForm').addEventListener('submit',async e=>{
 e.preventDefault();$('saveSite').disabled=true;$('siteMessage').textContent='保存中…';const epoch=generation;
 try{const id=$('siteId').value;const body={name:$('siteName').value.trim(),url:validateUrl($('siteUrl').value.trim()),enabled:$('siteEnabled').checked};if(!body.name)throw new Error('サイト名を入力してください。');
 const changed=await pulse('save_monitor',{...body,...(id?{id}:{})});if(epoch!==generation)return;if(!changed?.monitor)throw new Error('保存対象が見つかりません。再読み込みしてください。');$('siteDialog').close();await refresh();
 }catch(e){if(epoch===generation)$('siteMessage').textContent=errorMessage(e);}finally{$('saveSite').disabled=false;}
});
$('servicesList').addEventListener('click',async e=>{
 const button=e.target.closest('button[data-action]');if(!button)return;const row=rows.find(r=>r.id===button.dataset.id);if(!row)return;
 if(button.dataset.action==='edit')return openEditor(row);
 if(button.dataset.action==='delete'){pendingDelete=row.id;$('deleteName').textContent=row.name;$('deleteMessage').textContent='';return $('deleteDialog').showModal();}
 button.disabled=true;try{await pulse('save_monitor',{id:row.id,enabled:!row.enabled});await refresh();}catch(e){markNotice(errorMessage(e),true);button.disabled=false;}
});
$('cancelDelete').addEventListener('click',()=>$('deleteDialog').close());
$('confirmDelete').addEventListener('click',async()=>{const epoch=generation;$('confirmDelete').disabled=true;try{await pulse('delete_monitor',{id:pendingDelete});if(epoch!==generation)return;$('deleteDialog').close();await refresh();}catch(e){$('deleteMessage').textContent=errorMessage(e);}finally{$('confirmDelete').disabled=false;}});
$('recoveryForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const button=$('recoverAccount');button.disabled=true;$('recoverMessage').textContent='再設定中…';
 try{const data=await pulse('recover',{email:$('recoverEmail').value.trim(),recovery_code:$('recoverCode').value.trim(),password:$('recoverPassword').value},false);generation++;acceptSession(data);$('recoveryForm').reset();showRecovery(data.recovery_code);await showDashboard();}
 catch(e){$('recoverMessage').textContent=errorMessage(e);}finally{button.disabled=false;}
});
$('renewRecovery')?.addEventListener('click',()=>{$('renewRecoveryForm').reset();$('renewRecoveryMessage').textContent='';$('renewRecoveryDialog').showModal();});
$('cancelRenewRecovery')?.addEventListener('click',()=>$('renewRecoveryDialog').close());
$('renewRecoveryForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const button=$('confirmRenewRecovery');button.disabled=true;
 try{const data=await pulse('renew_recovery',{password:$('renewRecoveryPassword').value});$('renewRecoveryPassword').value='';$('renewRecoveryDialog').close();showRecovery(data.recovery_code);}
 catch(e){$('renewRecoveryMessage').textContent=errorMessage(e);}finally{button.disabled=false;}
});
document.querySelectorAll('.nav').forEach(link=>link.addEventListener('click',()=>document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n===link))));
function tick(){$('clock').textContent=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date())+' JST';}
setInterval(tick,1000);tick();setInterval(()=>{if(!document.hidden)refresh();},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
(async()=>{try{
 // Discard only legacy PULSE sessions; never touch another application's account.
 try{sessionStorage.removeItem('pulse.auth.session.v1');}catch{}
 const stored=sessionStorage.getItem(STORE);if(stored)session=JSON.parse(stored);
 if(session){await showDashboard();restoreRecovery();}
 }catch(e){if(e.status===401||e.code==='session_expired')clearSession('PULSEにログインしてください。'+errorMessage(e));else{$('authMessage').textContent=errorMessage(e);restoreRecovery();}}})();

$('connectionTest').addEventListener('click',async()=>{
 const button=$('connectionTest');button.disabled=true;$('authMessage').textContent='認証サーバーへの接続を確認中…';
 try{const result=await pulse('health',{},false);if(result.auth!=='pulse-isolated')throw new Error('PULSE専用認証へ接続できませんでした。');$('authMessage').textContent='PULSE専用認証への接続は正常です。My-Linksとは別のアカウントで利用できます。';}
 catch(e){$('authMessage').textContent=errorMessage(e);}
 finally{button.disabled=false;}
});
