// Small async helpers: request sequencing (stale responses never render), debounce, timeout.
export function createSequencer() {
  let controller = null, ticket = 0;
  return {
    cancel() { ticket++; controller?.abort(); controller = null; },
    async run(task) {
      controller?.abort();
      const mine = ++ticket;
      const own = controller = new AbortController();
      const current = () => mine === ticket;
      try {
        const value = await task(own.signal);
        return current() ? { ok: true, value } : { stale: true };
      } catch (error) {
        return current() ? { ok: false, error } : { stale: true };
      } finally {
        if (controller === own) controller = null;
      }
    },
  };
}

export function debounce(fn, wait, timers = globalThis) {
  let handle = null, pending = null;
  const fire = () => { handle = null; const args = pending; pending = null; if (args) fn(...args); };
  const debounced = (...args) => {
    pending = args;
    if (handle !== null) timers.clearTimeout(handle);
    handle = timers.setTimeout(fire, wait);
  };
  debounced.cancel = () => { if (handle !== null) timers.clearTimeout(handle); handle = null; pending = null; };
  debounced.flush = () => { if (handle !== null) { timers.clearTimeout(handle); fire(); } };
  return debounced;
}

// An AbortSignal that aborts when `parent` aborts or after `ms`, whichever comes first.
export function linkedTimeout(parent, ms, timers = globalThis) {
  const controller = new AbortController();
  let timed = false;
  const onParent = () => { dispose(); controller.abort(); };
  const handle = timers.setTimeout(() => { timed = true; dispose(); controller.abort(); }, ms);
  function dispose() { timers.clearTimeout(handle); parent?.removeEventListener('abort', onParent); }
  if (parent?.aborted) onParent(); else parent?.addEventListener('abort', onParent, { once: true });
  return { signal: controller.signal, dispose, timedOut: () => timed };
}
