#!/usr/bin/env node
// Isolated loopback preview. Never reads Production switches or opens a feedback store.
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const values = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match=/^--(port|mode|runtime-root)=(.+)$/.exec(arg);
  if(!match) throw Error('Use --port=18881 --mode=on|off|strict [--runtime-root=/absolute/approved/source]');
  return [match[1],match[2]];
}));
const port=Number(values.port ?? 18881), mode=values.mode ?? 'on';
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid loopback preview port');
if(!['on','off','strict'].includes(mode))throw Error('Invalid preview mode');
const root=resolve(values['runtime-root'] ?? fileURLToPath(new URL('../',import.meta.url)));
if(root==='/srv/besrah'||root.startsWith('/srv/besrah/'))throw Error('Production is not a preview runtime');
const {buildServer}=await import(pathToFileURL(resolve(root,'packages/core/dist/server.js')));
const app=buildServer({journeyBeta:{enabled:mode!=='off',switchFile:null,rolloutPercent:0,
 calendarMode:mode==='strict'?'strict':'weekday_baseline',feedbackDir:null,
 allowedOrigins:[`http://127.0.0.1:${port}`]}});
await app.listen({host:'127.0.0.1',port});
console.log(JSON.stringify({preview:`http://127.0.0.1:${port}/app/`,runtimeRoot:root,mode,
 feedbackEnabled:false,rateLimits:'unchanged defaults: 10/client/min, 60/global/min',
 disclaimer:'Preview only. Real model timetable; not GPS, field validation, public deployment or human WebView QA.'}));
let closing=false;
const close=async()=>{if(closing)return;closing=true;try{await app.close();process.exitCode=0;}catch(e){console.error(e);process.exitCode=1;}};
process.once('SIGTERM',close);process.once('SIGINT',close);
