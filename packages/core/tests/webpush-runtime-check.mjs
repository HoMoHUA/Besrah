import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePushEndpoint, publicPushAddresses } from '../dist/webpush/security.js';
import { registerWebPush } from '../dist/webpush/index.js';
import Fastify from 'fastify';
import webpush from 'web-push';
import { randomBytes } from 'node:crypto';

test('compiled native ESM accepts valid subscriptions and rejects unsafe destinations', async () => {
  assert.equal(validatePushEndpoint('https://fcm.googleapis.com/fcm/send/abc').hostname, 'fcm.googleapis.com');
  assert.throws(() => validatePushEndpoint('https://127.0.0.1/x'));
  assert.deepEqual(publicPushAddresses([{address:'8.8.8.8',family:4}]), [{address:'8.8.8.8',family:4}]);
  assert.throws(() => publicPushAddresses([{address:'127.0.0.1',family:4}]));
  const app=Fastify({logger:false}), origin='https://example.org', now=1000000;
  registerWebPush(app,{now:()=>now,metro:{planMetro:async()=>({options:[{eventId:'event',departEpoch:2000}]})},config:{...webpush.generateVAPIDKeys(),subject:'mailto:a@example.org',db:':memory:',origins:[origin]},startTimer:false});
  const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/abc',keys:{p256dh:webpush.generateVAPIDKeys().publicKey,auth:randomBytes(16).toString('base64url')}};
  const body={cancelToken:randomBytes(32).toString('base64url'),subscription,line:1,from:'a',to:'b',eventId:'event',departEpoch:2000};
  const req=payload=>app.inject({method:'POST',url:'/app/api/reminders',headers:{origin,'x-besrah-reminder':'1'},payload});
  assert.equal((await req(body)).statusCode,201);
  assert.equal((await req({...body,subscription:{...subscription,endpoint:'https://127.0.0.1/secret'}})).statusCode,400);
  await app.close();
});

test('actual built entrypoint serves enabled web-push routes over loopback', async () => {
  const {spawn} = await import('node:child_process');
  const {createServer} = await import('node:net');
  const {mkdtemp, rm} = await import('node:fs/promises');
  const {join} = await import('node:path');
  const {tmpdir} = await import('node:os');
  const probe=createServer(); await new Promise(r=>probe.listen(0,'127.0.0.1',r)); const port=probe.address().port; await new Promise(r=>probe.close(r));
  const dir=await mkdtemp(join(tmpdir(),'webpush-runtime-')); const keys=webpush.generateVAPIDKeys(), origin='https://example.org';
  const child=spawn(process.execPath,['dist/index.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),BESRAH_WEBPUSH_PUBLIC_KEY:keys.publicKey,BESRAH_WEBPUSH_PRIVATE_KEY:keys.privateKey,BESRAH_WEBPUSH_SUBJECT:'mailto:a@example.org',BESRAH_WEBPUSH_DB:join(dir,'push.db'),BESRAH_ALLOWED_ORIGINS:origin},stdio:['ignore','pipe','pipe']});
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('entrypoint timeout')),10000); child.once('exit',code=>{clearTimeout(timer);reject(Error(`entrypoint exited ${code}`));}); child.stdout.on('data',data=>{if(String(data).includes('mashhad-waze core on')){clearTimeout(timer);resolve();}});});
    const base=`http://127.0.0.1:${port}`;
    assert.equal((await fetch(base+'/app/api/reminders/config')).status,200);
    const body={cancelToken:randomBytes(32).toString('base64url'),subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/abc',keys:{p256dh:webpush.generateVAPIDKeys().publicKey,auth:randomBytes(16).toString('base64url')}},line:1,from:'a',to:'b',eventId:'event',departEpoch:Math.floor(Date.now()/1000)+600};
    const response=await fetch(base+'/app/api/reminders',{method:'POST',headers:{origin,'x-besrah-reminder':'1','content-type':'application/json'},body:JSON.stringify(body)});
    assert.notEqual((await response.json()).error,'invalid');
  } finally { child.kill('SIGTERM'); await new Promise(r=>child.once('exit',r)); await rm(dir,{recursive:true,force:true}); }
});
