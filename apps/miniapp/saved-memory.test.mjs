import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, sanitizeSavedChoice, sanitizePrefs } from './store.js';

function memory() {
  const values=new Map();
  const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  return { storage, values };
}
test('saved merchants/products require explicit action; persist only minimal ids/titles (no location)',()=>{
  const {storage,values}=memory(), store=createStore(storage);
  assert.deepEqual(store.savedChoices(),[]);
  assert.deepEqual(store.toggleSavedChoice('food',{id:'s:ab12',title:'گل رز',vertical:'flowers'}),{on:true});
  assert.deepEqual(store.toggleSavedChoice('shop',{id:'tl:1234',title:'هدفون'}),{on:true});
  assert.equal(store.isSavedChoice('food','s:ab12'),true);
  assert.equal(JSON.stringify([...values.values()]).includes('lat'),false);
  assert.deepEqual(createStore(storage).savedChoices().map(x=>x.kind),['shop','food']);
  assert.deepEqual(store.toggleSavedChoice('food',{id:'s:ab12',title:'گل رز',vertical:'flowers'}),{on:false});
  assert.equal(store.isSavedChoice('food','s:ab12'),false);
  store.clearSavedChoices();
  assert.deepEqual(createStore(storage).savedChoices(),[]);
});
test('saved items are bounded, reject URL, coordinates, corrupt or unexpected identity',()=>{
  const {storage}=memory(), store=createStore(storage);
  assert.equal(sanitizeSavedChoice({kind:'food',id:'https://bad.example',title:'foo'}),null);
  assert.equal(sanitizeSavedChoice({kind:'food',id:'s:x',title:'foo',vertical:'bad'}),null);
  assert.equal(store.toggleSavedChoice('food',{id:'javascript:alert(1)',title:'x'}).reason,'invalid');
  for(let n=0;n<24;n++)assert.equal(store.toggleSavedChoice('shop',{id:'tl:'+n,title:'کالای '+n}).on,true);
  assert.equal(store.toggleSavedChoice('shop',{id:'tl:999',title:'اضافه'}).reason,'full');
  const second=createStore(storage);assert.equal(second.savedChoices().length,24);
  second.removeSavedChoice('shop','tl:1');assert.equal(second.savedChoices().length,23);
});
test('category preference is whitelisted, ordered, bounded, explicit and not inferred',()=>{
  assert.deepEqual(sanitizePrefs({foodPreferredVerticals:['flowers','cafe']}),{foodPreferredVerticals:['flowers','cafe']});
  assert.deepEqual(sanitizePrefs({foodPreferredVerticals:['flowers','flowers']}),{});
  assert.deepEqual(sanitizePrefs({foodPreferredVerticals:['flowers','unknown']}),{});
  assert.deepEqual(sanitizePrefs({foodPreferredVerticals:['flowers','cafe','sweets','bakery','restaurant']}),{});
});
