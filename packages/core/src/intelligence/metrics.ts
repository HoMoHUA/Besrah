import type { Bounds, NumericMetric } from './contracts.js';

// Caller supplies the clock: no Date.now, network, storage, midpoint or fallback value.
export function metricBounds(metric: NumericMetric | undefined, at: string): Bounds | null {
  const now = Date.parse(at);
  if (!Number.isFinite(now) || !metric || (metric.state !== 'known' && metric.state !== 'estimated')) return null;
  if (!metric.evidence.length || metric.evidence.some(e =>
    (e.validUntil !== undefined && (!Number.isFinite(Date.parse(e.validUntil)) || Date.parse(e.validUntil) <= now)) ||
    (e.observedAt !== undefined && (!Number.isFinite(Date.parse(e.observedAt)) || Date.parse(e.observedAt) > now)) ||
    (e.retrievedAt !== undefined && (!Number.isFinite(Date.parse(e.retrievedAt)) || Date.parse(e.retrievedAt) > now)))) return null;
  const min = metric.state === 'estimated' && metric.interval ? metric.interval.min : metric.value;
  const max = metric.state === 'estimated' && metric.interval ? metric.interval.max : metric.value;
  if (min === undefined || max === undefined || !Number.isFinite(min) || !Number.isFinite(max) || min < 0 || min > max) return null;
  return { min, max, estimated: metric.state === 'estimated' };
}
