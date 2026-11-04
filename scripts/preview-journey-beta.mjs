#!/usr/bin/env node
// Local development ONLY: no production settings, external binding or deployment.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../packages/core/dist/server.js';
const port=Number(process.env.BESRAH_PREVIEW_PORT??18864);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid preview port');
const dir=mkdtempSync(join(tmpdir(),'besrah-beta-preview-'));
const app=buildServer({journeyBeta:{enabled:true,rolloutPercent:0,feedbackDir:dir,
 allowedOrigins:[`http://127.0.0.1:${port}`],journeyClientPerMinute:1000,journeyGlobalPerMinute:1000,
 feedbackClientPerHour:1000,feedbackGlobalPerMinute:1000}});
await app.listen({host:'127.0.0.1',port});
console.log(JSON.stringify({preview:`http://127.0.0.1:${port}/app/?beta=1#besrah`,feedbackDir:dir,
 disclaimer:'Private development preview; test feedback is not field evidence. Admission rate limits relaxed for browser QA only; concurrency unchanged.'}));
let stopping=false;
const close=async()=>{if(stopping)return;stopping=true;try{await app.close();process.exitCode=0;}catch{process.exitCode=1;}};
process.once('SIGINT',close);process.once('SIGTERM',close);
