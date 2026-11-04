// Read-only journey beta DTO. Model-only, same line, platform to platform: never live, never door-to-door.
import { randomBytes } from 'node:crypto';
import { epochToTehranHms, tehranDay, tehranToEpoch } from '../time.js';
import type { DayType } from '../time.js';
import type { CalendarResolution, Journey, JourneyResult, MetroLine, StationCatalog } from '../transit-journey/contracts.js';
import { tripEventId } from '../timetable-registry.js';
import { isTimetableDegraded, TIMETABLE_DEGRADED_NOTICE, type TimetableStatus } from '../timetable-overlay.js';
import type { JourneyBetaConfig } from './config.js';

export const JOURNEY_QUERY_KEYS: ReadonlySet<string> = new Set(['line', 'from', 'to', 'date', 'time']);
const STATION_ID = /^METRO-\d{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export type QueryError = 'unknown_parameter' | 'bad_line' | 'bad_station' | 'same_station' | 'bad_date' | 'bad_time' | 'date_and_time_together' | 'date_out_of_range' | 'time_in_past';
export interface ParsedQuery { line: MetroLine; originId: string; destinationId: string; readyAt: string; readyEpoch: number; source: 'server_now' | 'user_selected' }

export const isoTehran = (epoch: number): string => `${tehranDay(epoch)}T${epochToTehranHms(epoch)}+03:30`;
const hhmm = (epoch: number): string => epochToTehranHms(epoch).slice(0, 5);

export function parseJourneyQuery(query: Record<string, unknown>, catalog: StationCatalog, nowSec: number, config: JourneyBetaConfig): { ok: true; value: ParsedQuery } | { ok: false; error: QueryError } {
  for (const key of Object.keys(query)) if (!JOURNEY_QUERY_KEYS.has(key)) return { ok: false, error: 'unknown_parameter' };
  for (const key of JOURNEY_QUERY_KEYS) if (query[key] !== undefined && typeof query[key] !== 'string') return { ok: false, error: key === 'line' ? 'bad_line' : 'unknown_parameter' };
  const q = query as Record<string, string | undefined>;
  if (q.line !== '1' && q.line !== '2') return { ok: false, error: 'bad_line' };
  const line = Number(q.line) as MetroLine;
  const order = catalog.orders[line];
  for (const id of [q.from, q.to]) if (typeof id !== 'string' || !STATION_ID.test(id) || !order.includes(id)) return { ok: false, error: 'bad_station' };
  if (q.from === q.to) return { ok: false, error: 'same_station' };
  const originId = q.from as string, destinationId = q.to as string;
  if ((q.date === undefined) !== (q.time === undefined)) return { ok: false, error: 'date_and_time_together' };
  if (q.date === undefined) {
    const sec = Math.floor(nowSec);
    return { ok: true, value: { line, originId, destinationId, readyAt: isoTehran(sec), readyEpoch: sec, source: 'server_now' } };
  }
  if (!DATE.test(q.date) || tehranDay(tehranToEpoch(q.date, '12:00:00')) !== q.date) return { ok: false, error: 'bad_date' };
  if (!TIME.test(q.time as string)) return { ok: false, error: 'bad_time' };
  const readyEpoch = tehranToEpoch(q.date, `${q.time}:00`);
  const todayStart = tehranToEpoch(tehranDay(nowSec), '00:00:00');
  const dayStart = tehranToEpoch(q.date, '00:00:00');
  const daysAhead = Math.round((dayStart - todayStart) / 86400);
  if (daysAhead < 0 || daysAhead > config.horizonDays) return { ok: false, error: 'date_out_of_range' };
  if (readyEpoch < nowSec - 300) return { ok: false, error: 'time_in_past' };
  return { ok: true, value: { line, originId, destinationId, readyAt: `${q.date}T${q.time}:00+03:30`, readyEpoch, source: 'user_selected' } };
}

export const newRequestId = (): string => 'beta:' + randomBytes(6).toString('hex');

const STATUS_MESSAGE: Record<string, string | null> = {
  ok: null,
  partial: 'اطلاعات این بازه کامل نیست و فهرست ممکن است ناقص باشد.',
  insufficient_data: 'برای این روز برنامه ای که بتوان به آن اعتماد کرد در مدل نیست؛ زمان بندی نمایش داده نمی شود.',
  no_feasible_option: 'در این بازه قطاری که از مبدأ به مقصد برسد در مدل پیدا نشد. ممکن است سرویس تمام شده یا هنوز شروع نشده باشد.',
  unsupported: 'این درخواست در مدل پشتیبانی نمی شود.',
};
const CALENDAR_LABEL: Record<string, string> = { normal: 'برنامهٔ روز عادی', thursday: 'برنامهٔ پنجشنبه', friday: 'برنامهٔ جمعه' };

export interface CalendarDto { state: 'known' | 'estimated' | 'unknown'; dayType: DayType | null; label: string; warning: boolean; serviceDate: string }

export function calendarDto(calendars: readonly CalendarResolution[], readyDate: string): CalendarDto {
  const c = calendars.find(x => x.date === readyDate) ?? calendars[0];
  if (!c) return { state: 'unknown', dayType: null, label: 'برنامهٔ این روز در مدل تأیید نشده است', warning: true, serviceDate: readyDate };
  const label = c.state === 'unknown' ? 'برنامهٔ این روز در مدل تأیید نشده است'
    : c.state === 'estimated' ? `${CALENDAR_LABEL[c.dayType ?? 'normal']} (تخمینی؛ تعطیلی رسمی بررسی نشده)`
      : c.sourceId === 'besrah:gregorian-weekday' ? `${CALENDAR_LABEL[c.dayType ?? 'friday']} (تعطیلات رسمی تأیید نشده)`
        : `${CALENDAR_LABEL[c.dayType ?? 'friday']} (طبق تقویم اعلام شده؛ نه تضمین عملیاتی)`;
  // Even a known Friday model is a schedule model, not an operational guarantee: keep a gentle warning for estimated/unknown only.
  return { state: c.state, dayType: c.dayType ?? null, label, warning: c.state !== 'known', serviceDate: c.date };
}

function towardLabel(catalog: StationCatalog, line: MetroLine, journey: Journey): string {
  const order = catalog.orders[line];
  const forward = order.indexOf(journey.destination.stationId) > order.indexOf(journey.origin.stationId);
  const name = (id: string) => catalog.stations.find(s => s.id === id)?.name ?? id;
  if (line === 1) {
    if (!forward) return 'وکیل آباد';
    return journey.service === 'B' ? 'فرودگاه' : 'غدیر';
  }
  return name(forward ? order[order.length - 1] : order[0]).replace(/\u200c/g, ' ');
}

export interface OptionDto { id: string; service: 'A' | 'B' | null; toward: string; departAt: string; arriveAt: string; departDate: string; arriveDate: string; departEpoch: number; arriveEpoch: number; waitSeconds: number; inVehicleSeconds: number; earliestArrival: boolean; derivedExtension: boolean; confidence: string; eventId: string | null }

const BASELINE_ONLY_MESSAGE = 'برنامهٔ این روز در مدل تخمینی است و تعطیلی رسمی بررسی نشده؛ فهرست بر پایهٔ برنامهٔ روزهای عادی مدل است.';

export function toJourneyDto(result: JourneyResult, ctx: { query: ParsedQuery; catalog: StationCatalog; modelVersion: string; identityVersion?: string; timetableStatus?: TimetableStatus; config: JourneyBetaConfig; nowSec: number }) {
  const { query, catalog } = ctx;
  const name = (id: string) => catalog.stations.find(s => s.id === id)?.name ?? id;
  const usable = result.status === 'ok' || result.status === 'partial';
  const sorted = usable ? [...result.journeys].sort((a, b) => a.departureEpochSeconds - b.departureEpochSeconds || a.arrivalEpochSeconds - b.arrivalEpochSeconds) : [];
  const earliest = sorted.length ? Math.min(...sorted.map(j => j.arrivalEpochSeconds)) : null;
  // Keep the actual earliest-arrival candidate when display limits hide later departures.
  const selected = sorted.slice(0, ctx.config.maxOptions);
  const earliestCandidate = sorted.find(j => j.arrivalEpochSeconds === earliest);
  if (earliestCandidate && !selected.includes(earliestCandidate) && selected.length) selected[selected.length - 1] = earliestCandidate;
  selected.sort((a, b) => a.departureEpochSeconds - b.departureEpochSeconds || a.arrivalEpochSeconds - b.arrivalEpochSeconds);
  const clipped = sorted.length > selected.length;
  const status = usable && clipped ? 'partial' : result.status;
  const options: OptionDto[] = selected.map(j => ({
    id: j.tripId, service: j.service, toward: towardLabel(catalog, query.line, j),
    departAt: hhmm(j.departureEpochSeconds), arriveAt: hhmm(j.arrivalEpochSeconds),
    departDate: tehranDay(j.departureEpochSeconds), arriveDate: tehranDay(j.arrivalEpochSeconds),
    departEpoch: Math.floor(j.departureEpochSeconds), arriveEpoch: Math.floor(j.arrivalEpochSeconds),
    waitSeconds: Math.max(0, Math.round(j.departureEpochSeconds - query.readyEpoch)),
    inVehicleSeconds: Math.max(0, Math.round(j.arrivalEpochSeconds - j.departureEpochSeconds)),
    earliestArrival: j.arrivalEpochSeconds === earliest, derivedExtension: j.derivedExtension, confidence: j.confidence,
    eventId: ctx.identityVersion === undefined ? null : tripEventId(ctx.identityVersion, j.serviceDate, j.line, j.sourceTrainId),
  }));
  const readyDate = tehranDay(query.readyEpoch);
  const issueCodes = [...new Set(result.diagnostics.issues.map(i => i.code))].sort();
  // A weekday baseline is always 'partial' by design; its only issue is already shown as the calendar warning.
  const baselineOnly = status === 'partial' && issueCodes.length > 0 && issueCodes.every(code => code === 'holidays_unverified_weekday_baseline');
  const baseMessage = baselineOnly ? BASELINE_ONLY_MESSAGE + (clipped ? ` ${STATUS_MESSAGE.partial}` : '') : (STATUS_MESSAGE[status] ?? STATUS_MESSAGE.unsupported);
  const calendar = calendarDto(result.diagnostics.calendars, readyDate);
  // Only normal-day line 1 answers depend on the overlay; Thursday, Friday and line 2 never carry the notice.
  const degraded = ctx.timetableStatus !== undefined && isTimetableDegraded(ctx.timetableStatus) && query.line === 1 && calendar.dayType === 'normal';
  const message = degraded ? `${TIMETABLE_DEGRADED_NOTICE} ${baseMessage}` : baseMessage;
  return {
    schemaVersion: 1 as const, beta: true as const, modelOnly: true as const, live: false as const,
    status, reason: clipped ? 'display_candidate_limit' : result.reason, message,
    request: { line: query.line, originId: query.originId, destinationId: query.destinationId, originName: name(query.originId), destinationName: name(query.destinationId), readyAt: query.readyAt, source: query.source, windowMinutes: ctx.config.searchMinutes },
    calendar,
    modelVersion: ctx.modelVersion,
    ...(degraded && ctx.timetableStatus ? { timetableNotice: { state: ctx.timetableStatus.state } } : {}),
    options,
    coverage: { complete: result.diagnostics.complete && !clipped, truncated: result.diagnostics.candidateTruncated || clipped, listed: options.length, matched: result.diagnostics.matchedTrips, rejectedTrips: result.diagnostics.rejectedTrips, issueCodes },
    asOf: isoTehran(Math.floor(ctx.nowSec)),
    validUntil: isoTehran(Math.floor(ctx.nowSec) + 30),
  };
}
