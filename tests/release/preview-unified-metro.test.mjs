import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
const root = new URL('../../', import.meta.url);
async function port() { const s=createServer(); await new Promise(r=>s.listen(0,'127.0.0.1',r)); const n=s.address().port;await new Promise(r=>s.close(r));return n; }
for (const mode of ['on','off','strict']) test(`real loopback preview ${mode} never enables feedback`, async t=>{
 const p=await port();const child=spawn(process.execPath,['scripts/preview-unified-metro.mjs',`--port=${p}`,`--mode=${mode}`],{cwd:root,env:{...process.env,BESRAH_JOURNEY_BETA:'on',BESRAH_FEEDBACK_DIR:'/never-use-preview-env',BESRAH_JOURNEY_SWITCH_FILE:'/etc/besrah-journey/control.json'}});
 let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}});
 let response;
 for(let i=0;i<80;i++){if(child.exitCode!==null)throw new Error(`preview exited: ${output}`);try{response=await fetch(`http://127.0.0.1:${p}/app/api/beta`);break;}catch{await new Promise(r=>setTimeout(r,50));}}
 assert.ok(response,output);const config=(await response.json()).journey;assert.equal(config.enabled,mode!=='off');assert.equal(config.feedbackEnabled,false);assert.equal(config.rolloutPercent,0);assert.equal(config.calendarMode,mode==='strict'?'strict':'weekday_baseline');
 const feedback=await fetch(`http://127.0.0.1:${p}/app/api/journey-feedback`,{method:'POST',headers:{'content-type':'application/json','origin':`http://127.0.0.1:${p}`,'x-besrah-beta':'1'},body:'{}'});assert.equal(feedback.status,mode==='off'?404:503);
 assert.equal((await fetch(`http://127.0.0.1:${p}/health`)).status,200);assert.equal((await fetch(`http://127.0.0.1:${p}/app/`)).status,200);assert.match(output,/127\.0\.0\.1/);
});
