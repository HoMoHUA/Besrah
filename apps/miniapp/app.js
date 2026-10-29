import { normalize, nearestStation, groupPasses, requestPosition } from './logic.js';
const $ = id => document.getElementById(id);
const number = value => new Intl.NumberFormat('fa-IR').format(value);
let metadata, selected, controller, sequence = 0;
const tg = window.Telegram?.WebApp;
try { tg?.ready(); tg?.expand(); tg?.setHeaderColor?.('#092D2E'); tg?.setBackgroundColor?.('#F3F5EF'); } catch { /* Older Telegram clients can use the normal web shell. */ }
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
async function request(path, signal) {
  const response = await fetch(path, {signal, cache:'no-store', credentials:'omit'});
  if (!response.ok) throw new Error('request_failed');
  return response.json();
}
function options(query = '') {
  const matches = metadata.stations.filter(s => normalize(s.name).includes(normalize(query)));
  $('station').replaceChildren();
  const prompt = node('option', matches.length ? 'یک ایستگاه انتخاب کنید' : 'ایستگاهی پیدا نشد');
  prompt.value = ''; $('station').append(prompt);
  for (const station of matches) {
    const option = node('option', station.name + (station.lines.includes(1) ? '' : ' · خط ۲، بدون زمان رسیدن'));
    option.value = station.id; $('station').append(option);
  }
  if (selected && matches.some(s=>s.id===selected.id)) $('station').value = selected.id;
  $('match-count').textContent = number(matches.length) + ' ایستگاه';
}
function schematic() {
  $('route').replaceChildren();
  for (const name of metadata.line1Order) {
    const li=node('li'); const button=node('button',name);
    if (selected?.name === name) { button.setAttribute('aria-current','true'); li.className='current'; }
    button.addEventListener('click',()=> {
      $('search').value=''; options(); choose(metadata.stations.find(s=>s.name===name));
    });
    li.append(button); $('route').append(li);
  }
}
function choose(station) {
  if (!station) return;
  selected=station; $('station').value=station.id; schematic(); load();
}
async function load() {
  controller?.abort(); const current=++sequence;
  $('arrivals').replaceChildren(); $('notes').replaceChildren(); $('as-of').textContent='';
  $('selected-name').textContent=selected.name;
  document.querySelector('.line-badge').textContent=selected.lines.includes(1)?'۱':'۲';
  $('refresh').disabled=false;
  if (!selected.lines.includes(1)) {
    $('status').textContent='این ایستگاه روی خط ۲ است. زمان رسیدن خط ۲ هنوز در دسترس نیست.';
    $('arrivals').setAttribute('aria-busy','false'); return;
  }
  $('status').textContent='در حال دریافت زمان های تازه…'; $('arrivals').setAttribute('aria-busy','true');
  controller=new AbortController(); const active=controller;
  const timeout=setTimeout(()=>active.abort(),15000);
  try {
    const data=await request('api/next?station='+encodeURIComponent(selected.name)+'&limit=10',active.signal);
    if(current!==sequence) return;
    $('status').textContent=data.passes.length ? 'زمان ها تقریبی هستند؛ پیش از حرکت دوباره بررسی کنید.' : 'قطاری در این ساعت ثبت نشده؛ ممکن است خارج از ساعت سرویس باشد.';
    $('as-of').textContent='آخرین دریافت: '+data.as_of+' · به وقت تهران';
    for(const [toward,passes] of groupPasses(data.passes)) {
      const group=node('section',undefined,'arrival-group');
      group.append(node('h4',toward.startsWith('ورودی')?toward:'به سمت '+toward));
      const list=node('ol',undefined,'passes');
      for(const [index,pass] of passes.entries()) {
        const row=node('li',undefined,index===0?'next-pass':'later-pass');
        const eta=node('div',undefined,'eta');
        eta.append(node('strong',pass.eta_min===0?'اکنون':number(pass.eta_min)));
        if(pass.eta_min!==0) eta.append(node('span','دقیقه'));
        const timing=node('div',undefined,'timing'); timing.append(node('span',index===0?'قطار بعدی':'پس از آن'),node('bdi',pass.arrive));
        row.append(eta,timing); list.append(row);
      }
      group.append(list); $('arrivals').append(group);
    }
    for(const note of data.notes) $('notes').append(node('li',note));
  } catch(error) {
    if(current!==sequence) return;
    $('status').textContent='زمان تازه دریافت نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.';
  } finally {
    clearTimeout(timeout);
    if(current===sequence) $('arrivals').setAttribute('aria-busy','false');
  }
}
$('refresh').addEventListener('click',()=>selected?load():initialize());
$('station').addEventListener('change',()=>choose(metadata.stations.find(s=>s.id===$('station').value)));
$('search').addEventListener('input',()=>options($('search').value));
$('locate').addEventListener('click', async () => {
  $('locate').disabled=true; $('location-status').textContent='در انتظار اجازه موقعیت مکانی…';
  try {
    const coordinates=await requestPosition(tg, navigator.geolocation);
    const nearest=nearestStation(metadata.stations,coordinates.latitude,coordinates.longitude,metadata.maxNearestKm);
    if(!nearest) { $('location-status').textContent='در فاصله ۱۰ کیلومتری شما ایستگاهی در داده ها پیدا نشد. ایستگاه را دستی انتخاب کنید.'; return; }
    $('location-status').textContent='نزدیک ترین ایستگاه: '+nearest.station.name+' · حدود '+number(Math.round(nearest.km*1000))+' متر، فاصله مستقیم؛ نه مسیر پیاده روی.';
    $('search').value=''; options(); choose(nearest.station);
  } catch {
    $('location-status').textContent='دسترسی به موقعیت ممکن نشد. ایستگاه را دستی انتخاب کنید.';
  } finally { $('locate').disabled=false; }
});
async function initialize() {
  $('status').textContent='در حال دریافت ایستگاه ها…';
  try {
    metadata=await request('api/stations',AbortSignal.timeout(15000));
    options(); $('station').disabled=false; $('search').disabled=false; $('locate').disabled=false;
    choose(metadata.stations.find(s=>s.name===metadata.line1Order[0]));
  } catch {
    $('status').textContent='دریافت ایستگاه ها ممکن نشد. اتصال را بررسی کنید و تازه سازی را بزنید.';
    $('arrivals').setAttribute('aria-busy','false'); $('refresh').disabled=false;
  }
}
initialize();
