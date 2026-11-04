import { InputError, assertDecisionInput, timestamp } from '../intelligence/validation.js';
import { JOURNEY_LIMITS, type CalendarPolicy, type JourneyRequest } from './contracts.js';
import { dayTypeOf, tehranDay, tehranToEpoch, epochToTehranHms } from '../time.js';
export const invalid=(message:string):never=>{throw new InputError(message);};
export function record(v:unknown, required:string[], optional:string[]=[]):Record<string,unknown>{
 if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))return invalid('Expected plain data object');
 const descriptors=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(v);
 if(keys.some(k=>typeof k!=='string'||!descriptors[k].enumerable||!Object.hasOwn(descriptors[k],'value')||![...required,...optional].includes(k))||required.some(k=>!Object.hasOwn(v,k)))return invalid('Unknown, hidden, missing or accessor fields');
 return v as Record<string,unknown>;
}
export function dense(v:unknown,max:number,min=0):unknown[]{
 if(!Array.isArray(v)||v.length<min||v.length>max||Reflect.ownKeys(v).length!==v.length+1)return invalid('Invalid bounded dense array');
 for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,i);if(!d||!d.enumerable||!Object.hasOwn(d,'value'))return invalid('Array indices must be data');}
 return v;
}
export function text(v:unknown,max=128):string{if(typeof v!=='string'||!v.trim()||v.length>max)return invalid('Invalid bounded identifier');return v;}
export function integer(v:unknown,min:number,max:number):number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)return invalid('Invalid bounded integer');return v;}
export function dateEpoch(v:unknown):number{
 const s=text(v,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return invalid('Expected YYYY-MM-DD service date');
 const epoch=timestamp(s+'T00:00:00+03:30')/1000;
 if(epoch<0||tehranDay(epoch)!==s)return invalid('Unsupported calendar day for existing model');return epoch;
}
export function assertCalendarPolicy(value:unknown):asserts value is CalendarPolicy{
 const p=record(value,['mode'],['days']);if(p.mode!=='strict'&&p.mode!=='weekday_baseline')invalid('Unsupported calendar policy');
 const seen=new Set<string>();
 for(const entry of dense(p.days??[],JOURNEY_LIMITS.days)){
  const e=record(entry,['date','dayType','sourceId','dataVersion']);const date=text(e.date,10),epoch=dateEpoch(date);
  if(seen.has(date))invalid('Duplicate calendar date');seen.add(date);text(e.sourceId);text(e.dataVersion);
  if(!['normal','thursday','friday'].includes(e.dayType as string))invalid('Unsupported service day type');
  if(e.dayType!=='friday'&&e.dayType!==dayTypeOf(epoch))invalid('Calendar declaration contradicts weekday; only holiday Friday override supported');
 }
}
export function assertJourneyRequest(value:unknown):asserts value is JourneyRequest{
 const r=record(value,['schemaVersion','requestId','line','originId','destinationId','readyAt','calendar','decisionPermission'],['searchSeconds','maxCandidates','constraints']);
 if(r.schemaVersion!==1||(r.line!==1&&r.line!==2))invalid('Unsupported request schema or line');
 text(r.requestId);text(r.originId);text(r.destinationId);const at=timestamp(r.readyAt)/1000;
 if(at<0||tehranToEpoch(tehranDay(at),epochToTehranHms(at))!==Math.floor(at))invalid('Clock outside fixed-offset timetable model');
 if(r.originId===r.destinationId)invalid('Origin and destination must differ');assertCalendarPolicy(r.calendar);
 if(r.searchSeconds!==undefined)integer(r.searchSeconds,1,JOURNEY_LIMITS.searchSeconds);
 if(r.maxCandidates!==undefined)integer(r.maxCandidates,1,JOURNEY_LIMITS.candidates);
 assertDecisionInput({schemaVersion:1,context:{schemaVersion:1,requestId:r.requestId,taskId:'transit:r2a',domain:'transit',at:r.readyAt,decisionPermission:r.decisionPermission,objectives:[{metric:'arrivalEpochSeconds',direction:'min'}],constraints:r.constraints??[]},candidates:[]});
}
