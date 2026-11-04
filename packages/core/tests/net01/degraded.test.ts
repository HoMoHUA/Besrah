// R3-NET01-QG: a rejected or missing overlay must be VISIBLE (notes, journey notice, /beta state, distinct model identity),
// must never be labelled "corrected", and must keep every route answering (availability over silence).
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { createService } from '../../src/service.js';
import { tehranToEpoch } from '../../src/time.js';
import { createBaselineTimetable, createTimetableModel, DEFAULT_OVERLAY_PATH, REPO_ROOT, TIMETABLE_DEGRADED_NOTICE } from '../../src/timetable-overlay.js';
import { createModelSource } from '../../src/transit-journey/index.js';
import { betaOn, DA, H7, q } from '../journey-beta/helpers.js';

const quiet = { warn: () => {} };
const WED = '2026-11-04', THU = '2026-11-05';
const NOW = tehranToEpoch(WED, '10:00:00') * 1000;
const applied = createTimetableModel(quiet);
const missing = createTimetableModel({ overlayPath: join(tmpdir(), 'net01-absent-overlay.json'), ...quiet });
const stage = (mutate: (dir: string, p: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'net01-deg-'));
  for (const sub of ['data/timetable', 'data/official', 'data/field']) mkdirSync(join(dir, sub), { recursive: true });
  const o = JSON.parse(readFileSync(DEFAULT_OVERLAY_PATH, 'utf8'));
  for (const s of o.sources) copyFileSync(new URL(s.path, REPO_ROOT), join(dir, s.path));
  const p = join(dir, 'data/timetable/normal-day-overlay-v1.json');
  copyFileSync(DEFAULT_OVERLAY_PATH, p);
  mutate(dir, p);
  return { dir, p };
};
const invalid = (() => { const { dir, p } = stage((d) => writeFileSync(join(d, 'data/official/kowsar_airport_poster_2026-11-03.json'), '{"tampered":true}')); return createTimetableModel({ overlayPath: p, rootDir: dir, ...quiet }); })();
const nextOn = (model: typeof applied, date: string, line = 1) => createService(undefined, undefined, model).next(line === 1 ? 'هفت‌تیر' : 'شریعتی', tehranToEpoch(date, '10:00:00'), 4, line as 1 | 2);
const serverWith = (model: typeof applied, now = NOW) => buildServer({ now: () => now, journeyBeta: betaOn({ calendarMode: 'weekday_baseline' }), limiterClock: () => 1, timetable: model, journeySource: createModelSource(undefined, { timetable: model }) });

describe('rejected overlay is visible, never silent', () => {
  it('both rejection paths report a degraded state with a reason and a distinct model identity', () => {
    expect(missing.status.state).toBe('baseline_missing');
    expect(invalid.status.state).toBe('baseline_invalid');
    expect(invalid.status.reason).toMatch(/hash mismatch/);
    const identities = new Set([applied.identityVersion, missing.identityVersion, invalid.identityVersion, createBaselineTimetable().identityVersion]);
    expect(identities.size).toBe(4);
    const versions = new Set([applied, missing, invalid, createBaselineTimetable()].map(m => createModelSource(undefined, { timetable: m }).dataVersion));
    expect(versions.size).toBe(4);
  });
  it('/next on a normal day carries the degraded notice; applied, Thursday and line 2 do not', () => {
    expect(nextOn(missing, WED).notes).toContain(TIMETABLE_DEGRADED_NOTICE);
    expect(nextOn(invalid, WED).notes).toContain(TIMETABLE_DEGRADED_NOTICE);
    expect(nextOn(applied, WED).notes).not.toContain(TIMETABLE_DEGRADED_NOTICE);
    expect(nextOn(missing, THU).notes).not.toContain(TIMETABLE_DEGRADED_NOTICE);
    expect(nextOn(missing, WED, 2).notes).not.toContain(TIMETABLE_DEGRADED_NOTICE);
    expect(nextOn(createBaselineTimetable(), WED).notes).not.toContain(TIMETABLE_DEGRADED_NOTICE); // an intentional baseline is not a failure
  });
  it('the tracker positions carry the same notice on a normal day only', () => {
    const t = (model: typeof applied, date: string) => createService(undefined, undefined, model).positions(1, tehranToEpoch(date, '10:00:00')).notes;
    expect(t(missing, WED)).toContain(TIMETABLE_DEGRADED_NOTICE);
    expect(t(applied, WED)).not.toContain(TIMETABLE_DEGRADED_NOTICE);
    expect(t(missing, THU)).not.toContain(TIMETABLE_DEGRADED_NOTICE);
  });
  it('the journey response leads with the notice and states the degradation; applied has neither', async () => {
    const bad = (await serverWith(missing).inject({ method: 'GET', url: q({ line: '1', from: H7, to: DA, date: WED, time: '10:00' }) })).json();
    expect(bad.timetableNotice).toMatchObject({ state: 'baseline_missing' });
    expect(bad.message.startsWith(TIMETABLE_DEGRADED_NOTICE)).toBe(true);
    expect(bad.options.length).toBeGreaterThan(0); // availability is kept
    const good = (await serverWith(applied).inject({ method: 'GET', url: q({ line: '1', from: H7, to: DA, date: WED, time: '10:00' }) })).json();
    expect(good.timetableNotice).toBeUndefined();
    expect(good.message).not.toContain(TIMETABLE_DEGRADED_NOTICE);
    const thu = (await serverWith(missing).inject({ method: 'GET', url: q({ line: '1', from: H7, to: DA, date: THU, time: '10:00' }) })).json();
    expect(thu.timetableNotice).toBeUndefined();
  });
  it('/app/api/beta exposes the timetable state for operators (state and reason only, no paths)', async () => {
    const a = (await serverWith(applied).inject({ method: 'GET', url: '/app/api/beta' })).json();
    expect(a.timetable).toMatchObject({ state: 'applied', overlayId: 'net01-normal-day-v1' });
    const b = (await serverWith(invalid).inject({ method: 'GET', url: '/app/api/beta' })).json();
    expect(b.timetable.state).toBe('baseline_invalid');
    expect(JSON.stringify(b.timetable)).not.toMatch(/\/root|\/tmp|\/var|\.json/);
  });
  it('the degraded fallback still answers every route (no crash, no 5xx)', async () => {
    const app = serverWith(invalid);
    for (const url of ['/app/api/next?station=' + encodeURIComponent('هفت‌تیر') + '&line=1', '/app/api/trains?line=1', '/app/api/trains?line=2', '/health', q({ line: '1', from: H7, to: DA })]) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBeLessThan(500);
    }
  });
  it('a degraded model never claims the overlay: no departure carries the sheet-derived confidence', () => {
    const svc = createService(undefined, undefined, missing);
    const { trains } = svc.trainsFor(tehranToEpoch(WED, '10:00:00'));
    expect(trains.some(t => t.confidence === 'official_sheet_phase')).toBe(false);
  });
});
