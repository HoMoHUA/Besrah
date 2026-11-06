// R3-NET01: canonical line-1 normal-day timetable overlay, trip-event identity and departure-conflict classification.
// Test source classes used in the names: [modeled] engine/overlay output, [field_observed] owner field log,
// [official_document] printed sheet transcription, [extrapolated] outside observed windows, [synthetic_test] fixtures made here.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dayTrains, scheduleFor, vakilabadDepartures, nextPasses } from '../../src/engine.js';
import { forDay, loadNetwork } from '../../src/network.js';
import { createService } from '../../src/service.js';
import { buildServer } from '../../src/server.js';
import { epochToTehranHms, tehranToEpoch } from '../../src/time.js';
import { createBaselineTimetable, createTimetableModel, parseSheetColumn, REPO_ROOT, validateOverlay, DEFAULT_OVERLAY_PATH } from '../../src/timetable-overlay.js';
import { findDepartureAnomalies, tripEventId } from '../../src/timetable-registry.js';
import { createModelSource } from '../../src/transit-journey/index.js';
import { at, betaOn, DA, H7, q } from '../journey-beta/helpers.js';

const net = loadNetwork();
const TUESDAY = '2026-11-03', WEDNESDAY = '2026-11-04', SUNDAY = '2026-11-01', THURSDAY = '2026-10-22', FRIDAY = '2026-10-16';
const midnight = (d: string) => tehranToEpoch(d, '00:00:00');
const sec = (hm: string) => { const [h, m, s = 0] = hm.split(':').map(Number); return h * 3600 + m * 60 + s; };
const warnings: string[] = [];
const overlay = createTimetableModel({ warn: m => warnings.push(m) });
const baseline = createBaselineTimetable();
const trainsOf = (model: typeof overlay, date: string, type: 'normal' | 'thursday' | 'friday') =>
  dayTrains(forDay(net, type), midnight(date), type, model.scheduleFor(type));
const originDepartures = (trains: ReturnType<typeof trainsOf>, date: string, service: 'A' | 'B') =>
  trains.filter(t => t.direction === 'out' && t.service === service).map(t => t.stops[0].depart - midnight(date)).sort((a, b) => a - b);
const sheet = JSON.parse(readFileSync(new URL('data/official/kowsar_airport_poster_2026-11-03.json', REPO_ROOT), 'utf8'));
const stage = (mutate: (dir: string, overlayPath: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'net01-overlay-'));
  for (const sub of ['data/timetable', 'data/official', 'data/field']) mkdirSync(join(dir, sub), { recursive: true });
  const o = JSON.parse(readFileSync(DEFAULT_OVERLAY_PATH, 'utf8'));
  for (const s of o.sources) copyFileSync(new URL(s.path, REPO_ROOT), join(dir, s.path));
  const overlayPath = join(dir, 'data/timetable/normal-day-overlay-v1.json');
  copyFileSync(DEFAULT_OVERLAY_PATH, overlayPath); // byte-exact copy: the digest is defined over bytes
  mutate(dir, overlayPath);
  return { dir, overlayPath };
};
const quiet = { warn: () => {} };

describe('[modeled] baseline characterization: the defect is generated, not displayed', () => {
  const trains = trainsOf(baseline, TUESDAY, 'normal');
  const anomalies = findDepartureAnomalies(trains, midnight(TUESDAY));
  it('the unchanged generator emits 20 exact A/B departures at Vakilabad on a normal day (assumed phase on both)', () => {
    const exact = anomalies.filter(a => a.deltaS === 0);
    expect(exact).toHaveLength(20);
    expect(exact.every(a => a.class === 'independently_generated_collision')).toBe(true);
    expect(exact.every(a => a.a.confidence === 'site_headway_assumed_phase' && a.b.confidence === 'site_headway_assumed_phase')).toBe(true);
    expect(exact.slice(0, 3).map(a => epochToTehranHms(midnight(TUESDAY) + a.a.departS))).toEqual(['06:30:00', '07:00:00', '07:30:00']);
  });
  it('the cause is two independently anchored grids: A 15 min from 06:00 and B 30 min from 06:30', () => {
    const s = scheduleFor('normal');
    expect(s.phaseA).toBe(sec('06:00')); expect(s.phaseB).toBe(sec('06:30'));
    expect(s.slots[0]).toMatchObject({ headwayA: 900, headwayB: 1800 });
    expect(s.fixed).toBeUndefined();
  });
  it('Thursday keeps two near-but-not-equal A/B pairs (38 s) that are classified, never altered; Friday has none', () => {
    const thu = findDepartureAnomalies(trainsOf(baseline, THURSDAY, 'thursday'), midnight(THURSDAY));
    expect(thu.map(a => a.deltaS)).toEqual([38, 38]);
    expect(thu.every(a => a.class === 'independently_generated_collision')).toBe(true);
    expect(findDepartureAnomalies(trainsOf(baseline, FRIDAY, 'friday'), midnight(FRIDAY))).toEqual([]);
  });
  it('a documented pair that is close is never relabelled a generator artefact', () => {
    const fake = (service: 'A' | 'B', s: number, confidence: 'official_sheet_phase') => ({ id: `${service}-out-x`, service, direction: 'out' as const, start: s, stops: [{ idx: 0, name: 'x', arrive: s, depart: s }], confidence, beyondGhadirIsDerived: false });
    const list = [fake('A', 1000, 'official_sheet_phase'), fake('B', 1030, 'official_sheet_phase')]; // [synthetic_test]
    expect(findDepartureAnomalies(list, 0, 90).map(a => a.class)).toEqual(['possible_real_close_operation']);
    expect(findDepartureAnomalies([fake('A', 1000, 'official_sheet_phase'), fake('A', 1000, 'official_sheet_phase')], 0, 90).map(a => a.class)).toEqual(['confirmed_duplicate']);
  });
});

describe('[modeled] net01 overlay: canonical normal-day timetable', () => {
  const trains = trainsOf(overlay, TUESDAY, 'normal');
  const A = originDepartures(trains, TUESDAY, 'A'), B = originDepartures(trains, TUESDAY, 'B');
  it('is applied from the shipped files, with a recorded digest and no warning', () => {
    expect(overlay.status).toMatchObject({ state: 'applied', overlayId: 'net01-normal-day-v1', reason: null });
    expect(overlay.status.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(warnings).toEqual([]);
  });
  it('[official_document] B is the printed Kowsar sheet minus the derived 18 min offset, all 32 rows, nothing dropped', () => {
    expect(B).toEqual(parseSheetColumn(sheet, 'sat_to_wed').map(s => s - 1080));
    expect(B).toHaveLength(32);
    expect([B[0], B.at(-1)]).toEqual([sec('06:00'), sec('19:31')]);
    expect(overlay.overlay?.B.offsetQuality).toBe('derived');
  });
  it('no A/B departure is exact or within the 90 s guard; the smallest separation is the one chosen on purpose', () => {
    expect(findDepartureAnomalies(trains, midnight(TUESDAY), 90)).toEqual([]);
    expect(overlay.report?.exactCollisions).toBe(0);
    const smallest = Math.min(...A.flatMap(a => B.map(b => Math.abs(a - b))));
    expect(smallest).toBe(overlay.report?.minAbSeparationS);
    expect(smallest).toBeGreaterThanOrEqual(160); // origin-only separation; the whole-network objective is guarded in phase-search.test.ts
  });
  it('morning A keeps the site 15 min headway exactly (no train removed, only the unmeasured phase changed)', () => {
    const am = A.filter(s => s < sec('11:55'));
    expect(am).toHaveLength(24);
    expect(new Set(am.slice(1).map((s, i) => s - am[i]))).toEqual(new Set([900]));
    expect(am[0] % 900).toBe(380);
    expect(overlay.report?.phaseDecisions).toEqual([]); // the phase is a reviewed constant now, found offline by scripts/net01/phase_search.mjs
  });
  it('[extrapolated] from 11:55 A and B share one 8 min slot sequence; 20 grid slots are B slots and are recorded, not lost', () => {
    const slots = [...A, ...B].filter(s => s >= sec('11:55') && s <= sec('20:27')).sort((a, b) => a - b);
    expect(slots.every(s => (s / 60) % 8 === 3 || s === sec('19:31') || B.includes(s))).toBe(true);
    expect(overlay.report?.absorbed).toHaveLength(20);
    expect(overlay.report?.absorbed.every(x => Math.abs(x.deltaS) <= 90 && B.includes(x.documentedBS))).toBe(true);
    const gaps = slots.slice(1).map((s, i) => (s - slots[i]) / 60);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(6.5);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(10);
  });
  it('[field_observed] the six timed Tuesday A departures and the airport train sit inside the model (calibration residuals)', () => {
    for (const t of ['19:15:29', '19:22:52', '19:39:15', '19:46:58', '19:55:03', '20:03:10']) {
      expect(Math.min(...A.map(a => Math.abs(a - sec(t))))).toBeLessThanOrEqual(30);
    }
    expect(Math.min(...B.map(b => Math.abs(b - sec('19:32:22'))))).toBeLessThanOrEqual(90);
  });
  it('confidence labels never claim measurement outside timed observations (board-only 20:11-20:27 is NOT measured)', () => {
    const labelled = trains.filter(t => t.direction === 'out' && t.service === 'A').map(t => ({ s: t.stops[0].depart - midnight(TUESDAY), c: t.confidence }));
    expect(labelled.filter(x => x.c === 'measured_phase').every(x => x.s >= sec('19:15') && x.s <= sec('20:03'))).toBe(true);
    expect(labelled.filter(x => x.s >= sec('19:15') && x.s <= sec('20:03')).every(x => x.c === 'measured_phase')).toBe(true);
    expect(labelled.filter(x => x.s < sec('19:15') || x.s > sec('20:03')).every(x => x.c === 'site_headway_assumed_phase')).toBe(true);
    expect(trains.filter(t => t.service === 'B').every(t => t.confidence === 'sheet_derived_phase')).toBe(true);
  });
  it('is deterministic: two builds are identical, with no clock or randomness involved', () => {
    const again = createTimetableModel(quiet);
    expect(again.scheduleFor('normal')).toEqual(overlay.scheduleFor('normal'));
    expect(again.identityVersion).toBe(overlay.identityVersion);
    expect(again.report).toEqual(overlay.report);
  });
  it('Friday and the normal-day BASELINE remain unchanged; Thursday is updated by its separate field evidence', () => {
    expect(overlay.scheduleFor('friday')).toEqual(scheduleFor('friday'));
    expect(trainsOf(overlay, FRIDAY, 'friday')).toEqual(trainsOf(baseline, FRIDAY, 'friday'));
    const thu = overlay.scheduleFor('thursday');
    expect(thu.fixed?.A.length).toBeGreaterThan(30);
    expect(thu.fixed?.B.length).toBeGreaterThan(20);
    expect(thu).not.toEqual(baseline.scheduleFor('thursday'));
    expect(vakilabadDepartures(TUESDAY, scheduleFor('normal'), 'A')).toHaveLength(75);
  });
  it('[field_observed] Sunday crossing: the model puts an A train near Danesh-amooz within 60 s of the logged arrival', () => {
    const sunday = trainsOf(overlay, SUNDAY, 'normal');
    const out = nextPasses(net, sunday, 'دانش‌آموز', midnight(SUNDAY) + sec('20:00:00'), 20).filter(p => p.direction === 'out' && p.service === 'A').map(p => p.arrive - midnight(SUNDAY));
    expect(Math.min(...out.map(s => Math.abs(s - sec('20:09:03'))))).toBeLessThanOrEqual(60);
  });
});

describe('[synthetic_test] overlay loader fails closed to the baseline and says why', () => {
  const baselineNormal = scheduleFor('normal');
  const expectBaseline = (model: ReturnType<typeof createTimetableModel>, state: string) => {
    expect(model.status.state).toBe(state);
    expect(model.status.reason).toEqual(expect.any(String));
    expect(model.scheduleFor('normal')).toEqual(baselineNormal);
    expect(model.identityVersion).toBe(state === 'baseline_no_overlay' ? 'baseline' : `baseline-fallback:${state}`);
    expect(model.fingerprintParts()).toEqual([]);
  };
  it('missing file', () => expectBaseline(createTimetableModel({ overlayPath: join(tmpdir(), 'no-such-overlay.json'), ...quiet }), 'baseline_missing'));
  it('disabled by the caller', () => expectBaseline(createTimetableModel({ overlayPath: null }), 'baseline_no_overlay'));
  it('malformed JSON', () => { const { overlayPath } = stage((_d, p) => writeFileSync(p, '{ not json')); expectBaseline(createTimetableModel({ overlayPath, ...quiet }), 'baseline_invalid'); });
  it('wrong schema version', () => { const { overlayPath } = stage((_d, p) => { const o = JSON.parse(readFileSync(p, 'utf8')); o.schemaVersion = 2; writeFileSync(p, JSON.stringify(o)); }); expectBaseline(createTimetableModel({ overlayPath, ...quiet }), 'baseline_invalid'); });
  it('a source whose bytes changed (hash mismatch)', () => {
    const { dir, overlayPath } = stage((d) => writeFileSync(join(d, 'data/official/kowsar_airport_poster_2026-11-03.json'), readFileSync(join(d, 'data/official/kowsar_airport_poster_2026-11-03.json'), 'utf8').replace('"6:18"', '"6:19"')));
    const model = createTimetableModel({ overlayPath, rootDir: dir, ...quiet });
    expectBaseline(model, 'baseline_invalid'); expect(model.status.reason).toMatch(/hash mismatch/);
  });
  it('a missing PROVENANCE file never degrades the timetable; a missing RUNTIME input does', () => {
    const { dir, overlayPath } = stage((d) => { writeFileSync(join(d, 'data/official/kowsar_airport_poster_2026-11-03.png'), 'x'); });
    const o = JSON.parse(readFileSync(overlayPath, 'utf8'));
    o.sources.find((x: any) => x.id === 'kowsar-sheet-photo').path = 'data/official/gone.png'; writeFileSync(overlayPath, JSON.stringify(o));
    expect(createTimetableModel({ overlayPath, rootDir: dir, ...quiet }).status.state).toBe('applied');
    const bad = JSON.parse(readFileSync(overlayPath, 'utf8')); bad.sources.find((x: any) => x.id === 'kowsar-sheet').role = 'provenance';
    expect(() => validateOverlay(bad)).toThrow(); // the B source must stay a runtime input
  });
  it('a missing source file', () => {
    const { dir, overlayPath } = stage((d) => writeFileSync(join(d, 'data/field/corrections-2026-11-03.json'), '{}'));
    const o = JSON.parse(readFileSync(overlayPath, 'utf8'));
    o.sources[0].path = 'data/official/not-there.json'; writeFileSync(overlayPath, JSON.stringify(o));
    expectBaseline(createTimetableModel({ overlayPath, rootDir: dir, ...quiet }), 'baseline_invalid');
  });
  it('measured confidence on an extrapolated window, overlapping windows and unsafe paths are rejected by validation', () => {
    const base = JSON.parse(readFileSync(DEFAULT_OVERLAY_PATH, 'utf8'));
    const clone = () => structuredClone(base);
    const bad: Array<(o: any) => void> = [
      o => { o.A.windows[1].confidence = 'measured_phase'; },
      o => { o.A.windows[2].confidence = 'site_headway_assumed_phase'; },
      o => { o.A.windows[1].fromS = o.A.windows[0].fromS; },
      o => { o.sources[0].path = '../outside.json'; },
      o => { o.sources[0].path = '/etc/passwd'; },
      o => { o.B.offsetQuality = 'measured'; },
      o => { o.guardS = -1; },
      o => { o.appliesTo = 'friday'; },
    ];
    for (const mutate of bad) { const o = clone(); mutate(o); expect(() => validateOverlay(o)).toThrow(); }
    expect(() => validateOverlay(clone())).not.toThrow();
  });
  it('an overlay that would still collide is refused at build time', () => {
    const { dir, overlayPath } = stage(() => {});
    const o = JSON.parse(readFileSync(overlayPath, 'utf8'));
    o.A.windows[1].absorbIntoDocumentedB = false; writeFileSync(overlayPath, JSON.stringify(o));
    const model = createTimetableModel({ overlayPath, rootDir: dir, ...quiet });
    expect(model.status.state).toBe('baseline_invalid'); expect(model.status.reason).toMatch(/within 90s/);
  });
  it('packaging: the same files staged at another root (a production-like layout) apply identically', () => {
    const { dir, overlayPath } = stage(() => {});
    const staged = createTimetableModel({ overlayPath, rootDir: dir, ...quiet });
    expect(staged.status.state).toBe('applied');
    expect(staged.identityVersion).toBe(overlay.identityVersion);
  });
  it('malformed sheet rows are rejected, not guessed', () => {
    expect(() => parseSheetColumn({ c: ['6:18', '6:17', '7:00', '8:00', '9:00', '10:00', '11:00', '12:00'] }, 'c')).toThrow();
    expect(() => parseSheetColumn({ c: ['6:18', 'x', '7:00', '8:00', '9:00', '10:00', '11:00', '12:00'] }, 'c')).toThrow();
    expect(() => parseSheetColumn({}, 'c')).toThrow();
  });
});

describe('[modeled] one event identity across board, tracker and journey', () => {
  const NOW = at(WEDNESDAY, '10:00:00');
  const app = buildServer({ now: () => NOW, journeyBeta: betaOn({ calendarMode: 'weekday_baseline' }), limiterClock: () => 1 });
  it('trip event ids are deterministic, versioned and date-scoped', () => {
    const id = tripEventId(overlay.identityVersion, WEDNESDAY, 1, 'A-out-5');
    expect(id).toMatch(/^ev1_[0-9a-f]{20}$/);
    expect(tripEventId(overlay.identityVersion, WEDNESDAY, 1, 'A-out-5')).toBe(id);
    expect(tripEventId('baseline', WEDNESDAY, 1, 'A-out-5')).not.toBe(id);
    expect(tripEventId(overlay.identityVersion, TUESDAY, 1, 'A-out-5')).not.toBe(id);
    expect(tripEventId(overlay.identityVersion, WEDNESDAY, 2, 'A-out-5')).not.toBe(id);
  });
  it('/next, /trains and the journey option name the same physical departure by the same id (12 fixed instants)', async () => {
    const svc = createService(undefined, undefined, overlay);
    const instants = ['06:10:00', '07:30:00', '09:05:00', '10:00:00', '11:30:00', '12:20:00', '14:00:00', '17:45:00', '19:15:00', '19:40:00', '20:30:00', '21:15:00'];
    let compared = 0;
    for (const hm of instants) {
      const t = tehranToEpoch(WEDNESDAY, hm);
      const board = svc.next('هفت‌تیر', t, 10, 1).passes.filter(p => p.direction === 'out');
      const tracker = svc.positions(1, t).trains;
      const trainsToday = svc.trainsFor(t).trains;
      for (const p of board.slice(0, 3)) {
        const train = trainsToday.find(x => tripEventId(overlay.identityVersion, WEDNESDAY, 1, x.id) === p.event_id);
        expect(train, `board ${hm}`).toBeDefined();
        expect(train!.service).toBe(p.service);
        const seen = tracker.find(x => x.event_id === p.event_id);
        if (seen) { expect(seen.id).toBe(train!.id); compared++; }
      }
    }
    expect(compared).toBeGreaterThan(0);
    const ids = svc.trainsFor(NOW).trains.map(x => tripEventId(overlay.identityVersion, WEDNESDAY, 1, x.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('the journey option id equals the board/tracker id of the same train, via the real HTTP route', async () => {
    const res = await app.inject({ method: 'GET', url: q({ line: '1', from: H7, to: DA }) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.options.length).toBeGreaterThan(0);
    const svc = createService(undefined, undefined, overlay);
    const wanted = new Set(svc.trainsFor(NOW).trains.map(x => tripEventId(overlay.identityVersion, WEDNESDAY, 1, x.id)));
    for (const o of body.options) expect(wanted.has(o.eventId), o.id).toBe(true);
    expect(new Set(body.options.map((o: any) => o.eventId)).size).toBe(body.options.length);
  });
  it('[the reported symptom] no two journey cards share the same departure instant in the overlay model, but they do in the baseline', async () => {
    const overlayCards = (await app.inject({ method: 'GET', url: q({ line: '1', from: H7, to: DA, date: WEDNESDAY, time: '10:00' }) })).json().options;
    expect(new Set(overlayCards.map((o: any) => o.departAt)).size).toBe(overlayCards.length);
    const old = buildServer({ now: () => NOW, journeyBeta: betaOn({ calendarMode: 'weekday_baseline' }), limiterClock: () => 1, timetable: baseline, journeySource: createModelSource(undefined, { timetable: baseline }) });
    const oldCards = (await old.inject({ method: 'GET', url: q({ line: '1', from: H7, to: DA, date: WEDNESDAY, time: '10:00' }) })).json().options;
    expect(new Set(oldCards.map((o: any) => o.departAt)).size).toBeLessThan(oldCards.length);
  });
  it('the model version separates old feedback from the new model', () => {
    expect(createModelSource(undefined, { timetable: overlay }).dataVersion).not.toBe(createModelSource(undefined, { timetable: baseline }).dataVersion);
    expect(createModelSource(undefined, { timetable: overlay }).dataVersion).toBe(createModelSource(undefined, { timetable: createTimetableModel(quiet) }).dataVersion);
  });
  it('line 2 is unchanged by the overlay: same trains, only the identity token differs', () => {
    const a = createService(undefined, undefined, baseline).positions(2, tehranToEpoch(WEDNESDAY, '10:00:00')).trains;
    const b = createService(undefined, undefined, overlay).positions(2, tehranToEpoch(WEDNESDAY, '10:00:00')).trains;
    expect(b.map(({ event_id, ...rest }) => rest)).toEqual(a.map(({ event_id, ...rest }) => rest));
  });
  it('a rejected overlay keeps every route answering from the baseline generator', async () => {
    const dead = createTimetableModel({ overlayPath: join(tmpdir(), 'absent.json'), ...quiet });
    const fallback = buildServer({ now: () => NOW, timetable: dead });
    const r = await fallback.inject({ method: 'GET', url: '/app/api/next?station=' + encodeURIComponent('هفت‌تیر') + '&limit=3&line=1' });
    expect(r.statusCode).toBe(200);
    expect(r.json().passes).toHaveLength(3);
    expect((await fallback.inject({ method: 'GET', url: '/health' })).json()).toEqual({ ok: true });
  });
});
