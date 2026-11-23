"""Check configured public HTTPS endpoints and retain the last 288 readings."""
import concurrent.futures, datetime, hashlib, ipaddress, json, os, socket, time
import urllib.request, urllib.error
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None

def validate(raw, resolve=True):
    from urllib.parse import urlsplit
    u = urlsplit(raw)
    if u.scheme != 'https' or not u.hostname or u.username or u.password or u.port not in (None,443) or u.query or u.fragment:
        raise ValueError('公開HTTPS URL（認証情報・クエリなし）を指定してください')
    if not resolve: return raw
    addresses = socket.getaddrinfo(u.hostname,443,type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError('非公開アドレスは監視できません')
    return raw

def check(site):
    start=time.monotonic();at=datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        validate(site['url'])
        req=urllib.request.Request(site['url'],headers={'User-Agent':'PULSE-UptimeMonitor/1.0'})
        with urllib.request.build_opener(NoRedirect).open(req,timeout=12) as response:
            status=response.status
        return dict(at=at,ok=200<=status<400,status=status,ms=round((time.monotonic()-start)*1000),error=None)
    except urllib.error.HTTPError as e:
        return dict(at=at,ok=200<=e.code<400,status=e.code,ms=round((time.monotonic()-start)*1000),error=None if e.code<400 else 'HTTP '+str(e.code))
    except Exception as e:
        return dict(at=at,ok=False,status=None,ms=None,error='Timeout' if isinstance(e,TimeoutError) else 'Connection failed')

def main():
    sites=json.loads((ROOT/'monitors.json').read_text())
    if not isinstance(sites,list) or len(sites)>10: raise ValueError('最大10サイトです')
    seen=set()
    for site in sites:
        if not isinstance(site.get('name'),str) or not site['name'].strip(): raise ValueError('サイト名が必要です')
        if site['url'] in seen: raise ValueError('URLが重複しています')
        seen.add(site['url'])
        # Reject invalid/private destinations before starting requests.
        validate(site['url'], resolve=False)
    path=ROOT/'data/status.json'
    previous=json.loads(path.read_text()) if path.exists() else {}
    old={m['url']:m for m in previous.get('monitors',[])}
    monitors=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        for site,point in zip(sites,pool.map(check,sites)):
            points=(old.get(site['url'],{}).get('points',[])+[point])[-288:]
            monitors.append(dict(id=hashlib.sha256(site['url'].encode()).hexdigest()[:12],name=site['name'].strip()[:60],url=site['url'],points=points,last=point,uptime=round(sum(p['ok'] for p in points)/len(points)*100,1)))
    result=dict(configured=bool(sites),updatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),intervalMinutes=5,monitors=monitors)
    path.parent.mkdir(exist_ok=True)
    temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');os.replace(temporary,path)
if __name__=='__main__':main()
