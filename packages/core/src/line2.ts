import { readFileSync } from 'node:fs';
import { NETWORK_PATH, normName } from './network.js';
import { DayType, tehranDay, tehranToEpoch } from './time.js';

/**
 * Model of line 2 (Tabarsi <-> Shahid Fakouri), a single through-service without branches.
 * Timing is built from three kinds of data, all tagged in data/network.json:
 *  - headway: owner decision 10 min Sat-Wed (headway_conflict.owner_decision); Thursday and Friday use the official site (12 min);
 *  - run times: measured 2026-10-16 for Shariati..Fakouri, legacy estimates for Tabarsi..Shariati;
 *  - phase: NOT measured. Both terminals are assumed to depart on the same grid starting at the first service time.
 * So every line 2 pass is `site_headway_assumed_phase`: the interval between trains is meaningful, the exact minute is not.
 */

export interface Line2Network {
  order: string[];                // Tabarsi -> Fakouri, 13 names
  runF: number[];                 // runF[i]: seconds station i -> i+1
  runB: number[];                 // runB[i]: seconds station i+1 -> i
  runQuality: string[];
  dwell: number[];                // dwell at station i (seconds); terminals are not used
  hours: { weekdays: { from: string; to: string }; friday: { from: string; to: string } };
  headwayMin: { normal: number; thursday: number; friday: number };
}

export interface Line2Stop { idx: number; name: string; arrive: number; depart: number }
export interface Line2Train { id: string; direction: 'out' | 'back'; start: number; stops: Line2Stop[] }
export interface Line2Pass {
  trainId: string;
  direction: 'out' | 'back';      // out = toward Fakouri, back = toward Tabarsi
  arrive: number;
  depart: number;
  etaSeconds: number;
  terminalArrival: boolean;
}
export interface Line2Schedule { startS: number; endS: number; headwayS: number }

const DEFAULT_DWELL_S = 20;       // no measurement at most stations; same default as line 1
const hm = (s: string) => { const [h, m, sec = 0] = s.split(':').map(Number); return h * 3600 + m * 60 + sec; };

export function loadLine2(path: URL | string = NETWORK_PATH): Line2Network {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const line = raw.lines['2'];
  const order: string[] = line.order_tabarsi_to_fakouri;
  const segments: any[] = line.segments;
  if (segments.length !== order.length - 1) throw new Error('line 2: one segment per station pair expected');
  segments.forEach((s, i) => {
    if (normName(s.from) !== normName(order[i]) || normName(s.to) !== normName(order[i + 1])) {
      throw new Error(`line 2: segment ${i} (${s.from} -> ${s.to}) does not follow the station order`);
    }
  });

  const runF: number[] = [], runB: number[] = [], runQuality: string[] = [];
  for (const s of segments) {
    const f: number = s.run_s_forward ?? s.legacy_estimate_s;
    const b: number = s.run_s_backward ?? f;
    if (!(f > 0) || !(b > 0)) throw new Error('line 2: missing run time');
    runF.push(f);
    runB.push(b);
    runQuality.push(s.run_s_forward != null ? String(s.quality) : 'legacy_estimate');
  }

  const dwell = order.map(name => {
    const hit = Object.entries(line.dwell ?? {}).find(([k]) => normName(k) === normName(name));
    return hit ? (hit[1] as any).median_s as number : DEFAULT_DWELL_S;
  });

  const site = line.official_site.schedules;
  const decision = line.headway_conflict?.owner_decision?.headway_min as number | undefined;
  const siteMin = (day: 'weekdays' | 'fridays_and_holidays') => site[day].slots[0].headway_min as number;
  return {
    order, runF, runB, runQuality, dwell,
    hours: {
      weekdays: { from: site.weekdays.slots[0].from, to: site.weekdays.slots.at(-1).to },
      friday: { from: site.fridays_and_holidays.slots[0].from, to: site.fridays_and_holidays.slots.at(-1).to },
    },
    headwayMin: { normal: decision ?? siteMin('weekdays'), thursday: siteMin('weekdays'), friday: siteMin('fridays_and_holidays') },
  };
}

export function line2Schedule(net: Line2Network, dayType: DayType): Line2Schedule {
  const hours = dayType === 'friday' ? net.hours.friday : net.hours.weekdays;
  return { startS: hm(hours.from), endS: hm(hours.to), headwayS: net.headwayMin[dayType] * 60 };
}

function buildOut(net: Line2Network, start: number, id: string): Line2Train {
  const last = net.order.length - 1;
  const stops: Line2Stop[] = [{ idx: 0, name: net.order[0], arrive: start, depart: start }];
  let t = start;
  for (let k = 1; k <= last; k++) {
    const arrive = t + net.runF[k - 1];
    const depart = k === last ? arrive : arrive + net.dwell[k];
    stops.push({ idx: k, name: net.order[k], arrive, depart });
    t = depart;
  }
  return { id, direction: 'out', start, stops };
}

function buildBack(net: Line2Network, start: number, id: string): Line2Train {
  const last = net.order.length - 1;
  const stops: Line2Stop[] = [{ idx: last, name: net.order[last], arrive: start, depart: start }];
  let t = start;
  for (let k = last - 1; k >= 0; k--) {
    const arrive = t + net.runB[k];
    const depart = k === 0 ? arrive : arrive + net.dwell[k];
    stops.push({ idx: k, name: net.order[k], arrive, depart });
    t = depart;
  }
  return { id, direction: 'back', start, stops };
}

/** All trains of one Tehran day: both terminals depart on the same headway grid, first to last service time inclusive. */
export function line2DayTrains(net: Line2Network, dayEpoch: number, dayType: DayType): Line2Train[] {
  const midnight = tehranToEpoch(tehranDay(dayEpoch), '00:00:00');
  const { startS, endS, headwayS } = line2Schedule(net, dayType);
  const trains: Line2Train[] = [];
  for (let s = startS, i = 0; s <= endS; s += headwayS, i++) {
    trains.push(buildOut(net, midnight + s, `L2-out-${i}`), buildBack(net, midnight + s, `L2-back-${i}`));
  }
  return trains.sort((a, b) => a.start - b.start);
}

export function line2NextPasses(net: Line2Network, trains: Line2Train[], stationName: string, at: number, limit = 6): Line2Pass[] {
  const idx = net.order.findIndex(n => normName(n) === normName(stationName));
  if (idx < 0) throw new Error(`unknown station ${stationName}`);
  const passes: Line2Pass[] = [];
  for (const tr of trains) {
    const stop = tr.stops.find(s => s.idx === idx);
    if (!stop || stop.arrive < at) continue;
    passes.push({
      trainId: tr.id, direction: tr.direction, arrive: stop.arrive, depart: stop.depart,
      etaSeconds: Math.round(stop.arrive - at), terminalArrival: tr.stops[tr.stops.length - 1] === stop,
    });
  }
  return passes.sort((a, b) => a.arrive - b.arrive).slice(0, limit);
}
