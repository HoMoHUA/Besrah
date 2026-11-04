import { tehranToEpoch } from '../../src/time.js';
import { createModelSource } from '../../src/transit-journey/index.js';
import type { TimetableSource } from '../../src/transit-journey/contracts.js';
import type { JourneyBetaConfig } from '../../src/journey-beta/config.js';

export const at = (day: string, hms: string): number => tehranToEpoch(day, hms) * 1000;
export const FRIDAY_14 = at('2026-10-16', '14:00:00');
let source: TimetableSource | null = null;
export const realSource = (): TimetableSource => (source ??= createModelSource());
export const betaOn = (extra: Partial<JourneyBetaConfig> = {}): Partial<JourneyBetaConfig> => ({ enabled: true, rolloutPercent: 100, ...extra });
export const H7 = 'METRO-107', DA = 'METRO-108', VAKILABAD = 'METRO-101', GHADIR = 'METRO-122', AIRPORT = 'METRO-124';
export const q = (params: Record<string, string>): string => '/app/api/journey?' + new URLSearchParams(params).toString();
export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
