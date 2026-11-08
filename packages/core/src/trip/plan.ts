// Door-to-door trip planner between two real points. Pure given its dependencies (router, metro planner, station geometry).
// Rules: a leg is `routed` (a router measured it), `model` (the metro timetable model) or `assumption` (a fixed, disclosed constant).
// A leg nobody measured stays `unknown`; straight-line distance is never presented as a duration or an ETA.
import { epochToTehranHms, tehranDay } from '../time.js';
import { RouterError, type LatLon, type RouteLeg, type Router } from './neshan.js';

export const ACCESS_S = 180;   // station entrance to platform, assumption
export const EGRESS_S = 120;   // platform to station exit, assumption
export const MAX_STATION_WALK_M = 6000;
export const NEAREST_PER_SIDE = 3;
export const MAX_PAIRS = 4;
export const WALK_DIRECT_MAX_M = 3500;

export interface StationGeo { id: string; name: string; lat: number; lon: number; lines: readonly (1 | 2)[] }
export interface MetroOption { departEpoch: number; arriveEpoch: number; service: 'A' | 'B' | null; toward: string; confidence: string; eventId: string | null; derivedExtension: boolean }
export interface MetroAnswer { status: string; message: string; options: readonly MetroOption[]; calendarWarning: boolean }
export type MetroPlanner = (line: 1 | 2, originId: string, destinationId: string, readyEpoch: number) => Promise<MetroAnswer>;

export type Leg =
  | { type: 'walk'; from: string; to: string; durationS: number | null; distanceM: number | null; basis: 'routed' | 'unknown'; straightLineM: number }
  | { type: 'station_access' | 'station_egress'; durationS: number; basis: 'assumption' }
  | { type: 'metro'; line: 1 | 2; service: 'A' | 'B' | null; toward: string; from: string; to: string; departAt: string; arriveAt: string; durationS: number; basis: 'model'; confidence: string; eventId: string | null }
  | { type: 'car'; durationS: number; distanceM: number; basis: 'routed'; traffic: 'provider_traffic' };

export interface TripOption {
  id: string; kind: 'metro' | 'car' | 'walk'; title: string;
  leaveAt: string | null; leaveEpoch: number | null; arriveAt: string | null; arriveEpoch: number | null; totalS: number | null;
  legs: Leg[];
  /** Why this option is on screen: the earliest arrival, or a whole-trip alternative (another mode, another boarding station). */
  choice?: 'earliest' | 'other_mode' | 'other_station';
  ifMissed: { departAt: string; arriveAt: string | null } | null; notes: string[];
  /** Metro option without a routed walk: only the platform times are known, never the arrival. */
  platformDepartures?: Array<{ departAt: string; arriveAtStation: string }>;
}
export interface TripResult {
  schemaVersion: 1; status: 'ok' | 'partial' | 'unavailable'; reason: string; readyAt: string; readyEpoch: number;
  origin: LatLon; destination: LatLon; options: TripOption[];
  assumptions: { stationAccessS: number; stationEgressS: number; note: string };
  routing: { provider: 'neshan' | null; walk: 'routed' | 'unavailable'; car: 'routed' | 'unavailable'; trafficLabel: string };
  disclaimers: string[];
}

export const hhmm = (epoch: number): string => epochToTehranHms(epoch).slice(0, 5);
export function haversineM(a: LatLon, b: LatLon): number {
  const R = 6371008.8, rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const DISCLAIMERS = [
  'زمان مترو از مدل برنامهٔ قطار می آید، نه موقعیت زنده؛ پیاده روی و خودرو را سرویس مسیریابی اندازه گرفته است.',
  'ورود از در ایستگاه تا سکو و خروج از آن، دو زمان فرضی و ثابت اند و در جزئیات با برچسب «فرض» آمده اند.',
  'هزینه، موجودی خودرو و زمان رسیدن اتوبوس یا تاکسی در این نتیجه نیست.',
];

interface Pair { o: StationGeo; d: StationGeo; line: 1 | 2; straight: number }
interface Candidate { option: TripOption; arrive: number; pairKey: string }

export interface TripDeps { stations: readonly StationGeo[]; router: Router; metro: MetroPlanner | null; nowSec: number; /** The user's own limit for each walking leg to/from a station, in seconds (a stated preference, never inferred). */ maxWalkS?: number }

function shortlist(origin: LatLon, destination: LatLon, stations: readonly StationGeo[]): Pair[] {
  const near = (p: LatLon) => stations.map(s => ({ s, m: haversineM(p, s) })).filter(x => x.m <= MAX_STATION_WALK_M).sort((a, b) => a.m - b.m).slice(0, NEAREST_PER_SIDE);
  const O = near(origin), D = near(destination), pairs: Pair[] = [];
  for (const o of O) for (const d of D) {
    if (o.s.id === d.s.id) continue;
    for (const line of o.s.lines) if (d.s.lines.includes(line)) pairs.push({ o: o.s, d: d.s, line, straight: o.m + d.m });
  }
  return pairs.sort((a, b) => a.straight - b.straight).slice(0, MAX_PAIRS);
}

async function leg(router: Router, mode: 'pedestrian' | 'car', a: LatLon, b: LatLon): Promise<RouteLeg | null> {
  try { return await router.route(mode, a, b); } catch (error) { if (error instanceof RouterError || error instanceof Error) return null; return null; }
}

export async function planTrip(origin: LatLon, destination: LatLon, readyEpoch: number, deps: TripDeps): Promise<TripResult> {
  const { router, stations } = deps;
  const direct = haversineM(origin, destination);
  const pairs = deps.metro && direct > 900 ? shortlist(origin, destination, stations) : [];

  // Walk legs are measured once per distinct station (cached by the router as well).
  const walkTo = new Map<string, Promise<RouteLeg | null>>(), walkFrom = new Map<string, Promise<RouteLeg | null>>();
  for (const p of pairs) {
    if (!walkTo.has(p.o.id)) walkTo.set(p.o.id, router.configured ? leg(router, 'pedestrian', origin, p.o) : Promise.resolve(null));
    if (!walkFrom.has(p.d.id)) walkFrom.set(p.d.id, router.configured ? leg(router, 'pedestrian', p.d, destination) : Promise.resolve(null));
  }
  const carP = router.configured && direct > 700 ? leg(router, 'car', origin, destination) : Promise.resolve(null);
  const walkDirectP = router.configured && direct <= WALK_DIRECT_MAX_M ? leg(router, 'pedestrian', origin, destination) : Promise.resolve(null);

  const candidates: Candidate[] = [];
  const unrouted: TripOption[] = [];
  let metroProblem: string | null = null, excludedByWalk = 0;
  await Promise.all(pairs.map(async p => {
    const wa = await walkTo.get(p.o.id)!, wb = await walkFrom.get(p.d.id)!;
    const walkA = wa?.durationS ?? null, walkB = wb?.durationS ?? null;
    if (deps.maxWalkS && ((walkA ?? 0) > deps.maxWalkS || (walkB ?? 0) > deps.maxWalkS)) { excludedByWalk++; return; }
    const ready = walkA === null ? readyEpoch : readyEpoch + walkA + ACCESS_S;
    let answer: MetroAnswer;
    try { answer = await deps.metro!(p.line, p.o.id, p.d.id, ready); } catch { metroProblem = 'metro_unavailable'; return; }
    if (!answer.options.length) { metroProblem ??= answer.status; return; }
    const first = (x: LatLon, s: StationGeo, to: boolean, w: RouteLeg | null): Leg => to
      ? { type: 'walk', from: 'مبدأ', to: `ایستگاه ${s.name}`, durationS: w?.durationS ?? null, distanceM: w?.distanceM ?? null, basis: w ? 'routed' : 'unknown', straightLineM: Math.round(haversineM(x, s)) }
      : { type: 'walk', from: `ایستگاه ${s.name}`, to: 'مقصد', durationS: w?.durationS ?? null, distanceM: w?.distanceM ?? null, basis: w ? 'routed' : 'unknown', straightLineM: Math.round(haversineM(s, x)) };
    if (walkA === null || walkB === null) {
      // No measured walk: show only what the timetable model knows, with no arrival time.
      unrouted.push({ id: `m:${p.o.id}:${p.d.id}:${p.line}`, kind: 'metro', title: `مترو از ${p.o.name} به ${p.d.name}`, leaveAt: null, leaveEpoch: null, arriveAt: null, arriveEpoch: null, totalS: null,
        legs: [first(origin, p.o, true, wa), { type: 'metro', line: p.line, service: answer.options[0]!.service, toward: answer.options[0]!.toward, from: p.o.name, to: p.d.name, departAt: hhmm(answer.options[0]!.departEpoch), arriveAt: hhmm(answer.options[0]!.arriveEpoch), durationS: Math.round(answer.options[0]!.arriveEpoch - answer.options[0]!.departEpoch), basis: 'model', confidence: answer.options[0]!.confidence, eventId: answer.options[0]!.eventId }, first(destination, p.d, false, wb)],
        ifMissed: null, notes: ['زمان پیاده روی تا ایستگاه اندازه گیری نشده است؛ زمان رسیدن به مقصد نامعلوم است.'],
        platformDepartures: answer.options.slice(0, 3).map(o => ({ departAt: hhmm(o.departEpoch), arriveAtStation: hhmm(o.arriveEpoch) })) });
      return;
    }
    const sorted = [...answer.options].sort((a, b) => a.arriveEpoch - b.arriveEpoch || a.departEpoch - b.departEpoch);
    const best = sorted[0]!;
    const leaveEpoch = Math.max(readyEpoch, best.departEpoch - ACCESS_S - walkA);
    const arrive = best.arriveEpoch + EGRESS_S + walkB;
    const later = [...answer.options].filter(o => o.departEpoch > best.departEpoch).sort((a, b) => a.departEpoch - b.departEpoch)[0];
    const notes: string[] = [];
    if (answer.calendarWarning) notes.push('برنامهٔ این روز در مدل تخمینی است و تعطیلی رسمی بررسی نشده.');
    if (best.derivedExtension) notes.push('بخشی از زمان این قطار از برآورد مدل می آید.');
    candidates.push({ pairKey: `${p.o.id}>${p.d.id}`, arrive, option: {
      id: `m:${p.o.id}:${p.d.id}:${p.line}:${best.eventId ?? best.departEpoch}`, kind: 'metro', title: `مترو از ${p.o.name} به ${p.d.name}`,
      leaveAt: hhmm(leaveEpoch), leaveEpoch, arriveAt: hhmm(arrive), arriveEpoch: arrive, totalS: arrive - leaveEpoch,
      legs: [first(origin, p.o, true, wa), { type: 'station_access', durationS: ACCESS_S, basis: 'assumption' },
        { type: 'metro', line: p.line, service: best.service, toward: best.toward, from: p.o.name, to: p.d.name, departAt: hhmm(best.departEpoch), arriveAt: hhmm(best.arriveEpoch), durationS: Math.round(best.arriveEpoch - best.departEpoch), basis: 'model', confidence: best.confidence, eventId: best.eventId },
        { type: 'station_egress', durationS: EGRESS_S, basis: 'assumption' }, first(destination, p.d, false, wb)],
      ifMissed: later ? { departAt: hhmm(later.departEpoch), arriveAt: hhmm(later.arriveEpoch + EGRESS_S + walkB) } : null, notes } });
  }));

  const car = await carP, walkDirect = await walkDirectP;
  const others: Candidate[] = [];
  if (car) others.push({ pairKey: 'car', arrive: readyEpoch + car.durationS, option: { id: 'car', kind: 'car', title: 'با خودرو', leaveAt: hhmm(readyEpoch), leaveEpoch: readyEpoch, arriveAt: hhmm(readyEpoch + car.durationS), arriveEpoch: readyEpoch + car.durationS, totalS: car.durationS,
    legs: [{ type: 'car', durationS: car.durationS, distanceM: car.distanceM, basis: 'routed', traffic: 'provider_traffic' }], ifMissed: null,
    notes: ['زمان را مسیریاب با داده ترافیک خود اعلام کرده است؛ زنده بودن آن تضمین نمی شود. پارک و هزینه در آن نیست.'] } });
  if (walkDirect && walkDirect.durationS <= 40 * 60) others.push({ pairKey: 'walk', arrive: readyEpoch + walkDirect.durationS, option: { id: 'walk', kind: 'walk', title: 'پیاده', leaveAt: hhmm(readyEpoch), leaveEpoch: readyEpoch, arriveAt: hhmm(readyEpoch + walkDirect.durationS), arriveEpoch: readyEpoch + walkDirect.durationS, totalS: walkDirect.durationS,
    legs: [{ type: 'walk', from: 'مبدأ', to: 'مقصد', durationS: walkDirect.durationS, distanceM: walkDirect.distanceM, basis: 'routed', straightLineM: Math.round(direct) }], ifMissed: null, notes: [] } });

  const options = pickDistinct([...candidates, ...others]);
  const metroOptions = options.filter(o => o.kind === 'metro').length;
  let chosen = options;
  let status: TripResult['status'] = 'ok', reason = 'ok';
  if (!chosen.length && unrouted.length) {
    const rank = new Map(pairs.map((p, i) => [`m:${p.o.id}:${p.d.id}:${p.line}`, i]));
    chosen = distinctUnrouted([...unrouted].sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99))); status = 'partial'; reason = router.configured ? 'walk_legs_unavailable' : 'router_not_configured';
  } else if (!chosen.length && excludedByWalk) {
    status = 'unavailable'; reason = 'walk_limit_excluded_all';
  } else if (!chosen.length) {
    status = 'unavailable'; reason = metroProblem ?? (pairs.length ? 'no_candidate' : 'no_supported_option');
  } else if (pairs.length && !metroOptions && excludedByWalk && !metroProblem) { status = 'partial'; reason = 'walk_limit_excluded_metro'; }
  else if (pairs.length && !metroOptions && metroProblem) { status = 'partial'; reason = 'metro_unavailable_for_this_trip'; }
  if (!router.configured && status === 'ok') status = 'partial';

  return { schemaVersion: 1, status, reason, readyAt: `${tehranDay(readyEpoch)} ${hhmm(readyEpoch)}`, readyEpoch, origin, destination, options: chosen,
    assumptions: { stationAccessS: ACCESS_S, stationEgressS: EGRESS_S, note: 'ورود به سکو و خروج از ایستگاه فرض ثابت اند، اندازه گیری نشده اند.' },
    routing: { provider: router.configured ? 'neshan' : null, walk: router.configured ? 'routed' : 'unavailable', car: car ? 'routed' : 'unavailable', trafficLabel: 'ترافیک را مسیریاب برای خودرو لحاظ می کند؛ برای مترو و پیاده بی اثر است.' },
    disclaimers: DISCLAIMERS };
}

/** At most two options, different as whole trips: the earliest arrival, then the best of a different mode, else a different boarding station. */
export function pickDistinct(all: Candidate[]): TripOption[] {
  const sorted = [...all].sort((a, b) => a.arrive - b.arrive || a.option.id.localeCompare(b.option.id));
  const first = sorted[0];
  if (!first) return [];
  const second = sorted.find(c => c !== first && c.option.kind !== first.option.kind)
    ?? sorted.find(c => c !== first && c.option.kind === 'metro' && boarding(c) !== boarding(first) && c.arrive - first.arrive <= 20 * 60);
  const label = (o: TripOption, choice: NonNullable<TripOption['choice']>): TripOption => ({ ...o, choice });
  return [label(first.option, 'earliest'), ...(second ? [label(second.option, second.option.kind !== first.option.kind ? 'other_mode' : 'other_station')] : [])];
}
/** Without measured walks the cards differ only by stations: keep a second card only if it boards elsewhere, so the same
 *  train from the same platform is never shown twice. `unrouted` arrives in shortlist order (shortest straight-line first). */
export function distinctUnrouted(unrouted: readonly TripOption[]): TripOption[] {
  const board = (o: TripOption) => { const m = o.legs.find(l => l.type === 'metro'); return m && m.type === 'metro' ? `${m.line}:${m.from}` : o.id; };
  const out: TripOption[] = [];
  for (const o of unrouted) if (!out.some(x => board(x) === board(o))) out.push(o);
  return out.slice(0, 2);
}
const boarding = (c: Candidate): string => c.pairKey.split('>')[0] ?? '';
