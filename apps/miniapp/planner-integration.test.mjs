import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
const source = f => readFileSync(new URL(f, import.meta.url), 'utf8');
test('planner inherits the HM7 typeface (AzarMehr first) and ships no font of its own',()=>{
  const css=source('app.css');
  assert.doesNotMatch(css,/@font-face|BesrahVazirmatn|vazirmatn/i);
  assert.match(css,/\.journey \{ font-family: var\(--font-sans\)/);
  const tokens=readFileSync(new URL('vendor/hm7/tokens.css',import.meta.url),'utf8');
  assert.match(tokens,/--font-sans: "AzarMehr", "Vazirmatn"/);
  assert.equal(existsSync(new URL('assets/vazirmatn-regular.woff2',import.meta.url)),false);
  const allowed=readFileSync(new URL('../../packages/core/src/miniapp.ts',import.meta.url),'utf8');
  assert.doesNotMatch(allowed,/vazirmatn-regular/);
});
test('planner is embedded only in existing metro and uses its show/hide lifecycle', () => {
  const metro=source('views/metro.js');
  assert.match(metro,/import \{ createPlanner \} from '\.\.\/ui\/planner\.js'/);
  assert.match(metro,/planner\.el/);
  assert.match(metro,/planner\.onShow\(/);
  assert.match(metro,/planner\.onHide\(/);
  assert.doesNotMatch(metro,/سرویس دارد: A|سرویس B/);
  for(const file of ['views/home.js','views/food.js','navigation.js']) assert.doesNotMatch(source(file),/createPlanner|journey/);
});
test('beta additions use scoped semantic tokens, no remote resources or motion, and all assets are allowlisted',()=>{
  const css=source('app.css');assert.match(css,/\.journey-field/);assert.match(css,/\.journey-consent/);
  const planner=source('ui/planner.js');assert.doesNotMatch(planner,/innerHTML|geolocation|initData|setInterval|https?:\/\//);
  const allowed=readFileSync(new URL('../../packages/core/src/miniapp.ts',import.meta.url),'utf8');
  for(const file of ['journey.js','ui/planner.js']) assert.ok(allowed.includes("'/app/"+file+"'"));
});
