const TOKEN = 'besrah-reminder-token'; // Legacy server-issued token.
const RECORD = 'besrah-reminder-record';
const decode = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// Serialize operations across planner/profile instances in this document.
let queue = Promise.resolve();
function exclusive(fn) { const next = queue.then(fn, fn); queue = next.catch(() => {}); return next; }

/** Preparation does not request permission. schedule() calls subscribe directly from the user's click. */
export function createReminders({ navigator = globalThis.navigator, storage = globalThis.localStorage, fetch = globalThis.fetch, crypto = globalThis.crypto, now = Date.now } = {}) {
  let registration, key;
  const locked = fn => exclusive(() => navigator?.locks?.request ? navigator.locks.request('besrah-reminder', fn) : fn());
  async function post(path, data) {
    const result = await fetch(path, {method:'POST', credentials:'omit', cache:'no-store', headers:{'Content-Type':'application/json','X-Besrah-Reminder':'1'}, body:JSON.stringify(data)});
    if (!result.ok) throw new Error('reminder_unavailable');
    return result.json();
  }
  function read() {
    const raw = storage?.getItem(RECORD);
    if (!raw) return null;
    const record = JSON.parse(raw);
    const token = record?.token ?? record?.body?.cancelToken;
    const expires = record?.expires ?? (record?.body?.departEpoch - 240) * 1000;
    if (!token || !Number.isFinite(expires)) throw new Error('storage_unavailable');
    if (expires <= now()) { storage.removeItem(RECORD); return null; }
    if (record.state === 'confirmed' && record.body) { const compact = {state:'confirmed', token, expires}; save(compact); return compact; }
    return record;
  }
  function save(record) {
    const value = JSON.stringify(record);
    storage.setItem(RECORD, value);
    if (storage.getItem(RECORD) !== value) throw new Error('storage_unavailable');
  }
  async function recover() {
    const record = read();
    if (!record) return;
    if (record.state === 'cancelling') {
      await post('api/reminders/delete', {token:record.token ?? record.body.cancelToken});
      storage.removeItem(RECORD);
    } else if (record.state === 'pending') {
      await post('api/reminders', record.body);
      save({state:'confirmed', token:record.body.cancelToken, expires:(record.body.departEpoch - 240)*1000});
    }
  }
  return {
    recover() { return locked(recover); },
    async prepare() {
      if (!storage || !fetch) return false;
      try { await locked(recover); } catch { /* pending record remains available for retry/cancellation */ }
      if (!navigator?.serviceWorker) return false;
      try {
        storage.getItem(TOKEN);
        const result = await fetch('api/reminders/config', {credentials:'omit',cache:'no-store'});
        if (!result.ok) return false;
        const config = await result.json(); key = decode(config.publicKey);
        await navigator.serviceWorker.register('reminder-sw.js', {scope:'./'});
        registration = await navigator.serviceWorker.ready;
        return !!registration.pushManager;
      } catch { return false; }
    },
    async schedule(request, option) {
      if (!registration || !key || !option?.eventId) throw new Error('reminder_unavailable');
      // Check before subscribe, and again in the lock, to retain any existing reminder.
      if (read() || storage.getItem(TOKEN)) throw new Error('reminder_exists');
      const pending = registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:key});
      const sub = await pending;
      return locked(async () => {
        if (read() || storage.getItem(TOKEN)) throw new Error('reminder_exists');
        const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
        const body = {subscription:sub.toJSON(),line:request.line,from:request.originId,to:request.destinationId,eventId:option.eventId,departEpoch:option.departEpoch,cancelToken:encode(bytes)};
        const record = {state:'pending', body};
        save(record); // A failed durable write must prevent the POST entirely.
        const result = await post('api/reminders', body);
        save({state:'confirmed', token:record.body.cancelToken, expires:(record.body.departEpoch - 240)*1000});
        return result;
      });
    },
    async remove() {
      return locked(async () => {
        const record = read(), legacy = storage.getItem(TOKEN);
        if (record) {
          const token = record.token ?? record.body.cancelToken;
          save({state:'cancelling',token,expires:record.expires ?? (record.body.departEpoch - 240)*1000});
          await post('api/reminders/delete',{token});
          storage.removeItem(RECORD);
        }
        if (legacy) { await post('api/reminders/delete',{token:legacy}); storage.removeItem(TOKEN); }
        const sub = await registration?.pushManager.getSubscription();
        if (sub && !await sub.unsubscribe()) throw new Error('unsubscribe_failed');
      });
    },
    status() { try { const r = read(); return r?.state ?? (storage?.getItem(TOKEN) ? 'confirmed' : 'none'); } catch { return 'unknown'; } },
    hasReminder() { return this.status() !== 'none'; },
  };
}