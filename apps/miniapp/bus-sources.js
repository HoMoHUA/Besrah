// Audited public entry points only. These are LANDING PAGES, never stop-specific
// deep links, API endpoints or evidence of live ETA for the selected OSM stop.
export const BUS_ARRIVAL_SOURCES = Object.freeze([
  Object.freeze({
    id: 'mashhad_map', title: 'نقشه همراه مشهد',
    url: 'https://map.mashhad.ir/',
    hint: 'ایستگاه را در نقشه رسمی جست‌وجو کنید؛ زمان رسیدن، اگر در دسترس باشد، متعلق به آن سامانه است.',
    type: 'municipal_public_page',
  }),
  Object.freeze({
    id: 'neshan_map', title: 'نشان',
    url: 'https://neshan.org/maps',
    hint: 'برای جزئیات ایستگاه و زمان رسیدنِ قابل‌نمایش در اپ نشان، همان ایستگاه را جست‌وجو کنید.',
    type: 'provider_public_page',
  }),
]);
export function sourceById(id) { return BUS_ARRIVAL_SOURCES.find(s => s.id === id) ?? null; }
export function busHandoffNote(stopName) {
  const name = String(stopName ?? '').trim();
  return name && name.length <= 100
    ? `برای بررسی زمان رسیدن «${name}» را در منبع انتخابی جست‌وجو کنید. نام مشابه به معنی همان کد/سکوی رسمی نیست.`
    : 'برای بررسی زمان رسیدن، ایستگاه موردنظر را در منبع انتخابی پیدا کنید.';
}
export function openBusSource(id, host = globalThis) {
  const src = sourceById(id);
  if (!src) return false;
  // The URL is chosen exclusively from our immutable allowlist, not constructed
  // from an OSM stop name, user input, query string or untrusted redirect.
  if (host.window?.Telegram?.WebApp?.openLink) host.window.Telegram.WebApp.openLink(src.url);
  else if (host.window?.open) host.window.open(src.url, '_blank', 'noopener,noreferrer');
  else return false;
  return true;
}
