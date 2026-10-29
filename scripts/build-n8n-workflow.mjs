#!/usr/bin/env node
// Offline, dependency-free generator. Never reads credentials or mutates raw network data.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const outputDir = new URL('integrations/n8n/', root);
const source = name => readFileSync(new URL(name, outputDir), 'utf8');
const network = JSON.parse(readFileSync(new URL('data/network.json', root), 'utf8'));
const metro = { stations: network.stations.map(({ id, name, lat, lon, lines }) => ({ id, name, lat, lon, lines })), line1: network.lines['1'].order_vakilabad_to_airport, maxNearestKm: 10 };
const stableId = name => {
  const hash = createHash('sha256').update('besrah-n8n:' + name).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
const node = (name, type, typeVersion, parameters, position, extra = {}) => ({ id: stableId(name), name, type: 'n8n-nodes-base.' + type, typeVersion, parameters, position, ...extra });
const code = (name, jsCode, position) => node(name, 'code', 2, { mode: 'runOnceForEachItem', jsCode }, position);
const commonNodes = [
  code('Metro Data', `// Generated snapshot of station metadata; raw data/network.json remains untouched.\nreturn { json: { ...$json, metro: ${JSON.stringify(metro)} } };\n`, [260, 160]),
  code('Normalize', source('normalize.js'), [500, 160]),
  node('Valid Query?', 'if', 2.2, {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ id: stableId('query-condition'), leftValue: '={{ $json.route }}', rightValue: 'query', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, options: {},
  }, [740, 160]),
  node('Core Next', 'httpRequest', 4.2, {
    method: 'GET', url: 'http://127.0.0.1:3080/v1/next', authentication: 'none', sendQuery: true,
    queryParameters: { parameters: [{ name: 'station', value: '={{ $json.station }}' }, { name: 'limit', value: '4' }] },
    options: { timeout: 5000, redirect: { redirect: { followRedirects: false } }, response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } } },
  }, [980, 60], { onError: 'continueRegularOutput', retryOnFail: false }),
  code('Attach Core Response', "// Paired item lookup preserves the original chat even with batched smoke fixtures.\nreturn { json: { ...$('Normalize').item.json, core: $json } };\n", [1220, 60]),
  code('Render', source('render.js'), [1460, 160]),
];
const edge = name => ({ node: name, type: 'main', index: 0 });
const connections = {
  'Metro Data': { main: [[edge('Normalize')]] }, Normalize: { main: [[edge('Valid Query?')]] },
  'Valid Query?': { main: [[edge('Core Next')], [edge('Render')]] },
  'Core Next': { main: [[edge('Attach Core Response')]] }, 'Attach Core Response': { main: [[edge('Render')]] },
};
const settings = { executionOrder: 'v1', timezone: 'Asia/Tehran', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false, saveExecutionProgress: false };
const production = {
  id: 'BesrahMetro01', name: 'Besrah - Metro Telegram', active: false,
  nodes: [
    node('Telegram Trigger', 'telegramTrigger', 1.3, { updates: ['message'], additionalFields: {} }, [20, 160], { webhookId: stableId('telegram-webhook') }),
    ...commonNodes,
    node('Telegram Send', 'telegram', 1.2, { resource: 'message', operation: 'sendMessage', chatId: '={{ $json.chat_id }}', text: '={{ $json.text }}',
      replyMarkup: 'replyKeyboard', replyKeyboard: { rows: [{ row: { buttons: [{ text: '📍 ارسال موقعیت من', additionalFields: { request_location: true } }] } }] },
      replyKeyboardOptions: { resize_keyboard: true, one_time_keyboard: true }, additionalFields: { parse_mode: 'HTML', appendAttribution: false, disable_web_page_preview: true },
    }, [1700, 160]),
    node('Setup Required', 'stickyNote', 1, { content: '## Setup required — inactive export\nCreate a dedicated Telegram API credential and select it on Telegram Trigger and Telegram Send. No credential references or secrets are included. Confirm HTTPS WEBHOOK_URL, localhost core connectivity and smoke assertions, then activate explicitly. Trigger v1.3 authenticates webhook requests with a generated secret token and drops pending updates on activation. Private human chats only. Execution payload saving disabled (including manual/error); do not pin or log real GPS. Radius is 10 km straight-line to nearest known station; edit maxNearestKm in Metro Data or generator then regenerate. Line 2 predictions are unsupported. Coordinates are not walking routes. Activation remains outstanding in this export.', width: 610, height: 340 }, [480, -300]),
  ],
  connections: { 'Telegram Trigger': { main: [[edge('Metro Data')]] }, ...connections, Render: { main: [[edge('Telegram Send')]] } },
  settings, pinData: {}, tags: [],
};
const smokeCommonNodes = structuredClone(commonNodes);
smokeCommonNodes.find(node => node.name === 'Core Next').parameters.queryParameters.parameters.push({ name: 'at', value: '2026-10-16T14:00:00+03:30' });
const smokeConnections = structuredClone(connections);
smokeConnections['Valid Query?'].main[1] = [edge('Render Local')];
const smoke = {
  id: 'BesrahMetroSmoke01', name: 'Besrah - Metro Smoke (Synthetic Tests)', active: false,
  nodes: [
    node('Manual Trigger', 'manualTrigger', 1, {}, [-220, 160]),
    node('Smoke Fixtures', 'code', 2, { mode: 'runOnceForAllItems', jsCode: source('smoke-fixtures.js') }, [20, 160]),
    ...smokeCommonNodes,
    // Both renderers execute the exact production source; append waits for both IF branches.
    code('Render Local', source('render.js'), [1220, 360]),
    node('Gather Smoke Results', 'merge', 3.2, { mode: 'append', numberInputs: 2 }, [1700, 160]),
    node('Smoke Assertions', 'code', 2, { mode: 'runOnceForAllItems', jsCode: source('smoke-assertions.js') }, [1940, 160]),
    node('Synthetic Test Notice', 'stickyNote', 1, { content: '## SYNTHETIC TEST INPUTS ONLY\nNine synthetic private-chat cases exercise the exact production normalizer/renderer. Only the two valid line-1 cases call the REAL localhost core with fixed at=2026-10-16T14:00:00+03:30. No synthetic core responses are generated and no Telegram nodes exist. Smoke Assertions throws on any missing/wrong output; expected ok=true, total=9, core_queries=2, telegram_calls=0. Never activate this manual-only test workflow as the bot.', width: 580, height: 250 }, [260, -200]),
  ],
  connections: {
    'Manual Trigger': { main: [[edge('Smoke Fixtures')]] }, 'Smoke Fixtures': { main: [[edge('Metro Data')]] },
    ...smokeConnections,
    Render: { main: [[edge('Gather Smoke Results')]] },
    'Render Local': { main: [[{ node: 'Gather Smoke Results', type: 'main', index: 1 }]] },
    'Gather Smoke Results': { main: [[edge('Smoke Assertions')]] },
  }, settings: { ...settings }, pinData: {}, tags: [],
};
mkdirSync(outputDir, { recursive: true });
writeFileSync(new URL('besrah-metro.workflow.json', outputDir), JSON.stringify(production, null, 2) + '\n');
writeFileSync(new URL('besrah-metro-smoke.workflow.json', outputDir), JSON.stringify(smoke, null, 2) + '\n');
console.log('Generated integrations/n8n/besrah-metro.workflow.json (BesrahMetro01, inactive, credential-free)');
console.log('Generated integrations/n8n/besrah-metro-smoke.workflow.json (BesrahMetroSmoke01, manual-only synthetic tests)');
