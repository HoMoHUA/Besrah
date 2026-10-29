// Run Once for All Items after Merge append. Throwing fails the n8n smoke execution.
const expected = $('Smoke Fixtures').all().map(item => item.json);
const actual = $input.all().map(item => item.json);
const fail = detail => { throw new Error('BESRAH_SMOKE_FAILED: ' + detail); };
if (actual.length !== expected.length) fail(`expected ${expected.length} rendered items, got ${actual.length}`);
const seen = new Set();
const checks = [];
for (const fixture of expected) {
  const id = fixture.message.chat.id;
  const matches = actual.filter(item => item.chat_id === id);
  if (matches.length !== 1 || seen.has(id)) fail(fixture.test_case + ': missing or duplicate chat result');
  seen.add(id);
  const item = matches[0];
  if (item.kind !== fixture.expected_render_kind) fail(fixture.test_case + ': expected ' + fixture.expected_render_kind + ', got ' + item.kind);
  if (item.parse_mode !== 'HTML' || typeof item.text !== 'string' || !item.text.trim()) fail(fixture.test_case + ': invalid HTML envelope');
  if (/[<>*]/.test(item.text)) fail(fixture.test_case + ': unescaped HTML or Markdown');
  if (item.reply_markup?.keyboard?.[0]?.[0]?.request_location !== true) fail(fixture.test_case + ': missing private request-location keyboard');
  if (fixture.test_case === 'location' && (!item.text.includes('نزدیک‌ترین') || !item.text.includes('مستقیم'))) fail('location: missing nearest-station context');
  if (item.kind === 'prediction' && !item.text.includes('وکیل‌آباد')) fail(fixture.test_case + ': canonical station missing');
  if (item.kind === 'unsupported_line' && !item.text.includes('خط ۲')) fail(fixture.test_case + ': line 2 warning missing');
  checks.push({ case: fixture.test_case, kind: item.kind, chat_id_preserved: true, keyboard: true, html_safe: true });
}
return [{ json: { ok: true, synthetic_test: true, total: checks.length, core_queries: checks.filter(check => check.kind === 'prediction').length, telegram_calls: 0, cases: checks } }];
