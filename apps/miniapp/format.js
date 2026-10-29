// Pure display helpers (Persian digits, ETA, labels). The UI layer wraps HM7.shop for animation;
// these functions are the testable source of the strings.
import { groupPasses } from './logic.js';

const FA = '۰۱۲۳۴۵۶۷۸۹';
export const fa = value => String(value).replace(/[0-9]/g, d => FA[+d]);

export function etaParts(minutes) {
  return minutes === 0 ? { value: 'اکنون', unit: '' } : { value: fa(minutes), unit: 'دقیقه' };
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
};
export const confidenceLabel = value => CONFIDENCE[value] ?? null;

export function distanceLabel(km) {
  if (km < 1) return `${fa(Math.max(1, Math.round(km * 100)) * 10)} متر`;
  const rounded = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
  return `${fa(String(rounded).replace('.', '٫'))} کیلومتر`;
}

export const headingFor = toward => (toward.startsWith('ورودی') ? toward : `به سمت ${toward}`);

export function lineLabel(lines = []) {
  return lines.length ? `خط ${fa(lines.join(' و '))}` : '';
}

// Earliest train per direction, two directions at most — the hero and the favourites use this.
export function summarizeBoard(board, maxDirections = 2) {
  return groupPasses(board?.passes ?? []).slice(0, maxDirections).map(([toward, passes]) => ({
    heading: headingFor(toward), eta: passes[0].eta_min, text: etaText(passes[0].eta_min),
  }));
}
