import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('worker displays generic push immediately and never caches or intercepts fetch', async () => {
 const handlers={}, shown=[];
 const self={addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async (...args)=>shown.push(args)},clients:{openWindow:async()=>{}}};
 vm.runInNewContext(await readFile(new URL('./reminder-sw.js',import.meta.url),'utf8'),{self});
 assert.equal(handlers.fetch,undefined);
 let work; handlers.push({data:{json:()=>({title:'unsafe title',body:'unsafe body'})},waitUntil:p=>work=p}); await work;
 assert.equal(shown.length,1); assert.equal(shown[0][0],'بِسراه'); assert.doesNotMatch(shown[0][1].body,/unsafe/);
});
