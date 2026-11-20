// «کمترین قیمت ممکن اسنپ». A ride-hailing price depends on the exact points: ten metres onto another street or past an
// intersection can change it. Candidate points on nearby car streets come from OSM (api/snapp/candidates); here they are
// priced one at a time with a pause: the asked trip first, then each pickup with the destination fixed, then each drop-off
// with the best pickup. At most 1 + origins + destinations asks, all with the person's own Snapp session.
export const MAIN_SERVICE = 1;                  // «اسنپ» (به صرفه)
const pause = ms => new Promise(r => setTimeout(r, ms));

export function servicePrice(data, id = MAIN_SERVICE) {
  const s = data?.services?.find(x => x.id === id && x.enabled && Number.isInteger(x.priceToman));
  return s ? s.priceToman : null;
}

export async function cheapestSnapp({ from, to, origins = [], destinations = [], ask, serviceId = MAIN_SERVICE, pauseMs = 350, sleep = pause, onStep = () => {}, isCancelled = () => false }) {
  const tried = [];
  const stop = e => e?.kind === 'rate_limited' || e?.status === 401 || e?.status === 429;
  async function one(o, d, kind) {
    const data = await ask({ lat: o.lat, lon: o.lon }, { lat: d.lat, lon: d.lon });
    const price = servicePrice(data, serviceId);
    tried.push({ kind, price });
    onStep(tried.length, 1 + origins.length + destinations.length);
    return { data, price };
  }
  const base = await one(from, to, 'base');
  if (base.price === null) return { base: null, best: null, tried };
  let pick = { point: null, price: base.price, data: base.data };
  for (const c of origins) {
    if (isCancelled()) break;
    await sleep(pauseMs);
    try { const r = await one(c, to, 'origin'); if (r.price !== null && r.price < pick.price) pick = { point: c, price: r.price, data: r.data }; }
    catch (e) { if (stop(e)) break; }
  }
  let drop = { point: null, price: pick.price, data: pick.data };
  const start = pick.point ?? from;
  for (const c of destinations) {
    if (isCancelled()) break;
    await sleep(pauseMs);
    try { const r = await one(start, c, 'destination'); if (r.price !== null && r.price < drop.price) drop = { point: c, price: r.price, data: r.data }; }
    catch (e) { if (stop(e)) break; }
  }
  return { base: { price: base.price, data: base.data }, best: { pickup: pick.point, dropoff: drop.point, price: drop.price, saving: base.price - drop.price, data: drop.data }, tried };
}
