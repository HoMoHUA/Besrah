import { Network, loadNetwork, normName, forDay } from './network.js';
import { dayTrains, nextPasses, Pass, Train } from './engine.js';
import { dayTypeOf, epochToTehranHms, tehranDay, tehranToEpoch, DayType } from './time.js';
import { Line2Network, Line2Pass, Line2Train, loadLine2, line2DayTrains, line2NextPasses, line2Schedule } from './line2.js';
import { createBaselineTimetable, isTimetableDegraded, TIMETABLE_DEGRADED_NOTICE, type TimetableModel } from './timetable-overlay.js';
import { tripEventId } from './timetable-registry.js';

export type LineNo = 1 | 2;

export interface PassOut {
  line: LineNo;
  toward: string;          // Persian destination label
  service: 'A' | 'B' | null;   // line 1 only; line 2 is a single through-service
  direction: 'out' | 'back';
  eta_min: number;         // 0 = arriving now
  arrive: string;          // HH:MM:SS Tehran
  confidence: Pass['confidence'];
  beyond_ghadir_derived: boolean;
  /** Canonical trip-event identity shared by the board, the tracker and the journey planner. */
  event_id: string;
}

export interface NextResult {
  station: string;
  line: LineNo;            // the line of this answer; for an interchange asked without `line`, the first one
  lines: LineNo[];         // every line covered by `passes`
  as_of: string;           // HH:MM:SS Tehran
  day_type: DayType;
  passes: PassOut[];
  text: string;            // ready-to-send Persian message
  notes: string[];
}

export interface TrainPosition {
  id: string; line: LineNo; service: 'A' | 'B' | null; direction: 'out' | 'back'; toward: string;
  /** Station-order coordinate: 0 is the first station, an integer means the train stands at that station. */
  pos: number;
  state: 'dwelling' | 'running';
  from: number; to: number;
  /** Next station index the train will reach; null while it waits out its final layover. */
  next: number | null;
  eta_s: number | null;            // seconds until it reaches `next`
  rate: number;                    // station-index units per second while running, 0 while dwelling
  until_s: number;                 // seconds until the next timetable event (arrival or departure)
  confidence: Pass['confidence'];
  /** Canonical trip-event identity shared by the board, the tracker and the journey planner. */
  event_id: string;
}
export interface PositionsResult {
  line: LineNo; as_of: string; day_type: DayType; order: string[]; trains: TrainPosition[]; notes: string[];
}

interface TimedStop { idx: number; arrive: number; depart: number }
/** Where a timetabled trip is at `at`. Pure interpolation of the stop times; null outside the trip. */
function locate(stops: TimedStop[], at: number) {
  const first = stops[0], last = stops[stops.length - 1];
  if (at < first.arrive || at >= last.depart) return null;
  for (let k = 0; k < stops.length; k++) {
    const s = stops[k], n = stops[k + 1];
    if (at <= s.depart) {   // standing at stop k (the first stop has no dwell)
      return { pos: s.idx, state: 'dwelling' as const, from: s.idx, to: s.idx, next: n ? n.idx : null,
        eta_s: n ? Math.round(n.arrive - at) : null, rate: 0, until_s: Math.max(0, Math.round(s.depart - at)) };
    }
    if (n && at < n.arrive) {
      const run = n.arrive - s.depart, frac = (at - s.depart) / run, d = n.idx - s.idx;
      return { pos: Math.round((s.idx + frac * d) * 1000) / 1000, state: 'running' as const, from: s.idx, to: n.idx, next: n.idx,
        eta_s: Math.round(n.arrive - at), rate: d / run, until_s: Math.round(n.arrive - at) };
    }
  }
  return null;
}

const LABEL_OUT = { A: 'غدیر', B: 'فرودگاه' } as const;
const LABEL_BACK = 'وکیل‌آباد';
const L2_FAR = 'شهید فکوری', L2_NEAR = 'طبرسی';

/** Direction label as a rider sees it at this station. A train that ends here is an arrival, not a "toward". */
function label(p: Pass): string {
  if (p.terminalArrival) {
    // out-trip ends at Ghadir (A) or Airport (B); back-trip ends at Vakilabad
    if (p.direction === 'out') return `ورودی از ${LABEL_BACK}`;
    return `ورودی از ${p.service === 'A' ? 'غدیر' : 'فرودگاه'}`;
  }
  return p.direction === 'back' ? LABEL_BACK : LABEL_OUT[p.service];
}

/**
 * `timetable` selects the day schedule generator. The default is the baseline (unchanged) generator; the product wiring
 * (server.ts) passes the validated overlay model. Trip event ids always use the identity version of the model in use.
 */
export function createService(net: Network = loadNetwork(), net2: Line2Network = loadLine2(), timetable: TimetableModel = createBaselineTimetable()) {
  const cache = new Map<string, Train[]>();
  const cache2 = new Map<string, Line2Train[]>();

  function trainsFor(epoch: number): { trains: Train[]; type: DayType } {
    const day = tehranDay(epoch);
    const type = dayTypeOf(epoch);
    const key = `${day}|${type}`;
    let trains = cache.get(key);
    if (!trains) {
      trains = dayTrains(forDay(net, type), tehranToEpoch(day, '00:00:00'), type, timetable.scheduleFor(type));
      cache.set(key, trains);
    }
    return { trains, type };
  }

  function trains2For(epoch: number): Line2Train[] {
    const day = tehranDay(epoch);
    const type = dayTypeOf(epoch);
    const key = `${day}|${type}`;
    let trains = cache2.get(key);
    if (!trains) {
      trains = line2DayTrains(net2, tehranToEpoch(day, '00:00:00'), type);
      cache2.set(key, trains);
    }
    return trains;
  }

  const eventId = (at: number, line: LineNo, trainId: string) => tripEventId(timetable.identityVersion, tehranDay(at), line, trainId);

  function line1(canonical: string, at: number, limit: number) {
    const { trains, type } = trainsFor(at);
    const raw = nextPasses(net, trains, canonical, at, limit * 3);
    const passes: PassOut[] = raw.map(p => ({
      line: 1 as const,
      toward: label(p),
      service: p.service,
      direction: p.direction,
      eta_min: Math.max(0, Math.ceil(p.etaSeconds / 60)),
      arrive: epochToTehranHms(p.arrive),
      confidence: p.confidence,
      beyond_ghadir_derived: p.beyondGhadirIsDerived,
      event_id: eventId(at, 1, p.trainId),
    })).slice(0, limit);
    const notes: string[] = [];
    if (type === 'normal' && isTimetableDegraded(timetable.status)) notes.push(TIMETABLE_DEGRADED_NOTICE);
    if (type === 'normal') notes.push('روز عادی: فاز سرفاصله اندازه‌گیری نشده؛ زمان‌ها تقریبی است.');
    if (type === 'thursday') notes.push('پنجشنبه: زمان‌های مسیر از یک سفر ثبت‌شده است؛ زمان‌ها تقریبی است.');
    if (passes.some(p => p.beyond_ghadir_derived)) notes.push('زمان‌های مسیر توسعه (غدیر–فرودگاه) تخمینی است.');
    if (net.stationsOrder.indexOf(canonical) === net.GH) notes.push('غدیر: قطار شاتل حدود ۷ دقیقه می‌ماند.');
    return { passes, notes, type };
  }

  function line2(canonical: string, at: number, limit: number) {
    const type = dayTypeOf(at);
    const raw = line2NextPasses(net2, trains2For(at), canonical, at, limit * 3);
    const passes: PassOut[] = raw.map((p: Line2Pass) => ({
      line: 2 as const,
      toward: label2(p),
      service: null,
      direction: p.direction,
      eta_min: Math.max(0, Math.ceil(p.etaSeconds / 60)),
      arrive: epochToTehranHms(p.arrive),
      confidence: 'site_headway_assumed_phase' as const,
      beyond_ghadir_derived: false,
      event_id: eventId(at, 2, p.trainId),
    })).slice(0, limit);
    const headway = line2Schedule(net2, type).headwayS / 60;
    const notes = [
      `خط ۲: سرفاصلهٔ قطارها در این روز ${faDigits(headway)} دقیقه در نظر گرفته شده است، اما فاز حرکت اندازه گیری نشده؛ دقیقهٔ رسیدن تقریبی است.`,
      'خط ۲: زمان حرکت بین طبرسی و شریعتی تخمین قدیمی است و بین شریعتی و شهید فکوری اندازه گیری شده است.',
    ];
    return { passes, notes, type };
  }

  /** `line` selects one line. Without it, an interchange station (Shariati) returns both lines. */
  function next(station: string, at: number, limit = 4, line?: LineNo): NextResult {
    const i1 = net.stationsOrder.findIndex(n => normName(n) === normName(station));
    const i2 = net2.order.findIndex(n => normName(n) === normName(station));
    const lines = ([1, 2] as LineNo[]).filter(l => (l === 1 ? i1 >= 0 : i2 >= 0) && (line === undefined || line === l));
    if (!lines.length) throw new Error(`unknown station ${station}`);
    const canonical = lines[0] === 1 ? net.stationsOrder[i1] : net2.order[i2];

    const blocks = lines.map(l => ({ l, ...(l === 1 ? line1(canonical, at, limit) : line2(canonical, at, limit)) }));
    const passes = blocks.flatMap(b => b.passes);
    const notes = [...new Set(blocks.flatMap(b => b.notes))];
    const type = blocks[0].type;
    const text = blocks.length === 1
      ? formatText(canonical, passes, type, passes.length === 0, notes, lines[0])
      : formatCombined(canonical, blocks, type, notes);
    return { station: canonical, line: lines[0], lines, as_of: epochToTehranHms(at), day_type: type, passes, text, notes };
  }

  /** Estimated position of every timetabled train on one line: schedule interpolation, not GPS. */
  function positions(line: LineNo, at: number): PositionsResult {
    const type = dayTypeOf(at);
    if (line === 1) {
      const trains: TrainPosition[] = [];
      for (const t of trainsFor(at).trains) {
        const where = locate(t.stops, at);
        if (!where) continue;
        trains.push({ id: t.id, line: 1, service: t.service, direction: t.direction,
          toward: t.direction === 'back' ? LABEL_BACK : LABEL_OUT[t.service], ...where, confidence: t.confidence, event_id: eventId(at, 1, t.id) });
      }
      const notes = ['موقعیت ها از روی برنامه حرکت برآورد می شوند، نه GPS قطار.'];
      if (type === 'normal' && isTimetableDegraded(timetable.status)) notes.unshift(TIMETABLE_DEGRADED_NOTICE);
      if (type !== 'friday') notes.push('فاز سرفاصله در این روز اندازه گیری نشده است؛ فاصله بین قطارها معنی دارد و دقیقه دقیق ندارد.');
      if (trains.some(t => t.service === 'B')) notes.push('زمان مسیر غدیر تا فرودگاه تخمینی است.');
      return { line: 1, as_of: epochToTehranHms(at), day_type: type, order: [...net.stationsOrder], trains, notes };
    }
    const trains: TrainPosition[] = [];
    for (const t of trains2For(at)) {
      const where = locate(t.stops, at);
      if (!where) continue;
      trains.push({ id: t.id, line: 2, service: null, direction: t.direction, toward: t.direction === 'out' ? L2_FAR : L2_NEAR, ...where, confidence: 'site_headway_assumed_phase', event_id: eventId(at, 2, t.id) });
    }
    return { line: 2, as_of: epochToTehranHms(at), day_type: type, order: [...net2.order], trains,
      notes: ['موقعیت ها از روی برنامه حرکت برآورد می شوند، نه GPS قطار.', 'فاز حرکت خط ۲ اندازه گیری نشده است؛ فقط فاصله بین قطارها معنی دارد.'] };
  }

  return { next, positions, trainsFor, net, net2, timetable };
}

function label2(p: Line2Pass): string {
  if (p.terminalArrival) return `ورودی از ${p.direction === 'out' ? L2_NEAR : L2_FAR}`;
  return p.direction === 'out' ? L2_FAR : L2_NEAR;
}

const faDigits = (n: number) => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

function rows(passes: PassOut[]): string[] {
  // first arrival per direction, then the next one for that direction
  const byDir = new Map<string, PassOut[]>();
  for (const p of passes) {
    const arr = byDir.get(p.toward) ?? [];
    arr.push(p);
    byDir.set(p.toward, arr);
  }
  const out: string[] = [];
  for (const [toward, arr] of byDir) {
    const etas = arr.slice(0, 2).map(p => (p.eta_min === 0 ? 'در حال ورود...' : `${p.eta_min} دقیقه`)).join('، ');
    const head = toward.startsWith('ورودی') ? `*${toward}*` : `به سمت *${toward}*`;
    out.push(`- 🚆 ${head}: ${etas}`);
  }
  return out;
}

const EMPTY = '😴 در این ساعت قطاری برای این ایستگاه ثبت نشده (احتمالاً خارج از ساعت کاری).';

function footer(type: DayType, notes: string[]): string[] {
  const extra = [...notes];
  if (type !== 'friday' && !notes.some(n => n.includes('تقریبی'))) extra.push('⚠️ زمان‌ها برای این روز تقریبی است.');
  return extra.length ? ['', ...extra.map(n => `ℹ️ ${n}`)] : [];
}

export function formatText(station: string, passes: PassOut[], type: DayType, empty: boolean, notes: string[] = [], line: LineNo = 1): string {
  const lines = [`⏳ زمان رسیدن قطارهای بعدی:`, ``, `🚉 *${station}* (خط ${line === 1 ? '۱' : '۲'})`];
  lines.push(...(empty ? [EMPTY] : rows(passes)));
  lines.push(...footer(type, notes));
  return lines.join('\n');
}

function formatCombined(station: string, blocks: Array<{ l: LineNo; passes: PassOut[] }>, type: DayType, notes: string[]): string {
  const lines = [`⏳ زمان رسیدن قطارهای بعدی:`];
  for (const b of blocks) {
    lines.push('', `🚉 *${station}* (خط ${b.l === 1 ? '۱' : '۲'})`, ...(b.passes.length ? rows(b.passes) : [EMPTY]));
  }
  lines.push(...footer(type, notes));
  return lines.join('\n');
}
