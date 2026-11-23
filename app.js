'use strict';
const $=id=>document.getElementById(id);
const {url:API,key:PUBLIC_KEY}=window.PULSE_CONFIG;
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=value=>value?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(value)):'—';
let session=null,rows=[],mode='login',generation=0,refreshPromise=null,loading=false,pendingDelete=null;
const STORE='pulse.auth.session.v1';
const errorMessage=error=>{
 const text=error.message||'通信に失敗しました';
 if(/Invalid login credentials/.test(text))return 'メールアドレスまたはパスワードを確認してください。';
 if(/Email not confirmed/.test(text))return '確認メールのリンクで認証してからログインしてください。';
 if(/rate.limit|too many|429/i.test(text))return '操作が集中しています。しばらく待ってからお試しください。';
 if(/email.*not.*authorized|email_address_not_authorized/i.test(text))return 'メール送信先が制限されています。運営側でメール送信設定が必要です。';
 if(/duplicate key/i.test(text))return 'このURLは登録済みです。';
 if(/check constraint.*url/i.test(text))return '対応する公開HTTPS URLを入力してください。';
 return text.slice(0,200);
};
async function request(path,{method='GET',body,token,prefer}={}){
 const headers={apikey:PUBLIC_KEY,'Content-Type':'application/json'};
 if(token)headers.Authorization='Bearer '+token;
 if(prefer)headers.Prefer=prefer;
 const response=await fetch(API+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(15000)});
 const text=await response.text();let data;try{data=text?JSON.parse(text):null;}catch{throw new Error('サーバーから正しい応答を取得できませんでした。');}
 if(!response.ok){const error=new Error(data?.msg||data?.message||data?.error_description||data?.error||'HTTP '+response.status);error.status=response.status;throw error;}
 return data;
}
function persist(){try{if(session)sessionStorage.setItem(STORE,JSON.stringify(session));else sessionStorage.removeItem(STORE);}catch{/* Private browsing may disallow storage. */}}
function acceptSession(data){if(!data?.access_token)throw new Error('ログイン情報を取得できませんでした。');session={access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Date.now()+(data.expires_in||3600)*1000,user:data.user};persist();}
function clearSession(message=''){
 generation++;session=null;rows=[];persist();$('dashboard').hidden=true;$('authScreen').hidden=false;
 $('servicesList').replaceChildren();$('eventRows').replaceChildren();$('userEmail').textContent='';
 for(const id of ['count','healthy','down','latency','uptime'])$(id).textContent='—';
 for(const id of ['siteDialog','deleteDialog','passwordDialog'])if($(id).open)$(id).close();
 $('authMessage').textContent=message;
}
async function token(force=false){
 if(!session)throw new Error('ログインしてください。');
 if(!force&&session.expires_at>Date.now()+60000)return session.access_token;
 if(!refreshPromise){const epoch=generation;refreshPromise=(async()=>{try{const data=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}});if(epoch!==generation)throw new Error('セッションが変更されました。');acceptSession(data);return session.access_token;}catch(e){if(epoch===generation&&[400,401,403].includes(e.status))clearSession('ログインの有効期限が切れました。再度ログインしてください。');throw e;}finally{refreshPromise=null;}})();}
 return refreshPromise;
}
async function db(path,options={}){
 const epoch=generation;
 try{return await request('/rest/v1/'+path,{...options,token:await token()});}
 catch(e){if(e.status!==401||epoch!==generation)throw e;return request('/rest/v1/'+path,{...options,token:await token(true)});}
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
 if(!session||loading)return;loading=true;const epoch=generation;$('refresh').disabled=true;
 try{const data=await db('pulse_monitors?select=*&order=created_at.asc');if(epoch!==generation)return;rows=data;render();}
 catch(e){if(epoch===generation&&session){$('liveState').textContent='● 接続失敗';markNotice(errorMessage(e)+' 最後に取得した結果を表示しています。',true);}}
 finally{loading=false;$('refresh').disabled=false;}
}
async function showDashboard(){
 const epoch=generation;const user=await request('/auth/v1/user',{token:await token()});if(epoch!==generation)return;
 session.user=user;persist();$('authScreen').hidden=true;$('dashboard').hidden=false;$('userEmail').textContent=user.email||'マイダッシュボード';$('password').value='';await refresh();
}
function setMode(next){mode=next;$('loginTab').classList.toggle('primary',mode==='login');$('signupTab').classList.toggle('primary',mode==='signup');$('loginTab').setAttribute('aria-pressed',String(mode==='login'));$('signupTab').setAttribute('aria-pressed',String(mode==='signup'));$('authSubmit').textContent=mode==='login'?'ログイン':'アカウントを作成';$('password').autocomplete=mode==='login'?'current-password':'new-password';$('authMessage').textContent='';}
$('loginTab').addEventListener('click',()=>setMode('login'));$('signupTab').addEventListener('click',()=>setMode('signup'));
$('authForm').addEventListener('submit',async e=>{
 e.preventDefault();$('authSubmit').disabled=true;$('authMessage').textContent='確認中…';
 const email=$('email').value.trim(),password=$('password').value;
 try{
 const path=mode==='signup'?'/auth/v1/signup':'/auth/v1/token?grant_type=password';
 const data=await request(path,{method:'POST',body:{email,password}});
 if(!data.access_token){$('authMessage').textContent='確認メールを送信しました。メールのリンクで認証後、この画面に戻ってログインしてください。';$('password').value='';return;}
 generation++;acceptSession(data);await showDashboard();
 }catch(e){$('authMessage').textContent=errorMessage(e);}finally{$('authSubmit').disabled=false;}
});
$('logout').addEventListener('click',async()=>{const oldToken=session?.access_token;clearSession();if(oldToken)try{await request('/auth/v1/logout?scope=local',{method:'POST',token:oldToken});}catch{}});
$('refresh').addEventListener('click',refresh);
for(const id of ['search','filter'])$(id).addEventListener('input',render);
function openEditor(row){$('siteForm').reset();$('siteId').value=row?.id||'';$('siteName').value=row?.name||'';$('siteUrl').value=row?.url||'';$('siteEnabled').checked=row?.enabled??true;$('siteTitle').textContent=row?'監視サイトを編集':'サイトを追加';$('siteMessage').textContent='';$('siteDialog').showModal();}
$('addSite').addEventListener('click',()=>openEditor());$('closeDialog').addEventListener('click',()=>$('siteDialog').close());
function validateUrl(raw){const u=new URL(raw);if(u.protocol!=='https:'||u.port||u.username||u.password||u.search||u.hash||!['github.io','onrender.com','pages.dev','vercel.app','netlify.app'].some(d=>u.hostname.endsWith('.'+d)))throw new Error('対応する公開HTTPS URLを指定してください（認証情報・クエリ・カスタムドメインは未対応）。');return u.href;}
$('siteForm').addEventListener('submit',async e=>{
 e.preventDefault();$('saveSite').disabled=true;$('siteMessage').textContent='保存中…';const epoch=generation;
 try{const id=$('siteId').value;const body={name:$('siteName').value.trim(),url:validateUrl($('siteUrl').value.trim()),enabled:$('siteEnabled').checked};if(!body.name)throw new Error('サイト名を入力してください。');
 const changed=await db('pulse_monitors'+(id?'?id=eq.'+encodeURIComponent(id):''),{method:id?'PATCH':'POST',body,prefer:'return=representation'});if(epoch!==generation)return;if(!changed?.length)throw new Error('保存対象が見つかりません。再読み込みしてください。');$('siteDialog').close();await refresh();
 }catch(e){if(epoch===generation)$('siteMessage').textContent=errorMessage(e);}finally{$('saveSite').disabled=false;}
});
$('servicesList').addEventListener('click',async e=>{
 const button=e.target.closest('button[data-action]');if(!button)return;const row=rows.find(r=>r.id===button.dataset.id);if(!row)return;
 if(button.dataset.action==='edit')return openEditor(row);
 if(button.dataset.action==='delete'){pendingDelete=row.id;$('deleteName').textContent=row.name;$('deleteMessage').textContent='';return $('deleteDialog').showModal();}
 button.disabled=true;try{await db('pulse_monitors?id=eq.'+row.id,{method:'PATCH',body:{enabled:!row.enabled}});await refresh();}catch(e){markNotice(errorMessage(e),true);button.disabled=false;}
});
$('cancelDelete').addEventListener('click',()=>$('deleteDialog').close());
$('confirmDelete').addEventListener('click',async()=>{const epoch=generation;$('confirmDelete').disabled=true;try{await db('pulse_monitors?id=eq.'+pendingDelete,{method:'DELETE'});if(epoch!==generation)return;$('deleteDialog').close();await refresh();}catch(e){$('deleteMessage').textContent=errorMessage(e);}finally{$('confirmDelete').disabled=false;}});
async function emailAction(kind){const input=$('email');if(!input.reportValidity())return;const button=$(kind==='resend'?'resend':'recover');button.disabled=true;try{await request('/auth/v1/'+kind,{method:'POST',body:kind==='resend'?{type:'signup',email:input.value.trim()}:{email:input.value.trim()}});$('authMessage').textContent='該当するアカウントがある場合、メールが送信されます。受信箱をご確認ください。';}catch(e){$('authMessage').textContent=errorMessage(e);}finally{button.disabled=false;}}
$('resend').addEventListener('click',()=>emailAction('resend'));$('recover').addEventListener('click',()=>emailAction('recover'));
$('verifyRecovery').addEventListener('click',async()=>{const button=$('verifyRecovery');button.disabled=true;try{const link=new URL($('recoveryLink').value.trim());if(link.origin!==API||link.pathname!=='/auth/v1/verify'||link.searchParams.get('type')!=='recovery')throw new Error('このサービスのパスワード再設定メール内のリンクを入力してください。');const hash=link.searchParams.get('token');if(!hash)throw new Error('リンクに認証情報がありません。');const data=await request('/auth/v1/verify',{method:'POST',body:{token_hash:hash,type:'recovery'}});generation++;acceptSession(data);$('recoveryLink').value='';$('passwordDialog').showModal();}catch(e){$('authMessage').textContent=errorMessage(e);}finally{button.disabled=false;}});
$('passwordForm').addEventListener('submit',async e=>{e.preventDefault();$('savePassword').disabled=true;try{await request('/auth/v1/user',{method:'PUT',token:await token(),body:{password:$('newPassword').value}});$('passwordDialog').close();$('newPassword').value='';await showDashboard();}catch(e){$('passwordMessage').textContent=errorMessage(e);}finally{$('savePassword').disabled=false;}});
$('cancelPassword').addEventListener('click',()=>clearSession('パスワード再設定をキャンセルしました。'));
document.querySelectorAll('.nav').forEach(link=>link.addEventListener('click',()=>document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n===link))));
function tick(){$('clock').textContent=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date())+' JST';}
setInterval(tick,1000);tick();setInterval(()=>{if(!document.hidden)refresh();},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
(async()=>{try{
 const fragment=new URLSearchParams(location.hash.slice(1));
 if(fragment.has('access_token')){history.replaceState(null,'',location.pathname+location.search);acceptSession({access_token:fragment.get('access_token'),refresh_token:fragment.get('refresh_token'),expires_in:Number(fragment.get('expires_in')||3600)});if(fragment.get('type')==='recovery'){$('passwordDialog').showModal();return;}}
 else{const stored=sessionStorage.getItem(STORE);if(stored)session=JSON.parse(stored);}
 if(session)await showDashboard();
 }catch(e){clearSession('ログインしてください。'+errorMessage(e));}})();
