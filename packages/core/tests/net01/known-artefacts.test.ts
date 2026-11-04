// Register of KNOWN model artefacts after the overlay: A/B passes at the same station and direction at most 120 s apart.
// Pinning them makes any future change deliberate and keeps the residual honest: this is the model's behaviour, not field truth.
import { describe, expect, it } from 'vitest';
import { dayTrains } from '../../src/engine.js';
import { forDay, loadNetwork } from '../../src/network.js';
import { epochToTehranHms, tehranToEpoch } from '../../src/time.js';
import { createBaselineTimetable, createTimetableModel } from '../../src/timetable-overlay.js';

const net = loadNetwork(), mid = tehranToEpoch('2026-11-04', '00:00:00');
const model = createTimetableModel({ warn: () => {} });
function trainPairs(sched: ReturnType<typeof model.scheduleFor>) {
  const trains = dayTrains(forDay(net, 'normal'), mid, 'normal', sched);
  const by = new Map<string, Array<{ s: number; svc: string; id: string; dir: string }>>();
  for (const t of trains) for (const s of t.stops) (by.get(`${s.name}|${t.direction}`) ?? by.set(`${s.name}|${t.direction}`, []).get(`${s.name}|${t.direction}`)!).push({ s: s.arrive - mid, svc: t.service, id: t.id, dir: t.direction });
  const pairs = new Map<string, { dir: string; gaps: number[]; stations: number }>();
  for (const l of by.values()) { l.sort((a, b) => a.s - b.s); for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
    const d = l[j].s - l[i].s; if (d > 120) break; if (l[i].svc === l[j].svc) continue;
    const key = [l[i].id, l[j].id].sort().join(' ~ ');
    const e = pairs.get(key) ?? pairs.set(key, { dir: l[i].dir, gaps: [], stations: 0 }).get(key)!;
    e.gaps.push(d); e.stations++;
  } }
  return pairs;
}

describe('known artefacts after the overlay (pinned)', () => {
  const overlay = trainPairs(model.scheduleFor('normal'));
  const baseline = trainPairs(createBaselineTimetable().scheduleFor('normal'));
  it('the outbound direction (the reported symptom) has no A/B pair within 120 s at any station', () => {
    expect([...overlay.values()].filter(p => p.dir === 'out')).toEqual([]);
    expect([...baseline.values()].filter(p => p.dir === 'out').length).toBeGreaterThanOrEqual(20);
  });
  it('the residual is exactly three return-direction train pairs; their smallest gaps are 1 s, 76 s and 79 s', () => {
    const rows = [...overlay.entries()].map(([k, v]) => ({ k, dir: v.dir, min: Math.min(...v.gaps), stations: v.stations })).sort((a, b) => a.min - b.min);
    expect(rows.every(r => r.dir === 'back')).toBe(true);
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.min)).toEqual([1, 76, 79]);
  });
  it('the 1 s pair sits between the observed 19:15-20:03 A window and the last printed B train, so it is not ours to move', () => {
    const worst = [...overlay.entries()].find(([, v]) => Math.min(...v.gaps) === 1)!;
    const [a, b] = worst[0].split(' ~ ');
    const ids = [a, b].sort();
    expect(ids.some(i => i.startsWith('A-back'))).toBe(true);
    expect(ids.some(i => i.startsWith('B-back'))).toBe(true);
    const trains = dayTrains(forDay(net, 'normal'), mid, 'normal', model.scheduleFor('normal'));
    const outOfA = trains.find(t => t.id === ids.find(i => i.startsWith('A-back'))!.replace('back', 'out'))!;
    const dep = epochToTehranHms(outOfA.stops[0].depart);
    expect(dep >= '19:15:00' && dep <= '20:03:59').toBe(true);
    // This fixture day is not the timed Tuesday, so the phase is a generalisation, not an observation.
    expect(outOfA.confidence).toBe('generalized_observation_phase');
  });
});
