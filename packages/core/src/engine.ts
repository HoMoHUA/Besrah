import { Network, loadNetwork, normName } from './network.js';
import { DayType, dayTypeOf, tehranDay, tehranToEpoch } from './time.js';

/**
 * Model of line 1 timing.
 * Services: A = Vakilabad<->Ghadir shuttle; B = Vakilabad<->Airport through-service (via Ghadir, Bustan).
 * Only departures at Vakilabad are scheduled (headway + phase). Every other pass is computed
 * from run times, dwell and layovers. Back-trips start where the out-trip ends, after the layover.
 */

export type Service = 'A' | 'B';
export type Confidence = 'measured_phase' | 'official_sheet_phase' | 'site_headway_assumed_phase';

export interface Stop { idx: number; name: string; arrive: number; depart: number }
export interface Train {
  id: string;
  service: Service;
  direction: 'out' | 'back';           // out = toward Ghadir/Airport; back = toward Vakilabad
  start: number;                        // epoch s, departure from first stop
  stops: Stop[];
  confidence: Confidence;
  beyondGhadirIsDerived: boolean;      // true if the path includes the extension
}

export interface HeadwaySlot { from: string; to: string; A: number | null; B: number | null }
export interface DaySchedule {
  dayType: DayType;
  startA: number; startB: number;   // first Vakilabad departure allowed (s from midnight)
  /** Vakilabad departure phase per service, in seconds from Tehran midnight, and headway in seconds per service. */
  phaseA: number; phaseB: number;
  slots: Array<{ fromS: number; toS: number; headwayA: number | null; headwayB: number | null }>;
  confidenceA: Confidence;
  confidenceB: Confidence;
  /** departures from Vakilabad that are off the headway grid (seconds from midnight) */
  extra?: { A: number[]; B: number[] };
}

const hm = (s: string) => { const [h, m, sec = 0] = s.split(':').map(Number); return h * 3600 + m * 60 + sec; };
const min = (m: number) => m * 60;

/** Headways from the official site + B=30 min on normal days (A derived from main-route 1/10 = 1/A + 1/30). */
export function scheduleFor(dayType: DayType): DaySchedule {
  if (dayType === 'friday') {
    // anchors: A Vakilabad dep 13:59:51 every 24 min; B Vakilabad dep 14:12 every 24 min
    const end = hm('22:00');
    return {
      dayType, startA: hm('07:00'), startB: hm('06:30'), phaseA: hm('13:59:51'), phaseB: hm('14:12'),
      slots: [{ fromS: hm('06:00'), toS: end, headwayA: min(24), headwayB: min(24) }],
      confidenceA: 'measured_phase', confidenceB: 'measured_phase',
    };
  }
  const aPeak = (1 / (1 / 8 - 1 / 30)) * 60; // 1/A = 1/8 - 1/30  => A ≈ 10.9 min, in seconds
  if (dayType === 'thursday') {
    // B: sheet (Thursday from_ghadir 14:16/14:46 minus 40:43) and board (14:35) agree on :05:17 mod 30.
    // A: only one observed departure (14:25:06); headway from site, so low confidence.
    return {
      dayType, startA: hm('06:00'), startB: hm('06:30'), phaseA: hm('14:25:06'), phaseB: hm('14:05:17'),
      slots: [
        { fromS: hm('06:00'), toS: hm('15:30'), headwayA: min(15), headwayB: min(30) },
        { fromS: hm('15:30'), toS: hm('19:20'), headwayA: aPeak, headwayB: min(30) },
        { fromS: hm('19:20'), toS: hm('20:00'), headwayA: min(15), headwayB: min(30) },   // sheet: B runs to 19:35 from Vakilabad
        { fromS: hm('20:00'), toS: hm('22:00'), headwayA: min(10), headwayB: null },
      ],
      confidenceA: 'site_headway_assumed_phase', confidenceB: 'official_sheet_phase',
      extra: { A: [], B: [hm('06:00:17')] },   // sheet first train: Ghadir 06:41 -> Vakilabad 06:00:17 (off-grid)
    };
  }
  // normal days (Sat–Wed): phase is NOT measured; uses site headways.
  return {
    dayType, startA: hm('06:00'), startB: hm('06:30'), phaseA: hm('06:00'), phaseB: hm('06:30'),
    slots: [
      { fromS: hm('06:00'), toS: hm('15:30'), headwayA: min(15), headwayB: min(30) },
      { fromS: hm('15:30'), toS: hm('19:20'), headwayA: aPeak, headwayB: min(30) },
      { fromS: hm('19:20'), toS: hm('19:30'), headwayA: min(15), headwayB: min(30) },
      { fromS: hm('19:30'), toS: hm('22:00'), headwayA: min(10), headwayB: null },
    ],
    confidenceA: 'site_headway_assumed_phase', confidenceB: 'site_headway_assumed_phase',
  };
}

/** Vakilabad departures for one service: phase grid walked forward through the slots, no restart at slot edges. */
export function vakilabadDepartures(day: string, sched: DaySchedule, service: Service): number[] {
  const phase = service === 'A' ? sched.phaseA : sched.phaseB;
  const start = service === 'A' ? sched.startA : sched.startB;
  const slotAt = (t: number) => sched.slots.find(sl => t >= sl.fromS && t < sl.toS);
  const hw = (t: number) => { const sl = slotAt(t); return sl ? (service === 'A' ? sl.headwayA : sl.headwayB) : null; };
  // walk the phase grid back to the first allowed departure
  let t = phase;
  const h0 = hw(phase) ?? hw(start) ?? 0;
  while (t - h0 >= start) t -= h0;
  while (t < start) t += h0;
  const out: number[] = [];
  const extra = service === 'A' ? sched.extra?.A ?? [] : sched.extra?.B ?? [];
  for (const x of extra) out.push(tehranToEpoch(day, secToHms(x)));
  while (t < sched.slots[sched.slots.length - 1].toS) {
    const h = hw(t);
    if (h == null) { // no service in this slot: jump to next slot start
      const next = sched.slots.find(sl => sl.fromS > t);
      if (!next) break;
      t = next.fromS;
      continue;
    }
    if (t >= start) out.push(tehranToEpoch(day, secToHms(t)));
    t += h;
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function secToHms(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return [h, m, sec].map(x => String(x).padStart(2, '0')).join(':');
}

export function buildOutTrip(net: Network, service: Service, start: number, id: string): Train {
  const last = service === 'A' ? net.GH : net.AIR;
  const stops: Stop[] = [{ idx: 0, name: net.stationsOrder[0], arrive: start, depart: start }];
  let t = start;
  for (let j = 1; j <= last; j++) {
    t += net.runF[j - 1];
    const arrive = t;
    let depart = arrive;
    if (j === last) {
      depart = arrive + (service === 'A' ? net.layover.ghadirA : net.layover.airport);
    } else if (service === 'B' && j === net.GH) {
      depart = arrive + net.layover.ghadirPassB;
    } else {
      depart = arrive + net.dwell[j];
    }
    stops.push({ idx: j, name: net.stationsOrder[j], arrive, depart });
    t = depart;
  }
  return {
    id, service, direction: 'out', start, stops,
    confidence: 'measured_phase', // overridden by caller
    beyondGhadirIsDerived: service === 'B',
  };
}

export function buildBackTrip(net: Network, service: Service, start: number, id: string): Train {
  const first = service === 'A' ? net.GH : net.AIR;
  const stops: Stop[] = [];
  let t = start;
  stops.push({ idx: first, name: net.stationsOrder[first], arrive: start, depart: start });
  for (let k = first - 1; k >= 0; k--) {
    t += net.runB[k];
    const arrive = t;
    let depart = arrive;
    if (k === 0) depart = arrive; // terminal, layover handled by the Vakilabad schedule
    else if (k === net.GH && service === 'B') depart = arrive + net.layover.ghadirPassB;
    else depart = arrive + net.dwell[k];
    stops.push({ idx: k, name: net.stationsOrder[k], arrive, depart });
    t = depart;
  }
  return {
    id, service, direction: 'back', start, stops,
    confidence: 'measured_phase', beyondGhadirIsDerived: service === 'B',
  };
}

/** All trains for one Tehran day, with back-trips derived from out-trips. */
export function dayTrains(net: Network, dayEpoch: number, dayType?: DayType): Train[] {
  const day = tehranDay(dayEpoch);
  const type = dayType ?? dayTypeOf(dayEpoch);
  const sched = scheduleFor(type);
  const trains: Train[] = [];
  for (const svc of ['A', 'B'] as const) {
    const deps = vakilabadDepartures(day, sched, svc);
    deps.forEach((d, i) => {
      const conf = svc === 'A' ? sched.confidenceA : sched.confidenceB;
      const out = buildOutTrip(net, svc, d, `${svc}-out-${i}`);
      out.confidence = conf;
      trains.push(out);
      const endStop = out.stops[out.stops.length - 1];
      // back-trip from the terminal (Ghadir for A, Airport for B)
      const back = buildBackTrip(net, svc, endStop.depart, `${svc}-back-${i}`);
      back.confidence = conf;
      trains.push(back);
    });
  }
  return trains.sort((a, b) => a.start - b.start);
}

export interface Pass {
  trainId: string;
  service: Service;
  direction: 'out' | 'back';
  arrive: number;
  depart: number;
  etaSeconds: number;
  confidence: Confidence;
  beyondGhadirIsDerived: boolean;
  terminalArrival: boolean;   // the train ends its trip at this stop
}

/** Next passes through a station after `at` (epoch s). */
export function nextPasses(net: Network, trains: Train[], stationName: string, at: number, limit = 6): Pass[] {
  const idx = net.stationsOrder.findIndex(n => normName(n) === normName(stationName));
  if (idx < 0) throw new Error(`unknown station ${stationName}`);
  const passes: Pass[] = [];
  for (const tr of trains) {
    const stop = tr.stops.find(s => s.idx === idx);
    if (!stop) continue;
    if (stop.arrive < at) continue;
    passes.push({
      trainId: tr.id, service: tr.service, direction: tr.direction,
      arrive: stop.arrive, depart: stop.depart,
      etaSeconds: Math.round(stop.arrive - at),
      confidence: tr.confidence,
      beyondGhadirIsDerived: tr.beyondGhadirIsDerived && idx >= net.GH,
      terminalArrival: tr.stops[tr.stops.length - 1] === stop,
    });
  }
  return passes.sort((a, b) => a.arrive - b.arrive).slice(0, limit);
}

export { loadNetwork };
