// R3-NET01-QG data triage guards: reproducible facts about the owner's raw field files, and proof of what does (not) consume them.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createTimetableModel, DEFAULT_OVERLAY_PATH, REPO_ROOT } from '../../src/timetable-overlay.js';
import { epochToTehranHms } from '../../src/time.js';

const repo = (rel: string) => fileURLToPath(new URL(rel, REPO_ROOT));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const overlay = JSON.parse(readFileSync(DEFAULT_OVERLAY_PATH, 'utf8'));
const csv = (name: string) => readFileSync(repo(`data/field/${name}`), 'utf8').trim().split('\n').map(l => l.split(','));
const FIELD_DIR = repo('data/field/');
const allCsv = readdirSync(FIELD_DIR).filter(f => f.endsWith('.csv')).sort();
const NEW_CSV = allCsv.filter(f => f >= '2026-10-26');
const quiet = { warn: () => {} };

describe('provenance pins (verified here, not at runtime)', () => {
  it('every overlay source exists and matches its SHA-256', () => {
    for (const s of overlay.sources) expect(sha(readFileSync(repo(s.path))), s.id).toBe(s.sha256);
  });
  it('changing evidence-only files does not alter the served timetable (they are not inputs)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'net01-prov-'));
    for (const sub of ['data/timetable', 'data/official', 'data/field']) mkdirSync(join(dir, sub), { recursive: true });
    copyFileSync(DEFAULT_OVERLAY_PATH, join(dir, 'data/timetable/normal-day-overlay-v1.json'));
    for (const s of overlay.sources.filter((x: any) => x.role === 'runtime')) copyFileSync(repo(s.path), join(dir, s.path));
    // provenance files deliberately absent here
    const staged = createTimetableModel({ overlayPath: join(dir, 'data/timetable/normal-day-overlay-v1.json'), rootDir: dir, ...quiet });
    const real = createTimetableModel(quiet);
    expect(staged.status.state).toBe('applied');
    expect(staged.identityVersion).toBe(real.identityVersion);
    expect(staged.scheduleFor('normal')).toEqual(real.scheduleFor('normal'));
  });
});

describe('raw field CSV facts (reproduced, nothing mutated)', () => {
  it('the `time` column equals the Tehran rendering of `t` on every row of the four new files', () => {
    expect(NEW_CSV).toHaveLength(4);
    let rows = 0;
    for (const f of NEW_CSV) for (const r of csv(f).slice(1)) {
      rows++;
      expect(r[1].slice(0, 8), `${f}:${r[10]}`).toBe(epochToTehranHms(Math.floor(Number(r[10]) / 1000)));
    }
    expect(rows).toBe(11 + 18 + 6 + 55);
  });
  it('epoch-identical rows across files: exactly 14, all Friday line-2 copies inside the Thursday file', () => {
    const owners = new Map<string, Set<string>>();
    for (const f of allCsv) for (const r of csv(f).slice(1)) { const k = r[10]; (owners.get(k) ?? owners.set(k, new Set()).get(k)!).add(f); }
    const shared = [...owners.values()].filter(v => v.size > 1);
    expect(shared).toHaveLength(14);
    expect(new Set(shared.map(v => [...v].sort().join('|')))).toEqual(new Set(['2026-10-16_line2_shariati-fakouri-tabarsi.csv|2026-10-22_line1_thursday_kowsar-vakilabad-ghadir.csv']));
  });
  it('the owner-package claim "49 duplicates skipped (85 rows)" cannot be reproduced from the supplied files', () => {
    // The 85-row operator export is not part of the package; only the 14 epoch-identical rows above are reproducible.
    const stated = JSON.parse(readFileSync(repo('data/timetable/normal-day-overlay-v1.json'), 'utf8')).notes.join(' ');
    expect(stated).not.toMatch(/49 duplicate/i); // our own derived docs must not repeat the unverified number as fact
  });
  it('the 20:03:10 departure row still carries dwell_s=8 in the raw file (kept as is, flagged suspect in the ledger)', () => {
    const row = csv('2026-11-03_line1_tuesday_kowsar-vakilabad-kowsar.csv').slice(1).find(r => r[1].startsWith('20:03:10') && r[4].includes('وکیل') && r[6] === 'depart');
    expect(row).toBeDefined();
    expect(row![8]).toBe('8');
  });
});

describe('what consumes the field data', () => {
  it('no runtime source file reads data/field or CSV files', () => {
    const files: string[] = [];
    const walk = (dir: string) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
    walk(repo('packages/core/src/'));
    const offenders = files.filter(f => /data\/field|\.csv|corrections\.json/.test(readFileSync(f, 'utf8'))).map(f => f.replace(repo(''), ''));
    expect(offenders).toEqual([]);
  });
  it('tools/build_network.py (the only reader of field CSVs) loads exactly the two 2026-10-16 files', () => {
    const src = readFileSync(repo('tools/build_network.py'), 'utf8');
    const loads = [...src.matchAll(/^\w+=load\('([^']+)'\)/gm)].map(m => m[1]).sort();
    expect(loads).toEqual(['2026-10-16_line1_vakilabad-ghadir-vakilabad.csv', '2026-10-16_line2_shariati-fakouri-tabarsi.csv']);
    // consequently the Thursday file (with its 14 Friday copies), the new files, their dwell values and their spellings are not model inputs
  });
});
