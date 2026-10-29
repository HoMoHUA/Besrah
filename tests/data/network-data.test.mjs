// Data-integrity checks for data/network.json and the official transcriptions in data/official.
// These guard the single source of truth the engine, the bot and the Mini App all read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const net = read('data/network.json');
const official = read('data/official/metro_mashhad_ir_schedule_1405-07-21.json');
const sheet = read('data/official/airport_route_sheet_1405-07-22.json');
const key = value => String(value).replace(/[\u200c\u200d\s]/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک');
const minutes = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const routes = new Map(official.lines.flatMap(line => line.routes.map(route => [route.route_id, route])));
const slotsOf = schedule => Object.fromEntries(Object.entries(schedule).map(([day, value]) => [day,
  (value.time_slots ?? value.slots).map(slot => [slot.start_time ?? slot.from, slot.end_time ?? slot.to, slot.headway_minutes ?? slot.headway_min])]));

test('stations: unique ids and names, coordinates inside Mashhad', () => {
  assert.equal(net.stations.length, 36);
  assert.equal(new Set(net.stations.map(s => s.id)).size, net.stations.length);
  assert.equal(new Set(net.stations.map(s => key(s.name))).size, net.stations.length);
  for (const s of net.stations) {
    assert.ok(s.lat > 36.0 && s.lat < 36.6 && s.lon > 59.2 && s.lon < 59.9, `${s.name} is outside the Mashhad bounding box`);
    assert.ok(Array.isArray(s.lines) && s.lines.length > 0, `${s.name} has no line`);
  }
});

test('line orders match station line membership (line 1 and line 2)', () => {
  const order = { 1: net.lines['1'].order_vakilabad_to_airport, 2: net.lines['2'].order_tabarsi_to_fakouri };
  for (const [line, names] of Object.entries(order)) {
    const members = net.stations.filter(s => s.lines.includes(Number(line))).map(s => key(s.name)).sort();
    assert.deepEqual(names.map(key).sort(), members, `line ${line} order and station.lines disagree`);
  }
  assert.deepEqual(net.stations.filter(s => s.lines.length > 1).map(s => s.name), ['شریعتی']);
});

test('line 2 and 3 official headways are identical to the official site transcription', () => {
  const line2 = net.lines['2'].official_site;
  assert.ok(line2, 'lines.2.official_site is missing');
  const expected = [line2, ...(net.lines['3'].official_site?.routes ?? [])];
  assert.equal(expected.length, 3, 'line 2 plus two line 3 routes expected');
  for (const entry of expected) {
    const source = routes.get(entry.route_id);
    assert.ok(source, `${entry.route_id} is not in data/official`);
    assert.deepEqual(slotsOf(entry.schedules), slotsOf(source.schedules), `${entry.route_id} headways differ from the site`);
    assert.equal(entry.title, source.title);
    assert.deepEqual(entry.terminals, source.terminals);
  }
});

test('line 2 headway decision recorded; line 3 questions stay open', () => {
  const ids = net.open_questions.map(q => (typeof q === 'object' ? q.id : null)).filter(Boolean);
  assert.ok(ids.includes('line2-headway'));
  assert.ok(ids.includes('line3-stations'));
  assert.equal(net.lines['2'].headway_conflict.owner_decision.headway_min, 10, 'owner decision: line 2 is 10 minutes Sat-Wed');
  assert.ok(net.lines['2'].headway_conflict.status.startsWith('resolved_by_owner'));
  assert.equal(net.open_questions.find(q => q.id === 'line2-headway').status, 'resolved');
  assert.equal(net.lines['2'].official_site.schedules.weekdays.slots[0].headway_min, 12, 'official site value stays untouched');
  assert.ok(net.lines['3'].open_questions.length >= 3);
});

test('line 3 has no invented stations: only known anchors, none flagged on a station yet', () => {
  assert.equal(net.stations.filter(s => s.lines.includes(3)).length, 0);
  assert.deepEqual(Object.keys(net.lines['3'].known_anchor_stations).sort(), ['باب الجواد (ع)', 'بسیج', 'پایانه مسافری', 'شهدا'].sort());
});

test('airport sheet: arithmetic and structure of every printed column (cells verified against the photo on 2026-10-29)', () => {
  const sizes = { friday: [33, 32], thursday: [29, 28], normal_days: [33, 32] };
  for (const [day, [air, ghadir]] of Object.entries(sizes)) {
    assert.equal(sheet[day].from_airport.length, air, `${day} from_airport count`);
    assert.equal(sheet[day].from_ghadir.length, ghadir, `${day} from_ghadir count`);
    for (const list of [sheet[day].from_airport, sheet[day].from_ghadir]) {
      assert.deepEqual([...list].sort(), list, `${day} times are not in ascending order`);
      assert.ok(list.every(t => /^\d\d:\d\d$/.test(t)));
    }
  }
  const steps = list => list.slice(1).map((t, i) => minutes(t) - minutes(list[i]));
  const from = (list, start) => list.slice(list.indexOf(start));
  assert.ok(steps(sheet.friday.from_airport).every(x => x === 24) && steps(sheet.friday.from_ghadir).every(x => x === 24), 'Friday is a 24-minute series');
  assert.deepEqual([steps(sheet.thursday.from_airport)[0], new Set(steps(sheet.thursday.from_airport).slice(1))], [40, new Set([30])], 'Thursday airport: one 40-minute opening step, then 30');
  assert.deepEqual([steps(sheet.thursday.from_ghadir)[0], new Set(steps(sheet.thursday.from_ghadir).slice(1))], [35, new Set([30])], 'Thursday Ghadir: one 35-minute opening step, then 30');
  assert.ok(steps(from(sheet.normal_days.from_airport, '12:29')).every(x => x === 24), 'normal days: airport column is 24 minutes from 12:29');
  assert.ok(steps(from(sheet.normal_days.from_ghadir, '12:36')).every(x => x === 24), 'normal days: Ghadir column is 24 minutes from 12:36');
});

test('airport sheet row pairing is consistent with the printed columns', () => {
  for (const day of ['friday', 'thursday', 'normal_days']) {
    const rows = sheet[day].rows;
    assert.ok(Array.isArray(rows), `${day}.rows is missing`);
    assert.deepEqual(rows.map(r => r.from_airport), sheet[day].from_airport);
    assert.deepEqual(rows.map(r => r.from_ghadir).filter(Boolean), sheet[day].from_ghadir);
    for (const row of rows) {
      if (row.from_ghadir) assert.equal(row.gap_min, minutes(row.from_airport) - minutes(row.from_ghadir));
      else assert.equal(row.gap_min, null);
    }
  }
  assert.match(sheet.rows_note, /NOT confirmed/);
});

test('line 2 official map: 13 stations, planned stations excluded, misprinted name kept as owner confirmed', () => {
  const map = net.lines['2'].official_map;
  const order = net.lines['2'].order_tabarsi_to_fakouri;
  assert.equal(order.length, map.station_count);
  assert.ok(order.map(key).includes(key('مفتح')), 'the station is «مفتح», the map misprints «شهید فتح»');
  assert.ok(!order.map(key).includes(key('شهید فتح')));
  assert.equal(map.name_typo.correct, 'مفتح');
  assert.deepEqual(map.interchanges, { 'شریعتی': [1], 'شهدا': [3, 4] });
  for (const name of Object.keys(map.interchanges)) assert.ok(order.includes(name), `${name} must be on line 2`);
  assert.equal(map.planned_unbuilt_labels.length, 6);
  assert.ok(!net.stations.some(s => /^[N-S]2$/.test(s.name)), 'planned stations must not be in stations[]');
});
