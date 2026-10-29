import { buildServer } from './server.js';

const port = Number(process.env.PORT ?? 3080);
const host = process.env.HOST ?? '127.0.0.1'; // bind locally; put a reverse proxy in front if needed
buildServer().listen({ port, host }).then(() => console.log(`mashhad-waze core on http://${host}:${port}`));
