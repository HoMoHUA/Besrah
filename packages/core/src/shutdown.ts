// A service stop/restart sends SIGTERM. Without a handler Node dies instantly, skips Fastify's onClose hooks and
// leaves the feedback store's O_EXCL writer lock behind, which would keep feedback writes failing closed after
// every deployment. Drain in-flight work, run onClose (flushes the store, releases the lock), then exit.

export interface ShutdownOptions {
  /** Hard ceiling; must stay below the unit's TimeoutStopSec (15 s in production). */
  timeoutMs?: number;
  exit?: (code: number) => void;
  log?: (message: string) => void;
  signals?: readonly NodeJS.Signals[];
}

export function installGracefulShutdown(app: { close(): PromiseLike<unknown> }, options: ShutdownOptions = {}): () => void {
  const { timeoutMs = 10_000, exit = code => process.exit(code), log = message => console.error(message), signals = ['SIGTERM', 'SIGINT'] } = options;
  let started = false;
  const handler = (signal: NodeJS.Signals): void => {
    if (started) return; // repeated signals while draining are ignored, never a second concurrent close
    started = true;
    const timer = setTimeout(() => { log(`stop after ${signal} exceeded ${timeoutMs} ms; forcing exit`); exit(1); }, timeoutMs);
    timer.unref();
    app.close().then(
      () => { clearTimeout(timer); exit(0); },
      error => { clearTimeout(timer); log(`stop after ${signal} failed: ${(error as Error).message}`); exit(1); },
    );
  };
  for (const signal of signals) process.on(signal, handler);
  return () => { for (const signal of signals) process.off(signal, handler); };
}
