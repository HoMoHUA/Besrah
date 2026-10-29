from pathlib import Path
from html.parser import HTMLParser
import json,re,csv,gzip,xml.etree.ElementTree as E,hashlib,requests,datetime
D=Path(__file__).parent
sources=json.loads((D/'retrieval-status.json').read_text()); byid={s['id']:s for s in sources}
class Tables(HTMLParser):
 def __init__(self): super().__init__();self.tables=[];self.depth=0;self.cell=None;self.row=[]
 def handle_starttag(self,t,a):
  if t=='table':
   self.depth+=1
   if self.depth==1:self.tables.append([])
  elif self.depth and t=='tr':self.row=[]
  elif self.depth and t in ('td','th'):self.cell=[]
  elif self.cell is not None and t=='br':self.cell.append('\n')
 def handle_data(self,d):
  if self.cell is not None:self.cell.append(d)
 def handle_endtag(self,t):
  if t in ('td','th') and self.cell is not None:self.row.append(''.join(self.cell));self.cell=None
  elif t=='tr' and self.depth and self.row:self.tables[-1].append(self.row)
  elif t=='table':self.depth-=1
rows=[]
for name in ['mrchetor','blogfa_historical']:
 p=Tables();p.feed((D/(name+'.html')).read_text())
 (D/(name+'-tables-raw.json')).write_text(json.dumps(p.tables,ensure_ascii=False,indent=2))
 for ti,table in enumerate(p.tables):
  for ri,c in enumerate(table):
   clean=[v.strip().replace('\xa0',' ').strip() for v in c]
   if name=='mrchetor' and len(clean)==4 and re.fullmatch(r'[0-9۰-۹٠-٩./]+',clean[0]):
    rows.append(dict(source_id=name,source_url=byid[name]['url'],table_index=ti,row_index=ri,route_ref_raw=c[0],route_ref=clean[0],origin=clean[1],corridor_raw=clean[2],destination=clean[3],cells_raw=c,classification='third_party_undated_not_current_verified'))
   elif name=='blogfa_historical' and len(clean)==5 and re.fullmatch(r'[0-9۰-۹٠-٩./]+',clean[1]):
    rows.append(dict(source_id=name,source_url=byid[name]['url'],table_index=ti,row_index=ri,route_ref_raw=c[1],route_ref=clean[1],origin=clean[3],corridor_raw='',destination=clean[4],route_type_raw=clean[2],cells_raw=c,classification='third_party_historical_not_current_verified'))
(D/'supplementary-route-tables.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
fields=['source_id','source_url','table_index','row_index','route_ref_raw','route_ref','origin','corridor_raw','destination','classification']
with (D/'supplementary-route-tables.csv').open('w') as f:
 w=csv.DictWriter(f,fields,extrasaction='ignore');w.writeheader();w.writerows(rows)
# Reference tokens only from PDF rightmost route-number column. No automatic route-cell assignment.
ns={'h':'http://www.w3.org/1999/xhtml'};root=E.parse(D/'guide_historical.bbox.html').getroot(); refs=[]
for pi,page in enumerate(root.findall('.//h:page',ns),1):
 for l in page.findall('.//h:line',ns):
  text=' '.join(w.text or '' for w in l)
  if float(l.attrib['xMin'])>380 and re.fullmatch(r'[0-9۰-۹٠-٩./]+',text):
   refs.append(dict(route_ref_raw=text,page=pi,bbox=l.attrib,source_id='guide_historical',source_url=byid['guide_historical']['url'],classification='historical_1398_pdf_third_party_mirror_not_current_verified'))
(D/'historical-pdf-route-refs.json').write_text(json.dumps(refs,ensure_ascii=False,indent=2))
# Compare ref strings with ASCII digits ONLY, preserving slash/dot distinctions.
trans=str.maketrans('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩','01234567890123456789')
raw=json.load(gzip.open('/root/projects/besrah/data/bus/raw/overpass-mashhad-expanded.json.gz','rt'))
osm={e.get('tags',{}).get('ref','').translate(trans) for e in raw['elements'] if e.get('type')=='relation' and e.get('tags',{}).get('route')=='bus'}
compare={}
for name in ['mrchetor','blogfa_historical','guide_historical']:
 rr={r['route_ref'].translate(trans) for r in rows if r['source_id']==name} if name!='guide_historical' else {r['route_ref_raw'].translate(trans) for r in refs}
 compare[name]={'distinct_refs':len(rr),'raw_refs_not_exactly_in_osm':sorted(rr-osm),'warning':'Research candidates only, NOT proof of missing current routes; no slash/dot equivalence assumed.'}
(D/'osm-reference-comparison.json').write_text(json.dumps(compare,ensure_ascii=False,indent=2))
print(json.dumps({'table_rows':{n:sum(r['source_id']==n for r in rows) for n in ['mrchetor','blogfa_historical']},'pdf_refs':len(refs),'comparison':compare},ensure_ascii=False,indent=2))
