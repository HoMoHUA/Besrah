import test from 'node:test';
import assert from 'node:assert/strict';
import { createSavedView } from './views/saved.js';
import { createStore } from './store.js';
import { installFoodDom, findAll, button } from './test-support/food-dom.mjs';
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
const setup=t=>{
  installFoodDom(t);
  const store=createStore(memory()),calls=[];
  const serviceStore={has:()=>false,subscribe:()=>()=>{}};
  const view=createSavedView({store,serviceStore,actions:{go:(v,o)=>calls.push([v,o])}});
  return {store,calls,view};
};
test('saved tab is empty only if neither services nor explicit product/vendor saves exist',t=>{
  const {view,store}=setup(t);
  assert.match(view.el.textContent,/هنوز چیزی ذخیره نشده/);
  store.toggleSavedChoice('food',{id:'s:123',title:'گل رز',vertical:'flowers'});
  assert.doesNotMatch(view.el.textContent,/هنوز چیزی ذخیره نشده/);
  assert.match(view.el.textContent,/گل رز/);
  assert.match(view.el.textContent,/قیمت، موجودی یا فعالیت فعلی/);
});
test('saved store and product can be reopened, removed, with no automatic GPS/history',async t=>{
  const {view,store,calls}=setup(t);
  store.toggleSavedChoice('food',{id:'s:11',title:'کافه شهر',vertical:'cafe'});
  store.toggleSavedChoice('shop',{id:'tl:1234',title:'هدفون بلوتوث'});
  view.onShow();
  let cards=findAll(view.el,n=>n.className==='cm-card saved-choice');
  assert.equal(cards.length,2);
  const first=findAll(cards[0],n=>n.tagName==='button'&&n.textContent==='جست‌وجوی دوباره')[0];
  await first.dispatch('click');
  assert.deepEqual(calls[0],['shop',{q:'هدفون بلوتوث'}]);
  const second=findAll(cards[1],n=>n.tagName==='button'&&n.textContent==='جست‌وجوی دوباره')[0];
  await second.dispatch('click');
  assert.deepEqual(calls[1],['food',{q:'کافه شهر',vertical:'cafe'}]);
  await findAll(cards[0],n=>n.tagName==='button'&&n.textContent==='حذف ذخیره')[0].dispatch('click');
  assert.equal(store.savedChoices().length,1);
  assert.doesNotMatch(JSON.stringify(store.savedChoices()),/lat|lon|location|history/);
});
