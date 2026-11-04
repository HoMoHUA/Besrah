import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server.js';
describe('reminder assets and registration', () => {
  it('serves the worker and keeps the feature disabled by default', async () => {
    const app = buildServer();
    const worker = await app.inject('/app/reminder-sw.js');
    expect(worker.statusCode).toBe(200);
    expect(worker.headers['content-type']).toContain('javascript');
    expect((await app.inject('/app/api/reminders/config')).statusCode).toBe(404);
    await app.close();
  });
});
