import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeView } from './views/home.js';
import { installFoodDom, flushView, button, findAll } from './test-support/food-dom.mjs';

test('user explicit gift need overrides clock, passes no location, opens flower vendors', async t=>{
  installFoodDom(t);
  globalThis.fetch=()=>Promise.reject(new Error('offline artwork'));
  const sent=[],navigation=[];
  const cards=(intent='now')=>[{id:'food.'+intent,kind:'food',title:intent==='gift'?'گل و هدیه':'رستوران',
    why:'این موضوع را خودتان انتخاب کردید',detail:'موجودی را تأیید کنید',
    evidence:{source:'user_selection',kind:'user_intent'},cta:{type:'food',vertical:intent==='gift'?'flowers':'restaurant'}}];
  const api={homeSuggestions:async (point,signal,prefs,intent)=>{
    sent.push({point,prefs,intent});
    return {cards:cards(intent),locationUsed:false,note:'موقعیت ذخیره نمی‌شود'};}};
  const view=createHomeView({api,store:{suggestLocation:()=>false,prefs:()=>({foodPreferredVerticals:['cafe']})},
    actions:{go:(name,args)=>navigation.push([name,args]),openStation(){},serviceAction(){},heroAction(){}}});
  view.onShow();await flushView();
  assert.equal(sent[0].point,null);
  assert.deepEqual(sent[0].prefs,['cafe']);
  assert.equal(sent[0].intent,'now');
  await button(view.el,'گل و هدیه').dispatch('click');await flushView();
  assert.equal(sent.at(-1).intent,'gift');assert.equal(sent.at(-1).point,null);
  assert.match(view.el.textContent,/گل و هدیه/);
  const card=findAll(view.el,n=>n.dataset?.id==='food.gift')[0];
  assert.ok(card);
  await card.dispatch('click');
  assert.deepEqual(navigation.at(-1),['food',{vertical:'flowers'}]);
});
