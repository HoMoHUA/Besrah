import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import webpush from 'web-push';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerWebPush } from '../src/webpush/index.js';
import { registerJourneyBeta } from '../src/journey-beta/index.js';

function subscription() { const e = createECDH('prime256v1'); e.generateKeys(); return {endpoint:'https://fcm.googleapis.com/fcm/send/secret', keys:{p256dh:e.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}}; }
const origin = 'https://besrah.arklyn.ir';
const payload = () => ({ cancelToken: randomBytes(32).toString('base64url'), subscription: subscription(), line: 1, from: 'METRO-101', to: 'METRO-102', eventId: 'real-event', departEpoch: 2000 });

describe('web push opt-in API', () => {
  it('validates the modeled event and schedules one push only with explicit same-origin opt-in', async () => {
    const app = Fastify(); let now = 1_000_000; let sent = 0;
    const metro = { planMetro: async () => ({status:'ok', options:[{eventId:'real-event',departEpoch:2000}]}), catalog: () => ({}) } as any;
    const handle = registerWebPush(app, { now: () => now, metro, config: { ...webpush.generateVAPIDKeys(), subject:'mailto:admin@example.org', db:':memory:', origins:[origin] }, send: async () => { sent++; return 201; }, startTimer:false });
    const req = (body: Record<string, unknown>, requestOrigin = origin) => app.inject({method:'POST',url:'/app/api/reminders',headers:{origin:requestOrigin,'x-besrah-reminder':'1'},payload:body});
    expect((await req(payload(), 'https://evil.example')).statusCode).toBe(403);
    expect((await req({...payload(), eventId:'fake'})).statusCode).toBe(400);
    const response = await req(payload()); expect(response.statusCode).toBe(201);
    expect(response.json().token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await handle.tick(); expect(sent).toBe(0);
    now = 1_700_000; await handle.tick(); await handle.tick(); expect(sent).toBe(1);
    await app.close();
  });
  it('safely replays a lost creation response and rejects token or endpoint conflicts', async () => {
    const app=Fastify(); let plans=0;
    const metro={planMetro:async()=>{ plans++; return {status:'ok',options:[{eventId:'real-event',departEpoch:2000}]}; }} as any;
    registerWebPush(app,{now:()=>1_000_000,metro,config:{...webpush.generateVAPIDKeys(),subject:'mailto:admin@example.org',db:':memory:',origins:[origin]},startTimer:false});
    const headers={origin,'x-besrah-reminder':'1'}; const body=payload();
    const req=(p: any)=>app.inject({method:'POST',url:'/app/api/reminders',headers,payload:p});
    expect((await req(body)).statusCode).toBe(201);
    expect((await req(body)).statusCode).toBe(201);
    expect(plans).toBe(1);
    expect((await req({...body,eventId:'different'})).statusCode).toBe(409);
    expect((await req({...body,cancelToken:randomBytes(32).toString('base64url')})).statusCode).toBe(409);
    expect((await app.inject({method:'POST',url:'/app/api/reminders/delete',headers,payload:{token:body.cancelToken}})).statusCode).toBe(200);
    await app.close();
  });
  it('replays an accepted request after its creation window closes without replanning', async () => {
    const app=Fastify(); let now=1_000_000, calls=0;
    const metro={planMetro:async()=>{calls++; return {options:[{eventId:'real-event',departEpoch:2000}]};}} as any;
    registerWebPush(app,{now:()=>now,metro,config:{...webpush.generateVAPIDKeys(),subject:'mailto:admin@example.org',db:':memory:',origins:[origin]},startTimer:false});
    const body=payload(), headers={origin,'x-besrah-reminder':'1'};
    const request=()=>app.inject({method:'POST',url:'/app/api/reminders',headers,payload:body});
    expect((await request()).statusCode).toBe(201); now=1_650_000;
    expect((await request()).statusCode).toBe(201); expect(calls).toBe(1); await app.close();
  });
  it('cancels a creation whose planner is still in flight', async () => {
    const app=Fastify(); let now=1_000_000, release!:()=>void, sent=0, entered!:()=>void;
    const started=new Promise<void>(r=>{entered=r});
    const metro={planMetro:async()=>{entered(); await new Promise<void>(r=>{release=r}); return {options:[{eventId:'real-event',departEpoch:2000}]};}} as any;
    const handle=registerWebPush(app,{now:()=>now,metro,config:{...webpush.generateVAPIDKeys(),subject:'mailto:admin@example.org',db:':memory:',origins:[origin]},send:async()=>{sent++;return 201;},startTimer:false});
    const body=payload(), headers={origin,'x-besrah-reminder':'1'};
    const creating=app.inject({method:'POST',url:'/app/api/reminders',headers,payload:body}); await started;
    const deleting=app.inject({method:'POST',url:'/app/api/reminders/delete',headers,payload:{token:body.cancelToken}});
    await new Promise(r=>setTimeout(r,10)); release(); await creating; expect((await deleting).statusCode).toBe(200);
    now=1_700_000; await handle.tick(); expect(sent).toBe(0); await app.close();
  });
  it('rejects a create arriving after cancellation and server restart', async () => {
    const dir=mkdtempSync(join(tmpdir(),'push-api-restart-')); const config={...webpush.generateVAPIDKeys(),subject:'mailto:admin@example.org',db:join(dir,'db'),origins:[origin]};
    const metro={planMetro:async()=>({options:[{eventId:'real-event',departEpoch:2000}]})} as any;
    const headers={origin,'x-besrah-reminder':'1'}, body=payload();
    try {
      const first=Fastify(); registerWebPush(first,{now:()=>1_000_000,metro,config,startTimer:false});
      expect((await first.inject({method:'POST',url:'/app/api/reminders/delete',headers,payload:{token:body.cancelToken}})).statusCode).toBe(200); await first.close();
      const second=Fastify(); registerWebPush(second,{now:()=>1_000_000,metro,config,startTimer:false});
      expect((await second.inject({method:'POST',url:'/app/api/reminders',headers,payload:body})).statusCode).toBe(409); await second.close();
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
  it('rejects untrusted endpoints and throttles clients before accepting more requests', async () => {
    const app = Fastify(); const metro = {planMetro:async()=>({status:'ok',options:[{eventId:'real-event',departEpoch:2000}]}),catalog:()=>({})} as any;
    registerWebPush(app,{now:()=>1_000_000,metro,config:{...webpush.generateVAPIDKeys(),subject:'mailto:admin@example.org',db:':memory:',origins:[origin]},startTimer:false});
    const bad=payload(); bad.subscription.endpoint='https://127.0.0.1/internal';
    const req = () => app.inject({method:'POST',url:'/app/api/reminders',headers:{origin,'x-besrah-reminder':'1'},payload:bad});
    expect((await req()).statusCode).toBe(400);
    for (let i=0;i<5;i++) expect((await req()).statusCode).toBe(400);
    expect((await req()).statusCode).toBe(429);
    await app.close();
  });
  it('deletes a reminder before it is due using its private token', async () => {
    const app = Fastify(); let sent = 0; let now = 1_000_000;
    const metro = {planMetro:async()=>({status:'ok',options:[{eventId:'real-event',departEpoch:2000}]}),catalog:()=>({})} as any;
    const handle = registerWebPush(app,{now:()=>now,metro,config:{...webpush.generateVAPIDKeys(),subject:'mailto:admin@example.org',db:':memory:',origins:[origin]},send:async()=>{sent++;return 201;},startTimer:false});
    const headers = {origin,'x-besrah-reminder':'1'};
    const created = await app.inject({method:'POST',url:'/app/api/reminders',headers,payload:payload()});
    expect(created.statusCode).toBe(201);
    const deleted = await app.inject({method:'POST',url:'/app/api/reminders/delete',headers,payload:{token:created.json().token}});
    expect(deleted.statusCode).toBe(200);
    now=1_700_000; await handle.tick(); expect(sent).toBe(0);
    await app.close();
  });
  it('accepts an actual event from the project model, then sends it once', async () => {
    const app = Fastify(); let now = Date.parse('2026-10-16T08:00:00+03:30'), sent = 0;
    const metro = registerJourneyBeta(app, {now:()=>now, config:{enabled:true}});
    const handle = registerWebPush(app, {now:()=>now, metro, config:{...webpush.generateVAPIDKeys(),subject:'mailto:admin@example.org',db:':memory:',origins:[origin]}, send:async()=>{sent++;return 201;}, startTimer:false});
    const journey = await app.inject('/app/api/journey?line=1&from=METRO-101&to=METRO-102');
    expect(journey.statusCode).toBe(200);
    const option = journey.json().options.find((x: any) => x.eventId && x.departEpoch > now/1000 + 360);
    expect(option).toBeTruthy();
    const response = await app.inject({method:'POST',url:'/app/api/reminders',headers:{origin,'x-besrah-reminder':'1'},payload:{cancelToken:randomBytes(32).toString('base64url'),subscription:subscription(),line:1,from:'METRO-101',to:'METRO-102',eventId:option.eventId,departEpoch:option.departEpoch}});
    expect(response.statusCode).toBe(201);
    now=(option.departEpoch-300)*1000; await handle.tick(); await handle.tick(); expect(sent).toBe(1);
    await app.close();
  });
  it('does not allow forbidden origins to exhaust cancellation', async () => {
    const app = Fastify();
    const metro = {planMetro:async()=>({status:'ok',options:[{eventId:'real-event',departEpoch:2000}]})} as any;
    registerWebPush(app,{now:()=>1_000_000,metro,config:{...webpush.generateVAPIDKeys(),subject:'mailto:admin@example.org',db:':memory:',origins:[origin]},startTimer:false});
    const headers = {origin,'x-besrah-reminder':'1'};
    const created = await app.inject({method:'POST',url:'/app/api/reminders',headers,payload:payload()});
    expect(created.statusCode).toBe(201);
    for (let i=0;i<65;i++) await app.inject({method:'POST',url:'/app/api/reminders',headers:{...headers,origin:'https://evil.example'},payload:{}});
    const deleted = await app.inject({method:'POST',url:'/app/api/reminders/delete',headers,payload:{token:created.json().token}});
    expect(deleted.statusCode).toBe(200);
    await app.close();
  });
  it('reserves cancellation quota against same-origin creation traffic', async () => {
    const app=Fastify(); const metro={planMetro:async()=>({status:'ok',options:[{eventId:'real-event',departEpoch:2000}]})} as any;
    registerWebPush(app,{now:()=>1_000_000,metro,config:{...webpush.generateVAPIDKeys(),subject:'mailto:admin@example.org',db:':memory:',origins:[origin]},startTimer:false});
    const headers={origin,'x-besrah-reminder':'1'};
    const created=await app.inject({method:'POST',url:'/app/api/reminders',headers,payload:payload()});
    for(let i=0;i<65;i++) await app.inject({method:'POST',url:'/app/api/reminders',headers:{...headers,'x-real-ip':`127.0.1.${i+1}`},payload:{}});
    expect((await app.inject({method:'POST',url:'/app/api/reminders/delete',headers,payload:{token:created.json().token}})).statusCode).toBe(200);
    await app.close();
  });
  it('attempts ten simultaneous due reminders within their common one-minute window', async () => {
    const app = Fastify(); let now=1_000_000, sent=0;
    const metro={planMetro:async()=>({status:'ok',options:[{eventId:'real-event',departEpoch:2000}]})} as any;
    const handle=registerWebPush(app,{now:()=>now,metro,config:{...webpush.generateVAPIDKeys(),subject:'mailto:admin@example.org',db:':memory:',origins:[origin]},send:async()=>{sent++; await new Promise(r=>setTimeout(r,8000)); return 201;},startTimer:false});
    for(let i=0;i<10;i++) {
      const body=payload(); body.subscription.endpoint += String(i);
      const response=await app.inject({method:'POST',url:'/app/api/reminders',headers:{origin,'x-besrah-reminder':'1','x-real-ip':`127.0.0.${i+1}`},payload:body});
      expect(response.statusCode).toBe(201);
    }
    vi.useFakeTimers(); now=1_700_000; const pending=handle.tick();
    for(let i=0;i<6;i++){now+=8000; await vi.advanceTimersByTimeAsync(8000);}
    expect(sent).toBe(10);
    await vi.advanceTimersByTimeAsync(16000); await pending; await app.close(); vi.useRealTimers();
  });
  it('rejects an eleventh reminder in the same delivery window', async () => {
    const app=Fastify();
    const metro={planMetro:async()=>({options:[{eventId:'real-event',departEpoch:2000}]})} as any;
    registerWebPush(app,{now:()=>1_000_000,metro,config:{...webpush.generateVAPIDKeys(),subject:'mailto:admin@example.org',db:':memory:',origins:[origin]},startTimer:false});
    for(let i=0;i<11;i++) { const body=payload(); body.subscription.endpoint+=String(i); const res=await app.inject({method:'POST',url:'/app/api/reminders',headers:{origin,'x-besrah-reminder':'1','x-real-ip':`127.0.0.${i+1}`},payload:body}); expect(res.statusCode).toBe(i<10?201:503); }
    await app.close();
  });
  it('emits sanitized aggregate delivery results even without Fastify logger', async () => {
    const spy=vi.spyOn(console,'error').mockImplementation(()=>{}); const app=Fastify({logger:false}); let now=1_000_000;
    const metro={planMetro:async()=>({options:[{eventId:'real-event',departEpoch:2000}]})} as any;
    const handle=registerWebPush(app,{now:()=>now,metro,config:{...webpush.generateVAPIDKeys(),subject:'mailto:admin@example.org',db:':memory:',origins:[origin]},send:async()=>503,startTimer:false});
    await app.inject({method:'POST',url:'/app/api/reminders',headers:{origin,'x-besrah-reminder':'1'},payload:payload()}); now=1_700_000; await handle.tick();
    expect(JSON.stringify(spy.mock.calls)).toContain('rejected'); expect(JSON.stringify(spy.mock.calls)).not.toContain('fcm.googleapis.com');
    await app.close(); spy.mockRestore();
  });
  it('rejects malformed and mismatched VAPID key pairs', async () => {
    const keys=webpush.generateVAPIDKeys(), other=webpush.generateVAPIDKeys();
    for (const pair of [{...keys,privateKey:keys.privateKey+'!'}, {...keys,publicKey:other.publicKey}]) {
      const app=Fastify(); registerWebPush(app,{now:Date.now,metro:{} as any,config:{...pair,subject:'mailto:admin@example.org',db:':memory:',origins:[origin]},startTimer:false});
      expect((await app.inject('/app/api/reminders/config')).statusCode).toBe(404); await app.close();
    }
  });
  it('reports expired deliveries as missed without sending', async () => {
    const app=Fastify(); let now=1_000_000, sent=0;
    const metro={planMetro:async()=>({options:[{eventId:'real-event',departEpoch:2000}]})} as any;
    const handle=registerWebPush(app,{now:()=>now,metro,config:{...webpush.generateVAPIDKeys(),subject:'mailto:admin@example.org',db:':memory:',origins:[origin]},send:async()=>{sent++;return 201;},startTimer:false});
    expect((await app.inject({method:'POST',url:'/app/api/reminders',headers:{origin,'x-besrah-reminder':'1'},payload:payload()})).statusCode).toBe(201);
    now=1_760_000; expect(await handle.tick()).toEqual({attempted:0,missed:1}); expect(sent).toBe(0); await app.close();
  });
  it('drains an in-flight send before closing the store', async () => {
    const app=Fastify(); let now=1_000_000, release!:()=>void, finished=false;
    const metro={planMetro:async()=>({options:[{eventId:'real-event',departEpoch:2000}]})} as any;
    const handle=registerWebPush(app,{now:()=>now,metro,config:{...webpush.generateVAPIDKeys(),subject:'mailto:admin@example.org',db:':memory:',origins:[origin]},send:async()=>{await new Promise<void>(r=>{release=r}); finished=true; return 201;},startTimer:false});
    expect((await app.inject({method:'POST',url:'/app/api/reminders',headers:{origin,'x-besrah-reminder':'1'},payload:payload()})).statusCode).toBe(201);
    now=1_700_000; const tick=handle.tick(); const closing=app.close(); await new Promise(r=>setTimeout(r,20)); expect(finished).toBe(false);
    release(); await tick; await closing; expect(finished).toBe(true);
  });
  it('fails closed when credentials are absent', async () => {
    const app = Fastify();
    registerWebPush(app, { now: Date.now, metro:{} as any, config:null, startTimer:false });
    expect((await app.inject({method:'GET', url:'/app/api/reminders/config'})).statusCode).toBe(404);
    await app.close();
  });
});
