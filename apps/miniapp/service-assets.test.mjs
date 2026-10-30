import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const assets = new URL('./assets/', import.meta.url);
const services = ['rail', 'caravan', 'rahyab', 'savar', 'food', 'pay', 'besrah'];
const allowedTags = new Set([
  'svg', 'title', 'desc', 'defs', 'g', 'linearGradient', 'radialGradient',
  'stop', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line',
]);
const allowedAttributes = new Set([
  'viewBox', 'width', 'height', 'role', 'aria-labelledby', 'id', 'fill',
  'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-opacity', 'opacity', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'points', 'transform', 'offset', 'stop-color',
  'stop-opacity', 'gradientUnits', 'gradientTransform', 'preserveAspectRatio',
]);
const parseXml = `
import json, sys, xml.etree.ElementTree as ET
root = ET.fromstring(sys.stdin.read())
print(json.dumps([{'tag': e.tag, 'attrs': dict(e.attrib), 'text': e.text or ''} for e in root.iter()]))
`;

function validateSvg(source, viewBox) {
  assert.ok(Buffer.byteLength(source, 'utf8') < 12 * 1024, 'SVG must stay below 12KB');
  assert.doesNotMatch(source, /<!|<\?|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/, 'no declarations, entities, comments or control characters');
  const parsed = spawnSync('python', ['-c', parseXml], { input: source, encoding: 'utf8' });
  assert.equal(parsed.status, 0, `SVG must be well-formed XML: ${parsed.stderr}`);
  const elements = JSON.parse(parsed.stdout);
  assert.equal(elements[0].tag, '{http://www.w3.org/2000/svg}svg');
  assert.equal(elements[0].attrs.viewBox, viewBox);
  assert.equal(elements[0].attrs.role, 'img');
  const ids = new Set();
  for (const element of elements) {
    assert.ok(element.tag.startsWith('{http://www.w3.org/2000/svg}'), 'SVG namespace required');
    const tag = element.tag.slice('{http://www.w3.org/2000/svg}'.length);
    assert.ok(allowedTags.has(tag), `unsafe or unsupported SVG element: ${tag}`);
    for (const [name, value] of Object.entries(element.attrs)) {
      assert.ok(allowedAttributes.has(name), `unsafe or unsupported SVG attribute: ${name}`);
      assert.doesNotMatch(value, /javascript:|data:|https?:|\/\/|@import|expression\s*\(/i);
      if (value.includes('url(')) {
        assert.match(value, /^url\(#[A-Za-z][\w-]*\)$/, 'only local paint references allowed');
      }
    }
    if (element.attrs.id) {
      assert.ok(!ids.has(element.attrs.id), 'duplicate SVG id');
      ids.add(element.attrs.id);
    }
  }
  for (const element of elements) {
    for (const value of Object.values(element.attrs)) {
      const reference = /^url\(#([\w-]+)\)$/.exec(value);
      if (reference) assert.ok(ids.has(reference[1]), `unresolved paint: ${reference[1]}`);
    }
  }
  const labelledBy = elements[0].attrs['aria-labelledby']?.split(/\s+/) ?? [];
  assert.ok(labelledBy.length > 0 && labelledBy.every(id => ids.has(id)), 'accessible label must resolve');
  assert.ok(elements.some(e => e.tag.endsWith('}title') && e.text.trim()), 'title required');
  assert.ok(elements.some(e => e.tag.endsWith('}desc') && e.text.trim()), 'description required');
  assert.ok(elements.filter(e => /\}(path|rect|circle|ellipse|polygon|polyline|line)$/.test(e.tag)).length >= 8, 'crafted geometry required');
  return elements;
}

function readAsset(path) {
  const url = new URL(path, assets);
  assert.ok(existsSync(url), `missing illustration: ${path}`);
  return readFileSync(url, 'utf8');
}

for (const service of services) {
  test(`${service}: original standalone 120px service illustration is valid, safe and small`, () => {
    validateSvg(readAsset(`services/${service}.svg`), '0 0 120 120');
  });
}

test('hero-brand: generic city journey banner is valid, safe and small', () => {
  const source = readAsset('hero-brand.svg');
  validateSvg(source, '0 0 480 220');
  assert.doesNotMatch(source, /\b(train|metro|rail|locomotive)\b|قطار|مترو/i, 'brand banner must not be metro-specific');
  for (const color of ['#061C1D', '#0A5556', '#D7FF63']) assert.ok(source.includes(color), `brand color ${color} required`);
});

test('service family has distinct illustrations and identifiable service colors', () => {
  const sources = services.map(service => readAsset(`services/${service}.svg`));
  assert.equal(new Set(sources).size, 7);
  for (const [index, colors] of [
    ['#0A5556', '#D7FF63'], ['#E87936'], ['#438DDA'], ['#E8AA35'], ['#E85D3A'], ['#2DA67E'], ['#0A5556', '#D7FF63'],
  ].entries()) {
    for (const color of colors) assert.ok(sources[index].includes(color), `${services[index]} requires ${color}`);
  }
});

test('safety validator rejects executable, styled, external and malformed SVGs', () => {
  const wrapper = content => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img">${content}</svg>`;
  for (const content of [
    '<script>alert(1)</script>', '<style>path{fill:red}</style>',
    '<path style="fill:red"/>', '<path onclick="alert(1)"/>',
    '<image href="https://example.com/a.png"/>', '<foreignObject/>',
    '<filter id="blur"/>', '<text font-family="Arial">A</text>',
    '<path fill="url(https://example.com/a.svg)"/>', '<path>',
  ]) assert.throws(() => validateSvg(wrapper(content), '0 0 120 120'));
});
