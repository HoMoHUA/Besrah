import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApi } from './api.js';
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const config = { journey: { enabled: true, feedbackEnabled: true, rolloutPercent: 0, calendarMode: 'weekday_baseline', horizonDays: 7, windowMinutes: 120 } };
const dto = { schemaVersion: 1, beta: true, modelOnly: true, live: false, status: 'ok', options: [], request: { line: 1, originId: 'METRO-101', destinationId: 'METRO-102', readyAt: '2026-11-03T12:00:00+03:30' }, calendar: { serviceDate: '2026-11-03', state: 'estimated', warning: true }, modelVersion: 'sha256:' + 'a'.repeat(64), asOf: '2026-11-03T12:00:00+03:30', validUntil: '2026-11-03T12:00:30+03:30' };
test('frontend beta fixture agrees with the backend default search window', () => {
  const backend = readFileSync(new URL('../../packages/core/src/journey-beta/config.ts', import.meta.url), 'utf8');
  assert.equal(Number(/horizonDays:\s*7,\s*searchMinutes:\s*(\d+)/.exec(backend)?.[1]), config.journey.windowMinutes);
});
test('beta and plan use same-origin no-store credential-free reads with a strict query allowlist', async () => {
  const seen=[]; const api = createApi({ fetch: async (url, init) => { seen.push([url,init]); return json(url === 'api/beta' ? config : dto); } });
  assert.deepEqual(await api.beta(), config.journey);
  assert.deepEqual(await api.journey({ line: 1, from: 'METRO-101', to: 'METRO-102', initData: 'secret', at: 'bad' }), dto);
  assert.equal(seen[1][0], 'api/journey?line=1&from=METRO-101&to=METRO-102');
  for (const [, init] of seen) { assert.equal(init.credentials,'omit'); assert.equal(init.cache,'no-store'); }
});
test('feedback is JSON POST with explicit header, credentials omit and unchanged reportId', async () => {
  const p={reportId:'12345678-1234-1234-1234-123456789012'}; const seen=[];
  const api=createApi({ fetch:async(url,init)=> {seen.push([url,init]);return json({status:'duplicate'});} });
  await api.journeyFeedback(p); await api.journeyFeedback(p);
  for (const [url,init] of seen) {assert.equal(url,'api/journey-feedback');assert.equal(init.method,'POST');assert.equal(init.credentials,'omit');assert.equal(init.headers['Content-Type'],'application/json');assert.equal(init.headers['X-Besrah-Beta'],'1');assert.deepEqual(JSON.parse(init.body),p);}
});
test('new API errors preserve safe codes and classify feature OFF, load and transport failures', async () => {
  for (const [status,body,kind] of [[404,{},'disabled'],[400,{code:'same_station',issues:['$.note:invalid']},'bad_request'],[429,{},'rate_limited'],[503,{error:'feedback_full'},'unavailable'],[403,{},'forbidden']]) {
    const api=createApi({fetch:async()=>json(body,status)});
    await assert.rejects(api.journey({line:1,from:'a',to:'b'}),e=>e.kind===kind && (status!==400 || e.code==='same_station'));
  }
  await assert.rejects(createApi({fetch:async()=>{throw Error('offline');}}).beta(),e=>e.kind==='network');
});
test('malformed, live, excessive and unsolicited options fail closed', async () => {
  for (const body of [{}, {...dto,live:true}, {...dto,status:'no_feasible_option',options:[{}]}, {...dto,options:new Array(6).fill({})}]) {
    await assert.rejects(createApi({fetch:async()=>json(body)}).journey({line:1,from:'a',to:'b'}),e=>e.kind==='server');
  }
  await assert.rejects(createApi({fetch:async()=>json({journey:{enabled:true}})}).beta(),e=>e.kind==='server');
});
test('timeout covers body consumption, not just response headers', async () => {
  const timers={handle:null,setTimeout(fn){this.handle=fn;return 1;},clearTimeout(){}};
  const api=createApi({ timers, fetch:async(_url,{signal})=>({ok:true,status:200,json:()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error(),{name:'AbortError'}))))}) });
  const p=api.beta(); await new Promise(resolve=>setImmediate(resolve)); timers.handle();
  await assert.rejects(p,e=>e.kind==='timeout');
});
test('kill-switch 404 survives a non-JSON edge response and a journey timeout stays distinct',async()=>{
  await assert.rejects(createApi({fetch:async()=>({ok:false,status:404,json:async()=>{throw Error('html');}})}).journey({line:1,from:'a',to:'b'}),e=>e.kind==='disabled');
  await assert.rejects(createApi({fetch:async()=>json({error:'journey_timeout'},503)}).journey({line:1,from:'a',to:'b'}),e=>e.kind==='timeout');
});
test('invalid options and calendar metadata are rejected as server errors before rendering', async () => {
  const option = { id: '2026-11-03:L1:out:A:' + 'b'.repeat(64), toward: 'غدیر', departAt: '12:05', arriveAt: '12:20', departDate: '2026-11-03', arriveDate: '2026-11-03', waitSeconds: 300, inVehicleSeconds: 900 };
  const query = { line: 1, from: 'METRO-101', to: 'METRO-102' };
  const valid = { ...dto, options: [option] };
  assert.deepEqual(await createApi({ fetch: async () => json(valid) }).journey(query), valid);
  for (const changed of [null, { ...option, departAt: '29:61' }, { ...option, arriveAt: 1234 }, { ...option, waitSeconds: -1 }, { ...option, inVehicleSeconds: null }, { ...option, arriveDate: '2026-02-31' }]) {
    await assert.rejects(createApi({ fetch: async () => json({ ...dto, options: [changed] }) }).journey(query), e => e.kind === 'server');
  }
  for (const changed of [{ ...dto, calendar: { ...dto.calendar, state: 'live' } }, { ...dto, request: { ...dto.request, readyAt: '2026-11-03T12:00:00Z' } }, { ...dto, validUntil: dto.asOf }]) {
    await assert.rejects(createApi({ fetch: async () => json(changed) }).journey(query), e => e.kind === 'server');
  }
});
test('a response for another request must never become a valid result',async()=>{
  await assert.rejects(createApi({fetch:async()=>json({...dto,request:{...dto.request,destinationId:'METRO-124'}})}).journey({line:1,from:'METRO-101',to:'METRO-102'}),e=>e.kind==='server');
});
