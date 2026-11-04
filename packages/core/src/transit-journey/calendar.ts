import { dayTypeOf, tehranDay, tehranToEpoch } from '../time.js';
import { JOURNEY_LIMITS, type CalendarPolicy, type CalendarResolution } from './contracts.js';
import { assertCalendarPolicy, dateEpoch, integer, invalid } from './validation.js';
export function resolveCalendar(date:string,policy:CalendarPolicy):CalendarResolution{
 assertCalendarPolicy(policy);const at=dateEpoch(date),entry=policy.days?.find(e=>e.date===date);
 if(entry)return {date,state:'known',dayType:entry.dayType,sourceId:entry.sourceId,dataVersion:entry.dataVersion,reason:'explicit_service_calendar_declaration'};
 const weekday=dayTypeOf(at);
 if(weekday==='friday')return {date,state:'known',dayType:'friday',sourceId:'besrah:gregorian-weekday',dataVersion:'weekday-policy-v1',reason:'Friday and holiday schedule share the Friday model'};
 if(policy.mode==='weekday_baseline')return {date,state:'estimated',dayType:weekday,sourceId:'besrah:explicit-weekday-baseline',dataVersion:'weekday-baseline-unverified-holidays-v1',reason:'Caller explicitly requested weekday model; holidays are unverified'};
 return {date,state:'unknown',sourceId:'besrah:no-holiday-calendar',dataVersion:'strict-calendar-v1',reason:'No verified calendar or explicit service policy for this date'};
}
export function requiredServiceDates(ready:number,searchSeconds:number):string[]{
 integer(searchSeconds,1,JOURNEY_LIMITS.searchSeconds);if(!Number.isFinite(ready)||ready<0)invalid('Invalid request clock');
 const first=tehranDay(ready),midnight=tehranToEpoch(first,'00:00:00'),dates:string[]=[];
 if(ready-midnight<JOURNEY_LIMITS.tripSpanSeconds)dates.push(tehranDay(midnight-1));
 dates.push(first);const last=tehranDay(ready+searchSeconds);if(last!==first)dates.push(last);
 if(dates.length>JOURNEY_LIMITS.days)invalid('Too many service days');return dates;
}
