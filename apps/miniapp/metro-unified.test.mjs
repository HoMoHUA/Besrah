import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from './state.js';
import { installFoodDom, findAll, flushView } from './test-support/food-dom.mjs';
import { createPlannerController, createPlanner } from './ui/planner.js';
import { createTracker } from './ui/tracker.js';
import { createMetroView } from './views/metro.js';
import { createStationSheet } from './ui/station.js';
import { createStore } from './store.js';

const stations = [{id:'METRO-101',name:'ابتدا',lines:[1]},{id:'METRO-117',name:'مشترک',lines:[1,2]},{id:'METRO-201',name:'طبرسی',lines:[2]}];
const registry = () => createState({status:'ready',stations,order:['ابتدا','مشترک'],order2:['طبرسی','مشترک']});
const config = { enabled:true,feedbackEnabled:false,rolloutPercent:0,calendarMode:'weekday_baseline',horizonDays:7,windowMinutes:120 };
const make = state => createPlannerController({state,api:{beta:async()=>config},now:()=>Date.parse('2026-11-03T10:00:00+03:30')});

test('form selection during configuration revalidation cannot cancel config or strand loading', async t => {
  dom(t); const state=registry(); let resolve, signal;
  const c=createPlannerController({state,api:{beta:s=>{signal=s;return new Promise(r=>resolve=r);}}});
  const pending=c.load(); await flushView();
  c.setForm({from:'METRO-101'});
  assert.equal(signal.aborted,false,'form edits own journey cancellation, not configuration cancellation');
  resolve(config); await pending;
  assert.equal(c.get().phase,'ready'); assert.equal(c.get().form.from,'METRO-101');
  const second=c.load();await flushView();c.hide();assert.equal(signal.aborted,true);resolve(config);await second;
});

// A loading-only registry notification must not destroy an otherwise valid trip.
test('unified owner preserves valid endpoints on status and registry refresh; only removed IDs clear', t => {
  installFoodDom(t); const state=registry(), controller=make(state);
  createPlanner({state,controller});
  controller.setForm({from:'METRO-101',to:'METRO-117'});
  state.set({status:'loading'});
  assert.equal(controller.get().form.from,'METRO-101');
  state.set({status:'ready',stations:[...stations]});
  assert.equal(controller.get().form.to,'METRO-117');
  state.set({stations:stations.filter(s=>s.id!=='METRO-101')});
  assert.equal(controller.get().form.from,'');
  assert.equal(controller.get().form.to,'METRO-117');
});

// Extend the existing test DOM only with browser primitives required by real controls.
function dom(t) {
  installFoodDom(t); const proto=Object.getPrototypeOf(document.createElement('div'));
  const match=(n,selector)=>{
    if(selector.startsWith('#')) return n.getAttribute('id')===selector.slice(1);
    if(selector.startsWith('.')) return n.className.split(' ').includes(selector.slice(1));
    const data=selector.match(/^\[data-([\w-]+)(?:="([^"]+)")?\]$/);
    if(data) return n.dataset[data[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]!==undefined && (!data[2]||n.dataset[data[1]]===data[2]);
    return n.tagName===selector;
  };
  proto.querySelectorAll=function(s){return findAll(this,n=>s.split(',').some(part=>match(n,part.trim())));};
  proto.querySelector=function(s){return this.querySelectorAll(s)[0]??null;};
  proto.removeAttribute=function(k){delete this.attributes[k];};
  proto.focus=function(){document.activeElement=this;this.listeners.get('focus')?.({target:this});};
  proto.blur=function(){if(document.activeElement===this)document.activeElement=null;};
  proto.click=function(){return this.listeners.get('click')?.({target:this});};
  proto.scrollIntoView=function(){};
  proto.contains=function(n){return n===this||findAll(this,x=>x===n).length>0;};
  proto.remove=function(){};
  proto.closest=function(s){return match(this,s)?this:null;};
  Object.defineProperty(proto,'classList',{configurable:true,get(){const el=this;return {add(...names){el.className=[...new Set([...el.className.split(' ').filter(Boolean),...names])].join(' ');},remove(...names){el.className=el.className.split(' ').filter(n=>!names.includes(n)).join(' ');},toggle(n,on){on??=!el.className.split(' ').includes(n);on?this.add(n):this.remove(n);return on;}};}});
  Object.defineProperty(proto,'style',{configurable:true,get(){return {setProperty(){}};}});
  const events=new Map(); document.addEventListener=(n,fn)=>events.set(n,fn);document.removeEventListener=(n)=>events.delete(n);
  document.hidden=false;document.visibilityState='visible';document.activeElement=null;
  return {events};
}

test('controlled tracker changes line without fetching until started, aborts on hide and pauses hidden document', async t => {
  const {events}=dom(t), calls=[];
  const tracker=createTracker({api:{trains:(line,signal)=>{calls.push({line,signal});return new Promise(()=>{});}},actions:{openStation(){}}});
  assert.equal(typeof tracker.setLine,'function');
  tracker.setLine(2);assert.equal(calls.length,0);
  tracker.start();assert.equal(calls.length,1);assert.equal(calls[0].line,2);
  document.hidden=true;events.get('visibilitychange')();assert.equal(calls[0].signal.aborted,true);
  document.hidden=false;events.get('visibilitychange')();assert.equal(calls.length,2);
  tracker.setLine(1);assert.equal(calls[1].signal.aborted,true);assert.equal(calls.at(-1).line,1);
  tracker.stop();assert.equal(calls.at(-1).signal.aborted,true);
});

test('scheduled tracker polls do not cancel a slow but live request', async t => {
  dom(t); const handles=[],calls=[];
  t.mock.method(globalThis,'setInterval',(fn,ms)=>{handles.push({fn,ms});return handles.length;});
  t.mock.method(globalThis,'clearInterval',()=>{});
  const tracker=createTracker({api:{trains:(line,signal)=>new Promise(resolve=>calls.push({line,signal,resolve}))},actions:{openStation(){}}});
  try {
    tracker.start();const poll=handles.find(h=>h.ms===3000).fn;
    poll();poll();assert.equal(calls.length,1);assert.equal(calls[0].signal.aborted,false);
    calls[0].resolve({order:['ابتدا','مشترک'],trains:[],notes:[],as_of:'10:00:00'});await flushView();
    poll();assert.equal(calls.length,2);
  } finally { tracker.stop(); }
});

test('tracker polls every 3 s in the background; one missed refresh is silent, data older than 10 s is disclosed as stale and recovery clears it', async t => {
  dom(t);const handles=[];let fail=false,clock=0;
  t.mock.method(globalThis,'setInterval',(fn,ms)=>{handles.push({fn,ms});return handles.length;});t.mock.method(globalThis,'clearInterval',()=>{});
  t.mock.method(performance,'now',()=>clock);
  const tracker=createTracker({api:{trains:async()=>{if(fail)throw {kind:'network'};return {order:['ابتدا','مشترک'],trains:[],notes:[],as_of:'10:00:00'};}},actions:{openStation(){}}});
  const summary=()=>tracker.el.querySelector('.trk-summary').textContent;
  try {
    tracker.start();await flushView();
    assert.ok(handles.some(h=>h.ms===3000),'poll every 3 s');
    fail=true;clock=3000;handles.find(h=>h.ms===3000).fn();await flushView();
    assert.doesNotMatch(summary(),/قدیمی/,'one missed 3 s refresh is not news');
    clock=11000;handles.find(h=>h.ms===3000).fn();await flushView();
    assert.match(summary(),/قدیمی/);assert.match(summary(),/10:00:00/);
    fail=false;clock=14000;handles.find(h=>h.ms===3000).fn();await flushView();assert.doesNotMatch(summary(),/قدیمی/);
  } finally { tracker.stop(); }
});

test('embedded planner has one reused endpoint combobox, no parallel station selects or beta card heading', async t => {
  dom(t);const state=registry(),controller=make(state);await controller.load();controller.optIn();
  const view=createPlanner({state,controller,embedded:true});
  assert.equal(view.el.querySelectorAll('input').filter(n=>n.getAttribute('role')==='combobox').length,1);
  assert.equal(view.el.querySelectorAll('select').filter(n=>['journey-from','journey-to'].includes(n.getAttribute('id'))).length,0);
  assert.doesNotMatch(view.el.textContent,/برنامه ریز سفر مترو — آزمایشی/);
  const from=view.el.querySelector('#journey-from');await from.dispatch('click');
  const input=view.el.querySelector('#journey-station-query');await input.dispatch('input','ابتدا');
  await new Promise(r=>setTimeout(r,270));
  const pick=view.el.querySelectorAll('button').find(n=>n.dataset.name==='ابتدا');assert.ok(pick);
  input.listeners.get('keydown')({key:'ArrowDown',preventDefault(){}});
  assert.equal(pick.getAttribute('aria-selected'),'true');
  input.listeners.get('keydown')({key:'Enter',preventDefault(){}});
  assert.equal(controller.get().form.from,'METRO-101');
  // R3-B: the fare/limits sentence moved from standing text above the form to the result area (see metro-r3b.test.mjs).
  assert.doesNotMatch(view.el.textContent,/کرایه/);
  await view.el.querySelector('#journey-to').dispatch('click');
  assert.equal(view.el.querySelector('.journey-picker').hidden,false);
  controller.setForm({line:2});
  assert.equal(view.el.querySelector('.journey-picker').hidden,true,'line change must dismiss stale-line search suggestions');
});

test('shared picker preserves prior station recents without persisting journey selections', async t => {
  dom(t);const state=registry(),controller=make(state),stationStore=createStore();
  stationStore.addRecent('ابتدا');stationStore.addRecent('طبرسی');const before=stationStore.recents();
  await controller.load();controller.optIn();
  const view=createPlanner({state,controller,embedded:true,stationStore});await view.el.querySelector('#journey-from').dispatch('click');
  const suggestions=view.el.querySelectorAll('button').filter(b=>b.getAttribute('role')==='option');
  assert.ok(suggestions.some(b=>b.dataset.name==='ابتدا'));assert.ok(!suggestions.some(b=>b.dataset.name==='طبرسی'));
  await suggestions.find(b=>b.dataset.name==='ابتدا').dispatch('click');assert.equal(controller.get().form.from,'METRO-101');assert.deepEqual(stationStore.recents(),before);
});

test('origin board aborts stale selection and route hide; return refreshes while preserving form',async t=>{
  dom(t);const ctx=context(),pending=[];
  ctx.api.next=(name,opts)=>new Promise(resolve=>pending.push({name,...opts,resolve}));
  const view=createMetroView(ctx);view.onShow();await flushView();view.controller.optIn();
  view.controller.setForm({from:'METRO-101',to:'METRO-117'});assert.equal(pending.length,1);
  view.controller.setForm({from:'METRO-117'});assert.equal(pending[0].signal.aborted,true);
  pending[0].resolve({passes:[],as_of:'09:00:00',notes:['OLD'],day_type:'normal'});await flushView();assert.doesNotMatch(view.el.querySelector('.metro-current-board').textContent,/OLD/);
  view.onHide();assert.equal(pending[1].signal.aborted,true);
  view.onShow();await flushView();assert.equal(pending.length,3,'return must refresh current-time board');
  assert.equal(view.controller.get().form.to,'METRO-117');view.onHide();
});
test('explicit route line2 entry updates shared line rather than only discovery tab',async t=>{
  dom(t);const ctx=context(),view=createMetroView(ctx);view.onShow();await flushView();view.controller.optIn();
  view.onShow({mode:'line2'});await flushView();assert.equal(view.controller.get().form.line,2);view.onHide();
});

test('current board transport failure clears first-load skeleton and keeps a real retry action',async t=>{
  dom(t);const ctx=context();ctx.api.next=async()=>{throw {kind:'timeout'};};
  const view=createMetroView(ctx);view.onShow();await flushView();view.controller.optIn();view.controller.setForm({from:'METRO-101'});await flushView();
  const host=view.el.querySelector('.metro-current-board');
  view.onHide();
  assert.equal(host.querySelectorAll('.train--skeleton').length,0);
  assert.match(host.textContent,/تازه نشد/);assert.ok(host.querySelectorAll('button').some(b=>b.textContent==='تازه سازی تابلو'));
});

test('route-return bridge queues selection safely while config is loading and starts board only after ready', async t => {
  dom(t); const ctx=context(),view=createMetroView(ctx);
  try {
    view.onShow();await flushView();view.controller.optIn();view.controller.setForm({from:'METRO-101'});await flushView();
    view.onHide(); const before=ctx.calls.length;let resolve;
    ctx.api.beta=()=>new Promise(r=>resolve=r);
    view.onShow();assert.equal(view.isUnified(),false);assert.equal(ctx.calls.length,before);
    assert.equal(view.planFrom('مشترک'),true);assert.equal(ctx.calls.length,before);
    resolve(config);await flushView();assert.equal(view.isUnified(),true);assert.equal(view.controller.get().phase,'ready');assert.equal(view.controller.get().form.from,'METRO-117');assert.equal(ctx.calls.at(-1).name,'مشترک');
  } finally { view.onHide(); }
});

test('inline favorite follows external store changes without refetch and reports capacity', async t => {
  dom(t);const ctx=context();ctx.store=createStore(undefined,{maxFavourites:1});const view=createMetroView(ctx);
  try {
    view.onShow();await flushView();view.controller.optIn();view.controller.setForm({from:'METRO-101'});await flushView();const n=ctx.calls.length;
    ctx.store.toggleFavourite('ابتدا');
    const fav=view.el.querySelector('.metro-board-actions').querySelectorAll('button').find(b=>b.textContent==='حذف از علاقه مندی ها');
    assert.ok(fav);assert.equal(fav.getAttribute('aria-pressed'),'true');assert.equal(ctx.calls.length,n);
    ctx.store.toggleFavourite('ابتدا');ctx.store.toggleFavourite('مشترک');
    const save=view.el.querySelector('.metro-board-actions').querySelectorAll('button').find(b=>b.textContent==='ذخیره ایستگاه');await save.dispatch('click');
    assert.match(view.el.querySelector('.metro-board-status').textContent,/پر است/);assert.equal(ctx.store.isFavourite('ابتدا'),false);
  } finally { view.onHide(); }
});

test('all-stations discovery survives unrelated readiness updates but follows real line changes', async t => {
  dom(t);const ctx=context(),view=createMetroView(ctx);
  try {
    view.onShow();await flushView();view.controller.optIn();
    const all=view.el.querySelectorAll('button').find(b=>b.dataset.mode==='all');await all.dispatch('click');
    assert.equal(all.getAttribute('aria-selected'),'true');
    view.controller.setForm({mode:'custom'});assert.equal(all.getAttribute('aria-selected'),'true');
    view.controller.setForm({line:2});assert.equal(all.getAttribute('aria-selected'),'false');
    assert.equal(view.el.querySelectorAll('button').find(b=>b.dataset.mode==='line2').getAttribute('aria-selected'),'true');
  } finally { view.onHide(); }
});

function context() {
  const state=registry();state.set({nearest:{phase:'idle'},recent:null,asOf:null,maxKm:10,view:'metro'});
  const calls=[],trains=[];let enabled=true;
  const api={ beta:async()=>({...config,enabled}), next:(name,options)=>{calls.push({name,...options});return Promise.resolve({passes:[],as_of:'10:00:00',day_type:'normal',notes:['یادداشت مدل']});}, trains:(line,signal)=>{trains.push({line,signal});return Promise.resolve({order:['ابتدا','مشترک'],trains:[],notes:[],as_of:'10:00:00'});} };
  const fav=new Set();const store={recents:()=>[],clearRecents(){},favourites:()=>[...fav],isFavourite:n=>fav.has(n),toggleFavourite(n){fav.has(n)?fav.delete(n):fav.add(n);return {on:fav.has(n)};},addRecent(){},setLast(){}};
  const modes=[];const actions={metroModeChanged:on=>modes.push(on),back(){},go(){},reload(){},openStation(){},unsupported(){},heroAction(){},locate(){}};
  return {state,api,store,actions,calls,trains,modes,off(){enabled=false;}};
}
test('unified page shares origin board, swap/line, suppresses legacy stack, and tracker is lazy',async t=>{
  dom(t);const ctx=context(),view=createMetroView(ctx);
  view.onShow();await flushView();
  assert.ok(view.controller,'Metro exposes its shared owner for integration');
  const legacyPolls = ctx.trains.length; // OFF/opt-out retains the original expanded tracker.
  view.controller.optIn();await flushView();
  assert.match(view.el.querySelector('.metro-current-board').textContent,/برای دیدن حرکت ها/);
  assert.equal(view.el.querySelector('.metro-current-board').querySelectorAll('.train--skeleton').length,0);
  view.controller.setForm({from:'METRO-101',to:'METRO-117'});await flushView();
  assert.equal(ctx.calls.length,1);assert.equal(ctx.calls[0].name,'ابتدا');assert.equal(ctx.calls[0].line,1);
  assert.equal(ctx.trains.length,legacyPolls);
  assert.equal(view.el.querySelector('.metro-legacy').hidden,true);
  assert.match(view.el.querySelector('.metro-current-board').textContent,/زمان فعلی/);
  view.controller.setForm({mode:'custom',date:'2026-11-04',time:'10:00'});await flushView();assert.equal(ctx.calls.length,1);
  const swap=view.el.querySelectorAll('button').find(n=>n.getAttribute('aria-label')==='جابه جا کردن مبدأ و مقصد'); // R3-B: icon button, name via aria-label
  await swap.dispatch('click');await flushView();
  assert.equal(ctx.calls.at(-1).name,'مشترک');
  view.controller.setForm({line:2});await flushView();assert.equal(ctx.calls.at(-1).line,2);
  // Keep this request in flight: aborting an already completed response is not a lifecycle guarantee.
  ctx.api.trains=(line,signal)=>{ctx.trains.push({line,signal});return new Promise(()=>{});};
  const trackerTab=view.el.querySelector('#metro-tab-tracker');await trackerTab.dispatch('click');await flushView(); // R3-B: visible tab replaces the hidden <details>assert.equal(ctx.trains.at(-1).line,2);
  view.onHide();assert.equal(ctx.trains.at(-1).signal.aborted,true);
  view.onShow();await flushView();assert.equal(view.controller.get().form.from,'METRO-117');
  ctx.off();await view.controller.load();assert.equal(view.el.querySelector('.metro-legacy').hidden,false);view.onHide();
  assert.deepEqual(ctx.modes,[true,false],'summary fetching must switch with presentation, not stay pending after fallback');
});
test('sheet plan-from CTA is opt-in contextual and preserves sheet board/notes/spines',async t=>{
  dom(t);const ctx=context();let content,closed,planned;
  const sheet={open(root,opts){content=root;closed=opts.onClosed;},close(){closed();}};
  const station=createStationSheet({...ctx,sheet,getStations:()=>stations,getOrders:()=>({1:ctx.state.get().order,2:ctx.state.get().order2}),canPlanFrom:()=>true,onPlanFrom:name=>planned=name});
  station.show('مشترک');await flushView();
  assert.match(content.textContent,/یادداشت مدل/);assert.equal(content.querySelectorAll('.station__spine').length,2);
  const cta=content.querySelectorAll('button').find(n=>n.textContent==='از این ایستگاه سفر بساز');assert.ok(cta);await cta.dispatch('click');assert.equal(planned,'مشترک');
});
