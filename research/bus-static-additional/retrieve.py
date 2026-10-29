import requests, json, pathlib, datetime, concurrent.futures, re
D=pathlib.Path(__file__).parent
urls={
'hamyartrip':'https://hamyartrip.ir/mashhad-bus-route-guide/',
'mrchetor':'https://mrchetor.ir/mshhad-bus-routs/',
'hihotel':'https://hihotel.ir/blog/mashhad-bus-lines',
'blogfa_historical':'https://darman1.blogfa.com/post/46',
'bus_official':'https://bus.mashhad.ir/',
'map_official':'https://map.mashhad.ir/',
'guide_historical':'https://www.mashhad-tourist.ir/wp-content/uploads/2019/11/راهنمای-خطوط-اتوبوسرانی-مشهد-98.pdf'
}
def get(k,u,proxy=False):
 t=datetime.datetime.now(datetime.timezone.utc).isoformat(); name=k+('_proxy' if proxy else '')
 try:
  s=requests.Session(); s.trust_env=False
  r=s.get(u,timeout=(8,22),proxies={'http':'http://127.0.0.1:10809','https':'http://127.0.0.1:10809'} if proxy else {},headers={'User-Agent':'Mozilla/5.0'})
  b=r.content
  if len(b)<12000000: (D/(name+('.pdf' if b.startswith(b'%PDF') else '.html'))).write_bytes(b)
  return dict(id=name,url=u,retrieved_at=t,status=r.status_code,final_url=r.url,bytes=len(b),headers=dict(r.headers))
 except Exception as e: return dict(id=name,url=u,retrieved_at=t,error=str(e))
with concurrent.futures.ThreadPoolExecutor(max_workers=7) as p:
 out=list(p.map(lambda kv:get(*kv),urls.items()))
 out.extend(p.map(lambda k:get(k,urls[k],True),['guide_historical','bus_official']))
(D/'retrieval-status.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
print(json.dumps(out,ensure_ascii=False,indent=2))
