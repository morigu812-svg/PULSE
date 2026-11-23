const domains=['github.io','onrender.com','pages.dev','vercel.app','netlify.app'];
async function check(url:string){
 const at=new Date().toISOString(),start=performance.now();
 try{
  const target=new URL(url);
  if(target.protocol!=='https:'||target.port||target.username||target.password||target.search||target.hash||!domains.some(d=>target.hostname.endsWith('.'+d)))throw new Error('Unsupported target');
  const response=await fetch(target,{method:'GET',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(8000),headers:{'User-Agent':'PULSE-UptimeMonitor/2.0'}});
  const point={at,ok:response.status>=200&&response.status<400,status:response.status,ms:Math.round(performance.now()-start),error:response.status>=400?'HTTP '+response.status:null};
  await response.body?.cancel();return point;
 }catch(e){return {at,ok:false,status:null,ms:null,error:e instanceof DOMException&&['TimeoutError','AbortError'].includes(e.name)?'Timeout (8s)':'Connection failed'};}
}
export async function checkSites(sites:{id:string,url:string}[]){
 const results=[];
 for(let i=0;i<sites.length;i+=5){results.push(...await Promise.all(sites.slice(i,i+5).map(async s=>({id:s.id,url:s.url,point:await check(s.url)}))));}
 return results;
}
