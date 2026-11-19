const FOLD = {
  'ي': 'ی', 'ى': 'ی', 'ك': 'ک', 'ۀ': 'ه', 'ة': 'ه', 'أ': 'ا', 'إ': 'ا', 'ٱ': 'ا', 'آ': 'ا', 'ؤ': 'و',
};
const DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
// Characters that carry no meaning for matching: ZWNJ/ZWJ, bidi marks, spaces, tatweel, harakat.
const IGNORED = /[\u200c\u200d\u200e\u200f\s\u00a0\u0640\u064b-\u065f\u0670]/;

// Folds text for matching and keeps, for every folded character, its index in the original string
// (so a match can be highlighted in the text the user actually sees) and whether it starts a word.
export function foldWithMap(value) {
  const text = [], map = [], wordStart = [];
  let startsWord = true;
  const source = String(value ?? '');
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (IGNORED.test(ch)) { startsWord = true; continue; }
    let out = FOLD[ch] ?? ch;
    const fa = DIGITS.indexOf(out), ar = ARABIC_DIGITS.indexOf(out);
    if (fa >= 0) out = String(fa); else if (ar >= 0) out = String(ar);
    text.push(out.toLowerCase()); map.push(i); wordStart.push(startsWord); startsWord = false;
  }
  return { text: text.join(''), map, wordStart };
}
export function normalize(value) { return foldWithMap(value).text; }
export function nearestStation(stations, lat, lon, maxKm = 10) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) return null;
  const rad = value => value * Math.PI / 180;
  let nearest = null;
  for (const station of stations) {
    if (!Number.isFinite(station.lat) || !Number.isFinite(station.lon)) continue;
    const a = Math.sin(rad(station.lat-lat)/2)**2 + Math.cos(rad(lat))*Math.cos(rad(station.lat))*Math.sin(rad(station.lon-lon)/2)**2;
    const km = 6371 * 2 * Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));
    if (km <= maxKm && (!nearest || km < nearest.km)) nearest = {station,km};
  }
  return nearest;
}
// Exact core metro distance calculation (km)
export function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = d => d * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function groupPasses(passes) {
  const groups = new Map();
  for (const pass of passes) {
    let key = pass.toward;
    if (!groups.has(key)) groups.set(key, []);
    if (groups.get(key).length < 2) groups.get(key).push(pass);
  }
  return [...groups];
}

export async function resolveUserCoords(tgApp, timeoutMs = 10000) {
  const geo = typeof navigator !== 'undefined' && navigator.geolocation && {
    getCurrentPosition: (ok, fail, opts) => navigator.geolocation.getCurrentPosition(ok, fail, opts)
  };
  return requestPosition(tgApp, geo, timeoutMs);
}

// Permission is requested only when the UI explicitly calls this helper (HarmonyOS privacy rule: never before the user
// reaches the feature). Prefer Telegram's native location flow in supported Mini App clients.
// The rejection carries `kind`: 'denied' (the user or the platform refused), 'timeout', or 'unavailable' (off / no fix).
// The message stays 'location_unavailable' for every kind, so older callers keep working.
export function requestPosition(webApp, browserGeolocation, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (coordinates, kind = 'unavailable') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (Number.isFinite(coordinates?.latitude) && Number.isFinite(coordinates?.longitude)) {
        resolve({ latitude: coordinates.latitude, longitude: coordinates.longitude });
      } else { const error = new Error('location_unavailable'); error.kind = kind; reject(error); }
    };
    const timer = setTimeout(() => finish(null, 'timeout'), timeoutMs);
    const fromBrowser = () => {
      if (!browserGeolocation?.getCurrentPosition) return finish(null);
      try {
        browserGeolocation.getCurrentPosition(position => finish(position.coords),
          error => finish(null, error?.code === 1 ? 'denied' : error?.code === 3 ? 'timeout' : 'unavailable'),
          { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60000 });
      } catch { finish(null); }
    };
    const manager = webApp?.LocationManager;
    let nativeSupported = false;
    try { nativeSupported = Boolean(webApp?.initData && webApp?.isVersionAtLeast?.('8.0') && manager); } catch { /* Use browser support instead. */ }
    if (!nativeSupported) return fromBrowser();
    const fromNative = () => {
      if (!manager.isLocationAvailable) return fromBrowser();
      try { manager.getLocation(data => finish(data, manager.isAccessRequested && !manager.isAccessGranted ? 'denied' : 'unavailable')); } catch { finish(null); }
    };
    try {
      if (manager.isInited) fromNative();
      else manager.init(fromNative);
    } catch { fromBrowser(); }
  });
}

// After a refusal: no repeated prompts. When the user reaches the feature again, say how to turn location back on and,
// inside Telegram, offer its own settings screen (HarmonyOS privacy guide: "direct the user to the Settings page").
export function canOpenLocationSettings(webApp) {
  try { return Boolean(webApp?.isVersionAtLeast?.('8.0') && typeof webApp?.LocationManager?.openSettings === 'function'); } catch { return false; }
}
export function openLocationSettings(webApp) {
  if (!canOpenLocationSettings(webApp)) return false;
  try { webApp.LocationManager.openSettings(); return true; } catch { return false; }
}
export function locationAdvice(kind, { repeated = false, inTelegram = false } = {}) {
  if (kind === 'denied') {
    if (!repeated) return 'دسترسی به موقعیت داده نشد؛ بدون آن هم می‌توانید ادامه دهید.';
    return inTelegram ? 'دسترسی به موقعیت خاموش است. برای استفاده، آن را در تنظیمات همین برنامه در تلگرام روشن کنید.'
      : 'دسترسی به موقعیت برای این سایت خاموش است. آن را از تنظیمات مرورگر (نماد قفل کنار نشانی) روشن کنید.';
  }
  if (kind === 'timeout') return 'موقعیت به‌موقع پیدا نشد؛ کمی بعد دوباره امتحان کنید یا دستی انتخاب کنید.';
  return 'موقعیت در دسترس نیست؛ مکان‌یاب دستگاه را روشن کنید یا دستی انتخاب کنید.';
}
