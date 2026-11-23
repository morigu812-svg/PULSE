'use strict';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatTime = value => value ? new Intl.DateTimeFormat('ja-JP', {timeZone:'Asia/Tokyo', month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(value)) : '—';
function tick() { $('clock').innerHTML = escapeHtml(new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date())) + ' <small>JST</small>'; }
setInterval(tick,1000);tick();

let latestPayload;
function render(payload) {
 latestPayload=payload;
 const items = payload.monitors || [];
 const measured = items.filter(i=>i.last);
 const healthy = measured.filter(i=>i.last.ok);
 const down = measured.filter(i=>!i.last.ok);
 const vals = measured.filter(i=>i.last.ok && Number.isFinite(i.last.ms)).map(i=>i.last.ms);
 $('count').textContent=String(items.length);
 $('healthy').textContent=String(healthy.length);
 $('down').textContent=String(down.length);
 $('latency').textContent=vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length)+' ms' : '—';
 $('updated').textContent=payload.updatedAt?'LAST CHECK '+formatTime(payload.updatedAt):'NO CHECKS YET';
 $('liveState').textContent=payload.configured?'● LIVE DATA':'● NOT CONFIGURED';
 if(!payload.configured){ $('notice').className='notice demo';$('notice').textContent='初期設定が必要です。monitors.json に監視対象を登録してください。架空の稼働情報は表示していません。'; }
 else if(!payload.updatedAt){ $('notice').className='notice';$('notice').textContent='サイトの登録が完了しました。最初の自動チェックを待っています。実行には遅延する場合があります。'; }
 else { $('notice').className='notice';$('notice').textContent='実際の監視データを表示中。自動チェックは約5分間隔です。最終チェック：'+formatTime(payload.updatedAt); }
 if(payload.updatedAt && Date.now()-Date.parse(payload.updatedAt)>20*60000){$('liveState').textContent='● STALE DATA';$('notice').className='notice demo';$('notice').textContent='20分以上更新されていません。最終チェック：'+formatTime(payload.updatedAt)+'。表示中の結果は過去の記録です。';}
 $('servicesList').innerHTML=items.length ? items.filter(item => { const term=$('search').value.trim().toLowerCase();const kind=item.last?(item.last.ok?'ok':'down'):'unknown';return (item.name+' '+item.url).toLowerCase().includes(term)&&($('filter').value==='all'||$('filter').value===kind); }).map(item => {
 const p=item.last;const kind=p?(p.ok?'ok':'down'):'unknown';const state=p?(p.ok?'ONLINE':'DOWN'):'PENDING';
 return `<article class="service"><div class="service-icon">⌁</div><div class="service-main"><strong>${escapeHtml(item.name)}</strong><small title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</small></div><div class="service-right"><div class="indicator ${kind}">● ${state}</div><small>${p&&p.ms!==null?escapeHtml(p.ms)+' ms':'NO DATA'} · ${item.uptime===null?'—':escapeHtml(item.uptime)+'%'}</small></div></article>`;
 }).join('') || '<div class="empty">条件に一致するサイトはありません</div>':'<div class="empty">◈<br>監視対象が登録されていません。<br>まずは自分のWebサイトを追加してください。</div>';
 const points=items.flatMap(i=>i.points||[]);
 const pct=points.length ? Math.round(points.filter(p=>p.ok).length/points.length*1000)/10:null;
 $('uptime').textContent=pct===null?'—':pct+'%';
 $('ring').style.setProperty('--percent',(pct??0)+'%');
 const events=items.flatMap(i=>(i.points||[]).map(p=>({...p,name:i.name}))).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,20);
 $('eventRows').innerHTML=events.length?events.map(p=>`<tr><td>${escapeHtml(formatTime(p.at))}</td><td>${escapeHtml(p.name)}</td><td><span class="indicator ${p.ok?'ok':'down'}">● ${p.ok?'OK':'FAILED'}</span></td><td>${p.ms===null?'—':escapeHtml(p.ms)+' ms'}</td><td>${p.status===null?'—':escapeHtml(p.status)}</td></tr>`).join(''):'<tr><td colspan="5" style="text-align:center;padding:30px">まだ監視履歴がありません</td></tr>';
}
async function refresh() {
 const button=$('refresh');button.disabled=true;
 try {const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),10000);let response;
 try {response=await fetch('./data/status.json',{cache:'no-store',signal:controller.signal});} finally {clearTimeout(timeout);}
 if(!response.ok)throw new Error('API '+response.status);const data=await response.json();render(data);
 } catch(err){ $('liveState').textContent='● DISCONNECTED';$('notice').className='notice error';
 $('notice').textContent='監視APIへ接続できません。GitHub Actionsの実行状況を確認してください。（'+String(err.message).slice(0,80)+'）';
 $('servicesList').innerHTML='<div class="empty">監視データを読み込めません</div>';
 } finally {button.disabled=false;}
}
$('refresh').addEventListener('click',refresh);refresh();setInterval(refresh,60000);

for(const id of ['search','filter']) $(id).addEventListener('input',()=>{if(latestPayload)render(latestPayload)});
document.querySelectorAll('.nav').forEach(link=>link.addEventListener('click',()=>{document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n===link))}));
