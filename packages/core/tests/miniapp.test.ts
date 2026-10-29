import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server.js';

 describe('miniapp metadata', () => {
  it('shares the original next handler without timing changes', async () => {
    const app = buildServer({ now: () => Date.parse('2026-10-16T10:30:00Z') });
    const query = '?station=' + encodeURIComponent('شریعتی') + '&limit=4';
    const a = await app.inject('/v1/next' + query);
    const b = await app.inject('/app/api/next' + query);
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual(a.json());
    expect(b.headers['cache-control']).toBe('no-store');
    await app.close();
  });
  it('serves a secure local shell and rejects non-allowlisted paths', async () => {
    const app = buildServer();
    const redirect = await app.inject('/app');
    expect(redirect.statusCode).toBe(302);
    expect(redirect.headers.location).toBe('/app/');
    const shell = await app.inject('/app/');
    expect(shell.statusCode).toBe(200);
    expect(shell.headers['content-security-policy']).not.toContain('unsafe-inline');
    expect(shell.headers['x-content-type-options']).toBe('nosniff');
    expect(shell.body).toContain('Besrah');
    expect((await app.inject('/app/server.ts')).statusCode).toBe(404);
    expect((await app.inject('/app/assets/../../data/network.json')).statusCode).toBe(404);
    await app.close();
  });
  it('exposes real station metadata and explicit supported coverage', async () => {
    const app = buildServer();
    const r = await app.inject('/app/api/stations');
    expect(r.statusCode).toBe(200);
    expect(r.json().supportedLines).toEqual([1]);
    expect(r.json().maxNearestKm).toBe(10);
    expect(r.json().stations.find((s: { name: string }) => s.name === 'طبرسی').lines).toEqual([2]);
    expect(r.json().line1Order[0]).toBe('وکیل‌آباد');
    await app.close();
  });
});
