import { describe, expect, it } from 'vitest';
import { dayTypeOf, epochToTehranHms, tehranToEpoch } from '../src/time.js';

describe('tehran clock', () => {
  it('reads Tehran wall time and round-trips', () => {
    const e = tehranToEpoch('2026-10-16', '13:59:51');
    expect(epochToTehranHms(e)).toBe('13:59:51');
    expect(new Date(e * 1000).toISOString()).toBe('2026-10-16T10:29:51.000Z');
  });

  it('classifies day types (Friday, Thursday, normal) in Tehran time', () => {
    expect(dayTypeOf(tehranToEpoch('2026-10-16', '13:59:51'))).toBe('friday');
    expect(dayTypeOf(tehranToEpoch('2026-10-15', '10:00:00'))).toBe('thursday');
    expect(dayTypeOf(tehranToEpoch('2026-10-21', '10:00:00'))).toBe('normal');
    // 00:10 Friday in Tehran is still Thursday night in UTC: must still be Friday
    expect(dayTypeOf(tehranToEpoch('2026-10-16', '00:10:00'))).toBe('friday');
  });
});
