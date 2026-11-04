// Pure display helpers (Persian digits, ETA, labels). The UI layer wraps HM7.shop for animation;
// these functions are the testable source of the strings.
import { groupPasses } from './logic.js';

const FA = '۰۱۲۳۴۵۶۷۸۹';
export const fa = value => String(value).replace(/[0-9]/g, d => FA[+d]);

// Arrival wording. The timetable model can be a little late, so a train that is at most one minute away is never
// counted down to "0 minutes" or "now": it reads "در حال ورود" and keeps reading that until it is really gone.
// Two minutes is the smallest number of minutes ever shown.
export const ARRIVING_S = 60;
export const ARRIVING_LABEL = 'در حال ورود';
export function arrivalState(seconds) {
  if (!Number.isFinite(seconds)) return null;
  return seconds <= ARRIVING_S ? { arriving: true, minutes: 0 } : { arriving: false, minutes: Math.ceil(seconds / 60) };
}
export const arrivalText = seconds => {
  const state = arrivalState(seconds);
  return !state ? '' : state.arriving ? ARRIVING_LABEL : `حدود ${fa(state.minutes)} دقیقه`;
};
// Whole minutes as the server rounds them (ceil): 0 and 1 both mean "within the last minute".
export function etaParts(minutes) {
  return minutes <= 1 ? { value: ARRIVING_LABEL, unit: '' } : { value: fa(minutes), unit: 'دقیقه' };
}
export function etaText(minutes) {
  const { value, unit } = etaParts(minutes);
  return unit ? `${value} ${unit}` : value;
}

export function clockLabel(hms, { seconds = false } = {}) {
  const [h = '', m = '', s = ''] = String(hms ?? '').split(':');
  if (!h || !m) return '';
  return fa(seconds && s ? `${h}:${m}:${s}` : `${h}:${m}`);
}
export function asOfLabel(asOf, options) {
  const clock = clockLabel(asOf, options);
  return clock ? `${clock} به وقت تهران` : '';
}

const DAYS = { thursday: 'برنامهٔ پنجشنبه', friday: 'برنامهٔ جمعه', normal: 'برنامهٔ روز عادی' };
export const dayTypeLabel = dayType => DAYS[dayType] ?? '';

const CONFIDENCE = {
  official_sheet_phase: { text: 'بر پایهٔ جدول رسمی', tone: 'ok' },
  measured_phase: { text: 'زمان سنجی میدانی', tone: 'ok' },
  site_headway_assumed_phase: { text: 'برآورد از فاصلهٔ حرکت', tone: 'warn' },
  // Beta normal-day model (line 1): a timed phase carried to other days, and a printed sheet shifted by a derived offset. Never presented as live or confirmed.
  generalized_observation_phase: { text: 'برآورد بر پایهٔ زمان سنجی ۱۲ آبان', tone: 'warn' },
  sheet_derived_phase: { text: 'برآورد بر پایهٔ جدول چاپی فرودگاه', tone: 'warn' },
};
export const confidenceLabel = value => CONFIDENCE[value] ?? null;

export function distanceLabel(km) {
  if (km < 1) return `${fa(Math.max(1, Math.round(km * 100)) * 10)} متر`;
  const rounded = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
  return `${fa(String(rounded).replace('.', '٫'))} کیلومتر`;
}

export const headingFor = toward => (toward.startsWith('ورودی') ? toward : `به سمت ${toward}`);

// Lines the backend can time. A station on none of them stays visible but opens nothing.
export const SUPPORTED_LINES = [1, 2];
export const isSupported = station => (station?.lines ?? []).some(line => SUPPORTED_LINES.includes(line));

export function lineLabel(lines = []) {
  return lines.length ? `خط ${fa(lines.join(' و '))}` : '';
}

// Earliest train per direction, two directions at most — the hero and the favourites use this.
// When an interchange board mixes two lines, each heading names its line.
export function summarizeBoard(board, maxDirections = 2) {
  const all = board?.passes ?? [];
  const mixed = new Set(all.map(p => p.line).filter(Boolean)).size > 1;
  return groupPasses(all).slice(0, maxDirections).map(([toward, passes]) => ({
    heading: headingFor(toward) + (mixed && passes[0].line ? ` · خط ${fa(passes[0].line)}` : ''),
    eta: passes[0].eta_min, text: etaText(passes[0].eta_min),
  }));
}
