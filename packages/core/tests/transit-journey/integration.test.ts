import { describe, expect, it } from 'vitest';
import type { JourneyRequest, ModelTrip, TimetableSource } from '../../src/transit-journey/contracts.js';
import { createModelSource } from '../../src/transit-journey/model-source.js';
import { planJourney } from '../../src/transit-journey/planner.js';

const scenarios = [
  { date: '2026-10-16', dayType: 'friday', mode: 'strict', calendarState: 'known',
    confidenceA: 'measured_phase', confidenceB: 'measured_phase' },
  { date: '2026-10-22', dayType: 'thursday', mode: 'weekday_baseline', calendarState: 'estimated',
    confidenceA: 'site_headway_assumed_phase', confidenceB: 'official_sheet_phase' },
  { date: '2026-10-19', dayType: 'normal', mode: 'weekday_baseline', calendarState: 'estimated',
    confidenceA: 'site_headway_assumed_phase', confidenceB: 'site_headway_assumed_phase' },
] as const;
type Scenario = typeof scenarios[number];

function query(scenario: Scenario, line: 1 | 2, originId: string, destinationId: string,
  readyAt = `${scenario.date}T14:00:00+03:30`): JourneyRequest {
  return { schemaVersion: 1, requestId: `integration:${line}:${scenario.date}`, line,
    originId, destinationId, readyAt, searchSeconds: 7200, maxCandidates: 64,
    // Monday and Thursday explicitly select a weekday model. This is not a
    // claim about whether either historical civil date was a real holiday.
    calendar: { mode: scenario.mode }, decisionPermission: 'granted' };
}

// Full existing modeled trips, not next-pass wrappers or planner filtering or
// ranking helpers. The real-network test uses only a few bounded OD queries.
function exhaustive(trips: readonly ModelTrip[], request: JourneyRequest) {
  const ready = Date.parse(request.readyAt) / 1000;
  const until = ready + request.searchSeconds!;
  const matches: { id: string; arrival: number }[] = [];
  for (const trip of trips) {
    for (const from of trip.stops) {
      for (const to of trip.stops) {
        if (from.stationId === request.originId && to.stationId === request.destinationId
          && to.sequence > from.sequence && from.depart >= ready
          && to.arrive >= from.depart && to.arrive <= until) {
          matches.push({ id: trip.id, arrival: to.arrive });
        }
      }
    }
  }
  return matches;
}

async function compareReal(source: TimetableSource, scenario: Scenario, request: JourneyRequest) {
  const day = await source.getDay(request.line, scenario.date, scenario.dayType);
  expect(day.complete).toBe(true);
  expect(day.rejectedTrips).toBe(0);
  expect(day.trips.length).toBeGreaterThan(0);
  const expected = exhaustive(day.trips, request);
  expect(expected.length, 'bounded real-network OD query must exercise an actual modeled service').toBeGreaterThan(0);
  expect(expected.length).toBeLessThanOrEqual(request.maxCandidates!);
  const result = await planJourney(request, source);
  expect(result.status).toBe(scenario.calendarState === 'known' ? 'ok' : 'partial');
  expect(result.modelOnly).toBe(true);
  expect(result.diagnostics.serviceDates).toEqual([scenario.date]);
  expect(result.diagnostics.calendars).toEqual([expect.objectContaining({
    date: scenario.date, state: scenario.calendarState, dayType: scenario.dayType,
  })]);
  expect(result.diagnostics.matchedTrips).toBe(expected.length);
  expect(result.diagnostics.candidateTruncated).toBe(false);
  expect(result.diagnostics.rejectedTrips).toBe(0);
  expect(result.diagnostics.complete).toBe(scenario.calendarState === 'known');
  expect(result.diagnostics.issues.map(issue => issue.code)).toEqual(
    scenario.calendarState === 'known' ? [] : ['holidays_unverified_weekday_baseline'],
  );
  expect(result.journeys.map(journey => journey.tripId).sort()).toEqual(expected.map(ride => ride.id).sort());
  let earliest = Infinity;
  for (const ride of expected) if (ride.arrival < earliest) earliest = ride.arrival;
  expect(result.decision.options.length).toBeGreaterThan(0);
  for (const option of result.decision.options) {
    expect(expected.find(ride => ride.id === option.candidateId)?.arrival).toBe(earliest);
  }
  for (const journey of result.journeys) {
    const trip = day.trips.find(item => item.id === journey.tripId)!;
    expect(journey.confidence).toBe(trip.confidence);
    expect(journey.sourceTrainId).toBe(trip.sourceTrainId);
    expect(journey.sourceVersion).toBe(day.dataVersion);
    expect(journey.runQuality).toEqual(day.runQuality);
    expect(journey.calendar.state).toBe(scenario.calendarState);
    expect(journey.origin.stationId).toBe(request.originId);
    expect(journey.destination.stationId).toBe(request.destinationId);
    expect(journey.arrivalEpochSeconds).toBe(journey.destination.arrive);
    expect(journey.metrics.inVehicleSeconds).toMatchObject({
      state: 'estimated', value: journey.destination.arrive - journey.origin.depart,
    });
    expect(journey.evidence.every(evidence => evidence.live === false)).toBe(true);
    for (let index = 1; index < journey.stops.length; index++) {
      expect(journey.stops[index].sequence).toBe(journey.stops[index - 1].sequence + 1);
      expect(journey.stops[index].lineIndex - journey.stops[index - 1].lineIndex)
        .toBe(journey.direction === 'out' ? 1 : -1);
    }
  }
  return { day, result };
}

describe('actual network source-to-planner integration', () => {
  for (const scenario of scenarios) {
    for (const line of [1, 2] as const) {
      it(`matches exhaustive ${scenario.dayType} trips on line ${line}, ${scenario.date}`, async () => {
        const source = createModelSource();
        const order = source.catalog.orders[line];
        const shariati = source.catalog.stations.find(station => station.id === 'METRO-117')!;
        expect(shariati.name).toContain('شریعتی');
        // Both travel directions, a terminal, and the physical interchange;
        // not a cross-product of every real station and every possible time.
        for (const [origin, destination] of [[order[0], order.at(-1)!],
          [shariati.id, order.at(-1)!], [order.at(-1)!, shariati.id]]) {
          await compareReal(source, scenario, query(scenario, line, origin, destination));
        }
      });
    }

    it(`preserves day/service confidence differences for ${scenario.date}`, async () => {
      const source = createModelSource();
      const line1 = await source.getDay(1, scenario.date, scenario.dayType);
      const line2 = await source.getDay(2, scenario.date, scenario.dayType);
      for (const [service, confidence] of [['A', scenario.confidenceA], ['B', scenario.confidenceB]] as const) {
        const trips = line1.trips.filter(trip => trip.service === service);
        expect(trips.length).toBeGreaterThan(0);
        expect([...new Set(trips.map(trip => trip.confidence))]).toEqual([confidence]);
      }
      expect([...new Set(line2.trips.map(trip => trip.confidence))]).toEqual(['site_headway_assumed_phase']);
      // Exercise confidence mapping on all A and B journeys to Ghadir too.
      const { result } = await compareReal(source, scenario,
        query(scenario, 1, source.catalog.orders[1][0], source.catalog.ghadirId));
      expect(new Set(result.journeys.map(journey => journey.service))).toEqual(new Set(['A', 'B']));
      for (const journey of result.journeys) {
        expect(journey.confidence).toBe(journey.service === 'A' ? scenario.confidenceA : scenario.confidenceB);
      }
    });

    it(`never extends Ghadir A to Airport, ${scenario.date}`, async () => {
      const source = createModelSource();
      const airport = source.catalog.orders[1].at(-1)!;
      const { day, result } = await compareReal(source, scenario,
        query(scenario, 1, source.catalog.ghadirId, airport));
      const shortTurns = day.trips.filter(trip => trip.service === 'A');
      expect(shortTurns.length).toBeGreaterThan(0);
      expect(shortTurns.every(trip => trip.stops.every(stop => stop.stationId !== airport))).toBe(true);
      expect(result.journeys.every(journey => journey.service === 'B' && journey.direction === 'out')).toBe(true);
      expect(result.journeys.every(journey => journey.derivedExtension)).toBe(true);
    });

    it(`ends an A terminal journey at arrival, not its turnaround departure, ${scenario.date}`, async () => {
      const source = createModelSource();
      const { result } = await compareReal(source, scenario,
        query(scenario, 1, source.catalog.orders[1][0], source.catalog.ghadirId));
      const terminalJourneys = result.journeys.filter(journey => journey.service === 'A');
      expect(terminalJourneys.length).toBeGreaterThan(0);
      const ready = Date.parse(result.scope.readyAt) / 1000;
      for (const journey of terminalJourneys) {
        expect(journey.destination.stationId).toBe(source.catalog.ghadirId);
        expect(journey.destination.depart).toBeGreaterThan(journey.destination.arrive);
        expect(journey.arrivalEpochSeconds).toBe(journey.destination.arrive);
        const candidate = result.candidates.find(item => item.id === journey.candidateId)!;
        expect(candidate.metrics.durationSeconds).toMatchObject({ value: journey.destination.arrive - ready });
        expect(candidate.metrics.arrivalEpochSeconds).toMatchObject({ value: journey.destination.arrive });
      }
    });
  }

  it('keeps Shariati as one physical ID with membership and usable origins on both lines', async () => {
    const source = createModelSource();
    const shared = source.catalog.stations.filter(station => station.id === 'METRO-117');
    expect(shared).toHaveLength(1);
    expect(shared[0].name).toContain('شریعتی');
    expect([...shared[0].lines].sort()).toEqual([1, 2]);
    for (const line of [1, 2] as const) {
      const order = source.catalog.orders[line];
      expect(order.filter(id => id === shared[0].id)).toHaveLength(1);
      const { result } = await compareReal(source, scenarios[0], query(scenarios[0], line, shared[0].id, order.at(-1)!));
      expect(result.journeys.every(journey => journey.origin.stationId === shared[0].id)).toBe(true);
    }
  });
});
