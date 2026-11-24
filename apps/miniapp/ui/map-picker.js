import { h, icon } from './dom.js';
import { fa } from '../format.js';

const TILE = 256;
const EXTENT = 4096;
const DEFAULT_POINT = { lat: 36.297, lon: 59.606 };
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export function projectMapPoint({ lat, lon }) {
  const sin = Math.sin(clamp(lat, -85.05112878, 85.05112878) * Math.PI / 180);
  return { x: (lon + 180) / 360, y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI) };
}

export function mapPointAt({ x, y }) {
  return { lon: x * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI };
}

function trace(ctx, points) {
  let x = points[0], y = points[1];
  ctx.moveTo(x, y);
  for (let i = 2; i < points.length; i += 2) {
    x += points[i]; y += points[i + 1];
    ctx.lineTo(x, y);
  }
}

export function createMapPicker({ label, start = DEFAULT_POINT, other, onPick, onClose }) {
  const canvas = h('canvas', { tabindex: 0, 'aria-label': 'نقشه. با کلیدهای جهت حرکت کنید و با مثبت و منفی بزرگ‌نمایی را تغییر دهید.' });
  const status = h('p', { class: 'fd-note', role: 'status' });
  const confirm = h('button', { type: 'button', class: 'cm-btn', disabled: true, onClick: () => {
    const point = mapPointAt(center);
    onPick({ ...point, precision: 'coordinates', name: `${label} روی نقشه` });
  } }, `تأیید ${label}`);
  const context = canvas.getContext('2d');
  const cache = new Map(), pending = new Map();
  let center = projectMapPoint(start);
  let zoom = 15, frame = 0, active = false;
  const pointers = new Map();
  const coords = () => {
    const { lat, lon } = mapPointAt(center);
    return `${fa(lat.toFixed(5))}، ${fa(lon.toFixed(5))}`;
  };
  const observe = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;

  function schedule() {
    if (active && !frame) frame = requestAnimationFrame(() => { frame = 0; draw(); });
  }

  function getTile(key) {
    if (cache.has(key)) {
      const tile = cache.get(key);
      cache.delete(key);
      cache.set(key, tile);
      return tile;
    }
    if (!pending.has(key)) {
      const request = new AbortController();
      pending.set(key, request);
      const timeout = setTimeout(() => {
        cache.set(key, false);
        request.abort();
      }, 8000);
      fetch(new URL(`api/map/tiles/${key}`, document.baseURI), { signal: request.signal })
        .then(response => {
          if (response.status === 204) return null;
          if (!response.ok) throw new Error('map unavailable');
          return response.json();
        })
        .then(tile => cache.set(key, tile))
        .catch(() => { if (!request.signal.aborted) cache.set(key, false); })
        .finally(() => {
          clearTimeout(timeout);
          pending.delete(key);
          if (cache.size > 100) cache.delete(cache.keys().next().value);
          schedule();
        });
    }
    return undefined;
  }

  function drawTile(tile, left, top, size, style, labels) {
    const color = key => style.getPropertyValue(key).trim();
    context.save();
    context.translate(left, top);
    context.beginPath();
    context.rect(0, 0, size + 0.25, size + 0.25);
    context.clip();
    const scale = size / EXTENT;
    context.scale(scale, scale);
    function area(rings, fill) {
      context.fillStyle = fill;
      context.beginPath();
      for (const ring of rings) { trace(context, ring); context.closePath(); }
      context.fill('evenodd');
    }
    function line(runs, stroke, width) {
      context.strokeStyle = stroke;
      context.lineWidth = width / scale;
      context.beginPath();
      for (const run of runs) trace(context, run);
      context.stroke();
    }
    for (const rings of tile.w ?? []) area(rings, color('--map-water'));
    for (const [, ...rings] of tile.g ?? []) area(rings, color('--map-green'));
    for (const [kind, , ...runs] of tile.l ?? []) {
      line(runs, color(kind >= 30 ? '--map-rail' : '--map-water'), kind >= 30 ? 1.5 : 2);
    }
    for (const [kind, name, ...runs] of tile.r ?? []) {
      const width = kind <= 2 ? 4 : kind <= 4 ? 3 : 1.7;
      line(runs, color('--line'), width + 1.5);
      line(runs, color(kind <= 2 ? '--map-main-road' : '--map-road'), width);
      if (zoom >= 15 && tile.n[name]) {
        const run = runs.reduce((a, b) => a.length >= b.length ? a : b);
        if (run.length >= 4) labels.push([tile.n[name], left + (run[0] + run[2] / 2) * scale, top + (run[1] + run[3] / 2) * scale, 5]);
      }
    }
    for (const [rank, name, x, y] of tile.p ?? []) {
      if (tile.n[name]) labels.push([tile.n[name], left + x * scale, top + y * scale, rank]);
    }
    context.restore();
  }

  function draw() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const style = getComputedStyle(canvas);
    context.fillStyle = style.getPropertyValue('--map-ground').trim();
    context.fillRect(0, 0, width, height);
    const world = TILE * 2 ** zoom;
    const tileZoom = zoom >= 13 ? 13 : zoom >= 10 ? 10 : 7;
    const n = 2 ** tileZoom, size = world / n;
    const x0 = center.x * world - width / 2, y0 = center.y * world - height / 2;
    const labels = [];
    const visible = new Set();
    let loading = false, unavailable = false, hasData = false;
    for (let y = Math.max(0, Math.floor(y0 / size)); y < Math.min(n, Math.ceil((y0 + height) / size)); y++) {
      for (let x = Math.max(0, Math.floor(x0 / size)); x < Math.min(n, Math.ceil((x0 + width) / size)); x++) {
        const key = `${tileZoom}/${x}/${y}`;
        visible.add(key);
        const tile = getTile(key);
        if (tile === undefined) loading = true;
        else if (tile === false) unavailable = true;
        else if (tile) {
          hasData = true;
          drawTile(tile, x * size - x0, y * size - y0, size, style, labels);
        }
      }
    }
    for (const [key, request] of pending) if (!visible.has(key)) request.abort();

    context.font = `12px ${style.fontFamily}`;
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillStyle = style.getPropertyValue('--ink').trim();
    context.strokeStyle = style.getPropertyValue('--surface').trim();
    context.lineWidth = 3; context.lineJoin = 'round';
    const occupied = [], seen = new Set();
    for (const [name, x, y] of labels.sort((a, b) => a[3] - b[3])) {
      const w = context.measureText(name).width / 2 + 4;
      if (seen.has(name) || x - w < 0 || x + w > width || y < 8 || y > height - 8) continue;
      if (occupied.some(([px, py, pw]) => Math.abs(x - px) < w + pw && Math.abs(y - py) < 16)) continue;
      if (occupied.length >= 100) break;
      seen.add(name); occupied.push([x, y, w]);
      context.strokeText(name, x, y); context.fillText(name, x, y);
    }
    if (other) {
      const point = projectMapPoint(other);
      context.beginPath();
      context.arc(point.x * world - x0, point.y * world - y0, 7, 0, Math.PI * 2);
      context.fillStyle = style.getPropertyValue('--map-previous').trim();
      context.fill(); context.stroke();
    }
    // A blank tile at the pin has no coverage even when an adjacent tile contains data.
    const at = cache.get(`${tileZoom}/${Math.floor(center.x * n)}/${Math.floor(center.y * n)}`);
    confirm.disabled = !at;
    const message = loading ? 'در حال بارگذاری نقشه…' : unavailable && !at ? 'نقشه در دسترس نیست. دوباره تلاش کنید.' : !hasData || !at ? 'این نقطه در محدودهٔ نقشه نیست.' : coords();
    if (status.textContent !== message) status.textContent = message;
    retry.hidden = loading || !unavailable;
  }

  function move(dx, dy) {
    const world = TILE * 2 ** zoom;
    center = { x: clamp(center.x + dx / world, 0, 0.99999999), y: clamp(center.y + dy / world, 0, 0.99999999) };
    confirm.disabled = true;
    schedule();
  }

  function changeZoom(delta) {
    zoom = clamp(zoom + delta, 7, 19);
    confirm.disabled = true;
    schedule();
  }

  canvas.addEventListener('pointerdown', event => {
    if (pointers.size >= 2 || event.button !== 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, next);
    if (pointers.size === 1) {
      move(previous.x - next.x, previous.y - next.y);
      return;
    }
    const second = [...pointers.entries()].find(([id]) => id !== event.pointerId)[1];
    const before = Math.hypot(previous.x - second.x, previous.y - second.y);
    const after = Math.hypot(next.x - second.x, next.y - second.y);
    if (before > 4 && after > 4) changeZoom(Math.log2(after / before));
    move((previous.x - next.x) / 2, (previous.y - next.y) / 2);
  });
  canvas.addEventListener('lostpointercapture', event => pointers.delete(event.pointerId));
  canvas.addEventListener('wheel', event => {
    if (!event.deltaY) return;
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  canvas.addEventListener('keydown', event => {
    const step = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, -40], ArrowDown: [0, 40] }[event.key];
    if (step) move(...step);
    else if (event.key === '+' || event.key === '-') changeZoom(event.key === '+' ? 1 : -1);
    else return;
    event.preventDefault();
  });

  const retry = h('button', { type: 'button', class: 'cm-btn cm-btn--ghost', hidden: true, onClick: () => {
    for (const [key, tile] of cache) if (tile === false) cache.delete(key);
    schedule();
  } }, 'بارگذاری دوبارهٔ نقشه');
  const zoomControl = (delta, text, title) => h('button', {
    type: 'button', class: 'cm-icon-btn', 'aria-label': title, onClick: () => changeZoom(delta)
  }, text);
  const el = h('div', { class: 'tp-map' },
    h('header', { class: 'tp-map__head' }, h('h2', { id: 'trip-map-title', text: `انتخاب ${label}` }),
      h('button', { type: 'button', class: 'cm-icon-btn', 'aria-label': 'بستن نقشه', onClick: onClose }, icon('xmark'))),
    h('p', { class: 'fd-note', text: 'نقشه را جابه‌جا کنید تا نشانگر روی نقطهٔ دلخواه قرار بگیرد.' }),
    h('div', { class: 'tp-map__viewport' }, canvas, h('span', { class: 'tp-map__pin', 'aria-hidden': 'true' }),
      h('div', { class: 'tp-map__zoom' }, zoomControl(1, '+', 'بزرگ‌نمایی'), zoomControl(-1, '−', 'کوچک‌نمایی'))),
    h('a', { class: 'tp-map__credit', href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener noreferrer' }, '© OpenStreetMap contributors'),
    status, h('div', { class: 'fd-actions' }, confirm, retry));
  return {
    el,
    start() {
      if (!context) { status.textContent = 'نمایش نقشه در این مرورگر در دسترس نیست.'; return; }
      active = true;
      observe?.observe(canvas);
      window.addEventListener('resize', schedule);
      document.fonts?.ready.then(schedule);
      schedule();
    },
    stop() {
      active = false;
      observe?.disconnect();
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
      frame = 0;
      for (const request of pending.values()) request.abort();
    },
  };
}
