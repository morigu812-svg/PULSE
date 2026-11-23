// PULSE-specific authentication. No Supabase Auth account is created or modified.
const base=Deno.env.get('SUPABASE_URL')!;
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const origins=new Set(['https://pulse-9y2u.onrender.com','https://morigu812-svg.github.io']);
const actions=new Set(['health','signup','login','recover','me','logout','list_monitors','save_monitor','delete_monitor','renew_recovery']);
function headers(origin:string|null){
 const h=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Vary':'Origin'});
 if(origin&&origins.has(origin))h.set('Access-Control-Allow-Origin',origin);
 h.set('Access-Control-Allow-Headers','content-type, apikey, x-pulse-session');
 h.set('Access-Control-Allow-Methods','POST, OPTIONS');
 return h;
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin');const h=headers(origin);
 const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:h});
 if(origin&&!origins.has(origin))return reply({error:'この接続元は許可されていません。',code:'origin_denied'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:h});
 if(req.method!=='POST')return reply({error:'POSTが必要です。',code:'method_not_allowed'},405);
 try{
  if(Number(req.headers.get('content-length')||0)>8192)return reply({error:'送信内容が大きすぎます。',code:'too_large'},413);
  const reader=req.body?.getReader();if(!reader)return reply({error:'入力内容がありません。',code:'invalid_input'},400);
  let bytes=0;const chunks:Uint8Array[]=[];
  while(true){const{done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>8192){await reader.cancel();return reply({error:'送信内容が大きすぎます。',code:'too_large'},413);}chunks.push(value);}
  const buffer=new Uint8Array(bytes);let offset=0;for(const part of chunks){buffer.set(part,offset);offset+=part.length;}
  let body;try{body=JSON.parse(new TextDecoder().decode(buffer));}catch{return reply({error:'JSONが不正です。',code:'invalid_input'},400);}
  if(!body||!actions.has(body.action)||!body.input||Array.isArray(body.input)||typeof body.input!=='object')return reply({error:'操作内容が不正です。',code:'invalid_action'},400);
  // Only a PULSE opaque token is accepted. Supabase/My-Links JWTs cannot authenticate here.
  const token=req.headers.get('x-pulse-session');
  if(token&&!/^[a-f0-9]{64}$/.test(token))return reply({error:'PULSEへログインしてください。',code:'session_expired'},401);
  const ip=(req.headers.get('x-forwarded-for')||req.headers.get('x-real-ip')||'unknown').split(',').at(-1)!.trim().slice(0,200);
  const response=await fetch(base+'/rest/v1/rpc/pulse_isolated_api',{
   method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
   body:JSON.stringify({p_action:body.action,p_input:body.input,p_token:token,p_ip:ip}),signal:AbortSignal.timeout(20000)
  });
  if(!response.ok){console.error('PULSE isolated API database status',response.status);return reply({error:'処理を完了できませんでした。しばらく待って再試行してください。',code:'server_error'},503);}
  const result=await response.json();const status=Number(result.status)||200;delete result.status;
  return reply(result,status);
 }catch(e){const timeout=e instanceof DOMException&&['TimeoutError','AbortError'].includes(e.name);return reply({error:timeout?'処理が時間内に完了しませんでした。':'通信処理を完了できませんでした。',code:timeout?'timeout':'server_error'},503);}
});
