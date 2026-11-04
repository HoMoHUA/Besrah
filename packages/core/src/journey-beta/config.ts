// Production-beta configuration. Everything defaults to OFF/safe; invalid values fall back to the safe default.
import type { CalendarEntry } from '../transit-journey/contracts.js';
export interface JourneyBetaConfig {
  enabled: boolean;
  /** Optional root-managed local control file; missing/unsafe content disables beta without restarting the core. */
  switchFile: string | null;
  /** UI exposure share 0..100 for non-opted-in visitors. The read-only API itself is open whenever enabled. */
  rolloutPercent: number;
  calendarMode: 'strict' | 'weekday_baseline';
  /** Trusted, server-side declarations only. A public request can never declare its own service calendar. */
  calendarDays?: CalendarEntry[];
  /** Absolute directory for append-only feedback JSONL. null disables feedback writes. */
  feedbackDir: string | null;
  allowedOrigins: readonly string[];
  maxConcurrent: number;
  journeyGlobalPerMinute: number;
  journeyClientPerMinute: number;
  feedbackGlobalPerMinute: number;
  feedbackClientPerHour: number;
  feedbackMaxPerDay: number;
  feedbackMaxFileBytes: number;
  horizonDays: number;
  searchMinutes: number;
  maxOptions: number;
  requestTimeoutMs: number;
}

const int = (value: string | undefined, fallback: number, min: number, max: number): number => {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

export const DEFAULT_JOURNEY_BETA_CONFIG: JourneyBetaConfig = Object.freeze({
  enabled: false, switchFile: null, rolloutPercent: 0, calendarMode: 'weekday_baseline', feedbackDir: null,
  allowedOrigins: Object.freeze(['https://besrah.arklyn.ir']),
  maxConcurrent: 2, journeyGlobalPerMinute: 60, journeyClientPerMinute: 10,
  feedbackGlobalPerMinute: 30, feedbackClientPerHour: 10, feedbackMaxPerDay: 2000, feedbackMaxFileBytes: 8 * 1024 * 1024,
  horizonDays: 7, searchMinutes: 120, maxOptions: 5, requestTimeoutMs: 5000,
});

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): JourneyBetaConfig {
  const dir = env.BESRAH_FEEDBACK_DIR;
  const origins = (env.BESRAH_ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(s => /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(s));
  return {
    ...DEFAULT_JOURNEY_BETA_CONFIG,
    enabled: env.BESRAH_JOURNEY_BETA === 'on',
    switchFile: env.BESRAH_JOURNEY_SWITCH_FILE === undefined ? null : env.BESRAH_JOURNEY_SWITCH_FILE,
    rolloutPercent: int(env.BESRAH_JOURNEY_ROLLOUT_PERCENT, 0, 0, 100),
    calendarMode: env.BESRAH_JOURNEY_CALENDAR === 'strict' ? 'strict' : 'weekday_baseline',
    feedbackDir: dir && dir.startsWith('/') && !dir.includes('..') ? dir : null,
    allowedOrigins: origins.length ? origins : DEFAULT_JOURNEY_BETA_CONFIG.allowedOrigins,
    maxConcurrent: int(env.BESRAH_JOURNEY_MAX_CONCURRENT, 2, 1, 8),
  };
}
