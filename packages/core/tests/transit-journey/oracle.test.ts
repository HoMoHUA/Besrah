import { describe, expect, it } from 'vitest';
import type { JourneyRequest, ModelStop, ModelTrip } from '../../src/transit-journey/contracts.js';
import { planJourney } from '../../src/transit-journey/planner.js';
import { DAY, catalog, epoch, request, source } from './helpers.js';

type Ride = { trip: ModelTrip; origin: ModelStop; destination: ModelStop };

// This deliberately does not call planner extraction, calendar, constraint, or
// ranking helpers. Enumerate every stop pair, then minimize arrival directly.
function enumerate(trips: readonly ModelTrip[], query: JourneyRequest): Ride[] {
  const ready = Date.parse(query.readyAt) / 1000;
  const until = ready + (query.searchSeconds ?? 7200);
  const rides: Ride[] = [];
  for (const trip of trips) {
    if (trip.line !== query.line) continue;
    for (const origin of trip.stops) {
      for (const destination of trip.stops) {
        if (origin.stationId === query.originId && destination.stationId === query.destinationId
          && destination.sequence > origin.sequence && origin.depart >= ready
          && destination.arrive >= origin.depart && destination.arrive <= until) {
          rides.push({ trip, origin, destination });
        }
      }
    }
  }
  return rides;
}

const start = epoch('10:00:00');
const at = (offset: number) => new Date((start + offset) * 1000).toISOString();
const stations = catalog().orders[1];

function tinyTrip(id: string, direction: 'out' | 'back', departure: number,
  run: number, dwell: number, service: 'A' | 'B' = 'A'): ModelTrip {
  const indices = service === 'A' ? [0, 1, 2] : [0, 1, 2, 3];
  if (direction === 'back') indices.reverse();
  let clock = start + departure;
  const stops = indices.map((lineIndex, sequence) => {
    const arrive = clock;
    const depart = arrive + (sequence === 0 ? 0 : dwell);
    clock = depart + run;
    return { sequence, stationId: stations[lineIndex], lineIndex, arrive, depart };
  });
  return { id, sourceTrainId: id, serviceDate: DAY, line: 1, service, direction,
    confidence: 'fixture:tiny-oracle', derivedExtension: service === 'B', stops };
}

async function compare(trips: ModelTrip[], query: JourneyRequest) {
  const possible = enumerate(trips, query);
  const result = await planJourney(query, source(trips));
  const cap = query.maxCandidates ?? 32;
  let earliest: number | undefined;
  for (const ride of possible) {
    if (earliest === undefined || ride.destination.arrive < earliest) earliest = ride.destination.arrive;
  }
  expect(result.diagnostics.matchedTrips).toBe(possible.length);
  expect(result.diagnostics.candidateTruncated).toBe(possible.length > cap);
  expect(result.journeys).toHaveLength(Math.min(possible.length, cap));
  expect(result.candidates.map(candidate => candidate.id)).toEqual(result.journeys.map(journey => journey.tripId));
  // Compare only arrival values, not the planner's ID-based tie-breaking policy.
  expect(result.journeys.map(journey => journey.arrivalEpochSeconds)).toEqual(
    possible.map(ride => ride.destination.arrive).sort((a, b) => a - b).slice(0, cap),
  );
  if (earliest === undefined) {
    expect(result.status).toBe('no_feasible_option');
    expect(result.decision.options).toEqual([]);
  } else {
    expect(result.status).toBe(possible.length > cap ? 'partial' : 'ok');
    expect(result.decision.options.length).toBeGreaterThan(0);
    for (const option of result.decision.options) {
      const selected = possible.find(ride => ride.trip.id === option.candidateId);
      expect(selected, 'decision must name an independently enumerated feasible ride').toBeDefined();
      expect(selected!.destination.arrive).toBe(earliest);
    }
  }
  const ready = Date.parse(query.readyAt) / 1000;
  for (const journey of result.journeys) {
    const ride = possible.find(item => item.trip.id === journey.tripId)!;
    expect(journey.origin).toEqual(ride.origin);
    expect(journey.destination).toEqual(ride.destination);
    expect(journey.departureEpochSeconds).toBe(ride.origin.depart);
    expect(journey.arrivalEpochSeconds).toBe(ride.destination.arrive);
    expect(journey.metrics.waitingSeconds).toMatchObject({ value: ride.origin.depart - ready });
    expect(journey.metrics.inVehicleSeconds).toMatchObject({ value: ride.destination.arrive - ride.origin.depart });
    expect(journey.stops.map(stop => stop.sequence)).toEqual(
      ride.trip.stops.filter(stop => stop.sequence >= ride.origin.sequence && stop.sequence <= ride.destination.sequence)
        .map(stop => stop.sequence),
    );
  }
  return result;
}

describe('independent exhaustive tiny-timetable arrival oracle', () => {
  // Exhaust all binary run/dwell/phase choices. Each generated timetable has
  // out, back, short-turn, through, and later-but-faster services. Trip input
  // order is intentionally not chronological. All distinct station pairs,
  // discrete ready times, windows, and candidate caps below are exercised.
  for (const run of [20, 40]) {
    for (const dwell of [0, 30]) {
      for (const phase of [0, 15]) {
        it(`matches every tiny query: run=${run}, dwell=${dwell}, phase=${phase}`, async () => {
          const trips = [
            tinyTrip('fixture:back-through', 'back', phase + 30, run, dwell, 'B'),
            tinyTrip('fixture:slow-first', 'out', phase, run + 60, dwell),
            tinyTrip('fixture:fast-later', 'out', phase + 15, run, dwell),
            tinyTrip('fixture:out-through', 'out', phase + 90, run, dwell, 'B'),
            tinyTrip('fixture:last-back', 'back', phase + 180, run, dwell),
          ];
          for (const originId of stations) {
            for (const destinationId of stations) {
              if (originId === destinationId) continue;
              for (const ready of [0, 30, 60, 120, 180, 600]) {
                for (const searchSeconds of [1, 120, 600]) {
                  for (const maxCandidates of [1, 2, 64]) {
                    await compare(trips, request({ originId, destinationId, readyAt: at(ready), searchSeconds, maxCandidates }));
                  }
                }
              }
            }
          }
        }, 30_000);
      }
    }
  }

  it('boards during dwell and exactly at departure, but misses one millisecond later', async () => {
    const train = tinyTrip('fixture:dwell', 'out', 0, 60, 30);
    const origin = train.stops[1], destination = train.stops[2];
    for (const ready of [origin.arrive, origin.depart - 0.001, origin.depart]) {
      const result = await compare([train], request({ readyAt: new Date(ready * 1000).toISOString() }));
      expect(result.decision.options.map(option => option.candidateId)).toEqual([train.id]);
      expect(result.journeys[0].arrivalEpochSeconds).toBe(destination.arrive);
      expect(result.journeys[0].arrivalEpochSeconds).toBeLessThan(destination.depart);
    }
    const missed = await compare([train], request({ readyAt: new Date(origin.depart * 1000 + 1).toISOString() }));
    expect(missed.journeys).toEqual([]);
  });

  it('includes arrival exactly at until, and excludes an arrival one second beyond it', async () => {
    const train = tinyTrip('fixture:window', 'out', 0, 60, 30);
    expect((await compare([train], request({ readyAt: at(60), searchSeconds: 90 }))).journeys).toHaveLength(1);
    expect((await compare([train], request({ readyAt: at(60), searchSeconds: 89 }))).journeys).toHaveLength(0);
  });

  it('uses increasing trip sequence for reverse journeys, not increasing station order', async () => {
    const back = tinyTrip('fixture:reverse', 'back', 0, 60, 30);
    expect(back.stops.map(stop => stop.sequence)).toEqual([0, 1, 2]);
    expect(back.stops.map(stop => stop.lineIndex)).toEqual([2, 1, 0]);
    const result = await compare([back], request({ originId: 'fixture:g', destinationId: 'fixture:a', readyAt: at(0) }));
    expect(result.journeys).toHaveLength(1);
    expect((await compare([back], request({ originId: 'fixture:a', destinationId: 'fixture:g', readyAt: at(0) }))).journeys).toHaveLength(0);
  });

  it.each([1, 2, 64])('preserves the later-departing earliest arrival with cap %s and unsorted input', async maxCandidates => {
    const slow = tinyTrip('fixture:slow', 'out', 0, 120, 0);
    const fast = tinyTrip('fixture:fast', 'out', 30, 30, 0);
    const middle = tinyTrip('fixture:middle', 'out', 15, 60, 0);
    const result = await compare([slow, middle, fast], request({ originId: 'fixture:a', readyAt: at(0), maxCandidates }));
    expect(result.decision.options.map(option => option.candidateId)).toEqual([fast.id]);
  });

  it('takes the last departure inclusively, then reports no route after it or beyond a short turn', async () => {
    const last = tinyTrip('fixture:last', 'out', 300, 60, 30);
    expect((await compare([last], request({ originId: 'fixture:a', readyAt: at(300) }))).journeys).toHaveLength(1);
    expect((await compare([last], request({ originId: 'fixture:a', readyAt: at(300.001) }))).journeys).toHaveLength(0);
    expect((await compare([last], request({ destinationId: 'fixture:air', readyAt: at(0) }))).journeys).toHaveLength(0);
    expect((await compare([], request({ readyAt: at(0) }))).journeys).toHaveLength(0);
  });
});
