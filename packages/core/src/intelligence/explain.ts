import { METRIC_UNITS } from './contracts.js';
import type { Candidate, Claim, ConstraintCheck, Explanation, MetricKey, MetricRef, OptionLabel } from './contracts.js';
import { metricBounds } from './metrics.js';

const metricNames: Record<MetricKey, string> = {
  totalCostToman: 'هزینه',
  listedItemPriceToman: 'قیمت ثبت‌شدهٔ قلم (بدون ارسال)',
  distanceMeters: 'فاصلهٔ هوایی',
  durationSeconds: 'زمان سفر',
  walkingSeconds: 'زمان پیاده روی',
  transfers: 'تعداد تعویض',
  quality: 'کیفیت',
  arrivalEpochSeconds: 'زمان رسیدن',
};
const unitNames = {
  toman: 'تومان', meters: 'متر', seconds: 'ثانیه', count: 'بار', score_0_100: 'امتیاز', epoch_seconds: 'ثانیه از مبدأ یونیکس',
} as const;
const labelTexts: Record<OptionLabel, string> = {
  fastest: 'سریع ترین است',
  lowest_cost: 'کم هزینه ترین است',
  lowest_listed_item_price: 'کمترین قیمت قلم ثبت‌شده در میان همین گزینه‌های هم‌نام و قابل مقایسه است',
  preference_match: 'با اولویت انتخابی هماهنگ است',
  pareto_option: 'گزینه ای نامغلوب است',
};

function refFor(candidate: Candidate, metric: MetricKey): MetricRef {
  return { candidateId: candidate.id, metric, evidenceIds: [...new Set(candidate.metrics[metric]?.evidence?.map(item => item.id) ?? [])] };
}

// Labels are engine-authorized, not global/provider-wide superlatives inferred here.
export function explainCandidate(candidate: Candidate, at: string, labels: OptionLabel[], checks: ConstraintCheck[]): Explanation {
  const claims: Claim[] = [];
  const usableRefs: MetricRef[] = [];
  for (const key of Object.keys(METRIC_UNITS) as MetricKey[]) {
    const metric = candidate.metrics[key];
    if (!metric) continue;
    const bounds = metricBounds(metric, at);
    const ref = refFor(candidate, key);
    if (!bounds) {
      claims.push({ code: `metric_unavailable:${key}`, text: `دادهٔ قابل استفاده برای ${metricNames[key]} موجود نیست.`, refs: [ref] });
      continue;
    }
    usableRefs.push(ref);
    // Format only the supplied bounds: no midpoint, rounding, unit conversion or savings.
    const value = bounds.min === bounds.max ? String(bounds.min) : `${bounds.min} تا ${bounds.max}`;
    claims.push({ code: `metric:${key}`, text: `${metricNames[key]}${bounds.estimated ? ' (برآورد)' : ''}: ${value} ${unitNames[metric.unit]}.`, refs: [ref] });
  }
  for (const label of new Set(labels)) {
    const refs = usableRefs.filter(ref => label === 'fastest' ? ref.metric === 'durationSeconds' : label === 'lowest_cost' ? ref.metric === 'totalCostToman' : label === 'lowest_listed_item_price' ? ref.metric === 'listedItemPriceToman' : true);
    if (!refs.length) continue;
    claims.push({ code: `label:${label}`, text: `در میان گزینه های هم ارز و واجد شرایط ارائه شده، ${labelTexts[label]}.`, refs });
  }
  for (const check of checks) {
    if (check.candidateId !== candidate.id || check.ref.candidateId !== candidate.id) continue;
    const text = check.status === 'satisfied' ? 'محدودیت رعایت شده است.'
      : check.status === 'violated' ? 'محدودیت رعایت نشده است.' : 'رعایت محدودیت مشخص نیست.';
    // Do not echo free-form reasons or trust external evidence IDs as numeric authority.
    claims.push({ code: `constraint:${check.constraintId}`, text, refs: candidate.metrics[check.ref.metric] ? [refFor(candidate, check.ref.metric)] : [] });
  }
  return { candidateId: candidate.id, claims };
}
