// Scheduled endpoint. No visitor credentials or monitor URLs are logged.
const base = Deno.env.get('SUPABASE_URL')!;
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const suffixes = ['github.io','onrender.com','pages.dev','vercel.app','netlify.app'];
async function rpc(name: string, body: unknown) {
 const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
  method:'POST', headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
  body:JSON.stringify(body),signal:AbortSignal.timeout(15000)
 });
 if(!response.ok) { console.error("PULSE DB",name,response.status,(await response.text()).slice(0,500)); throw new Error(`Database request failed (${response.status})`); }
 const text=await response.text(); return text ? JSON.parse(text):null;
}
export function validTarget(raw: string) {
 const u=new URL(raw);
 if(u.protocol!=='https:'||u.port||u.username||u.password||u.search||u.hash||raw.length>2048||!suffixes.some(s=>u.hostname.endsWith('.'+s))) throw new Error('Unsupported URL');
 return u;
}
async function check(url: string) {
 const at=new Date().toISOString(), started=performance.now();
 try {
  const u=validTarget(url);
  // Platform-owned DNS suffixes only; no user-supplied custom DNS/IP targets.
  const response=await fetch(u,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(8000),headers:{'User-Agent':'PULSE-UptimeMonitor/2.0'}});
  const ms=Math.round(performance.now()-started);await response.body?.cancel();
  return {at,ok:response.status>=200&&response.status<400,status:response.status,ms,error:response.status>=400?'HTTP '+response.status:null};
 } catch(e) {return {at,ok:false,status:null,ms:null,error:e instanceof DOMException&&['TimeoutError','AbortError'].includes(e.name)?'Timeout (8s)':'Connection failed'};}
}
Deno.serve(async(req: Request)=>{
 if(req.method!=='POST') return new Response('Method not allowed',{status:405});
 const token=req.headers.get('x-pulse-cron');
 if(!token||!/^[a-f0-9]{64}$/.test(token)) return new Response('Unauthorized',{status:401});
 let sites;
 try { sites=await rpc('pulse_worker_batch',{p_token:token}); }
 catch {return new Response('Unauthorized or unavailable',{status:403});}
 let failed=0,completed=0;
 // Bound both concurrency and total time; remaining sites rotate on the next run.
 for(let offset=0;offset<sites.length;offset+=5) {
  await Promise.all(sites.slice(offset,offset+5).map(async(site:{id:string,url:string})=>{
   const point=await check(site.url);
   try {await rpc('pulse_record_check',{p_id:site.id,p_url:site.url,p_point:point});completed++;} catch {failed++;}
  }));
 }
 return Response.json({checked:completed,failed},{status:failed?500:200,headers:{'Cache-Control':'no-store'}});
});
