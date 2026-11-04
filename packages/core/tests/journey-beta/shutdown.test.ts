import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// Real process, real signal: a unit stop/restart sends SIGTERM and must leave the feedback store reusable.
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const clean of cleanups.splice(0).reverse()) await clean(); });
const exists = (path: string) => access(path).then(() => true, () => false);

const freePort = () => new Promise<number>((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address() as { port: number }; probe.close(() => resolve(port)); });
});

async function boot(extraEnv: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pb-shutdown-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const feedbackDir = join(dir, 'feedback');
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: new URL('../..', import.meta.url).pathname,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), BESRAH_JOURNEY_BETA: 'on', BESRAH_FEEDBACK_DIR: feedbackDir, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  cleanups.push(async () => { child.kill('SIGKILL'); });
  let out = '';
  child.stdout.on('data', c => { out += String(c); });
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no listen line: ' + out)), 15000);
    child.stdout.on('data', () => { const m = /on (http:\/\/[\d.]+:\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(m[1]); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('exited early ' + code + out)); });
  });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  return { child, url, feedbackDir, exit };
}

describe('graceful shutdown keeps the feedback store reusable', () => {
  it('SIGTERM drains the store, releases .feedback.lock and exits 0', async () => {
    const { child, url, feedbackDir, exit } = await boot();
    const journey = await fetch(`${url}/app/api/beta`);
    expect(journey.status).toBe(200);
    const model = await (await fetch(`${url}/app/api/journey?line=1&from=METRO-107&to=METRO-108`)).json() as { modelVersion?: string };
    expect(model.modelVersion).toMatch(/^sha256:/);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date());
    const post = await fetch(`${url}/app/api/journey-feedback`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-besrah-beta': '1' }, body: JSON.stringify({
      v: 1, reportId: 'shutdown-' + 'a'.repeat(16), kind: 'timing_quality', timingQuality: 'close', consent: { storeForModelImprovement: true }, modelVersion: model.modelVersion,
      context: { line: 1, originId: 'METRO-107', destinationId: 'METRO-108', serviceDate: today } }) });
    expect(post.status).toBe(201);
    expect(await exists(join(feedbackDir, '.feedback.lock'))).toBe(true);
    child.kill('SIGTERM');
    const result = await exit;
    expect(result).toEqual({ code: 0, signal: null });
    expect(await exists(join(feedbackDir, '.feedback.lock'))).toBe(false);
    expect((await readdir(feedbackDir)).some(n => /^feedback-\d{4}-\d{2}\.jsonl$/.test(n))).toBe(true);
  }, 30000);

  it('SIGINT behaves the same way', async () => {
    const { child, exit } = await boot();
    child.kill('SIGINT');
    expect(await exit).toEqual({ code: 0, signal: null });
  }, 30000);

  it('a second signal during drain does not start a second shutdown or crash', async () => {
    const { child, exit } = await boot();
    child.kill('SIGTERM');
    child.kill('SIGTERM');
    expect(await exit).toEqual({ code: 0, signal: null });
  }, 30000);
});
