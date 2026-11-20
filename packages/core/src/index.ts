import { buildServer } from './server.js';
import { installGracefulShutdown } from './shutdown.js';

const port = Number(process.env.PORT ?? 3080);
const host = process.env.HOST ?? '127.0.0.1'; // bind locally; put a reverse proxy in front if needed
const app = buildServer();
installGracefulShutdown(app);
app.listen({ port, host }).then(() => {
  console.log(`mashhad-waze core on http://${host}:${port}`);
  // The food index (4,240 vendors / 292k items since the 2026-11 rescan) takes ~10 s to parse. Load it right after start,
  // through the normal route, so the first person searching for food does not wait for it. A failure stays a 503 there.
  setTimeout(() => { void app.inject({ method: 'GET', url: '/app/api/food/search?limit=1' }).catch(() => undefined); }, 1500).unref();
});
