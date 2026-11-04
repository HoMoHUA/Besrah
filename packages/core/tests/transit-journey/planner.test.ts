import { describe,expect,it } from 'vitest';
import { planJourney } from '../../src/transit-journey/planner.js';
import { request,source,epoch,trip,DAY } from './helpers.js';
describe('same-line platform journey planning',()=>{
 it.each([['10:01:00',1],['10:01:00.001',0],['10:02:00',0]])('uses departure-inclusive boarding boundary %s',async(clock,count)=>{
  const r=await planJourney(request({readyAt:DAY+'T'+clock+'+03:30'}),source());expect(r.journeys).toHaveLength(count as number);
 });
 it('does not board terminal arrivals as a new reverse departure',async()=>{
  const q=request({originId:'fixture:g',destinationId:'fixture:b'});
  expect((await planJourney(q,source())).status).toBe('no_feasible_option');
  const back=trip('fixture:back');back.direction='back';back.stops=[{sequence:0,stationId:'fixture:g',lineIndex:2,arrive:epoch('10:12:00'),depart:epoch('10:12:00')},{sequence:1,stationId:'fixture:b',lineIndex:1,arrive:epoch('10:16:00'),depart:epoch('10:17:00')},{sequence:2,stationId:'fixture:a',lineIndex:0,arrive:epoch('10:20:00'),depart:epoch('10:20:00')}];
  const r=await planJourney(q,source([trip(),back]));expect(r.journeys).toHaveLength(1);expect(r.journeys[0].sourceTrainId).toBe('fixture:back');expect(r.journeys[0].metrics.waitingSeconds).toMatchObject({value:720});
 });
 it('chooses earliest arrival, not earliest departure, and makes caps explicit',async()=>{
  const fast=trip('fixture:later-but-fast');fast.stops=fast.stops.map((s,i)=>i===1?{...s,depart:epoch('10:02:00')}:i===2?{...s,arrive:epoch('10:04:00')}:s);
  const r=await planJourney(request({maxCandidates:1}),source([trip(),fast]));expect(r.decision.options.map(o=>o.candidateId)).toEqual(['fixture:later-but-fast']);expect(r.diagnostics.candidateTruncated).toBe(true);expect(r.status).toBe('partial');
 });
 it('retains the earliest hard-eligible trip instead of filling a cap with violated options',async()=>{
  const fast=trip('fixture:fast');fast.stops=fast.stops.map((s,i)=>i===2?{...s,arrive:epoch('10:04:00')}:s);
  const r=await planJourney(request({maxCandidates:1,constraints:[{id:'minimum-duration',metric:'durationSeconds',operator:'gte',bound:300}]}),source([fast,trip()]));
  expect(r.decision.options.map(o=>o.candidateId)).toEqual(['fixture:trip']);
 });
 it('keeps fare unknown and respects cost or requireKnown constraints',async()=>{
  const cost=await planJourney(request({constraints:[{id:'budget',metric:'totalCostToman',operator:'lte',bound:500}]}),source());expect(cost.status).toBe('insufficient_data');expect(cost.decision.options).toEqual([]);
  const exact=await planJourney(request({constraints:[{id:'exact-arrival',metric:'arrivalEpochSeconds',operator:'lte',bound:epoch('11:00:00'),requireKnown:true}]}),source());expect(exact.status).toBe('insufficient_data');
 });
 it('does not query a source when decision permission is denied',async()=>{
  const s=source();s.getDay=async()=>{throw Error('source must not be called');};const r=await planJourney(request({decisionPermission:'denied'}),s);expect(r.reason).toBe('decision_permission_denied');expect(r.diagnostics.issues).toEqual([]);
 });
 it('marks a strict unknown calendar insufficient and an explicit weekday baseline partial',async()=>{
  const no=await planJourney(request({calendar:{mode:'strict'}}),source());expect(no.status).toBe('insufficient_data');expect(no.journeys).toEqual([]);
  const baseline=await planJourney(request({calendar:{mode:'weekday_baseline'}}),source());expect(baseline.status).toBe('partial');expect(baseline.journeys[0].calendar.state).toBe('estimated');
 });
 it.each(['fixture:missing','fixture:l2a'])('rejects invalid origin or wrong line membership %s',async originId=>{
  await expect(planJourney(request({originId}),source())).rejects.toThrow();
 });
 it('marks source failures or mismatches insufficient rather than claiming no service',async()=>{
  const s=source();s.getDay=async()=>{throw Error('synthetic source failure');};expect((await planJourney(request(),s)).status).toBe('insufficient_data');
  const wrong=source();const get=wrong.getDay;wrong.getDay=async(...args)=>({...await get(...args),line:2});expect((await planJourney(request(),wrong)).diagnostics.issues[0].code).toBe('source_identity_or_capacity_mismatch');
 });
 it('keeps valid journeys provisional when source rejected other trips',async()=>{
  const s=source(),get=s.getDay;s.getDay=async(...args)=>({...await get(...args),complete:false,rejectedTrips:1,issues:[{code:'invalid_trip'}]});const r=await planJourney(request(),s);expect(r.status).toBe('partial');expect(r.diagnostics.rejectedTrips).toBe(1);
 });
 it('separates previous service date from civil arrival date across midnight',async()=>{
  const t=trip('fixture:overnight','2026-11-01');t.stops=[{sequence:0,stationId:'fixture:a',lineIndex:0,arrive:epoch('23:50:00','2026-11-01'),depart:epoch('23:50:00','2026-11-01')},{sequence:1,stationId:'fixture:b',lineIndex:1,arrive:epoch('23:59:00','2026-11-01'),depart:epoch('00:02:00')},{sequence:2,stationId:'fixture:g',lineIndex:2,arrive:epoch('00:08:00'),depart:epoch('00:15:00')}];
  const q=request({readyAt:DAY+'T00:00:00+03:30',calendar:{mode:'strict',days:[{date:'2026-11-01',dayType:'normal',sourceId:'fixture:calendar',dataVersion:'v1'},{date:DAY,dayType:'normal',sourceId:'fixture:calendar',dataVersion:'v1'}]}});
  const r=await planJourney(q,source([t]));expect(r.status).toBe('ok');expect(r.journeys[0].serviceDate).toBe('2026-11-01');expect(r.journeys[0].arrivalEpochSeconds).toBe(epoch('00:08:00'));
  q.calendar.days!.pop();expect((await planJourney(q,source([t]))).status).toBe('partial');
 });

 it('rejects missing, oversized, live or version-mismatched source evidence',async()=>{
  const base=source();
  for(const evidence of [[],Array.from({length:7},(_,i)=>({...base.evidence[0],id:'fixture:'+i})),[{...base.evidence[0],live:true}],[{...base.evidence[0],dataVersion:'other'}]]){
   await expect(planJourney(request(),{...base,evidence})).rejects.toThrow();
  }
 });
 it('preserves source-provided lineage instead of attributing fixture times to the real model',async()=>{
  const s=source(),r=await planJourney(request(),s);
  const evidence=r.journeys[0].evidence;
  expect(evidence).toContainEqual(s.evidence[0]);
  expect(evidence.some(e=>e.sourceId.startsWith('besrah:metro-model'))).toBe(false);
  expect(evidence.find(e=>e.sourceId==='besrah:station-to-station-adapter')?.method).toContain('destination.arrive-readyAt');
 });
 it('does not turn exhaustively proven infeasibility into missing data by dropping violated records',async()=>{
  const r=await planJourney(request({maxCandidates:1,constraints:[{id:'zero-duration',metric:'durationSeconds',operator:'lte',bound:0}]}),source([trip('one'),trip('two')]));
  expect(r.diagnostics.matchedTrips).toBe(2);expect(r.diagnostics.candidateTruncated).toBe(true);
  expect(r.status).toBe('no_feasible_option');expect(r.diagnostics.complete).toBe(true);
 });
 it('boards a dwelling train through departure and stops duration at destination arrival',async()=>{
  const r=await planJourney(request(),source());
  expect(r.status).toBe('ok');expect(r.journeys).toHaveLength(1);
  expect(r.journeys[0].metrics.waitingSeconds).toMatchObject({state:'estimated',value:60});
  expect(r.journeys[0].metrics.inVehicleSeconds).toMatchObject({state:'estimated',value:240});
  expect(r.candidates[0].metrics.durationSeconds).toMatchObject({state:'estimated',value:300});
  expect(r.candidates[0].metrics.arrivalEpochSeconds).toMatchObject({state:'estimated',value:epoch('10:05:00')});
  expect(r.candidates[0].metrics.totalCostToman?.state).toBe('unknown');
  expect(r.decision.options[0].candidateId).toBe(r.journeys[0].candidateId);
 });
});
