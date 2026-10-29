// Tiny observable state. `set(patch)` notifies only the subscribers whose keys changed.
export function createState(initial) {
  let data = { ...initial };
  const subscribers = new Set();
  return {
    get: () => data,
    set(patch) {
      const changed = Object.keys(patch).filter(key => data[key] !== patch[key]);
      if (!changed.length) return;
      data = { ...data, ...patch };
      for (const sub of [...subscribers]) {
        if (!sub.keys || changed.some(key => sub.keys.includes(key))) sub.fn(data, changed);
      }
    },
    subscribe(keys, fn) {
      const sub = { keys: keys === '*' ? null : keys, fn };
      subscribers.add(sub);
      return () => subscribers.delete(sub);
    },
  };
}
