import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from './state.js';
import { installFoodDom, findAll, flushView } from './test-support/food-dom.mjs';
import * as planner from './ui/planner.js';
import { FIXED_NOTICE, WEEKDAY_WARNING } from './journey.js';

const config = { enabled: true, feedbackEnabled: true, rolloutPercent: 0, calendarMode: 'weekday_baseline', horizonDays: 7, windowMinutes: 120 };
const stations = [{id:'METRO-101',name:'ابتدا',lines:[1]},{id:'METRO-117',name:'مشترک',lines:[1,2]},{id:'METRO-201',name:'طبرسی',lines:[2]}];
const state = () => createState({ stations, order:['ابتدا','مشترک'],order2:['طبرسی','مشترک'],status:'ready' });
const time = Date.parse('2026-11-03T12:00:00+03:30');
const timers=()=>({handles:[],setTimeout(fn,ms){this.handles.push([fn,ms]);return this.handles.length;},clearTimeout(){}});
const dto = () => ({ schemaVersion:1,beta:true,modelOnly:true,live:false,status:'ok',message:null,request:{line:1,originId:'METRO-101',destinationId:'METRO-117',originName:'ابتدا',destinationName:'مشترک',readyAt:'2026-11-03T12:00:00+03:30',source:'server_now',windowMinutes:120},calendar:{state:'estimated',warning:true,serviceDate:'2026-11-03',dayType:'normal'},asOf:'2026-11-03T12:00:00+03:30',validUntil:'2026-11-03T12:00:30+03:30',modelVersion:'sha256:'+'a'.repeat(64),options:[{id:'2026-11-03:L1:out:A:1',service:'A',toward:'غدیر',departAt:'12:05:00.5',arriveAt:'12:20:00',departDate:'2026-11-03',arriveDate:'2026-11-03',waitSeconds:300,inVehicleSeconds:900,earliestArrival:true}] });
const memory = () => {const m=new Map();return {getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
function make(api={},extra={}) {return planner.createPlannerController({api:{beta:async()=>config,journey:async()=>dto(),journeyFeedback:async()=>({status:'stored'}),...api},state:state(),storage:memory(),now:()=>time,timers:timers(),...extra});}
async function ready(c){await c.load();c.optIn();c.setForm({from:'METRO-101',to:'METRO-117'});}

test('invitation and full rollout never replace an explicit opt-in, and journeys are not persisted', async t => {
  let gps = 0, reads = 0, writes = 0; const saved = new Map();
  installFoodDom(t, { browser: () => { gps++; } });
  const storage = { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, v), removeItem: k => saved.delete(k) };
  const c = make({ beta: async () => ({ ...config, rolloutPercent: 100 }), journey: async () => { reads++; return dto(); }, journeyFeedback: async () => { writes++; return { status: 'stored' }; } }, { storage, search: '?beta=1' });
  const view = planner.createPlanner({ controller: c, state: state() });
  await c.load(); await c.plan();
  assert.equal(c.get().active, false); assert.equal(reads, 0); assert.equal(writes, 0);
  c.optIn(); c.setForm({ from: 'METRO-101', to: 'METRO-117' }); await c.plan();
  assert.equal(reads, 1); assert.equal(writes, 0); assert.equal(gps, 0);
  assert.match(view.el.textContent, /Asia\/Tehran/);
  assert.deepEqual([...saved.keys()].sort(), ['besrah.beta.bucket', 'besrah.beta.optin']);
  assert.doesNotMatch(JSON.stringify([...saved]), /METRO-|2026-|readyAt|observedAt/);
});

test('render distinguishes empty coverage states and transport failures without invented cards', async t => {
  installFoodDom(t);
  for (const status of ['partial', 'insufficient_data', 'no_feasible_option']) {
    const c = make({ journey: async () => ({ ...dto(), status, options: [] }) });
    await ready(c); await c.plan(); const view = planner.createPlanner({ controller: c, state: state() });
    assert.ok(view.el.textContent.includes(FIXED_NOTICE));
    assert.equal(findAll(view.el, n => n.tagName === 'article').length, 0);
    assert.doesNotMatch(view.el.textContent, /حرکت تخمینی|زودترین رسیدن/);
  }
  for (const kind of ['network', 'server', 'timeout', 'rate_limited']) {
    const c = make({ journey: async () => { throw { kind }; } });
    await ready(c); await c.plan(); const view = planner.createPlanner({ controller: c, state: state() });
    assert.ok(view.el.textContent.includes(FIXED_NOTICE));
    assert.equal(findAll(view.el, n => n.tagName === 'article').length, 0);
    assert.equal(c.get().busy, null); assert.equal(c.get().active, true);
  }
});

test('registry ordering uses physical IDs, keeps shared membership, and never includes another line',()=>{
  assert.deepEqual(planner.lineStations(state().get(),2).map(s=>s.id),['METRO-201','METRO-117']);
  assert.deepEqual(planner.lineStations(state().get(),1).map(s=>s.id),['METRO-101','METRO-117']);
});
test('config OFF is a hard gate; opting in is optional and leaving cancels and clears results',async()=>{
  const off=make({beta:async()=>({...config,enabled:false})});await off.load();off.optIn();assert.equal(off.get().active,false);
  const c=make();await c.load();assert.equal(c.get().active,false);c.optIn();assert.equal(c.get().active,true);c.leave();assert.equal(c.get().active,false);assert.equal(c.get().response,null);
});
test('one active plan, input change aborts and stale completion cannot render',async()=>{
  const flights=[];let calls=0;
  const c=make({journey:(_q,signal)=>{calls++;return new Promise(resolve=>flights.push({resolve,signal}));}});await ready(c);
  const old=c.plan();await flushView();const duplicate=c.plan();await duplicate;assert.equal(calls,1);
  c.setForm({to:'METRO-101'});assert.equal(flights[0].signal.aborted,true);assert.equal(c.get().response,null);
  c.setForm({to:'METRO-117'});const next=c.plan();await flushView();flights[1].resolve({...dto(),status:'partial'});await next;
  flights[0].resolve(dto());await old;assert.equal(c.get().response.status,'partial');
  c.setForm({mode:'custom'});assert.equal(c.get().response,null);
});
test('expiry is explicit, one-shot, no polling; current-option feedback stops but witnessed history remains',async()=>{
  let ms=time;const clock=timers();const c=make({}, {now:()=>ms,timers:clock});await ready(c);await c.plan();
  assert.equal(c.get().expired,false);assert.equal(clock.handles.length,1);ms+=31000;clock.handles[0][0]();
  assert.equal(c.get().expired,true);assert.equal(c.availableFeedback().timing_quality,false);assert.equal(c.availableFeedback().boarding_outcome,false);assert.equal(c.availableFeedback().train_observation,true);
});
test('feedback requires unchecked explicit consent and preserves reportId through a failed retry',async()=>{
  const sent=[];const c=make({journeyFeedback:async p=>{sent.push(p);if(sent.length===1)throw {kind:'network'};return {status:'duplicate'};}});await ready(c);await c.plan();c.openFeedback();
  assert.equal(c.get().feedback.consent,false);c.updateFeedback({kind:'timing_quality',quality:'close'});await c.sendFeedback();assert.equal(sent.length,0);
  c.updateFeedback({consent:true});await c.sendFeedback();assert.equal(c.get().feedback.status,'error');await c.sendFeedback();
  assert.equal(sent.length,2);assert.equal(sent[0].reportId,sent[1].reportId);assert.equal(c.get().feedback.status,'sent');await c.sendFeedback();assert.equal(sent.length,2);
});
test('explicit witnessed date/time, arrival vs departure, and feedback OFF are enforced before POST',async()=>{
  const sent=[];const c=make({journeyFeedback:async p=>{sent.push(p);return {status:'stored'};}});await ready(c);await c.plan();c.openFeedback();
  c.updateFeedback({kind:'train_observation',event:'train_departure',stationId:'METRO-101',direction:'out',date:'2026-11-03',time:'13:00',precision:'minute',consent:true});await c.sendFeedback();assert.equal(sent.length,0);
  c.updateFeedback({date:'2026-11-02'});await c.sendFeedback();assert.equal(sent[0].observation.observedAt,'2026-11-02T13:00:00+03:30');assert.equal(sent[0].observation.event,'train_departure');assert.equal(sent[0].context.tripId,undefined);
  const off=make({beta:async()=>({...config,feedbackEnabled:false})});await ready(off);await off.plan();off.openFeedback();assert.equal(off.get().feedback.open,false);
});
test('runtime 404 kills only planner and late feedback responses after hide cannot become success',async()=>{
  const c=make({journey:async()=>{throw {kind:'disabled'};}});await ready(c);await c.plan();assert.equal(c.get().active,false);assert.equal(c.get().response,null);
  let resolve;const pending=make({journeyFeedback:()=>new Promise(r=>resolve=r)});await ready(pending);await pending.plan();pending.openFeedback();pending.updateFeedback({kind:'timing_quality',quality:'close',consent:true});const send=pending.sendFeedback();await flushView();pending.hide();resolve({status:'stored'});await send;assert.notEqual(pending.get().feedback.status,'sent');
});
test('real render includes readable notices, destinations, expiry refresh and accessible consent, no A/B',async t=>{
  installFoodDom(t);const c=make();await ready(c);await c.plan();const view=planner.createPlanner({controller:c,state:state()});
  assert.ok(view.el.textContent.includes(FIXED_NOTICE));assert.ok(view.el.textContent.includes(WEEKDAY_WARNING));assert.match(view.el.textContent,/غدیر/);assert.doesNotMatch(view.el.textContent,/سرویس A|سرویس B|12:05:00/);
  c.openFeedback();const consent=findAll(view.el,n=>n.tagName==='input'&&n.getAttribute('type')==='checkbox')[0];assert.ok(consent);assert.equal(consent.checked,false);
  assert.ok(findAll(view.el,n=>n.tagName==='label'&&n.getAttribute('for')===consent.getAttribute('id')).length);
  c.expire();assert.match(view.el.textContent,/منقضی/);assert.match(view.el.textContent,/محاسبه دوباره/);
  c.setForm({to:'METRO-101'});assert.doesNotMatch(view.el.textContent,/زودترین رسیدن/);
});
test('a failed problem report is retried byte-for-byte even after option expiry',async()=>{
  const reports=[];const c=make({journeyFeedback:async p=>{reports.push(JSON.stringify(p));if(reports.length===1)throw {kind:'network'};return {status:'stored'};}});await ready(c);await c.plan();c.openFeedback();
  c.updateFeedback({kind:'problem',category:'other',optionId:dto().options[0].id,consent:true});await c.sendFeedback();c.expire();await c.sendFeedback();assert.equal(reports[0],reports[1]);
});
test('uncertain delivery retries the exact report after expiry, without allowing new expired-option feedback', async t => {
  installFoodDom(t);
  const reports = []; let ms = time;
  const c = make({ journeyFeedback: async p => { reports.push(JSON.stringify(p)); if (reports.length === 1) throw { kind: 'network' }; return { status: 'duplicate' }; } }, { now: () => ms });
  await ready(c); await c.plan(); c.openFeedback();
  c.updateFeedback({ kind: 'timing_quality', quality: 'close', consent: true });
  await c.sendFeedback(); ms += 31_000; c.expire();
  const view = planner.createPlanner({ controller: c, state: state() });
  assert.equal(c.get().feedback.kind, 'timing_quality');
  const send = findAll(view.el, n => n.tagName === 'button' && n.getAttribute('type') === 'submit').at(-1);
  assert.equal(send.getAttribute('disabled'), null);
  await c.sendFeedback();
  assert.equal(reports.length, 2); assert.equal(reports[1], reports[0]);
  assert.equal(c.get().feedback.status, 'sent');
  c.expire(); assert.equal(c.get().feedback.status, 'sent');
  c.closeFeedback(); c.openFeedback();
  assert.equal(c.availableFeedback().timing_quality, false);
});
test('weekday baseline warning cannot disappear just because a DTO forgets its warning bit',async t=>{
  installFoodDom(t);const c=make({journey:async()=>({...dto(),calendar:{...dto().calendar,state:'known',warning:false}})});await ready(c);await c.plan();const view=planner.createPlanner({controller:c,state:state()});assert.ok(view.el.textContent.includes(WEEKDAY_WARNING));
});
test('midnight dates are visibly distinct and all user/server text remains text nodes',async t=>{
  installFoodDom(t);const data=dto();data.options[0]={...data.options[0],toward:'<img src=x>',departAt:'23:59',arriveAt:'00:20',arriveDate:'2026-11-04'};
  const c=make({journey:async()=>data});await ready(c);await c.plan();const view=planner.createPlanner({controller:c,state:state()});assert.match(view.el.textContent,/فردا/);assert.equal(findAll(view.el,n=>n.tagName==='img').length,0);assert.ok(view.el.textContent.includes('<img src=x>'));
});
test('typing a native time invalidates results without replacing the focused time control',async t=>{
  installFoodDom(t);const c=make();await ready(c);c.setForm({mode:'custom',date:'2026-11-03',time:'13:00'});await c.plan();const view=planner.createPlanner({controller:c,state:state()});
  const field=findAll(view.el,n=>n.getAttribute('id')==='journey-time')[0];await field.dispatch('input','13:01');
  assert.equal(c.get().response,null);assert.equal(c.get().form.time,'13:01');assert.equal(findAll(view.el,n=>n.getAttribute('id')==='journey-time')[0],field);assert.doesNotMatch(view.el.textContent,/زودترین رسیدن/);
});
test('a disabled, loading or unreachable beta is invisible to visitors who never asked for it', async t => {
  installFoodDom(t);
  const off = make({ beta: async () => { throw { kind: 'disabled' }; } });
  const view = planner.createPlanner({ controller: off, state: state() });
  assert.equal(view.el.hidden, true, 'idle');
  await off.load();
  assert.equal(view.el.hidden, true, 'disabled');
  assert.equal(view.el.textContent, '', 'no dead card content for ordinary visitors');
  const down = make({ beta: async () => { throw { kind: 'network' }; } });
  const downView = planner.createPlanner({ controller: down, state: state() });
  await down.load();
  assert.equal(down.get().phase, 'config_error');
  assert.equal(downView.el.hidden, true, 'a config fetch error must not clutter the board for non-beta visitors');
});
test('visitors who opted in or followed the invitation still see why the beta is off, and the card returns when it is on', async t => {
  installFoodDom(t);
  const invited = make({ beta: async () => { throw { kind: 'disabled' }; } }, { search: '?beta=1' });
  const invitedView = planner.createPlanner({ controller: invited, state: state() });
  await invited.load();
  assert.equal(invitedView.el.hidden, false);
  assert.match(invitedView.el.textContent, /خاموش/);
  const storage = memory(); storage.setItem('besrah.beta.optin', '1');
  const returning = make({ beta: async () => { throw { kind: 'disabled' }; } }, { storage });
  const returningView = planner.createPlanner({ controller: returning, state: state() });
  await returning.load();
  assert.equal(returningView.el.hidden, false);
  const on = make();
  const onView = planner.createPlanner({ controller: on, state: state() });
  await on.load();
  assert.equal(onView.el.hidden, false, 'enabled beta shows the optional entry to everyone');
  assert.match(onView.el.textContent, /فعال کردن اختیاری بتا/);
  on.optIn(); on.leave();
  assert.equal(onView.el.hidden, false, 'a visitor who left an enabled beta still sees the entry');
});
