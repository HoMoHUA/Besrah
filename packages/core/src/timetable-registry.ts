// Canonical trip-event identity and departure-conflict classification for the line 1 timetable model.
//
// One physical departure has exactly one event id, whichever consumer (board, tracker or journey planner) sees it.
// The id is deterministic: it mixes the identity version of the applied timetable, the service date, the line and the
// engine's own train id. No clock, no randomness. A model change therefore changes every id instead of silently
// re-attributing old feedback to the new model.
import { createHash } from 'node:crypto';
import type { Confidence, Train } from './engine.js';

export function tripEventId(identityVersion: string, serviceDate: string, line: 1 | 2, trainId: string): string {
  return 'ev1_' + createHash('sha256').update(JSON.stringify([identityVersion, serviceDate, line, trainId])).digest('hex').slice(0, 20);
}

export type AnomalyClass =
  | 'confirmed_duplicate'
  | 'independently_generated_collision'
  | 'possible_real_close_operation'
  | 'insufficient_evidence';

export interface DepartureRef { trainId: string; service: 'A' | 'B'; departS: number; confidence: Confidence }
export interface DepartureAnomaly { class: AnomalyClass; a: DepartureRef; b: DepartureRef; deltaS: number; reason: string }

const DOCUMENTED = new Set<Confidence>(['measured_phase', 'official_sheet_phase', 'generalized_observation_phase', 'sheet_derived_phase']);

/**
 * Compare Vakilabad departures of the two services in the same direction.
 *  - same service and same instant                      -> confirmed_duplicate (a generator emitted one event twice)
 *  - different services, at least one assumed phase     -> independently_generated_collision: the closeness comes from
 *    two independently anchored grids, not from evidence about an operation
 *  - different services, both documented/measured       -> possible_real_close_operation: never removed or moved
 * A distance below the guard is a reason to classify, never a licence to delete an event.
 */
export function findDepartureAnomalies(trains: readonly Train[], dayMidnight: number, guardS = 90): DepartureAnomaly[] {
  const outs: DepartureRef[] = trains.filter(t => t.direction === 'out' && t.stops.length > 0)
    .map(t => ({ trainId: t.id, service: t.service, departS: t.stops[0].depart - dayMidnight, confidence: t.confidence }))
    .sort((x, y) => x.departS - y.departS || x.trainId.localeCompare(y.trainId));
  const found: DepartureAnomaly[] = [];
  for (let i = 0; i < outs.length; i++) {
    for (let j = i + 1; j < outs.length; j++) {
      const a = outs[i], b = outs[j], delta = b.departS - a.departS;
      if (delta > guardS) break;
      if (a.service === b.service) {
        if (delta === 0) found.push({ class: 'confirmed_duplicate', a, b, deltaS: delta, reason: 'same service, same direction, same origin instant' });
        continue;
      }
      const documented = DOCUMENTED.has(a.confidence) && DOCUMENTED.has(b.confidence);
      found.push(documented
        ? { class: 'possible_real_close_operation', a, b, deltaS: delta, reason: 'both departures rest on documented or measured phase; kept as is' }
        : { class: 'independently_generated_collision', a, b, deltaS: delta, reason: 'at least one departure comes from an assumed phase; two independent grids produced the closeness' });
    }
  }
  return found;
}
