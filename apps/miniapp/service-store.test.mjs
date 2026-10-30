import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceStore, SERVICE_KEY } from './service-store.js';
const memory = seed => { const m = new Map(Object.entries(seed ?? {})); return { getItem:k=>m.get(k)??null, setItem:(k,v)=>m.set(k,v), m }; };
test('service saves persist separately without modifying station favourites', () => {
  const s = memory({ 'besrah:favs':'["غدیر"]' }); const a = createServiceStore(s);
  assert.equal(a.toggle('besrah'), true); assert.equal(a.has('besrah'), true);
  assert.deepEqual(createServiceStore(s).all(), ['besrah']);
  assert.equal(s.getItem('besrah:favs'), '["غدیر"]');
  assert.equal(a.toggle('besrah'), false); assert.deepEqual(a.all(), []);
});
test('invalid, duplicate and unknown services are removed on read', () => {
  const s = memory({ [SERVICE_KEY]: '["metro","metro","unknown",2,null,"pay"]' });
  assert.deepEqual(createServiceStore(s).all(), ["besrah","pay"]);
  assert.equal(createServiceStore(s).toggle('unknown'), false);
});
test('blocked or corrupt storage does not break saves, listeners and defensive copies', () => {
  for (const storage of [memory({ [SERVICE_KEY]:'{' }), { getItem(){throw Error('blocked')},setItem(){throw Error('blocked')} }]) {
    const a = createServiceStore(storage); let count=0;
    const stop = a.subscribe(()=>count++); a.toggle("food"); a.all().push('metro');
    assert.deepEqual(a.all(), ["food"]); assert.equal(count,1); stop(); a.toggle("food"); assert.equal(count,1);
  }
});
