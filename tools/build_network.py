import csv, json, math, statistics as S, datetime
ROOT = '/home/claude/mashhad-waze'

# ---------- stations (coordinates from legacy n8n node Metro-Data) ----------
L1 = [
 ('METRO-101','وکیل‌آباد',36.3461444,59.4422694),('METRO-102','کوهستان پارک',36.3428861,59.4520889),
 ('METRO-103','نمایشگاه',36.3392306,59.4635889),('METRO-104','اقبال لاهوری',36.3313889,59.4708333),
 ('METRO-105','صیاد شیرازی',36.3324861,59.4851390),('METRO-106','صدف',36.33008,59.4929),
 ('METRO-107','هفت‌تیر',36.32747,59.500774),('METRO-108','دانش‌آموز',36.3263889,59.5069444),
 ('METRO-109','سیدرضی',36.322546,59.517058),('METRO-110','کوثر',36.319843,59.525665),
 ('METRO-111','پارک ملت',36.3172972,59.5338472),('METRO-112','آزادی',36.3125806,59.5443972),
 ('METRO-113','خیام',36.3069720,59.5529083),('METRO-114','فلسطین',36.3001694,59.5633222),
 ('METRO-115','طالقانی',36.2970111,59.5731806),('METRO-116','قائم',36.294446,59.578717),
 ('METRO-117','شریعتی',36.291206,59.585623),('METRO-118','امام خمینی',36.281387,59.595793),
 ('METRO-119','بسیج',36.2735639,59.6034500),('METRO-120','هفده شهریور',36.267600,59.609172),
 ('METRO-121','پروین اعتصامی',36.262610,59.614413),('METRO-122','غدیر',36.25683,59.62020),
 ('METRO-123','بوستان ریحانه',36.243078,59.623190),('METRO-124','فرودگاه شهید هاشمی‌نژاد',36.23500,59.64083)]
L2 = [
 ('METRO-201','طبرسی',36.325040,59.675348),('METRO-202','ولایت',36.316996,59.662369),
 ('METRO-203','فجر',36.312544,59.655095),('METRO-204','نبوت',36.3056889,59.6441222),
 ('METRO-205','مفتح',36.301514,59.637822),('METRO-206','راه‌آهن',36.3033306,59.6223610),
 ('METRO-207','شهدا',36.2978611,59.6059472),('METRO-208','سعدی',36.295520,59.598431),
 ('METRO-117','شریعتی',36.291206,59.585623),
 ('METRO-210','الندشت',36.2877,59.5761),('METRO-211','کوهسنگی',36.283632,59.563622),
 ('METRO-212','شهید کاوه',36.2845184,59.549228),('METRO-213','شهید فکوری',36.283618,59.542730)]
# legacy travel times (seconds) from old Time-Cal (estimates, NOT measured)
LEG1 = {"وکیل‌آباد_کوهستان پارک":180,"کوهستان پارک_نمایشگاه":120,"نمایشگاه_اقبال لاهوری":120,"اقبال لاهوری_صیاد شیرازی":120,
 "صیاد شیرازی_صدف":120,"صدف_هفت‌تیر":120,"هفت‌تیر_دانش‌آموز":120,"دانش‌آموز_سیدرضی":120,"سیدرضی_کوثر":90,"کوثر_پارک ملت":95,
 "پارک ملت_آزادی":120,"آزادی_خیام":107,"خیام_فلسطین":120,"فلسطین_طالقانی":120,"طالقانی_قائم":120,"قائم_شریعتی":120,
 "شریعتی_امام خمینی":180,"امام خمینی_بسیج":180,"بسیج_هفده شهریور":120,"هفده شهریور_پروین اعتصامی":120,"پروین اعتصامی_غدیر":180,
 "غدیر_بوستان ریحانه":180,"بوستان ریحانه_فرودگاه شهید هاشمی‌نژاد":300}
LEG2 = {"طبرسی_ولایت":180,"ولایت_فجر":120,"فجر_نبوت":120,"نبوت_مفتح":120,"مفتح_راه‌آهن":120,"راه‌آهن_شهدا":120,"شهدا_سعدی":100,
 "سعدی_شریعتی":120,"شریعتی_الندشت":120,"الندشت_کوهسنگی":120,"کوهسنگی_شهید کاوه":210,"شهید کاوه_شهید فکوری":180}
LEG_DELAYS = {"شریعتی":25,"فلسطین":20,"پارک ملت":20}

def hav(a,b):
    R=6371.0; la1,lo1,la2,lo2=map(math.radians,(a[0],a[1],b[0],b[1]))
    d=math.sin((la2-la1)/2)**2+math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
    return 2*R*math.asin(math.sqrt(d))

# ---------- corrections for operator mis-taps ----------
CORR = [
 {"file":"2026-10-16_line1_vakilabad-ghadir-vakilabad.csv","t":1792146830667,"field":"station","from":"نمایشگاه","to":"کوهستان پارک",
  "why":"depart pressed after station field was already advanced (confirmed by user)"},
 {"file":"2026-10-16_line2_shariati-fakouri-tabarsi.csv","t":1792151127895,"field":"station","from":"کوهسنگی","to":"شهید کاوه",
  "why":"station not advanced after Kouhsangi (Wikipedia order Kouhsangi->Kaveh->Fakouri)"},
 {"file":"2026-10-16_line2_shariati-fakouri-tabarsi.csv","t":1792151174423,"field":"station","from":"کوهسنگی","to":"شهید کاوه","why":"same as above"}]
EXCLUDE = [{"file":"2026-10-16_line1_vakilabad-ghadir-vakilabad.csv","t":1792149933818,"why":"Imam Khomeini dwell 3 s on return, almost surely a mis-tap (reported to user)"}]

ALL_NAMES=[n for _,n,_,_ in L1+L2]
def key(x): return x.replace('\u200c','').replace(' ','')
ALIAS={key('پایانه وکیل آباد'):key('وکیل‌آباد'),key('فکوری'):key('شهید فکوری')}
KEYMAP={key(n):n for n in ALL_NAMES}
def canon(x):
    k=key(x); k=ALIAS.get(k,k)
    return KEYMAP.get(k,x)
def load(fn):
    rows=list(csv.DictReader(open(f'{ROOT}/data/field/{fn}',encoding='utf-8')))
    for r in rows:
        r['t']=int(r['t'])
        for c in CORR:
            if c['file']==fn and c['t']==r['t']: r['station']=c['to']
        r['station']=canon(r['station'])
    return rows

def visits(rows):
    """group into runs by (dir); within run pair arrive/depart per station"""
    runs=[]; cur=None
    for r in rows:
        if cur is None or cur['dir']!=r['dir']:
            cur={'dir':r['dir'],'visits':[]}; runs.append(cur)
        v=cur['visits']
        if r['ev']=='arrive':
            v.append({'station':r['station'],'arr':r['t']/1000,'dep':None})
        else:
            if v and v[-1]['station']==r['station'] and v[-1]['dep'] is None: v[-1]['dep']=r['t']/1000
            else: v.append({'station':r['station'],'arr':None,'dep':r['t']/1000})
    return runs

def seg_stats(runs):
    segs=[];dw=[]
    for run in runs:
        v=run['visits']
        for a,b in zip(v,v[1:]):
            if a['dep'] and b['arr']:
                segs.append({'dir':run['dir'],'from':a['station'],'to':b['station'],'run_s':round(b['arr']-a['dep'])})
        for x in v:
            if x['arr'] and x['dep']: dw.append({'dir':run['dir'],'station':x['station'],'dwell_s':round(x['dep']-x['arr'],1)})
    return segs,dw

l1=load('2026-10-16_line1_vakilabad-ghadir-vakilabad.csv')
l2=load('2026-10-16_line2_shariati-fakouri-tabarsi.csv')
ex={e['t'] for e in EXCLUDE}
r1=visits(l1); r2=visits(l2)
s1,d1=seg_stats(r1); s2,d2=seg_stats(r2)
s1=[x for x in s1 if not (x['dir']=='وکیل آباد' and 'امام خمینی' in (x['from'],x['to']))]
d1=[d for d in d1 if not (d['station']=='امام خمینی' and d['dir']=='وکیل آباد')]

# terminal turnarounds
g_arr=[r for r in l1 if r['station']=='غدیر' and r['ev']=='arrive']
g_dep=[r for r in l1 if r['station']=='غدیر' and r['ev']=='depart'][0]
ghadir={'arrive_end_of_run':g_arr[0]['t']/1000,'arrive_departure_platform':g_arr[1]['t']/1000,'depart':g_dep['t']/1000}
ghadir_turn=round(ghadir['arrive_departure_platform']-ghadir['arrive_end_of_run'])
ghadir_wait=round(ghadir['depart']-ghadir['arrive_departure_platform'])
ghadir_total=ghadir_turn+ghadir_wait
f_arr=[r for r in l2 if r['station']=='شهید فکوری' and r['ev']=='arrive']
f_dep=[r for r in l2 if r['station']=='شهید فکوری' and r['ev']=='depart']
fak_turn=round(f_arr[1]['t']/1000-f_arr[0]['t']/1000); fak_wait=round(f_dep[1]['t']/1000-f_arr[1]['t']/1000)
fak_total=round(f_dep[1]['t']/1000-f_arr[0]['t']/1000)

# Line 1 outbound trip
out=[s for s in s1 if s['dir']=='غدیر']; back=[s for s in s1 if s['dir']=='وکیل آباد']
run_out=sum(s['run_s'] for s in out)
trip_out=round(g_arr[0]['t']/1000 - [r for r in l1 if r['ev']=='depart'][0]['t']/1000)
mid=[s['run_s'] for s in out[1:-1]]

# ---------- fleet / cycle derivation ----------
VAK_LAYOVER=431   # s: derived 13:52:40 arrival -> 13:59:51 depart (user said ~13:53)
D=trip_out        # Vakilabad depart -> Ghadir arrive (incl. all intermediate dwell)
cycle_A=2*D+ghadir_total+VAK_LAYOVER
sets_A_fri=cycle_A/(24*60)
GH_PASS=25
cycle_B=120*60
T_plus_L=21*60   # Friday sheet: Ghadir 14:05 -> airport departure 14:26
rest=cycle_B-(2*D+VAK_LAYOVER+2*GH_PASS)
T=(rest-T_plus_L)  # 2T+L = rest ; T+L = 1260 => T = rest-1260
L_air=T_plus_L-T
alt={}
for sets in (4,5,6):
    rest_s=sets*24*60-(2*D+VAK_LAYOVER+2*GH_PASS); T_s=rest_s-T_plus_L
    alt[sets]={'T_s':round(T_s),'L_air_s':round(T_plus_L-T_s)}
def sets_for(headway_min,cycle_s): return cycle_s/(headway_min*60)

# ---------- legacy vs measured ----------
leg1_sum=sum(v for k,v in LEG1.items() if 'غدیر_بوستان' not in k and 'بوستان ریحانه_' not in k)+sum(LEG_DELAYS.values())
dist={}
st1={n:(la,lo) for _,n,la,lo in L1}; st2={n:(la,lo) for _,n,la,lo in L2}
seg_dist=[]
for a,b in zip(L1,L1[1:]):
    km=hav((a[2],a[3]),(b[2],b[3])); seg_dist.append((a[1],b[1],round(km,2)))
meas={ (s['from'],s['to']):s['run_s'] for s in out}
speeds=[]
for a,b,km in seg_dist:
    if (a,b) in meas: speeds.append((a,b,km,meas[(a,b)],round(km/meas[(a,b)]*3600,1)))

# ---------- build network.json ----------
def dwell_med(name,lst):
    v=[d['dwell_s'] for d in lst if d['station']==name]
    return (round(S.median(v),1),v) if v else (None,[])

def seg_entry(a,b,legacy,meas_list_fw,meas_list_bw,line):
    fw=[s['run_s'] for s in meas_list_fw if s['from']==a and s['to']==b]
    bw=[s['run_s'] for s in meas_list_bw if s['from']==b and s['to']==a]
    return {'from':a,'to':b,
            'run_s_forward':fw[0] if fw else None,'run_s_backward':bw[0] if bw else None,
            'legacy_estimate_s':legacy,
            'dist_km_straight':round(hav(st1.get(a) or st2.get(a),st1.get(b) or st2.get(b)),2),
            'quality':'measured_2026-10-16' if (fw or bw) else 'legacy_estimate'}

line1_segs=[]
for a,b in zip(L1,L1[1:]):
    key=f'{a[1]}_{b[1]}'
    line1_segs.append(seg_entry(a[1],b[1],LEG1.get(key),out,back,1))
# forward = toward Ghadir (listed order Vakilabad->Airport); backward = toward Vakilabad
line1_segs=[seg_entry(a[1],b[1],LEG1.get(f'{a[1]}_{b[1]}'),out,back,1) for a,b in zip(L1,L1[1:])]
line2_segs=[]
for a,b in zip(L2,L2[1:]):
    key=f'{a[1]}_{b[1]}'
    line2_segs.append(seg_entry(a[1],b[1],LEG2.get(key),
        [s for s in s2 if s['dir']=='فکوری'],[s for s in s2 if s['dir']=='طبرسی'],2))
# line 2: forward in our list order is Tabarsi->Fakouri; measured toward Fakouri is forward.

dwell1={}
for _,n,_,_ in L1:
    m,v=dwell_med(n,d1)
    if m is not None: dwell1[n]={'median_s':m,'obs_s':v}
dwell2={}
for _,n,_,_ in L2:
    m,v=dwell_med(n,d2)
    if m is not None: dwell2[n]={'median_s':m,'obs_s':v}

net={
 'meta':{'name':'Mashhad-Waze network','generated':datetime.datetime.utcnow().isoformat()+'Z','tz':'Asia/Tehran (UTC+03:30)',
   'units':{'run_s':'seconds depart-previous-station -> arrive','dwell':'seconds arrive -> depart','dist':'km straight line'},
   'quality_levels':['measured_2026-10-16','legacy_estimate','derived','hypothesis'],
   'note':'Operator reaction error about +-5 s per timestamp (~+-7 s on dwell).'},
 'stations':[{'id':i,'name':n,'lat':la,'lon':lo,'lines':([1] if i.startswith('METRO-1') else [2])+([2] if n=='شریعتی' else [])} for i,n,la,lo in L1]
            +[{'id':i,'name':n,'lat':la,'lon':lo,'lines':[2]} for i,n,la,lo in L2 if n!='شریعتی'],
 'lines':{
  '1':{'color':'#006400','order_vakilabad_to_airport':[n for _,n,_,_ in L1],'segments':line1_segs,'dwell':dwell1,
       'terminals':{
         'وکیل‌آباد':{'layover_s_derived':VAK_LAYOVER,'exit_first_segment_s':out[0]['run_s'],'note':'arrival time derived, not observed'},
         'غدیر':{'turnaround_move_s':ghadir_turn,'platform_wait_s':ghadir_wait,'total_layover_s':ghadir_total,
                 'entry_last_segment_s':out[-1]['run_s'],'exit_first_segment_s':[s for s in back if s['from']=='غدیر'][0]['run_s'] if [s for s in back if s['from']=='غدیر'] else None,
                 'note':'trains do not cross over by switch; they loop on track, hence slow terminal segments (user)'},
         'فرودگاه شهید هاشمی‌نژاد':{'layover_s_derived_friday':round(L_air),'note':'hypothesis-based, see derived.extension'}},
       'measured_trip_vakilabad_to_ghadir_s':trip_out,
       'services':{
         'A_shuttle':{'route':'وکیل‌آباد↔غدیر','status':'observed'},
         'B_airport_through':{'route':'وکیل‌آباد↔فرودگاه (از غدیر و بوستان ریحانه)','status':'hypothesis_supported_by_data',
            'evidence':['Vakilabad board 13:57: 14:00 Ghadir,14:12 airport,14:24 Ghadir,14:36 airport',
                        'Vakilabad 14:12/14:36 + 40:43 = 14:52:43/15:16:43 matches sheet Ghadir 14:53/15:17',
                        'Official headways: main route = combined A+B (Fri 12 = 1/24+1/24; weekday 10 = 1/15+1/30)']}}},
  '2':{'color':'#0000CD','order_tabarsi_to_fakouri':[n for _,n,_,_ in L2],'segments':line2_segs,'dwell':dwell2,
       'terminals':{'شهید فکوری':{'turnaround_move_s':fak_turn,'platform_wait_s':fak_wait,'total_layover_s':fak_total,
                                 'note':'Fakouri now has two platforms (user); old single-platform assumptions obsolete'},
                    'طبرسی':{'status':'unmeasured'}},
       'data_note':'Segments Tabarsi..Shariati are legacy estimates (user says unchanged); Shariati..Fakouri measured and differ from legacy by -24..-68 s'},
  '3':{'color':'#FF8C00','status':'schedule_only','stations_known':False,
       'routes':['پایانه مسافری↔باب الجواد (یکی در میان از پایانه مسافری و بسیج)','شهدا↔باب الجواد'],
       'note':'only terminals and headways known from official site; Basij is a Line 1 interchange'}},
 'derived':{
  'fleet_estimates':{
    'friday':{'A_shuttle':{'headway_min':24,'cycle_min':round(cycle_A/60,2),'trainsets':round(sets_A_fri,2)},
              'B_airport':{'headway_min':24,'cycle_min':120,'trainsets':5},'line1_total':9,
              'method':'cycle=2*trip+terminal layovers; B solved so that T+L_airport=21 min (sheet 14:05->14:26)'},
    'weekday_offpeak':{'A_headway_min':15,'B_headway_min':30,'trainsets_approx':{'A':round(sets_for(15,cycle_A),1),'B':4},'line1_total_approx':11,
                       'note':'A headway inferred from 1/10=1/A+1/30; confirm with weekday field run'},
    'weekday_peak_1530_1920':{'combined_headway_min':8,'A_headway_min_approx':round(1/(1/8-1/30),1),'trainsets_approx':{'A':round(sets_for(1/(1/8-1/30),cycle_A),1),'B':4},'line1_total_approx':13},
    'confidence':'medium on Friday; low on weekdays'},
  'extension_ghadir_airport':{'one_way_T_s':round(T),'one_way_T_min':round(T/60,1),'airport_layover_s':round(L_air),
     'sensitivity_by_trainset_count':alt,
     'split_estimate':{'ghadir_to_bustan_s':round((T-25)*180/480),'bustan_to_airport_s':round((T-25)*300/480),'dwell_bustan_assumed_s':25,
                       'note':'split uses legacy ratio 180:300'},
     'assumptions':['5 trainsets on airport service on Friday (4 and 6 give impossible T)','Vakilabad layover 431 s','Ghadir pass-through dwell 25 s each way','symmetric trip times both directions'],
     'confidence':'medium-low','legacy_estimate_s':480},
  'legacy_vs_measured':{'line1_legacy_total_vakilabad_to_ghadir_s_including_delays':leg1_sum,'measured_trip_s':trip_out,
                        'measured_run_only_s':run_out,'median_mid_segment_run_s':S.median(mid)}},
 'open_questions':[
  'Official sheet "normal days" airport column is irregular/24-min after 11:57, while official JSON says weekdays 30 min. Which is in force?',
  'Is Line 1 service B (airport through-service) really calling at every station? (assumed yes)',
  'Weekday and Thursday run/dwell times (all measurements are Friday afternoon)',
  'Tabarsi..Shariati Line 2 times (legacy only), Line 3 station list/times',
  'Return-direction times between Shariati and Kohestan Park (not yet measured)']
}
json.dump(net,open(f'{ROOT}/data/network.json','w',encoding='utf-8'),ensure_ascii=False,indent=1)
json.dump({'corrections':CORR,'excluded_rows':EXCLUDE},open(f'{ROOT}/data/field/corrections.json','w',encoding='utf-8'),ensure_ascii=False,indent=1)

# ---------- printed summary ----------
print('trip_out',trip_out,'run_out',run_out,'mid median',S.median(mid),'min/max',min(mid),max(mid))
print('ghadir turn/wait/total',ghadir_turn,ghadir_wait,ghadir_total,'fak',fak_turn,fak_wait,fak_total)
print('cycle_A min',round(cycle_A/60,2),'sets',round(sets_A_fri,2))
print('T',round(T),'s',round(T/60,2),'min; L_air',round(L_air),'s',round(L_air/60,2),'min'); print(alt)
print('legacy L1 sum',leg1_sum,'vs trip',trip_out)
print('line2 segs',[ (s['from'],s['to'],s['run_s']) for s in s2])
print('line1 back segs',[(s['from'],s['to'],s['run_s']) for s in back])
print('speeds km/h outliers:')
for x in speeds:
    if x[4]<25 or x[4]>55: print(' ',x)
print('avg speed',round(S.mean(x[4] for x in speeds),1))
print('weekday A sets',round(sets_for(15,cycle_A),1),'peak A hw',round(1/(1/8-1/30),1),'sets',round(sets_for(1/(1/8-1/30),cycle_A),1))
