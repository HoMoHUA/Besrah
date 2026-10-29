import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
const root = new URL('../../', import.meta.url);
function render(json) {
  const file = new URL('integrations/n8n/render.js', root);
  assert.ok(existsSync(file), 'render Code node source must exist');
  const result = vm.runInNewContext(`(function() {${readFileSync(file, 'utf8')}\n})()`, { $json: json }, { timeout: 1000 });
  return JSON.parse(JSON.stringify(result.json));
}
const query = { chat_id: 42, route: 'query', kind: 'station', station: 'وکیل‌آباد' };
test('local help and invalid replies use the same safe HTML renderer and request-location keyboard', () => {
  for (const kind of ['help', 'unknown', 'stations', 'unsupported_line', 'outside_service_area', 'invalid_location']) {
    const result = render({ chat_id: 777, route: 'reply', kind, reply_text: '<b>نام &</b>' });
    assert.equal(result.kind, kind);
    assert.equal(result.chat_id, 777);
    assert.equal(result.text, '&lt;b&gt;نام &amp;&lt;/b&gt;');
    assert.equal(result.reply_markup.keyboard[0][0].request_location, true);
    assert.equal('core' in result, false);
  }
});

test('core transport, HTTP and malformed-response failures are friendly errors, never unsupported-line claims', () => {
  for (const core of [{ error: 'ECONNREFUSED' }, { error: { message: 'timeout' } },
    { statusCode: 500, body: { error: 'internal' } }, { statusCode: 400, body: { error: 'bad_at' } },
    { statusCode: 404, body: { error: 'unknown_station' } }, { statusCode: 200, body: {} },
    { statusCode: 200, body: { text: 'bad', passes: 'wrong' } }, undefined]) {
    const result = render({ ...query, core });
    assert.equal(result.kind, 'core_error');
    assert.equal(result.chat_id, 42);
    assert.match(result.text, /دوباره/);
    assert.equal(result.text.includes('خط ۲'), false);
    assert.equal(result.text.includes('ECONNREFUSED'), false);
  }
});

test('location prediction names the nearest station with approximate straight-line distance', () => {
  const result = render({ ...query, kind: 'location', station: '<ایستگاه>', distance_km: 0.1234,
    core: { statusCode: 200, body: { text: 'زمان قطار', passes: [], notes: [] } } });
  assert.match(result.text, /نزدیک‌ترین/);
  assert.match(result.text, /&lt;ایستگاه&gt;/);
  assert.match(result.text, /123/);
  assert.match(result.text, /مستقیم/);
  assert.match(result.text, /تقریبی/);
});

test('core text is HTML-escaped with legacy Markdown stars removed and approximation notes preserved', () => {
  const result = render({ ...query, core: { statusCode: 200, body: {
    text: '🚉 *وکیل‌آباد* <b> & "زمان"\nبه سمت *غدیر*: ۲ دقیقه', passes: [],
    notes: ['زمان‌ها تقریبی است.'],
  } } });
  assert.equal(result.chat_id, 42);
  assert.equal(result.kind, 'prediction');
  assert.equal(result.parse_mode, 'HTML');
  assert.ok(result.text.includes('&lt;b&gt; &amp; &quot;زمان&quot;'));
  assert.equal(result.text.includes('*'), false);
  assert.ok(result.text.includes('زمان‌ها تقریبی است.'));
  assert.deepEqual(result.reply_markup, { keyboard: [[{ text: '📍 ارسال موقعیت من', request_location: true }]], resize_keyboard: true, one_time_keyboard: true });
});
