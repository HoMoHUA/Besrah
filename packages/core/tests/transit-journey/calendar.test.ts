import { describe, expect, it } from 'vitest';
import { resolveCalendar, requiredServiceDates } from '../../src/transit-journey/calendar.js';
import { assertJourneyRequest } from '../../src/transit-journey/validation.js';
const base=()=>({schemaVersion:1,requestId:'fixture:r',line:1,originId:'fixture:a',destinationId:'fixture:b',readyAt:'2026-11-02T12:00:00+03:30',calendar:{mode:'strict'},decisionPermission:'granted'});
describe('explicit calendar and request policy',()=>{
 it('does not silently classify a possible holiday as a normal service day',()=>{
  expect(resolveCalendar('2026-11-02',{mode:'strict'}).state).toBe('unknown');
  expect(resolveCalendar('2026-11-06',{mode:'strict'})).toMatchObject({state:'known',dayType:'friday'});
  expect(resolveCalendar('2026-11-05',{mode:'weekday_baseline'})).toMatchObject({state:'estimated',dayType:'thursday'});
 });
 it('uses traceable explicit service calendar and permits a holiday Friday schedule',()=>{
  expect(resolveCalendar('2026-11-02',{mode:'strict',days:[{date:'2026-11-02',dayType:'friday',sourceId:'fixture:holiday-policy',dataVersion:'v1'}]})).toMatchObject({state:'known',dayType:'friday',sourceId:'fixture:holiday-policy'});
 });
 it('includes previous service spill and next civil day only when relevant',()=>{
  expect(requiredServiceDates(Date.parse('2026-11-02T00:10:00+03:30')/1000,3600)).toEqual(['2026-11-01','2026-11-02']);
  expect(requiredServiceDates(Date.parse('2026-11-02T23:30:00+03:30')/1000,3600)).toEqual(['2026-11-02','2026-11-03']);
  expect(requiredServiceDates(Date.parse('2026-11-02T12:00:00+03:30')/1000,3600)).toEqual(['2026-11-02']);
 });
 it.each([
  (v:any)=>v.readyAt='2026-11-02T12:00:00',
  (v:any)=>v.readyAt='2026-02-30T12:00:00+03:30',
  (v:any)=>v.searchSeconds=21601,
  (v:any)=>v.maxCandidates=65,
  (v:any)=>v.calendar.days=[{date:'2026-11-02',dayType:'thursday',sourceId:'fixture:wrong',dataVersion:'v1'}],
  (v:any)=>v.calendar.days=Array(1),
  (v:any)=>Object.defineProperty(v,'readyAt',{get(){throw Error('getter must not run')}}),
 ])('rejects malformed or unbounded request %#',mutate=>{const v=base();mutate(v);expect(()=>assertJourneyRequest(v)).toThrow();});
});
