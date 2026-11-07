import test from 'node:test';
import assert from 'node:assert/strict';
import { createBusView } from './views/bus.js';
import { installFoodDom, flushView, button, findAll } from './test-support/food-dom.mjs';

const guide = { v:1, meta:{osm_base:'2026-10-29'}, n:['ایستگاه الف','ایستگاه ب','ایستگاه ج','ایستگاه د','ایستگاه ه'], l:[
  {r:'10',v:[{i:1,f:'ایستگاه الف',t:'ایستگاه د',s:[0,1,2,3],d:0}]},
  {r:'20',v:[{i:2,f:'ایستگاه ج',t:'ایستگاه ه',s:[2,4],d:0}]},
]};

function setup(t) {
  installFoodDom(t);
  let opened = null, loads = 0;
  const view = createBusView({
    actions:{back(){},go(){}},
    api:{async busGuide(){loads++;return guide;}},
    sheet:{isOpen:false,open(c){opened=c;},close(){opened=null;},get element(){return opened;}}
  });
  return {view, loads:()=>loads, get opened(){return opened;}};
}

test('bus view finds direct and one-transfer possibilities, without showing fabricated arrival times', async t => {
  const x = setup(t);
  x.view.onShow();
  await flushView();
  assert.equal(x.loads(),1);
  const all=findAll(x.view.el,n=>n.tagName==='input');
  const from=all.find(n=>n.getAttribute('id')==='bus-route-from');
  const to=all.find(n=>n.getAttribute('id')==='bus-route-to');
  assert.ok(from&&to);
  await from.dispatch('input','ایستگاه الف');
  await to.dispatch('input','ایستگاه د');
  await button(x.view.el,'یافتن مسیرهای ممکن').dispatch('click');
  assert.match(x.view.el.textContent,/بدون تعویض/);
  assert.match(x.view.el.textContent,/زمان سفر و زمان انتظار قابل محاسبه نیست/);
  await to.dispatch('input','ایستگاه ه');
  await button(x.view.el,'یافتن مسیرهای ممکن').dispatch('click');
  assert.match(x.view.el.textContent,/یک تعویض احتمالی/);
  assert.match(x.view.el.textContent,/زمان سفر و زمان انتظار قابل محاسبه نیست/);
  assert.match(x.view.el.textContent,/زمان رسیدن اتوبوس از داده این برنامه در دسترس نیست/);
});

test('bus source handoff is explicit and takes the user only to reviewed public landing page', async t => {
  const x=setup(t);
  const opened=[];
  globalThis.window.open=(...args)=>opened.push(args);
  x.view.onShow(); await flushView();
  await button(x.view.el,'بررسی در نقشه همراه مشهد').dispatch('click');
  await button(x.view.el,'بررسی در نشان').dispatch('click');
  assert.deepEqual(opened,[
    ['https://map.mashhad.ir/','_blank','noopener,noreferrer'],
    ['https://neshan.org/maps','_blank','noopener,noreferrer'],
  ]);
  assert.equal(x.loads(),1);
});

test('invalid stop shows uncertainty, not a fake route or zero-minute estimate', async t => {
  const x=setup(t);
  x.view.onShow(); await flushView();
  const all=findAll(x.view.el,n=>n.tagName==='input');
  await all.find(n=>n.getAttribute('id')==='bus-route-from').dispatch('input','جعلی');
  await all.find(n=>n.getAttribute('id')==='bus-route-to').dispatch('input','ایستگاه ه');
  await button(x.view.el,'یافتن مسیرهای ممکن').dispatch('click');
  assert.match(x.view.el.textContent,/اتصال مستقیمی یا با یک تعویض پیدا نشد/);
  assert.doesNotMatch(x.view.el.textContent,/صفر دقیقه/);
});
