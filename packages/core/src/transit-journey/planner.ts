import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import type { Candidate, Evidence, NumericMetric, DecisionInput } from '../intelligence/contracts.js';
import { evaluateDecision } from '../intelligence/decision.js';
import { checkConstraint } from '../intelligence/constraints.js';
import { timestamp } from '../intelligence/validation.js';
import { resolveCalendar, requiredServiceDates } from './calendar.js';
import { assertJourneyRequest, dense, record, invalid, text } from './validation.js';
import { JOURNEY_LIMITS, type CalendarResolution, type Journey, type JourneyResult, type ModelDay, type ModelTrip, type TimetableSource } from './contracts.js';

export async function planJourney(value:unknown,source:TimetableSource):Promise<JourneyResult>{
 const begin=performance.now();assertJourneyRequest(value);const r=value,ready=timestamp(r.readyAt)/1000,until=ready+(r.searchSeconds??7200),cap=r.maxCandidates??32;
 text(source.dataVersion);
 const order=source.catalog.orders[r.line];
 if(!order.includes(r.originId)||!order.includes(r.destinationId))invalid('Origin or destination is not a physical station on the requested line');
 const task='r2a:'+createHash('sha256').update(JSON.stringify([r.line,r.originId,r.destinationId,r.readyAt,until,r.calendar,source.dataVersion])).digest('hex');
 const input:DecisionInput={schemaVersion:1,context:{schemaVersion:1,requestId:r.requestId,taskId:task,domain:'transit',at:r.readyAt,decisionPermission:r.decisionPermission,objectives:[{metric:'arrivalEpochSeconds',direction:'min'}],constraints:r.constraints??[]},candidates:[]};
 const result:JourneyResult={schemaVersion:1,modelOnly:true,requestId:r.requestId,status:'no_feasible_option',reason:'no_modeled_journey_in_window',scope:{kind:'same_line_platform_to_platform',line:r.line,originId:r.originId,destinationId:r.destinationId,readyAt:r.readyAt,until:new Date(until*1000).toISOString()},candidates:[],journeys:[],decision:evaluateDecision(input),diagnostics:{serviceDates:[],calendars:[],matchedTrips:0,candidateTruncated:false,rejectedTrips:0,issues:[],complete:true,timingsMs:{source:0,extraction:0,decision:0,total:0}}};
 if(r.decisionPermission==='denied'){result.reason='decision_permission_denied';result.diagnostics.timingsMs.total=performance.now()-begin;return result;}
 for(const value of dense(source.evidence,6,1)){
  const e=record(value,['id','sourceId','kind','dataVersion','live'],['method','observedAt','retrievedAt','validUntil']);
  if(e.live!==false||e.dataVersion!==source.dataVersion)invalid('Source evidence must identify this non-live model version');
 }
 const selected:{candidate:Candidate;journey:Journey;bucket:number}[]=[];
 const issue=(code:string)=>{result.diagnostics.complete=false;if(result.diagnostics.issues.length<JOURNEY_LIMITS.issues)result.diagnostics.issues.push({code});};
 const dates=requiredServiceDates(ready,r.searchSeconds??7200);result.diagnostics.serviceDates=dates;
 for(const date of dates){
  const calendar=resolveCalendar(date,r.calendar);result.diagnostics.calendars.push(calendar);
  if(calendar.state==='unknown'||!calendar.dayType){issue('calendar_unknown');continue;}
  if(calendar.state==='estimated')issue('holidays_unverified_weekday_baseline');
  let day:ModelDay;const sourceBegin=performance.now();
  try{day=await source.getDay(r.line,date,calendar.dayType);}catch{result.diagnostics.timingsMs.source+=performance.now()-sourceBegin;issue('source_day_unavailable');continue;}
  result.diagnostics.timingsMs.source+=performance.now()-sourceBegin;
  if(day.line!==r.line||day.serviceDate!==date||day.dayType!==calendar.dayType||day.dataVersion!==source.dataVersion||day.trips.length>JOURNEY_LIMITS.tripsPerDay){issue('source_identity_or_capacity_mismatch');continue;}
  if(!day.complete){result.diagnostics.complete=false;result.diagnostics.rejectedTrips+=day.rejectedTrips;for(const x of day.issues)if(result.diagnostics.issues.length<JOURNEY_LIMITS.issues)result.diagnostics.issues.push(x);}
  const scanBegin=performance.now();let scanned=0;
  for(const trip of day.trips){
   if(++scanned%64===0)await yieldTurn();
   const origin=trip.stops.find(s=>s.stationId===r.originId),destination=trip.stops.find(s=>s.stationId===r.destinationId);
   if(!origin||!destination||origin.sequence>=destination.sequence||origin.depart<ready||destination.arrive<origin.depart||destination.arrive>until)continue;
   const mapped=mapJourney(trip,day,calendar,input,origin.sequence,destination.sequence,ready,source);
   const checks=(r.constraints??[]).map(c=>checkConstraint(mapped.candidate,c,r.readyAt));
   const bucket=checks.some(c=>c.status==='violated')?2:checks.some(c=>c.status==='undetermined')?1:0;
   result.diagnostics.matchedTrips++;
   selected.push({...mapped,bucket});selected.sort((a,b)=>a.bucket-b.bucket||a.journey.arrivalEpochSeconds-b.journey.arrivalEpochSeconds||(a.candidate.id<b.candidate.id?-1:a.candidate.id>b.candidate.id?1:0));
   if(selected.length>cap){const omitted=selected.pop()!;result.diagnostics.candidateTruncated=true;if(omitted.bucket!==2)result.diagnostics.complete=false;}
  }
  result.diagnostics.timingsMs.extraction+=performance.now()-scanBegin;
 }
 result.candidates=selected.map(s=>s.candidate);result.journeys=selected.map(s=>s.journey);input.candidates=result.candidates;
 const decisionBegin=performance.now();result.decision=evaluateDecision(input);result.diagnostics.timingsMs.decision=performance.now()-decisionBegin;
 result.status=result.decision.status;result.reason=result.decision.reason;
 if(!result.diagnostics.complete){result.status=result.decision.options.length?'partial':'insufficient_data';result.reason='incomplete_calendar_source_or_candidate_coverage';}
 result.diagnostics.timingsMs.total=performance.now()-begin;return result;
}
function mapJourney(trip:ModelTrip,day:ModelDay,calendar:CalendarResolution,input:DecisionInput,from:number,to:number,ready:number,source:TimetableSource):{candidate:Candidate;journey:Journey}{
 const origin=trip.stops[from]!,destination=trip.stops[to]!;
 const evidence:Evidence[]=[...source.evidence.map(e=>structuredClone(e)),{id:'adapter:journey-derivation',sourceId:'besrah:station-to-station-adapter',kind:'derived',dataVersion:'r2a-v1',live:false,method:'r2a-v1: durationSeconds=destination.arrive-readyAt; waitingSeconds=origin.depart-readyAt; inVehicleSeconds=destination.arrive-origin.depart; arrivalEpochSeconds=destination.arrive; no transfer within one validated trip'}, {id:'calendar:'+day.serviceDate,sourceId:calendar.sourceId,kind:'derived',dataVersion:calendar.dataVersion,live:false,method:'r2a-v1: explicit service-calendar policy or Gregorian weekday resolution'}];
 const assumptions=['Schedule model, not live train telemetry; no delay guarantee',`Timetable confidence: ${trip.confidence}`,`Service day: ${day.dayType}; calendar ${calendar.state}`];
 if(trip.derivedExtension)assumptions.push('Ghadir-airport extension uses derived run times');
 const estimate=(n:number,unit:'seconds'|'epoch_seconds'):NumericMetric=>({state:'estimated',unit,value:n,evidence,assumptions:[...assumptions]});
 const fromName=source.catalog.stations.find(s=>s.id===origin.stationId)!.name.replace(/\u200c/g,' '),toName=source.catalog.stations.find(s=>s.id===destination.stationId)!.name.replace(/\u200c/g,' ');
 const candidate:Candidate={schemaVersion:1,id:trip.id,providerId:'besrah:modeled-metro',domain:'transit',taskId:input.context.taskId,equivalenceKey:input.context.taskId,title:`${fromName} به ${toName}، خط ${trip.line}`,availability:'available',metrics:{arrivalEpochSeconds:estimate(destination.arrive,'epoch_seconds'),durationSeconds:estimate(destination.arrive-ready,'seconds'),totalCostToman:{state:'unknown',unit:'toman',reason:'No verified fare in the current model'},walkingSeconds:{state:'not_applicable',unit:'seconds',reason:'Platform-to-platform scope excludes external walking'},transfers:{state:'known',unit:'count',value:0,evidence}}};
 const journey:Journey={candidateId:candidate.id,tripId:trip.id,sourceTrainId:trip.sourceTrainId,serviceDate:trip.serviceDate,line:trip.line,service:trip.service,direction:trip.direction,confidence:trip.confidence,derivedExtension:trip.derivedExtension,sourceVersion:day.dataVersion,runQuality:day.runQuality,calendar,origin,destination,stops:trip.stops.slice(from,to+1),departureEpochSeconds:origin.depart,arrivalEpochSeconds:destination.arrive,metrics:{waitingSeconds:estimate(origin.depart-ready,'seconds'),inVehicleSeconds:estimate(destination.arrive-origin.depart,'seconds')},evidence};
 return {candidate,journey};
}
