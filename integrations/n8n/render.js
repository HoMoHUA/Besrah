// n8n Code node: Run Once for Each Item. Only a Telegram-ready envelope leaves this node.
const plain = value => String(value).replace(/\*/g, '');
const escape = value => plain(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
let kind = $json.kind;
let text;
if ($json.route === 'reply') {
  text = $json.reply_text;
} else {
  const core = $json.core;
  const body = core?.body;
  if (core?.error || !(core?.statusCode >= 200 && core.statusCode < 300)
    || typeof body?.text !== 'string' || !body.text.trim() || !Array.isArray(body?.passes)) {
    kind = 'core_error';
    text = 'دریافت زمان قطارها فعلاً ممکن نیست. لطفاً کمی بعد دوباره تلاش کنید.';
  } else {
    text = plain(body.text);
    for (const note of Array.isArray(body.notes) ? body.notes : []) {
      if (typeof note === 'string' && !text.includes(plain(note))) text += '\nℹ️ ' + plain(note);
    }
    if ($json.kind === 'location' && Number.isFinite($json.distance_km)) {
      text = `📍 نزدیک‌ترین ایستگاه: ${$json.station}\nفاصلهٔ مستقیم تقریبی: ${Math.round($json.distance_km * 1000)} متر (مسیر پیاده‌روی نیست)\n\n` + text;
    }
    kind = 'prediction';
  }
}
return { json: {
  chat_id: $json.chat_id, kind, text: escape(text), parse_mode: 'HTML',
  reply_markup: { keyboard: [[{ text: '📍 ارسال موقعیت من', request_location: true }]], resize_keyboard: true, one_time_keyboard: true },
} };
