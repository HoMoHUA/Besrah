// n8n Code node: Run Once for Each Item. No I/O or credentials.
const { message, metro } = $json;
if (!message || message.chat?.type !== 'private' || message.from?.is_bot !== false
  || !Number.isSafeInteger(message.chat.id) || message.chat.id <= 0) return null;
const key = value => String(value).normalize('NFKC').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
  .replace(/[\u064b-\u065f\u0670\u0640]/g, '').replace(/[\s\u200c\u200d\u200e\u200f\ufeff]+/g, '');
const reply = (kind, text) => ({ json: { chat_id: message.chat.id, route: 'reply', kind, reply_text: text } });
const help = 'به بِسراه خوش آمدید. نام ایستگاه خط ۱ را بنویسید یا با دکمه زیر موقعیت خود را بفرستید.\n\n/app — باز کردن مینی اپ\n/stations — فهرست ایستگاه ها\n/about — درباره بِسراه و دقت زمان ها\n/privacy — حریم خصوصی\n/help — راهنما\n/start — شروع دوباره\n\nزمان ها تقریبی اند؛ داده زنده حرکت قطار نیستند.';
const unsupported = station => reply('unsupported_line', `ایستگاه ${station.name} در خط ۲ است. پیش‌بینی زمان خط ۲ هنوز پشتیبانی نمی‌شود؛ فعلاً فقط خط ۱ پشتیبانی می‌شود.`);
if (Object.prototype.hasOwnProperty.call(message, 'location')) {
  const { latitude, longitude } = message.location || {};
  if (typeof latitude !== 'number' || typeof longitude !== 'number'
    || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return reply('invalid_location', 'مختصات موقعیت معتبر نیست. لطفاً موقعیت را دوباره با دکمهٔ زیر ارسال کنید.');
  }
  const rad = degrees => degrees * Math.PI / 180;
  const distance = station => {
    const a = Math.sin(rad(station.lat - latitude) / 2) ** 2
      + Math.cos(rad(latitude)) * Math.cos(rad(station.lat)) * Math.sin(rad(station.lon - longitude) / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  };
  const nearest = metro.stations.map(station => ({ station, km: distance(station) })).sort((a, b) => a.km - b.km)[0];
  // Radius is straight-line distance to the nearest known station, not a walking route.
  const maxNearestKm = Number.isFinite(metro.maxNearestKm) && metro.maxNearestKm > 0 ? metro.maxNearestKm : 10;
  if (!nearest || nearest.km > maxNearestKm) return reply('outside_service_area', 'این موقعیت خارج از محدودهٔ پشتیبانی‌شدهٔ متروی مشهد است. نام یک ایستگاه را از /stations انتخاب کنید.');
  if (!metro.line1.includes(nearest.station.name)) return unsupported(nearest.station);
  return { json: { chat_id: message.chat.id, route: 'query', kind: 'location', station: nearest.station.name, distance_km: nearest.km } };
}
const text = typeof message.text === 'string' ? message.text.trim() : '';
const command = text.split(/\s/)[0].replace(/@[A-Za-z0-9_]+$/, '').toLowerCase();
if (!text || command === '/start' || command === '/help') return reply('help', help);
if (command === '/app') return reply('app', 'مینی اپ بِسراه را از دکمه «باز کردن بِسراه» یا لینک زیر باز کنید:\n' + metro.appUrl);
if (command === '/about') return reply('about', 'Besrah | بِسراه\nدستیار متروی مشهد برای پیدا کردن ایستگاه و برآورد زمان قطارهای خط ۱.\nبرآوردها از جدول زمانی و داده های ثبت شده به دست می آیند؛ موقعیت زنده قطار نیستند. فاصله نمایش داده شده مستقیم است، نه مسیر پیاده روی. خط ۲ و مسیریابی ترکیبی هنوز فعال نیستند.\n/app — باز کردن مینی اپ\n/privacy — حریم خصوصی');
if (command === '/privacy') return reply('privacy', 'حریم خصوصی بِسراه\nدر مینی اپ، موقعیت با اجازه شما در دستگاه پردازش می شود و فقط نام ایستگاه برای دریافت زمان به سرور می رود.\nاگر موقعیت را در چت بات بفرستید، تلگرام و گردش کار سرور آن را دریافت می کنند. ذخیره تاریخچه اجرای گردش کار غیرفعال است، اما ورودی اولیه ممکن است تا پاک سازی خودکار n8n در پایگاه داده باقی بماند. نسخه های پشتیبان و سوابق تلگرام جدا هستند.\nبرای استفاده بدون ارسال موقعیت، فقط نام ایستگاه را بنویسید.');
if (command === '/stations') return reply('stations', 'ایستگاه‌های پشتیبانی‌شدهٔ خط ۱:\n' + metro.line1.join('\n'));
const input = key(text).replace(/^ایستگاه/, '');
const station = metro.stations.find(s => key(s.name) === input);
if (!station) return reply('unknown', 'نام ایستگاه شناخته نشد. نام یکی از ایستگاه‌های /stations را بفرستید یا موقعیت خود را ارسال کنید.');
if (!metro.line1.includes(station.name)) return unsupported(station);
return { json: { chat_id: message.chat.id, route: 'query', kind: 'station', station: station.name } };
