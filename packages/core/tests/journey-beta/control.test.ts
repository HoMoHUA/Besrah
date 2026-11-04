import { existsSync, mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { DEFAULT_JOURNEY_BETA_CONFIG, configFromEnv } from '../../src/journey-beta/config.js';
import { betaOn, DA, FRIDAY_14, H7, q, realSource } from './helpers.js';

const query = q({ line: '1', from: H7, to: DA });
describe('production beta control, off without a runtime restart', () => {
  it('defaults off with a two-hour, bounded read window', () => {
    expect(configFromEnv({}).enabled).toBe(false);
    expect(DEFAULT_JOURNEY_BETA_CONFIG.searchMinutes).toBe(120);
  });
  it('honours an explicit runtime off switch without touching existing metro APIs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-control-'));
    const file = join(dir, 'switch.json');
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, enabled: true, rolloutPercent: 10, feedbackEnabled: false }));
    const app = buildServer({ now: () => FRIDAY_14, journeySource: realSource(),
      journeyBeta: betaOn({ switchFile: file }), limiterClock: () => 1 });
    try {
      expect((await app.inject({ method: 'GET', url: query })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/app/api/beta' })).json().journey.rolloutPercent).toBe(10);
      writeFileSync(file, JSON.stringify({ schemaVersion: 1, enabled: false, rolloutPercent: 0, feedbackEnabled: false }));
      expect((await app.inject({ method: 'GET', url: query })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: '/app/api/beta' })).json().journey.enabled).toBe(false);
      expect((await app.inject({ method: 'GET', url: '/app/api/stations' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    } finally { await app.close(); }
  });
  it('fails closed for a missing, malformed, oversized, writable or symlink switch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-control-bad-'));
    const file = join(dir, 'switch.json'), link = join(dir, 'link.json');
    for (const input of [null, '{}', '{"schemaVersion":1,"enabled":true,"rolloutPercent":101,"feedbackEnabled":true}', 'x'.repeat(2048)]) {
      if (input !== null) writeFileSync(file, input);
      const app = buildServer({ now: () => FRIDAY_14, journeySource: realSource(), journeyBeta: betaOn({ switchFile: file }) });
      try { expect((await app.inject({ method: 'GET', url: query })).statusCode).toBe(404); }
      finally { await app.close(); }
    }
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, enabled: true, rolloutPercent: 0, feedbackEnabled: false }));
    symlinkSync(file, link);
    const app = buildServer({ now: () => FRIDAY_14, journeySource: realSource(), journeyBeta: betaOn({ switchFile: link }) });
    try { expect((await app.inject({ method: 'GET', url: query })).statusCode).toBe(404); }
    finally { await app.close(); }
  });
});
