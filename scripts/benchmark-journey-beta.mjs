#!/usr/bin/env node
// Real loopback HTTP benchmark. Budgets were frozen in PERFORMANCE-BUDGET.md before execution.
// All anonymous feedback here is synthetic and confined to a disposable private test directory.
// Methodology v3: the HTTP server runs in a forked child and the load client in this parent, both inside the same
// 192 MiB / no-swap cgroup. v2 ran both in one process, so the event-loop probe measured client work too (run kept in
// the private checkpoint as benchmark-first-complete.json). Budgets were NOT changed.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { fork } from 'node:child_process';
import { Agent, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { createModelSource } from '../packages/core/dist/transit-journey/index.js';
import { createTimetableModel } from '../packages/core/dist/timetable-overlay.js';
// NET01-QG: measure the product wiring, i.e. the validated overlay timetable behind /next, /trains AND the journey planner.
const timetable = createTimetableModel();
import { createFeedbackStore } from '../packages/core/dist/journey-beta/feedback.js';

const budgets = Object.freeze({ warmP95Ms:80, coldMs:250, concurrentP95Ms:150, churnP95Ms:200,
  nextP95Ms:50, nextDeltaP95Ms:30, feedbackP95Ms:50, reopenMs:500,
  eventLoopP95Ms:30, eventLoopMaxMs:150, rssMiB:170, cgroupPeakMiB:184 });
if (process.argv[2]==='--server') {
 // Server worker: owns buildServer and the event-loop probe; controlled over IPC by the parent client.
 const { buildServer } = await import('../packages/core/dist/server.js');
 let app=null,delay=null,fail=false;const realSource=createModelSource(undefined,{timetable});
 const faultSource={...realSource,getDay:async(...a)=>{if(fail)throw Error('injected fault');return realSource.getDay(...a);}};
 process.on('message',async m=>{
  try{
   if(m.cmd==='open'){app=buildServer({now:()=>m.now,timetable,journeyBeta:m.config,...(m.fault?{journeySource:faultSource}:{})});await app.listen({host:'127.0.0.1',port:0});process.send({id:m.id,port:app.server.address().port});}
   else if(m.cmd==='close'){const a=app;app=null;let err=null;if(a){try{await a.close();}catch(e){err=String(e.message??e);}}process.send({id:m.id,closeError:err});}
   else if(m.cmd==='fault'){fail=m.on;process.send({id:m.id});}
   else if(m.cmd==='loop-start'){delay=monitorEventLoopDelay({resolution:5});delay.enable();await sleep(20);delay.reset();process.send({id:m.id});}
   else if(m.cmd==='loop-stop'){delay.disable();process.send({id:m.id,loop:{n:delay.count,p50:delay.percentile(50)/1e6,p95:delay.percentile(95)/1e6,p99:delay.percentile(99)/1e6,max:delay.max/1e6}});}
   else if(m.cmd==='rss'){process.send({id:m.id,rssMiB:Math.max(process.memoryUsage().rss,process.resourceUsage().maxRSS*1024)/1048576});}
   else if(m.cmd==='exit'){process.exit(0);}
  }catch(e){process.send({id:m.id,error:String(e.stack??e)});}
 });
 await new Promise(()=>{});
}
const iterations=Number(process.argv[2]??100);
assert(Number.isInteger(iterations)&&iterations>=30&&iterations<=300);
const group=readFileSync('/proc/self/cgroup','utf8').trim().split('\n').find(s=>s.startsWith('0::'))?.slice(3);
const cg=group?join('/sys/fs/cgroup',group):null;
const cgRead=name=>cg?readFileSync(join(cg,name),'utf8').trim():null;
assert.equal(cgRead('memory.max'),String(192*1048576),'Must run in a 192 MiB cgroup');
assert.equal(cgRead('memory.swap.max'),'0','Swap must be disabled');
const events=()=>Object.fromEntries(cgRead('memory.events').split('\n').map(l=>l.split(' ').map((v,i)=>i?Number(v):v)));
const report={schemaVersion:2,benchmark:'r2a-pb-real-loopback',timetable:timetable.status,at:new Date().toISOString(),node:process.version,
  iterations,budgets,cgroup:{path:group,max:cgRead('memory.max'),swapMax:cgRead('memory.swap.max'),eventsBefore:events()},phases:{}};
const failures=[];const check=(name,ok,actual)=>{if(!ok)failures.push({name,actual});};
const pct=(a,p)=>[...a].sort((x,y)=>x-y)[Math.max(0,Math.ceil(a.length*p)-1)]??null;
const stats=a=>({n:a.length,p50:pct(a,.5),p95:pct(a,.95),max:a.length?Math.max(...a):null});
const root=mkdtempSync(join(tmpdir(),'r2apb-final-bench-')), feedbackDir=join(root,'feedback');
const now=Date.now();const day=n=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran'}).format(new Date(now+n*86400000));
const source=createModelSource(undefined,{timetable});const order=source.catalog.orders;
const query=(n=0,line=1)=>'/app/api/journey?'+new URLSearchParams({line:String(line),from:order[line][5],to:order[line][6],date:day(1+n%3),time:'09:00'});
const next='/app/api/next?station='+encodeURIComponent(source.catalog.stations.find(s=>s.id===order[1][6]).name)+'&limit=4';
const agent=new Agent({keepAlive:true,maxSockets:6});let port;
const child=fork(new URL(import.meta.url).pathname,['--server'],{stdio:['ignore','inherit','inherit','ipc']});let seq=0;const waiting=new Map();
child.on('message',m=>{const w=waiting.get(m.id);if(w){waiting.delete(m.id);m.error?w.reject(Error(m.error)):w.resolve(m);}});
child.once('exit',c=>{for(const w of waiting.values())w.reject(Error('server worker exited '+c));});
const ipc=msg=>new Promise((resolve,reject)=>{const id=++seq;waiting.set(id,{resolve,reject});child.send({...msg,id});});
const call=(path,body)=>new Promise((resolve,reject)=>{
 const start=performance.now(),text=body===undefined?undefined:JSON.stringify(body);
 const req=request({host:'127.0.0.1',port,path,method:text?'POST':'GET',agent,headers:text?{'content-type':'application/json','content-length':Buffer.byteLength(text),'x-besrah-beta':'1'}:{}},res=>{
  const chunks=[];res.on('data',c=>chunks.push(c));res.once('error',reject);res.once('end',()=>resolve({status:res.statusCode,ms:performance.now()-start,body:JSON.parse(Buffer.concat(chunks).toString())}));
 });req.setTimeout(10000,()=>req.destroy(Error('timeout')));req.once('error',reject);if(text)req.write(text);req.end();
});
// Disable admission-rate thresholds ONLY for latency samples. Production concurrency remains TWO, writes ONE.
const relaxed={enabled:true,feedbackDir,journeyGlobalPerMinute:100000,journeyClientPerMinute:100000,
 feedbackGlobalPerMinute:100000,feedbackClientPerHour:100000};
async function open(config=relaxed,extra={}){port=(await ipc({cmd:'open',now,config,fault:Boolean(extra.fault)})).port;}
async function close(){const r=await ipc({cmd:'close'});if(r.closeError)throw Error(r.closeError);}
let sampledPeak=0;const mem=setInterval(()=>{sampledPeak=Math.max(sampledPeak,process.memoryUsage().rss);},5);mem.unref();
const feedback=(id,version)=>({v:1,reportId:'BENCH-'+String(id).padStart(24,'0'),kind:'timing_quality',timingQuality:'close',consent:{storeForModelImprovement:true},
 modelVersion:version,context:{line:1,originId:order[1][5],destinationId:order[1][6],serviceDate:day(0)}});
try{
 await open();
 for(let i=0;i<15;i++)assert.equal((await call(next)).status,200);
 const baseline=[];for(let i=0;i<iterations;i++){const r=await call(next);assert.equal(r.status,200);baseline.push(r.ms);}
 report.phases.nextBaseline=stats(baseline);
 const cold=await call(query());assert.equal(cold.status,200);assert(cold.body.options.length>0,'real timetable must produce options');
 report.modelVersion=cold.body.modelVersion;report.phases.cold={ms:cold.ms,options:cold.body.options.length};check('cold',cold.ms<=budgets.coldMs,cold.ms);
 const warm=[];for(let i=0;i<iterations;i++){const r=await call(query());assert.equal(r.status,200);warm.push(r.ms);}
 report.phases.warm=stats(warm);check('warm',report.phases.warm.p95<=budgets.warmP95Ms,report.phases.warm);
 await ipc({cmd:'loop-start'});
 const concurrent=[];for(let i=0;i<iterations;i+=2){const rs=await Promise.all([call(query()),call(query())]);for(const r of rs){assert.equal(r.status,200);concurrent.push(r.ms);}}
 report.phases.concurrent=stats(concurrent);check('concurrent',report.phases.concurrent.p95<=budgets.concurrentP95Ms,report.phases.concurrent);
 const churn=[];for(let i=0;i<iterations;i++){const r=await call(query(i,1+i%2));assert.equal(r.status,200);churn.push(r.ms);}
 report.phases.churn=stats(churn);check('churn',report.phases.churn.p95<=budgets.churnP95Ms,report.phases.churn);
 const contention=[];const background=[];
 for(let i=0;i<iterations;i++){const rs=await Promise.all([call(query(i,1+i%2)),call(query(i+1,1+(i+1)%2)),call(next)]);rs.forEach(r=>assert.equal(r.status,200));background.push(rs[0].ms,rs[1].ms);contention.push(rs[2].ms);}
 const loop=(await ipc({cmd:'loop-stop'})).loop;report.phases.nextContended={...stats(contention),deltaP95:pct(contention,.95)-pct(baseline,.95),ratioP95:pct(contention,.95)/pct(baseline,.95)};
 report.phases.eventLoop=loop; // server worker only; the client runs in this separate process
 check('next p95',report.phases.nextContended.p95<=budgets.nextP95Ms,report.phases.nextContended);
 check('next delta',report.phases.nextContended.deltaP95<=budgets.nextDeltaP95Ms,report.phases.nextContended);
 check('event loop p95',report.phases.eventLoop.p95<=budgets.eventLoopP95Ms,report.phases.eventLoop);
 check('event loop max',report.phases.eventLoop.max<=budgets.eventLoopMaxMs,report.phases.eventLoop);
 const writes=[];for(let i=0;i<iterations;i++){const r=await call('/app/api/journey-feedback',feedback(i,report.modelVersion));assert.equal(r.status,201,'feedback write '+i+' '+JSON.stringify(r.body));writes.push(r.ms);}
 const duplicate=await call('/app/api/journey-feedback',feedback(0,report.modelVersion));assert.equal(duplicate.body.status,'duplicate');
 report.phases.feedback=stats(writes);check('feedback',report.phases.feedback.p95<=budgets.feedbackP95Ms,report.phases.feedback);
 const fbBurst=await Promise.all(Array.from({length:30},(_,i)=>call('/app/api/journey-feedback',feedback(1000+i,report.modelVersion))));
 assert(fbBurst.every(r=>[201,429].includes(r.status)));report.phases.feedbackBurst=fbBurst.reduce((m,r)=>(m[r.status]=(m[r.status]??0)+1,m),{});
 await close();
 const rawName=readdirSync(feedbackDir).find(f=>/^feedback-/.test(f)), raw=readFileSync(join(feedbackDir,rawName),'utf8');
 const rows=raw.trim().split('\n').map(JSON.parse);assert.equal(rows.length,iterations+(report.phases.feedbackBurst[201]??0));assert.equal(new Set(rows.map(r=>r.reportId)).size,rows.length);
 report.phases.feedbackIntegrity={records:rows.length,unique:true,durableReadback:true};
 // A valid near-quota private fixture, generated from the real stored schema; never field evidence.
 const quotaDir=join(root,'quota');const seed=mkdtempSync(join(root,'quota-seed-'));const records=[];let bytes=0;
 for(let i=0;bytes<7*1048576;i++){const line=JSON.stringify({...rows[0],reportId:'BENCH-QUOTA-'+String(i).padStart(20,'0'),sourceId:'anonymous_feedback:BENCH-QUOTA-'+String(i).padStart(20,'0')})+'\n';records.push(line);bytes+=Buffer.byteLength(line);}
 writeFileSync(join(seed,rawName),records.join(''),{mode:0o600});
 const started=performance.now();const reopened=createFeedbackStore({dir:seed,maxFileBytes:8*1048576,maxPerDay:2000,clock:()=>now});const reopenedBytes=await reopened.diskBytes();const reopenMs=performance.now()-started;let count=0;await reopened.exportRecords(()=>{count++;});await reopened.flush();
 assert.equal(count,records.length);report.phases.nearQuotaReopen={ms:reopenMs,bytes,records:count};check('reopen',reopenMs<=budgets.reopenMs,report.phases.nearQuotaReopen);
 await open({enabled:true,feedbackDir});
 const burst=await Promise.all(Array.from({length:120},()=>call(query())));assert(burst.every(r=>[200,429].includes(r.status)));
 report.phases.defaultBurst=burst.reduce((m,r)=>(m[r.status]=(m[r.status]??0)+1,m),{});assert(report.phases.defaultBurst[200]>0&&report.phases.defaultBurst[429]>0);
 assert.equal((await call(next)).status,200);await close();
 // Fault and recovery exercise the same real adapter with an injected transient provider failure.
 await open(relaxed,{fault:true});await ipc({cmd:'fault',on:true});const bad=await call(query());assert([200,503].includes(bad.status));assert.equal(bad.body.options?.length??0,0);assert.equal((await call(next)).status,200);await ipc({cmd:'fault',on:false});const good=await call(query());assert.equal(good.status,200);assert(good.body.options.length>0);report.phases.modelFaultRecovery={faultStatus:bad.status,faultResult:bad.body.status??bad.body.error,recoveredOptions:good.body.options.length};await close();
 // A missing/unsafe store disables writes but not existing transit. Recovery uses a NEW isolated store.
 writeFileSync(join(root,'not-directory'),'fixture');await open({...relaxed,feedbackDir:join(root,'not-directory')});const badStore=await call('/app/api/journey-feedback',feedback(99999,report.modelVersion));assert.equal(badStore.status,503);assert.equal((await call(next)).status,200);try{await close();}catch{/* failed store reports its close fault */}
 await open({...relaxed,feedbackDir:quotaDir});assert.equal((await call('/app/api/journey-feedback',feedback(99999,report.modelVersion))).status,201);await close();report.phases.storageFaultRecovery={faultStatus:503,recoveredStatus:201,recovery:'fresh safe store, not silent corruption repair'};
 sampledPeak=Math.max(sampledPeak,process.memoryUsage().rss,process.resourceUsage().maxRSS*1024);const serverRss=(await ipc({cmd:'rss'})).rssMiB;report.rssPeakMiB=serverRss;report.rssBreakdownMiB={serverWorker:serverRss,loadClientProcess:sampledPeak/1048576,note:'RSS budget applies to the server process under test (the production-equivalent). The load client is a test artefact; the cgroup peak check covers both processes together.'};check('rss',report.rssPeakMiB<=budgets.rssMiB,report.rssPeakMiB);
 report.cgroup.peakMiB=Number(cgRead('memory.peak'))/1048576;report.cgroup.eventsAfter=events();check('cgroup peak',report.cgroup.peakMiB<=budgets.cgroupPeakMiB,report.cgroup.peakMiB);check('oom',report.cgroup.eventsAfter.oom===0&&report.cgroup.eventsAfter.oom_kill===0,report.cgroup.eventsAfter);
}catch(e){failures.push({name:'execution',actual:e.stack});}finally{clearInterval(mem);try{await close();}catch{}try{child.send({cmd:'exit'});}catch{}agent.destroy();rmSync(root,{recursive:true,force:true});}
report.failures=failures;report.verdict=failures.length?'BUDGET_MISSED':'WITHIN_BUDGETS';
report.caveats=['Server worker and load client are separate processes inside one cgroup on a shared host; short samples are not an SLO.','Default rate limits are disabled only for latency samples; concurrency remains two. Default burst is measured separately.','Feedback fixtures are private synthetic test inputs, never real observations.','Provider means the in-process timetable source, not an external real-time service.'];
console.log(JSON.stringify(report,null,2));process.exitCode=failures.length?1:0;
