#!/usr/bin/env node
// Explicitly synthetic capacity probe. These stop times are NOT city timetable facts.
import assert from 'node:assert/strict';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as sleep, setImmediate as yieldTurn } from 'node:timers/promises';
import { createModelSource, normalizeModelDay, planJourney, JOURNEY_LIMITS } from '../packages/core/dist/transit-journey/index.js';
const args=process.argv.slice(2);
if(args.length && (args.length!==2||args[0]!=='--iterations'||!/^\d+$/.test(args[1])))throw Error('Usage: --iterations 1..100');
const iterations=args.length?Number(args[1]):10;
if(!Number.isSafeInteger(iterations)||iterations<1||iterations>100)throw Error('Iterations must be 1..100');
const date='2026-10-16',ready=Date.parse(date+'T13:00:00+03:30')/1000;
const catalog=createModelSource().catalog,order=catalog.orders[1];
const names=new Map(catalog.stations.map(s=>[s.id,s.name]));
const dataVersion='fixture:synthetic-capacity-v1';
const raw={line:1,serviceDate:date,dayType:'friday',dataVersion,runQuality:order.slice(1).map(()=>'fixture:synthetic-not-city-data'),trains:Array.from({length:JOURNEY_LIMITS.tripsPerDay},(_,i)=>{
 const start=ready+i;return {id:`fixture:capacity-${i}`,service:'B',direction:'out',confidence:'fixture:synthetic',beyondGhadirIsDerived:true,start,stops:order.map((id,idx)=>({idx,name:names.get(id),arrive:start+idx*10,depart:start+idx*10}))};
})};
const normalization=[],plans=[];let day,result;
const delay=monitorEventLoopDelay({resolution:5});delay.enable();await sleep(20);delay.reset();
let maxHeartbeatLateMs=0,last=performance.now();
const timer=setInterval(()=>{const now=performance.now();maxHeartbeatLateMs=Math.max(maxHeartbeatLateMs,now-last-5);last=now;},5);
try{
 for(let i=0;i<iterations;i++){
  const begin=performance.now();day=normalizeModelDay(raw,catalog);normalization.push(performance.now()-begin);assert.equal(day.trips.length,512);await yieldTurn();
 }
 const source={catalog,dataVersion,evidence:[{id:'fixture:capacity-source',sourceId:'fixture:synthetic-capacity',kind:'fixture',dataVersion,live:false}],async getDay(line,date,type){assert.equal(line,1);assert.equal(date,day.serviceDate);assert.equal(type,day.dayType);await yieldTurn();return day;},stats(){return {entries:1,maxEntries:2,hits:0,misses:1,evictions:0};},clear(){}};
 const request={schemaVersion:1,requestId:'fixture:capacity',line:1,originId:order[0],destinationId:order.at(-1),readyAt:date+'T13:00:00+03:30',calendar:{mode:'strict'},decisionPermission:'granted',searchSeconds:21600,maxCandidates:64};
 for(let i=0;i<iterations;i++){
  const begin=performance.now();result=await planJourney(request,source);plans.push(performance.now()-begin);
  assert.equal(result.candidates.length,64);assert.equal(result.diagnostics.matchedTrips,512);assert.equal(result.diagnostics.candidateTruncated,true);assert.equal(result.status,'partial');await yieldTurn();
 }
 await sleep(10);
 const stats=values=>{const v=[...values].sort((a,b)=>a-b);return {count:v.length,p50:v[Math.ceil(v.length*.5)-1],p95:v[Math.ceil(v.length*.95)-1],max:v.at(-1)};};
 console.log(JSON.stringify({synthetic:true,notice:'512 artificial trips using real station registry; timings are not city facts. Capacity probe, not a production SLO.',iterations,shape:{trips:512,stopsPerTrip:order.length,candidates:64,windowSeconds:21600,sourceEvidencePerMetric:1,totalEvidencePerMetric:3},normalizationMs:stats(normalization),planMs:stats(plans),lastTimingsMs:result.diagnostics.timingsMs,decisionStats:result.decision.stats,outputStatus:result.status,memory:process.memoryUsage(),maxRssBytes:process.resourceUsage().maxRSS*1024,eventLoop:{maxHeartbeatLateMs,delayCount:delay.count,maxMs:delay.count?delay.max/1e6:null,p95Ms:delay.count?delay.percentile(95)/1e6:null},caveat:'Event-loop probe includes synchronous normalization and planner; benchmark itself intentionally holds raw and normalized snapshots. This is not a memory ceiling or production capacity guarantee.'},null,2));
}finally{clearInterval(timer);delay.disable();}
