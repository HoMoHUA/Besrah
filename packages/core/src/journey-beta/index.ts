// Anonymous production-beta boundary. No request here changes the timetable or grants identity authority.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { tehranDay } from '../time.js';
import { createModelSource, planJourney, resolveCalendar } from '../transit-journey/index.js';
import type { TimetableSource } from '../transit-journey/contracts.js';
import type { TimetableModel } from '../timetable-overlay.js';
import { configFromEnv, type JourneyBetaConfig } from './config.js';
import { betaControl } from './control.js';
import { createFeedbackStore, toStored, validateFeedback, type StoredFeedback } from './feedback.js';
import { isoTehran, newRequestId, parseJourneyQuery, toJourneyDto } from './journey.js';
import { clientKey, createGate, createWindowLimiter } from './limits.js';
import { boundedSource } from './source.js';
import { assertCalendarPolicy } from '../transit-journey/validation.js';

export { configFromEnv, type JourneyBetaConfig } from './config.js';
export interface JourneyBetaOptions {
  config?: Partial<JourneyBetaConfig>;
  source?: TimetableSource;
  /** Wall clock in milliseconds; admission rates use a separate, monotonic-in-tests clock. */
  now: () => number;
  limiterClock?: () => number;
  /** Timetable model used by the default model source (ignored when `source` is injected). */
  timetable?: TimetableModel;
}
const noStore = (reply: FastifyReply) => reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');

async function deadline<T>(work: Promise<T>, milliseconds: number, code: string, onTimeout?: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { onTimeout?.(); reject(new Error(code)); }, milliseconds);
      timer.unref();
    })]);
  } finally { clearTimeout(timer); }
}

/** What door-to-door planning may read from the beta engine: platform-to-platform model answers, nothing else. */
export interface MetroOptionAnswer { departEpoch: number; arriveEpoch: number; service: 'A' | 'B' | null; toward: string; confidence: string; eventId: string | null; derivedExtension: boolean }
export interface MetroAnswerDto { status: string; message: string; options: MetroOptionAnswer[]; calendarWarning: boolean }
export interface JourneyBetaHandle { planMetro(line: 1 | 2, originId: string, destinationId: string, readyEpoch: number): Promise<MetroAnswerDto>; catalog(): TimetableSource['catalog'] }

export function registerJourneyBeta(app: FastifyInstance, options: JourneyBetaOptions): JourneyBetaHandle {
  const config: JourneyBetaConfig = { ...configFromEnv(), ...options.config };
  const calendar = structuredClone({ mode: config.calendarMode, ...(config.calendarDays === undefined ? {} : { days: config.calendarDays }) });
  assertCalendarPolicy(calendar);
  const clock = options.limiterClock ?? Date.now;
  let source: TimetableSource | null = null, closed = false;
  const getSource = (): TimetableSource => (source ??= (options.source ? boundedSource(options.source) : boundedSource(createModelSource(undefined, options.timetable ? { timetable: options.timetable } : {}), { reuseFrozenSnapshots: true })));
  const gate = createGate(config.maxConcurrent), feedbackGate = createGate(1);
  const journeyGlobal = createWindowLimiter(config.journeyGlobalPerMinute, 60_000, clock, 1);
  const journeyClient = createWindowLimiter(config.journeyClientPerMinute, 60_000, clock);
  const feedbackGlobal = createWindowLimiter(config.feedbackGlobalPerMinute, 60_000, clock, 1);
  const feedbackClient = createWindowLimiter(config.feedbackClientPerHour, 3_600_000, clock);
  const store = config.enabled && config.feedbackDir
    ? createFeedbackStore({ dir: config.feedbackDir, maxFileBytes: config.feedbackMaxFileBytes, maxPerDay: config.feedbackMaxPerDay, clock: options.now }) : null;
  app.addHook('onClose', async () => { closed = true; await store?.flush(); });
  const notFound = (reply: FastifyReply) => noStore(reply).code(404).send({ error: 'not_found' });

  app.get('/app/api/beta', async (_req, reply) => {
    noStore(reply);
    const control = betaControl(config);
    return { journey: { enabled: control.enabled, rolloutPercent: control.rolloutPercent,
      feedbackEnabled: control.enabled && control.feedbackEnabled && store !== null && !store.failed,
      calendarMode: config.calendarMode, horizonDays: config.horizonDays, windowMinutes: config.searchMinutes },
      ...(options.timetable ? { timetable: { state: options.timetable.status.state, overlayId: options.timetable.status.overlayId, reason: options.timetable.status.reason } } : {}) };
  });

  app.get('/app/api/journey', async (req: FastifyRequest, reply: FastifyReply) => {
    noStore(reply);
    if (closed || !betaControl(config).enabled) return notFound(reply);
    if (!journeyClient.allow(clientKey(req)) || !journeyGlobal.allow('all')) return reply.code(429).header('Retry-After', '10').send({ error: 'rate_limited' });
    if (!gate.tryEnter()) return reply.code(429).header('Retry-After', '2').send({ error: 'busy' });
    let transferred = false;
    try {
      const nowSec = options.now() / 1000, src = getSource();
      const parsed = parseJourneyQuery(req.query as Record<string, unknown>, src.catalog, nowSec, config);
      if (!parsed.ok) return reply.code(400).send({ error: 'bad_request', code: parsed.error });
      const work = planJourney({ schemaVersion: 1, requestId: newRequestId(), line: parsed.value.line,
        originId: parsed.value.originId, destinationId: parsed.value.destinationId, readyAt: parsed.value.readyAt,
        calendar, decisionPermission: 'granted', searchSeconds: config.searchMinutes * 60, maxCandidates: 12 }, src);
      // A timeout stops the response, not the underlying engine. Keep capacity reserved until it truly settles.
      work.then(() => gate.leave(), () => gate.leave());
      transferred = true;
      const result = await deadline(work, config.requestTimeoutMs, 'journey_timeout');
      return toJourneyDto(result, { query: parsed.value, catalog: src.catalog, modelVersion: src.dataVersion, ...(src.identityVersion === undefined ? {} : { identityVersion: src.identityVersion }), ...(options.timetable ? { timetableStatus: options.timetable.status } : {}), config, nowSec });
    } catch (error) {
      return reply.code(503).send({ error: (error as Error).message === 'journey_timeout' ? 'journey_timeout' : 'journey_unavailable' });
    } finally { if (!transferred) gate.leave(); }
  });

  const feedbackError = (error: Error & { statusCode?: number }, _req: FastifyRequest, reply: FastifyReply) => {
    store?.reject('malformed_request');
    const status = error.statusCode === 413 || error.statusCode === 415 ? error.statusCode : 400;
    return noStore(reply).code(status).send({ error: status === 413 ? 'too_large' : status === 415 ? 'unsupported_media_type' : 'malformed_json' });
  };

  app.post('/app/api/journey-feedback', {
    bodyLimit: 4096, errorHandler: feedbackError,
    // Do this before body parsing: malformed attacker-controlled bodies must not bypass origin or admission policy.
    onRequest: async (req, reply) => {
      noStore(reply);
      const control = betaControl(config);
      if (closed || !control.enabled) return notFound(reply);
      if (!control.feedbackEnabled || !store || store.failed) return reply.code(503).send({ error: 'feedback_unavailable' });
      if (!feedbackClient.allow(clientKey(req)) || !feedbackGlobal.allow('all')) {
        store.reject('rate_limited');
        return reply.code(429).header('Retry-After', '60').send({ error: 'rate_limited' });
      }
      const origin = req.headers.origin;
      if (req.headers['x-besrah-beta'] !== '1' || (origin !== undefined && !config.allowedOrigins.includes(origin)) || req.headers['sec-fetch-site'] === 'cross-site') {
        store.reject('forbidden_origin'); return reply.code(403).send({ error: 'forbidden' });
      }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
        store.reject('malformed_request'); return reply.code(415).send({ error: 'unsupported_media_type' });
      }
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!store) return reply.code(503).send({ error: 'feedback_unavailable' });
    if (!feedbackGate.tryEnter()) { store.reject('busy'); return reply.code(429).header('Retry-After', '2').send({ error: 'busy' }); }
    if (!gate.tryEnter()) { feedbackGate.leave(); store.reject('busy'); return reply.code(429).header('Retry-After', '2').send({ error: 'busy' }); }
    let transferred = false, expired = false;
    try {
      const src = getSource(), nowMs = options.now();
      const checked = validateFeedback(req.body, { nowSec: nowMs / 1000, catalog: src.catalog, modelVersion: src.dataVersion, horizonDays: config.horizonDays });
      if (!checked.ok) { store.reject('invalid_payload'); return reply.code(400).send({ error: 'invalid', issues: checked.issues }); }
      const value = checked.value, versionMatches = value.modelVersion === src.dataVersion;
      const work = (async () => {
        let comparison: StoredFeedback['comparison'] = { tripMatch: value.context.tripId ? (versionMatches ? 'unmatched' : 'model_version_mismatch') : 'not_provided', modelEventAt: null, deltaSeconds: null };
        if (value.context.tripId && versionMatches) {
          try {
            const resolved = resolveCalendar(value.context.serviceDate, calendar);
            if (resolved.dayType) {
              const day = await src.getDay(value.context.line, value.context.serviceDate, resolved.dayType);
              const trip = day.trips.find(t => t.id === value.context.tripId && t.line === value.context.line && t.serviceDate === value.context.serviceDate);
              const origin = trip?.stops.find(s => s.stationId === value.context.originId), destination = trip?.stops.find(s => s.stationId === value.context.destinationId);
              const ready = value.context.readyAt === null ? null : Date.parse(value.context.readyAt) / 1000;
              if (trip && origin && destination && origin.sequence < destination.sequence && (ready === null || origin.depart >= ready) && destination.arrive >= origin.depart) {
                comparison = { tripMatch: 'matched', modelEventAt: null, deltaSeconds: null };
                const observed = value.observation;
                const stop = observed ? trip.stops.find(s => s.stationId === observed.stationId) : undefined;
                if (observed && (observed.direction === 'unknown' || observed.direction !== trip.direction || !stop || stop.sequence < origin.sequence || stop.sequence > destination.sequence
                  || (observed.event === 'train_departure' && stop.sequence === trip.stops.length - 1)
                  || (observed.event === 'train_arrival' && stop.sequence === 0))) {
                  comparison = { tripMatch: 'unmatched', modelEventAt: null, deltaSeconds: null };
                } else if (observed && stop) {
                  const modelEpoch = Math.round(observed.event === 'train_arrival' ? stop.arrive : stop.depart);
                  comparison = { tripMatch: 'matched', modelEventAt: isoTehran(modelEpoch), deltaSeconds: observed.observedAtEpoch - modelEpoch };
                }
              }
            }
          } catch { /* Preserve the anonymous claim, but never invent a model comparison after a lookup fault. */ }
        }
        if (closed || expired) throw new Error('feedback_timeout');
        const record = toStored(value, { receivedAtEpoch: Math.floor(nowMs / 1000), modelVersionMatches: versionMatches, comparison });
        const outcome = await store.append(record);
        return { outcome, reportId: value.reportId, receivedDate: tehranDay(nowMs / 1000) };
      })();
      work.then(() => { gate.leave(); feedbackGate.leave(); }, () => { gate.leave(); feedbackGate.leave(); });
      transferred = true;
      const result = await deadline(work, config.requestTimeoutMs, 'feedback_timeout', () => { expired = true; });
      if (result.outcome === 'duplicate') return { status: 'duplicate', reportId: result.reportId };
      if (result.outcome === 'full') { store.reject('storage_full'); return reply.code(503).send({ error: 'feedback_full' }); }
      if (result.outcome === 'unavailable') return reply.code(503).send({ error: 'feedback_unavailable' });
      return reply.code(201).send({ status: 'stored', reportId: result.reportId, receivedDate: result.receivedDate });
    } catch (error) {
      const timedOut = (error as Error).message === 'feedback_timeout';
      store.reject(timedOut ? 'feedback_timeout' : 'model_unavailable');
      return reply.code(503).send({ error: timedOut ? 'feedback_timeout' : 'feedback_unavailable' });
    } finally { if (!transferred) { gate.leave(); feedbackGate.leave(); } }
  });

  // Shared with the door-to-door planner: same gate, same deadline, same model source. Throws when the beta is off.
  const planMetro: JourneyBetaHandle['planMetro'] = async (line, originId, destinationId, readyEpoch) => {
    if (closed || !betaControl(config).enabled) throw new Error('metro_disabled');
    if (!gate.tryEnter()) throw new Error('busy');
    let transferred = false;
    try {
      const nowSec = options.now() / 1000, src = getSource();
      const query = { line, originId, destinationId, readyAt: isoTehran(Math.floor(readyEpoch)), readyEpoch: Math.floor(readyEpoch), source: 'user_selected' as const };
      const work = planJourney({ schemaVersion: 1, requestId: newRequestId(), line, originId, destinationId, readyAt: query.readyAt, calendar, decisionPermission: 'granted', searchSeconds: config.searchMinutes * 60, maxCandidates: 12 }, src);
      work.then(() => gate.leave(), () => gate.leave());
      transferred = true;
      const result = await deadline(work, config.requestTimeoutMs, 'journey_timeout');
      const dto = toJourneyDto(result, { query, catalog: src.catalog, modelVersion: src.dataVersion, ...(src.identityVersion === undefined ? {} : { identityVersion: src.identityVersion }), ...(options.timetable ? { timetableStatus: options.timetable.status } : {}), config, nowSec });
      const usable = dto.status === 'ok' || dto.status === 'partial';
      return { status: dto.status, message: dto.message ?? "", calendarWarning: dto.calendar.warning,
        options: usable ? dto.options.map(o => ({ departEpoch: o.departEpoch, arriveEpoch: o.arriveEpoch, service: o.service, toward: o.toward, confidence: o.confidence, eventId: o.eventId, derivedExtension: o.derivedExtension })) : [] };
    } finally { if (!transferred) gate.leave(); }
  };
  return { planMetro, catalog: () => getSource().catalog };
}
