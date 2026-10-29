import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
const root = new URL('../../', import.meta.url);
function build() {
  assert.ok(existsSync(new URL('scripts/build-n8n-workflow.mjs', root)), 'workflow generator must exist');
  const result = spawnSync(process.execPath, ['scripts/build-n8n-workflow.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(readFileSync(new URL('integrations/n8n/besrah-metro.workflow.json', root), 'utf8'));
}
test('smoke export shares production node code, makes only real localhost requests and fails loudly on wrong outputs', () => {
  const production = build();
  const file = new URL('integrations/n8n/besrah-metro-smoke.workflow.json', root);
  assert.ok(existsSync(file), 'manual smoke workflow must be generated');
  const smoke = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(smoke.id, 'BesrahMetroSmoke01');
  assert.equal(smoke.active, false);
  assert.equal(smoke.nodes.some(node => /telegram/i.test(node.type)), false);
  const nodes = Object.fromEntries(smoke.nodes.map(node => [node.name, node]));
  assert.equal(nodes['Manual Trigger'].type, 'n8n-nodes-base.manualTrigger');
  for (const name of ['Metro Data', 'Normalize', 'Attach Core Response', 'Render']) {
    assert.equal(nodes[name].parameters.jsCode, production.nodes.find(node => node.name === name).parameters.jsCode);
  }
  assert.equal(nodes['Render Local'].parameters.jsCode, nodes.Render.parameters.jsCode);
  const at = nodes['Core Next'].parameters.queryParameters.parameters.find(param => param.name === 'at');
  assert.equal(at.value, '2026-10-16T14:00:00+03:30');
  const run = (code, context) => JSON.parse(JSON.stringify(vm.runInNewContext(`(function() {${code}\n})()`, context, { timeout: 1000 })));
  const fixtures = run(nodes['Smoke Fixtures'].parameters.jsCode, {});
  assert.ok(fixtures.length >= 7);
  const rendered = [];
  for (const fixture of fixtures) {
    assert.equal(fixture.json.synthetic_test, true);
    const data = run(nodes['Metro Data'].parameters.jsCode, { $json: fixture.json });
    const normalized = run(nodes.Normalize.parameters.jsCode, { $json: data.json });
    assert.ok(normalized);
    assert.equal(normalized.json.kind, fixture.json.expected_normalized_kind);
    let input = normalized.json;
    if (input.route === 'query') {
      const core = { statusCode: 200, body: { text: `SYNTHETIC UNIT TEST ONLY *${input.station}*`, passes: [], notes: ['تقریبی'] } };
      input = run(nodes['Attach Core Response'].parameters.jsCode, { $json: core, $: () => ({ item: normalized }) }).json;
    }
    rendered.push(run(nodes.Render.parameters.jsCode, { $json: input }));
  }
  const context = { $input: { all: () => rendered }, $: () => ({ all: () => fixtures }) };
  const result = run(nodes['Smoke Assertions'].parameters.jsCode, context);
  assert.equal(result[0].json.ok, true);
  assert.equal(result[0].json.total, fixtures.length);
  assert.equal(result[0].json.core_queries, 2);
  assert.throws(() => run(nodes['Smoke Assertions'].parameters.jsCode, { ...context, $input: { all: () => [] } }), /SMOKE/);
  const bad = structuredClone(rendered); bad[0].json.kind = 'core_error';
  assert.throws(() => run(nodes['Smoke Assertions'].parameters.jsCode, { ...context, $input: { all: () => bad } }), /SMOKE/);
});

test('production bot exposes the trusted HTTPS Mini App without accepting user URLs', () => {
  const flow = build();
  const byName = Object.fromEntries(flow.nodes.map(node => [node.name, node]));
  const rows = byName['Telegram Send'].parameters.replyKeyboard.rows;
  const appButton = rows.flatMap(row => row.row.buttons).find(button => button.additionalFields?.web_app);
  assert.ok(appButton, 'a real WebApp keyboard button must exist');
  assert.equal(appButton.additionalFields.web_app.url, 'https://besrah.arklyn.ir/');
  const input = { message: { text: '/app', chat: { id: 123456789, type: 'private' }, from: { is_bot: false } }, appUrl: 'https://attacker.invalid/' };
  const withMetadata = vm.runInNewContext(`(function(){${byName['Metro Data'].parameters.jsCode}})()`, { $json: input });
  assert.equal(withMetadata.json.metro.appUrl, 'https://besrah.arklyn.ir/');
  const normalized = vm.runInNewContext(`(function(){${byName.Normalize.parameters.jsCode}})()`, { $json: withMetadata.json });
  assert.equal(normalized.json.kind, 'app');
  assert.equal(normalized.json.reply_text.includes('attacker.invalid'), false);
});

test('production export is private, inactive, credential-free and wired through the bounded localhost core', () => {
  const flow = build();
  assert.equal(flow.id, 'BesrahMetro01');
  assert.equal(flow.name, 'Besrah - Metro Telegram');
  assert.equal(flow.active, false);
  assert.deepEqual(flow.settings, { executionOrder: 'v1', timezone: 'Asia/Tehran', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false, saveExecutionProgress: false });
  for (const node of flow.nodes) assert.equal('credentials' in node, false);
  const byName = Object.fromEntries(flow.nodes.map(node => [node.name, node]));
  assert.equal(byName['Telegram Trigger'].typeVersion, 1.3);
  assert.deepEqual(byName['Telegram Trigger'].parameters.updates, ['message']);
  assert.ok(byName['Telegram Trigger'].webhookId);
  const core = byName['Core Next'];
  assert.equal(core.typeVersion, 4.2);
  assert.equal(core.parameters.method, 'GET');
  assert.equal(core.parameters.url, 'http://127.0.0.1:3080/v1/next');
  assert.deepEqual(core.parameters.queryParameters.parameters, [{ name: 'station', value: '={{ $json.station }}' }, { name: 'limit', value: '4' }]);
  assert.equal(core.parameters.options.timeout, 5000);
  assert.equal(core.parameters.options.response.response.neverError, true);
  assert.equal(core.parameters.options.response.response.fullResponse, true);
  assert.equal(core.onError, 'continueRegularOutput');
  assert.equal(byName['Telegram Send'].parameters.additionalFields.parse_mode, 'HTML');
  assert.equal(byName['Telegram Send'].parameters.replyKeyboard.rows[0].row.buttons[0].additionalFields.request_location, true);
  assert.equal(flow.connections['Valid Query?'].main[0][0].node, 'Core Next');
  assert.equal(flow.connections['Valid Query?'].main[1][0].node, 'Render');
  assert.equal(flow.connections.Render.main[0][0].node, 'Telegram Send');
  assert.match(byName['Setup Required'].parameters.content, /credential/i);
  assert.equal(byName.Normalize.parameters.jsCode, readFileSync(new URL('integrations/n8n/normalize.js', root), 'utf8'));
  assert.equal(byName.Render.parameters.jsCode, readFileSync(new URL('integrations/n8n/render.js', root), 'utf8'));
});
