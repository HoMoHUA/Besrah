import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../data/', import.meta.url);
const load = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

describe('Nov 5 line 3 paper evidence is data-only and preserves ambiguities', () => {
  const network = load('network.json');
  const line3 = network.lines['3'];
  const bassij = load('official/line3_bassij_board_2026-11-05.json');
  const bab = load('official/line3_board_bab_aljavad_2026-11-05.json');

  it('records four open and three unopened stations, not an invented full line', () => {
    const stations = line3['stations_owner_stated_2026-11-05'].order_terminal_to_shohada;
    expect(stations).toHaveLength(7);
    expect(stations.filter((x: {status:string}) => x.status === 'open')).toHaveLength(4);
    expect(stations.filter((x: {status:string}) => x.status === 'not_open')).toHaveLength(3);
    expect(line3['services_owner_stated_2026-11-05'].service_1).toContain('Shohada');
    expect(line3['services_owner_stated_2026-11-05'].service_2).toContain('Bassij');
  });

  it('preserves exact Bassij paper-board row counts and exceptional last rows', () => {
    expect(Object.values(bassij.times).map((a: any) => a.length)).toEqual([21,20,44,41]);
    expect(bassij.times.imam_reza_terminal_normal.at(-1)).toBe('21:50');
    expect(bassij.times.bab_aljavad_normal.slice(-2)).toEqual(['21:35','22:07']);
    expect(bassij.quality).toBe('photo_transcription');
    expect(bassij.open_questions.length).toBeGreaterThan(0);
  });

  it('preserves Bab al-Jawad board directions and its unconfirmed holiday data', () => {
    expect(bab.bab_aljavad_to_bassij_terminal.normal).toHaveLength(43);
    expect(bab.bab_aljavad_to_bassij_terminal.holiday_rows).toHaveLength(40);
    expect(bab.bab_aljavad_to_shohada.normal).toHaveLength(64);
    expect(bab.bab_aljavad_to_bassij_terminal.normal.slice(-2)).toEqual([
      ['21:30','بسیج'], ['21:45','پایانه'],
    ]);
    expect(bab.open_questions.join(' ')).toContain('not photographed');
  });
});
