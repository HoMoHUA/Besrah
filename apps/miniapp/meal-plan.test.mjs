import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,sanitizeMealPlanEntry} from './store.js';
import {createFoodView} from './views/food.js';
import {installFoodDom,flushView,button} from './test-support/food-dom.mjs';

const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),_m:m};};
test('weekly categories require an explicit action and never save GPS or inferred orders',()=>{
  const mem=storage(),store=createStore(mem);
  assert.deepEqual(store.mealPlan(),[]);
  assert.equal(store.setMealPlanEntry({day:0,slot:'lunch',vertical:'restaurant'}),true);
  assert.equal(store.setMealPlanEntry({day:0,slot:'lunch',vertical:'fast_food'}),true);
  assert.deepEqual(store.mealPlan(),[{day:0,slot:'lunch',vertical:'fast_food'}]);
  assert.equal(store.setMealPlanEntry({day:7,slot:'lunch',vertical:'restaurant'}),false);
  assert.equal(store.setMealPlanEntry({day:0,slot:'lunch',vertical:'flowers'}),false);
  assert.equal(sanitizeMealPlanEntry({day:0,slot:'dinner',vertical:'cafe',lat:36.3}),null);
  assert.deepEqual(createStore(mem).mealPlan(),[{day:0,slot:'lunch',vertical:'fast_food'}]);
  assert.doesNotMatch(JSON.stringify([...mem._m.values()]),/\blat\b|\blon\b|latitude|history|orderId/);
  store.clearMealPlan();assert.deepEqual(createStore(mem).mealPlan(),[]);
});
test('weekly meal plan leads to a category search, NOT an automatic checkout',async t=>{
  installFoodDom(t);
  const store=createStore(storage()),requests=[];
  const api={foodSearch:async params=>{
    requests.push(params);
    return {vendors:[],total:0,offset:0,limit:10,notes:[],snapshot:{capturedTo:null,stale:true}};
  }};
  const view=createFoodView({api,store,actions:{go(){}}});
  view.onShow();await flushView();
  await button(view.el,'برنامهٔ هفتگی من').dispatch('click');
  assert.match(view.el.textContent,/نه سفارش یا اشتراک خودکار/);
  await button(view.el,'مواد اولیه').dispatch('click');
  await button(view.el,'ثبت انتخاب در برنامه').dispatch('click');
  assert.deepEqual(store.mealPlan(),[{day:0,slot:'lunch',vertical:'grocery'}]);
  await button(view.el,'جست‌وجوی گزینه‌ها').dispatch('click');await flushView();
  assert.equal(requests.at(-1).vertical,'grocery');
  await button(view.el,'برنامهٔ هفتگی من').dispatch('click');
  await button(view.el,'حذف').dispatch('click');
  assert.deepEqual(store.mealPlan(),[]);
});
