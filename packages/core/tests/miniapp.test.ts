import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { buildServer } from '../src/server.js';
import { MINIAPP_ASSETS } from '../src/miniapp.js';

const ROOT = new URL('../../../apps/miniapp/', import.meta.url);
// Pinned on purpose: any change to the policy must be a conscious edit of this test and the README.
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors https://web.telegram.org https://*.telegram.org";
const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2', webmanifest: 'application/manifest+json',
};

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
  it('exposes real station metadata and explicit supported coverage', async () => {
    const app = buildServer();
    const r = await app.inject('/app/api/stations');
    expect(r.statusCode).toBe(200);
    expect(r.json().supportedLines).toEqual([1, 2]);
    expect(r.json().line2Order).toHaveLength(13);
    expect(r.json().line2Order[0]).toBe('طبرسی');
    expect(r.json().line2Order[12]).toBe('شهید فکوری');
    expect(r.json().maxNearestKm).toBe(10);
    expect(r.json().stations.find((s: { name: string }) => s.name === 'طبرسی').lines).toEqual([2]);
    expect(r.json().line1Order[0]).toBe('وکیل‌آباد');
    await app.close();
  });
});

describe('miniapp static files', () => {
  it('redirects /app to /app/', async () => {
    const app = buildServer();
    const r = await app.inject('/app');
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/app/');
    await app.close();
  });

  it('every allowlisted file exists on disk and is served with its MIME type, nosniff and revalidation', async () => {
    const app = buildServer();
    expect(MINIAPP_ASSETS.length).toBeGreaterThan(20);
    for (const [route, file] of MINIAPP_ASSETS) {
      expect(existsSync(new URL(file, ROOT)), file).toBe(true);
      const r = await app.inject(route);
      expect(r.statusCode, route).toBe(200);
      const ext = file.split('.').pop() as string;
      expect(r.headers['content-type'], route).toBe(MIME[ext]);
      expect(r.headers['x-content-type-options'], route).toBe('nosniff');
      expect(r.headers['cache-control'], route).toBe('no-cache');
      expect(r.headers.etag, route).toMatch(/^"[A-Za-z0-9_-]{20,}"$/);
    }
    await app.close();
  });

  it('answers a matching If-None-Match with an empty 304 and a changed one with 200', async () => {
    const app = buildServer();
    for (const route of ['/app/', '/app/vendor/hm7/fonts/HMSymbol.woff2', '/app/skin.css']) {
      const first = await app.inject(route);
      const etag = first.headers.etag as string;
      const again = await app.inject({ url: route, headers: { 'if-none-match': etag } });
      expect(again.statusCode, route).toBe(304);
      expect(again.body, route).toBe('');
      expect(again.headers.etag, route).toBe(etag);
      expect(again.headers['cache-control'], route).toBe('no-cache');
      const list = await app.inject({ url: route, headers: { 'if-none-match': `"other", W/${etag}` } });
      expect(list.statusCode, route).toBe(304);
      const stale = await app.inject({ url: route, headers: { 'if-none-match': '"stale"' } });
      expect(stale.statusCode, route).toBe(200);
    }
    await app.close();
  });

  it('pins the CSP and related headers on the HTML shell, including 304 responses', async () => {
    const app = buildServer();
    const shell = await app.inject('/app/');
    expect(shell.headers['content-security-policy']).toBe(CSP);
    expect(shell.headers['content-security-policy']).not.toContain('unsafe-inline');
    expect(shell.headers['content-security-policy']).not.toContain('unsafe-eval');
    // data: is allowed for images only (HM7 builds dissolve masks at run time); never for scripts, styles or fonts
    expect(shell.headers['content-security-policy']).toMatch(/img-src 'self' data:;/);
    expect(shell.headers['content-security-policy']).not.toMatch(/(script|style|font|connect)-src[^;]*data:/);
    expect(shell.headers['referrer-policy']).toBe('no-referrer');
    expect(shell.headers['permissions-policy']).toBe('geolocation=(self)');
    expect(shell.body).toContain('Besrah');
    const again = await app.inject({ url: '/app/', headers: { 'if-none-match': shell.headers.etag as string } });
    expect(again.statusCode).toBe(304);
    expect(again.headers['content-security-policy']).toBe(CSP);
    await app.close();
  });

  it('rejects unlisted, traversal and malformed paths', async () => {
    const app = buildServer();
    const paths = [
      '/app/server.ts', '/app/app.test.mjs', '/app/README.md', '/app/vendor/', '/app/vendor/hm7/', '/app/vendor/hm7/fonts/Missing.woff2',
      '/app/assets/../../data/network.json', '/app/assets/%2e%2e/%2e%2e/data/network.json', '/app/..%2f..%2fdata%2fnetwork.json',
      '/app//skin.css', '/app/skin.css/', '/app/SKIN.CSS', '/app/skin.css%00.png', '/app/vendor/hm7/tokens.css/../../../../etc/passwd',
      '/app/assets/Vazirmatn-Regular.ttf', '/app/index.html', '/app/styles.css',
    ];
    for (const p of paths) expect((await app.inject(p)).statusCode, p).toBe(404);
    await app.close();
  });

  it('every file the shell, scripts and stylesheets reference is itself allowlisted', async () => {
    const files = new Set(MINIAPP_ASSETS.map(([, file]) => file));
    const missing: string[] = [];
    const check = (from: string, ref: string) => {
      if (/^(https?:|data:|#|mailto:)/.test(ref)) { if (/^https?:|^data:/.test(ref)) missing.push(`${from} -> ${ref} (external)`); return; }
      const clean = ref.split(/[?#]/)[0];
      const target = clean === '' || clean === './' ? 'index.html' : posix.normalize(posix.join(posix.dirname(from), clean));
      if (!files.has(target)) missing.push(`${from} -> ${ref}`);
    };
    for (const [, file] of MINIAPP_ASSETS) {
      const ext = file.split('.').pop();
      const text = ['html', 'css', 'js', 'webmanifest'].includes(ext as string) ? readFileSync(new URL(file, ROOT), 'utf8') : '';
      const dir = file;
      if (ext === 'js' && !file.startsWith('assets/telegram') && !file.startsWith('vendor/')) {
        for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) check(dir, m[1]);
        // URLs built in JS resolve against the page (/app/), not against the module
        for (const m of text.matchAll(/['"`]((?:\.\/)?assets\/[^'"`]+)['"`]/g)) check('index.html', m[1]);
      }
      if (ext === 'css') for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) check(dir, m[1]);
      if (ext === 'html') for (const m of text.matchAll(/(?:href|src)="([^"]+)"/g)) check(dir, m[1]);
      if (ext === 'webmanifest') for (const m of text.matchAll(/"src"\s*:\s*"([^"]+)"/g)) check(dir, m[1]);
    }
    expect(missing).toEqual([]);
  });

  it('serves no inline script, style block or style attribute in the shell', () => {
    const html = readFileSync(new URL('index.html', ROOT), 'utf8');
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/i);
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });
});
