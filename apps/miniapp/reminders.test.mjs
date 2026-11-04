import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createReminders } from './reminders.js';

function setup({failCreate = false, failStorage = false, initial} = {}) {
  const values = new Map(initial), calls = [];
  const storage = {getItem:k=>values.get(k) ?? null, setItem:(k,v)=>{if(failStorage) throw Error('quota'); values.set(k,v);}, removeItem:k=>values.delete(k)};
  const sub = {toJSON:()=>({endpoint:'https://push.example/x',keys:{p256dh:'a',auth:'b'}}),unsubscribe:async()=>true};
  const registration = {pushManager:{subscribe:()=>Promise.resolve(sub),getSubscription:async()=>sub}};
  const fetch = async (url,options={})=>{calls.push({url,body:options.body && JSON.parse(options.body),snapshot:new Map(values)}); if(url==='api/reminders' && failCreate) throw Error('lost'); return {ok:true,json:async()=>url.endsWith('/config')?{publicKey:'AQ'}:{status:'ok'}};};
  const make = () => createReminders({navigator:{serviceWorker:{register:async()=>registration,ready:Promise.resolve(registration)}},storage,fetch,crypto:webcrypto,now:()=>1000000});
  return {values,calls,storage,make};
}
const request={line:1,originId:'METRO-101',destinationId:'METRO-102'}, option={eventId:'event',departEpoch:2000};

test('persists a 32-byte cancel token and exact request before create, and recovers lost response', async()=>{
  const s=setup({failCreate:true}), client=s.make(); assert.equal(await client.prepare(),true);
  await assert.rejects(client.schedule(request,option));
  const first=s.calls.find(c=>c.url==='api/reminders'); assert.match(first.body.cancelToken,/^[A-Za-z0-9_-]{43}$/); assert.equal(Buffer.from(first.body.cancelToken,'base64url').length,32);
  assert.ok([...first.snapshot.values()].some(v=>v.includes(first.body.cancelToken))); assert.equal(client.hasReminder(),true);
  s.calls.length=0; const recovered=s.make(); await recovered.prepare();
  assert.deepEqual(s.calls.find(c=>c.url==='api/reminders').body,first.body);
});


test('failed storage prevents a create POST', async()=>{
  const s=setup({failStorage:true}), client=s.make(); await client.prepare();
  await assert.rejects(client.schedule(request,option));
  assert.equal(s.calls.filter(c=>c.url==='api/reminders').length,0);
});

test('does not replace an existing reminder and leaves its cancellation token intact', async()=>{
  const s=setup(), client=s.make(); await client.prepare(); await client.schedule(request,option);
  const original=[...s.values.entries()]; await assert.rejects(client.schedule(request,{...option,eventId:'other'}),/reminder_exists/);
  assert.deepEqual([...s.values.entries()],original); assert.equal(s.calls.filter(c=>c.url==='api/reminders').length,1);
});

test('failed cancellation is retried on startup, never recreates the reminder', async()=>{
  const s=setup(), client=s.make(); await client.prepare(); await client.schedule(request,option);
  const token=s.calls.find(c=>c.url==='api/reminders').body.cancelToken;
  const broken=s.make(); // temporarily make cancellation fail via storage-independent network instance
  const failing=createReminders({storage:s.storage,crypto:webcrypto,now:()=>1000000,fetch:async()=>{throw Error('offline')}});
  await assert.rejects(failing.remove()); assert.equal(failing.status(),'cancelling');
  s.calls.length=0; await broken.prepare();
  assert.deepEqual(s.calls.find(c=>c.url==='api/reminders/delete').body,{token});
  assert.equal(s.calls.some(c=>c.url==='api/reminders'),false); assert.equal(broken.hasReminder(),false);
});

test('pending and confirmed reminders expire after departure', async()=>{
  const s=setup({failCreate:true}), c=s.make(); await c.prepare(); await assert.rejects(c.schedule(request,option));
  const expired=createReminders({storage:s.storage,now:()=>2000000,fetch:async()=>{throw Error('must not retry')}});
  await expired.prepare(); assert.equal(expired.status(),'none');
});


test('startup recovery does not require service worker or beta configuration', async()=>{
  const s=setup({failCreate:true}), c=s.make(); await c.prepare(); await assert.rejects(c.schedule(request,option));
  const calls=[]; const startup=createReminders({storage:s.storage,now:()=>1000000,fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({status:'ok'})};}});
  await startup.recover(); assert.equal(calls.length,1); assert.equal(calls[0].url,'api/reminders'); assert.equal(startup.status(),'confirmed');
});


test('reminder expires at server expiry one minute after due time', async()=>{
  const s=setup(), c=s.make(); await c.prepare(); await c.schedule(request,option);
  const expired=createReminders({storage:s.storage,now:()=>1760000});
  assert.equal(expired.status(),'none');
});


test('uses browser-wide lock to serialize recovery against other tabs', async()=>{
  const calls=[]; const client=createReminders({navigator:{locks:{request:async(name,fn)=>{calls.push(name);return fn();}}},storage:{getItem:()=>null},fetch:async()=>{}});
  await client.recover(); assert.deepEqual(calls,['besrah-reminder']);
});

test('confirmed reminder retains only cancellation token and expiry', async()=>{
  const s=setup(), client=s.make(); await client.prepare(); await client.schedule(request,option);
  const record=JSON.parse(s.values.get('besrah-reminder-record'));
  assert.deepEqual(Object.keys(record).sort(), ['expires','state','token']);
  assert.equal(record.state,'confirmed');
  assert.equal(record.expires,(option.departEpoch-240)*1000);
});
