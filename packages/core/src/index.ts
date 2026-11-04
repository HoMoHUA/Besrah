import { buildServer } from './server.js';
import { installGracefulShutdown } from './shutdown.js';

const port = Number(process.env.PORT ?? 3080);
const host = process.env.HOST ?? '127.0.0.1'; // bind locally; put a reverse proxy in front if needed
const app = buildServer();
installGracefulShutdown(app);
app.listen({ port, host }).then(() => console.log(`mashhad-waze core on http://${host}:${port}`));
