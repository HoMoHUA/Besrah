import { Network, loadNetwork, normName, forDay } from './network.js';
import { dayTrains, nextPasses, Pass, Train } from './engine.js';
import { dayTypeOf, epochToTehranHms, tehranDay, tehranToEpoch, DayType } from './time.js';

export interface PassOut {
  toward: string;          // Persian destination label
  service: 'A' | 'B';
  direction: 'out' | 'back';
  eta_min: number;         // 0 = arriving now
  arrive: string;          // HH:MM:SS Tehran
  confidence: Pass['confidence'];
  beyond_ghadir_derived: boolean;
}

export interface NextResult {
  station: string;
  line: 1;
  as_of: string;           // HH:MM:SS Tehran
  day_type: DayType;
  passes: PassOut[];
  text: string;            // ready-to-send Persian message
  notes: string[];
}

const LABEL_OUT = { A: 'غدیر', B: 'فرودگاه' } as const;
const LABEL_BACK = 'وکیل‌آباد';

/** Direction label as a rider sees it at this station. A train that ends here is an arrival, not a "toward". */
function label(p: Pass): string {
  if (p.terminalArrival) {
    // out-trip ends at Ghadir (A) or Airport (B); back-trip ends at Vakilabad
    if (p.direction === 'out') return `ورودی از ${LABEL_BACK}`;
    return `ورودی از ${p.service === 'A' ? 'غدیر' : 'فرودگاه'}`;
  }
  return p.direction === 'back' ? LABEL_BACK : LABEL_OUT[p.service];
}

export function createService(net: Network = loadNetwork()) {
  const cache = new Map<string, Train[]>();

  function trainsFor(epoch: number): { trains: Train[]; type: DayType } {
    const day = tehranDay(epoch);
    const type = dayTypeOf(epoch);
    const key = `${day}|${type}`;
    let trains = cache.get(key);
    if (!trains) {
      trains = dayTrains(forDay(net, type), tehranToEpoch(day, '00:00:00'), type);
      cache.set(key, trains);
    }
    return { trains, type };
  }

  function next(station: string, at: number, limit = 4): NextResult {
    const { trains, type } = trainsFor(at);
    const idx = net.stationsOrder.findIndex(n => normName(n) === normName(station));
    if (idx < 0) throw new Error(`unknown station ${station}`);
    const canonical = net.stationsOrder[idx];
    const raw = nextPasses(net, trains, canonical, at, limit * 3);
    const passes: PassOut[] = raw.map(p => ({
      toward: label(p),
      service: p.service,
      direction: p.direction,
      eta_min: Math.max(0, Math.ceil(p.etaSeconds / 60)),
      arrive: epochToTehranHms(p.arrive),
      confidence: p.confidence,
      beyond_ghadir_derived: p.beyondGhadirIsDerived,
    })).slice(0, limit);

    const notes: string[] = [];
    if (type === 'normal') notes.push('روز عادی: فاز سرفاصله اندازه‌گیری نشده؛ زمان‌ها تقریبی است.');
    if (type === 'thursday') notes.push('پنجشنبه: زمان‌های مسیر از یک سفر ثبت‌شده است؛ زمان‌ها تقریبی است.');
    if (passes.some(p => p.beyond_ghadir_derived)) notes.push('زمان‌های مسیر توسعه (غدیر–فرودگاه) تخمینی است.');
    if (net.stationsOrder.indexOf(canonical) === net.GH) notes.push('غدیر: قطار شاتل حدود ۷ دقیقه می‌ماند.');

    return {
      station: canonical,
      line: 1,
      as_of: epochToTehranHms(at),
      day_type: type,
      passes,
      text: formatText(canonical, passes, type, passes.length === 0, notes),
      notes,
    };
  }

  return { next, trainsFor, net };
}

export function formatText(station: string, passes: PassOut[], type: DayType, empty: boolean, notes: string[] = []): string {
  const lines = [`⏳ زمان رسیدن قطارهای بعدی:`, ``, `🚉 *${station}* (خط ۱)`];
  if (empty) {
    lines.push('😴 در این ساعت قطاری برای این ایستگاه ثبت نشده (احتمالاً خارج از ساعت کاری).');
  } else {
    // first arrival per direction, then the next one for that direction
    const byDir = new Map<string, PassOut[]>();
    for (const p of passes) {
      const arr = byDir.get(p.toward) ?? [];
      arr.push(p);
      byDir.set(p.toward, arr);
    }
    for (const [toward, arr] of byDir) {
      const etas = arr.slice(0, 2).map(p => (p.eta_min === 0 ? 'در حال ورود...' : `${p.eta_min} دقیقه`)).join('، ');
      const head = toward.startsWith('ورودی') ? `*${toward}*` : `به سمت *${toward}*`;
      lines.push(`- 🚆 ${head}: ${etas}`);
    }
  }
  const extra = [...notes];
  if (type !== 'friday' && !notes.some(n => n.includes('تقریبی'))) extra.push('⚠️ زمان‌ها برای این روز تقریبی است.');
  if (extra.length) lines.push('', ...extra.map(n => `ℹ️ ${n}`));
  return lines.join('\n');
}
