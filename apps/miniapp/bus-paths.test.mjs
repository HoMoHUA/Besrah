import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from './bus-data.js';
import { findBusConnections } from './bus-paths.js';

// Synthetic! No stop, line or time below claims real Mashhad service.
const guide = buildIndex({ v: 1, meta: {}, n: ['الف','ب','ج','د','ه','و','ز'], l: [
  { r:'10',v:[{i:1,f:'الف',t:'د',d:0,s:[0,1,2,3]},{i:2,f:'د',t:'الف',d:0,s:[3,2,1,0]}]},
  { r:'20',v:[{i:3,f:'ج',t:'ه',d:0,s:[2,4,5]}]},
  { r:'30',v:[{i:4,f:'ه',t:'ز',d:0,s:[4,6]}]},
  { r:'LOOP',v:[{i:5,f:'ب',t:'ب',d:0,s:[1,4,1,6]}]},
]});

test('direct directionality; reverse variant is a separate observed route variant', () => {
  const a = findBusConnections(guide,'الف','د');
  assert.equal(a[0].type,'direct');
  assert.equal(a[0].legs[0].ref,'10');
  assert.equal(a[0].legs[0].stopCount,3);
  assert.equal(a[0].durationS,null);
  assert.equal(a[0].waitS,null);
  assert.equal(a[0].fareToman,null);
  assert.equal(a[0].verified,false);
  assert.ok(findBusConnections(guide,'د','الف').some(v=>v.legs[0].variantId===2));
  assert.equal(findBusConnections(guide,'ز','الف').length,0);
});

test('requires forward order on both legs for a potential transfer', () => {
  const routes=findBusConnections(guide,'الف','و');
  const t=routes.find(v=>v.type==='transfer');
  assert.ok(t);
  assert.equal(t.transfer,'ج');
  assert.deepEqual(t.legs.map(v=>v.ref),['10','20']);
  assert.deepEqual(t.legs.map(v=>v.stopCount),[2,2]);
  assert.match(t.warning,/تأیید نمی‌کند/);
});

test('do not pretend two consecutive transfers make a direct connection', () => {
  // From الف to ز requires at least two transfers on 10=>20=>30, but LOOP
  // may offer one-transfer alternative; omit loop in this controlled case.
  const withoutLoop=buildIndex({v:1,meta:{},n:['الف','ب','ج','د','ه','و','ز'],l:[
    {r:'10',v:[{i:1,f:'الف',t:'د',d:0,s:[0,1,2,3]}]},
    {r:'20',v:[{i:3,f:'ج',t:'و',d:0,s:[2,4,5]}]},
    {r:'30',v:[{i:4,f:'ه',t:'ز',d:0,s:[4,6]}]},
  ]});
  assert.deepEqual(findBusConnections(withoutLoop,'الف','ز'),[]);
});

test('same-name matching needs exact registered stop; no arbitrary input or silent approximation', () => {
  assert.deepEqual(findBusConnections(guide,'الف','الف'),[]);
  assert.deepEqual(findBusConnections(guide,'unknown','ج'),[]);
  assert.deepEqual(findBusConnections(guide,'الف ','د', {maxResults:50}),[]);
  assert.deepEqual(findBusConnections(guide,'الف','ج', {maxResults:0}),[]);
});

test('repeated stops and loop routes are kept direction-aware; results bounded and deterministic', () => {
  const a=findBusConnections(guide,'ب','ز');
  const b=findBusConnections(guide,'ب','ز');
  assert.deepEqual(a,b);
  assert.ok(a.length>0 && a.length<=3);
  assert.equal(a[0].type,'direct');
  assert.equal(a[0].legs[0].ref,'LOOP');
  assert.equal(a[0].stopCount,1);
  assert.deepEqual(findBusConnections(guide,'ب','ز',{maxResults:1}),a.slice(0,1));
});

test('unbounded or corrupted indexes fail closed', () => {
  assert.deepEqual(findBusConnections({lines:[],stops:[]},'الف','ب'),[]);
  assert.deepEqual(findBusConnections(null,'الف','ب'),[]);
  const extra=buildIndex({v:1,n:['الف','ب'],l:Array.from({length:801},(_,i)=>({r:String(i),v:[{i,f:'الف',t:'ب',d:0,s:[0,1]}]}))});
  assert.deepEqual(findBusConnections(extra,'الف','ب'),[]);
});
