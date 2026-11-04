import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from './state.js';
import { installFoodDom, findAll, flushView } from './test-support/food-dom.mjs';
import { createPlanner, createPlannerController } from './ui/planner.js';

test('planner offers reminders only for eligible model events and schedules after a click', async t => {
  installFoodDom(t);
  const time=Date.parse('2026-11-03T12:00:00+03:30'), data=new Map(), calls=[]; let count=0;
  const storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const sub={toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/token',keys:{p256dh:'x',auth:'y'}}),unsubscribe:async()=>true};
  const registration={pushManager:{subscribe:()=>{count++;return Promise.resolve(sub);},getSubscription:async()=>sub}};
  globalThis.navigator.serviceWorker={register:async()=>registration,ready:Promise.resolve(registration)};
  globalThis.fetch=async (url, options={})=>{calls.push({url,options}); return {ok:true,json:async()=>url.endsWith('/config')?{publicKey:'AQ'}:{token:'opaque'}};};
  const state=createState({stations:[{id:'METRO-101',name:'ابتدا',lines:[1]},{id:'METRO-117',name:'مشترک',lines:[1]}],order:['ابتدا','مشترک'],order2:[],status:'ready'});
  const response={schemaVersion:1,beta:true,modelOnly:true,live:false,status:'ok',message:null,request:{line:1,originId:'METRO-101',destinationId:'METRO-117',originName:'ابتدا',destinationName:'مشترک',readyAt:'2026-11-03T12:00:00+03:30',source:'server_now',windowMinutes:120},calendar:{state:'estimated',warning:true,dayType:'normal'},asOf:'2026-11-03T12:00:00+03:30',validUntil:'2026-11-03T12:00:30+03:30',modelVersion:'sha256:'+'a'.repeat(64),options:[{id:'trip',eventId:'ev1_abcdef',departEpoch:time/1000+700,service:'A',toward:'غدیر',departAt:'12:11',arriveAt:'12:20',departDate:'2026-11-03',arriveDate:'2026-11-03',waitSeconds:700,inVehicleSeconds:500,earliestArrival:true}]};
  const api={beta:async()=>({enabled:true,feedbackEnabled:false,rolloutPercent:0,calendarMode:'weekday_baseline',horizonDays:7,windowMinutes:120}),journey:async()=>response};
  const controller=createPlannerController({api,state,storage,now:()=>time,timers:{setTimeout:()=>1,clearTimeout:()=>{}}});
  const view=createPlanner({api,state,storage,controller}); await view.onShow(); controller.optIn(); controller.setForm({from:'METRO-101',to:'METRO-117'}); await controller.plan(); await flushView();
  const button=findAll(view.el,n=>n.tagName==='button'&&n.textContent.includes('یادآوری این قطار'))[0]; assert.ok(button); assert.equal(count,0);
  await button.dispatch('click'); await flushView(); assert.equal(count,1);
  assert.equal(JSON.parse(calls.find(c=>c.url==='api/reminders').options.body).eventId,'ev1_abcdef');
  const replacement=findAll(view.el,n=>n.tagName==='button'&&n.textContent.includes('یادآوری این قطار'))[0]; assert.notEqual(replacement.getAttribute('disabled'),null);
  assert.ok(view.el.textContent.includes('ابتدا یادآوری قبلی را لغو کنید'));
  const cancel=findAll(view.el,n=>n.tagName==='button'&&n.textContent.includes('لغو یادآوری'))[0]; assert.ok(cancel); await cancel.dispatch('click'); await flushView();
  assert.ok(calls.some(c=>c.url==='api/reminders/delete'));
});
