import { readFileSync } from 'node:fs';

export const NETWORK_PATH = new URL('../../../data/network.json', import.meta.url);

/** Persian names come in many spellings (ZWNJ, Arabic yeh/kaf, spaces). Compare on a normalized key. */
export function normName(s: string): string {
  return s.replace(/[\u200c\u200d\s]/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/ۀ/g, 'ه');
}

export interface Network {
  stationsOrder: string[];       // Vakilabad -> Airport, 24 names (line 1)
  GH: number;                    // index of Ghadir
  BUSTAN: number;
  AIR: number;                   // index of airport terminal
  runF: number[];                // runF[i]: seconds from station i to i+1 (forward)
  runB: number[];                // runB[i]: seconds from station i+1 to i (backward)
  runQuality: string[];
  dwell: number[];               // dwell at station i (seconds), passenger stop
  dwellQuality: string[];
  layover: { vakilabad: number; ghadirA: number; airport: number; ghadirPassB: number };
  thursday?: { runF: Record<number, number>; runB: Record<number, number>; dwell: Record<string, number> };
  base: { runF: number[]; runB: number[]; dwell: number[] };
}

export function loadNetwork(path: URL | string = NETWORK_PATH): Network {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const line = raw.lines['1'];
  const order: string[] = line.order_vakilabad_to_airport;
  const ix = (name: string) => {
    const i = order.findIndex(o => normName(o) === normName(name));
    if (i < 0) throw new Error(`station not in line 1: ${name}`);
    return i;
  };
  const split = raw.derived.extension_ghadir_airport.split_estimate;
  const GH = ix('غدیر'), BUSTAN = ix('بوستان ریحانه'), AIR = ix('فرودگاه شهید هاشمی‌نژاد');

  const runF: number[] = [], runB: number[] = [], runQuality: string[] = [];
  line.segments.forEach((s: any, i: number) => {
    let f: number | null = s.run_s_forward as number | null;
    let q = s.quality as string;
    if (f == null) {
      // extension segments: Ghadir->Bustan and Bustan->Airport from the derived split
      if (i === GH) { f = split.ghadir_to_bustan_s; q = 'derived'; }
      else if (i === BUSTAN) { f = split.bustan_to_airport_s; q = 'derived'; }
      else throw new Error(`no run time for segment ${i}`);
    }
    runF.push(f as number);
    const b = s.run_s_backward as number | null;
    runB.push(b ?? f!);
    runQuality.push(b != null ? q : `${q}+symmetric_assumed`);
  });

  const dwell: number[] = [], dwellQuality: string[] = [];
  order.forEach((name, i) => {
    const d = line.dwell[name];
    if (d) { dwell.push(d.median_s); dwellQuality.push('measured'); }
    else if (i === BUSTAN) { dwell.push(25); dwellQuality.push('assumed'); }
    else { dwell.push(20); dwellQuality.push('default_assumed'); }
  });

  const th = line['thursday_2026-10-22'];
  const thursday = th ? {
    runF: Object.fromEntries(Object.entries(th.run_forward_s).map(([k, v]) => [Number(k), v as number])),
    runB: Object.fromEntries(Object.entries(th.run_backward_s).map(([k, v]) => [Number(k), v as number])),
    dwell: th.dwell_s as Record<string, number>,
  } : undefined;

  return {
    stationsOrder: order, GH, BUSTAN, AIR, runF, runB, runQuality, dwell, dwellQuality,
    thursday, base: { runF: [...runF], runB: [...runB], dwell: [...dwell] },
    layover: {
      vakilabad: line.terminals['وکیل‌آباد'].layover_s_derived,
      ghadirA: line.terminals['غدیر'].total_layover_s,
      airport: line.terminals['فرودگاه شهید هاشمی‌نژاد'].layover_s_derived_friday,
      ghadirPassB: 25,
    },
  };
}

/** Day-specific view of the network. Thursday: measured segments override, other run times scale by the measured Thursday/Friday ratio. */
export const THURSDAY_RUN_FACTOR = 1.073; // Vakilabad->Seyed Razi: 794 s (Thu) / 740 s (Fri), 8 segments, one train

export function forDay(net: Network, dayType: 'friday' | 'thursday' | 'normal'): Network {
  if (dayType !== 'thursday' || !net.thursday) return net;
  const runF = net.base.runF.map((v, i) => (net.thursday!.runF[i] ?? Math.round(v * THURSDAY_RUN_FACTOR)));
  const runB = net.base.runB.map((v, i) => (net.thursday!.runB[i] ?? Math.round(v * THURSDAY_RUN_FACTOR)));
  const dwell = net.base.dwell.map((v, i) => {
    const name = net.stationsOrder[i];
    return net.thursday!.dwell[name] ?? v;
  });
  return { ...net, runF, runB, dwell };
}
