import test from 'node:test';
import assert from 'node:assert/strict';
import { installFoodDom, findAll, flushView } from './test-support/food-dom.mjs';
import { createProfileView } from './views/profile.js';

test('profile can cancel a saved reminder without worker or configuration', async t => {
  installFoodDom(t);
  const data = new Map([['besrah-reminder-token', 'private-token']]);
  globalThis.localStorage = {getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const calls=[]; globalThis.fetch=async (url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({status:'deleted'})};};
  const store={prefs:()=>({}),suggestLocation:()=>false};
  const view=createProfileView({api:{accountSession:async()=>({available:false})},store,actions:{}});
  const button=findAll(view.el,n=>n.tagName==='button'&&n.textContent.includes('لغو یادآوری'))[0];
  assert.ok(button); await button.dispatch('click'); await flushView();
  assert.equal(calls[0].url,'api/reminders/delete'); assert.deepEqual(JSON.parse(calls[0].options.body),{token:'private-token'}); assert.equal(data.size,0);
});


test('profile honestly labels an unconfirmed reminder and can cancel it without beta access', async t => {
  installFoodDom(t);
  const token='A'.repeat(43), data=new Map([['besrah-reminder-record',JSON.stringify({state:'pending',body:{cancelToken:token,departEpoch:Date.now()/1000+600}})]]);
  globalThis.localStorage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const calls=[]; globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({status:'deleted'})};};
  const view=createProfileView({api:{accountSession:async()=>({available:false})},store:{prefs:()=>({}),suggestLocation:()=>false},actions:{}});
  assert.ok(view.el.textContent.includes('هنوز تأیید نشده')); const button=findAll(view.el,n=>n.tagName==='button'&&n.textContent.includes('لغو یادآوری'))[0];
  await button.dispatch('click'); await flushView(); assert.deepEqual(calls,[{url:'api/reminders/delete',body:{token}}]); assert.equal(data.size,0);
});
