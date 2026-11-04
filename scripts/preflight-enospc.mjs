import { buildServer } from '../packages/core/dist/server.js';
import { createModelSource } from '../packages/core/dist/transit-journey/index.js';
import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
const dir='/var/lib/besrah-preflight/enospc/feedback';
const mv=createModelSource().dataVersion; const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran'}).format(new Date());
const relaxed={enabled:true,feedbackDir:dir,journeyGlobalPerMinute:1e6,journeyClientPerMinute:1e6,feedbackGlobalPerMinute:1e6,feedbackClientPerHour:1e6,allowedOrigins:['https://besrah.arklyn.ir']};
const body=i=>({v:1,reportId:'ENOSPC-'+String(i).padStart(20,'0'),kind:'timing_quality',timingQuality:'close',consent:{storeForModelImprovement:true},modelVersion:mv,context:{line:1,originId:'METRO-107',destinationId:'METRO-108',serviceDate:today}});
const hdr={'content-type':'application/json','x-besrah-beta':'1',origin:'https://besrah.arklyn.ir'};
let app=buildServer({journeyBeta:relaxed}); await app.ready();
const codes=[]; let firstFail=-1;
for(let i=0;i<200;i++){const r=await app.inject({method:'POST',url:'/app/api/journey-feedback',headers:hdr,payload:body(i)});codes.push(r.statusCode);if(r.statusCode!==201&&firstFail<0){firstFail=i;}if(firstFail>=0&&i>firstFail+5)break;}
const ok=codes.filter(c=>c===201).length;
console.log(JSON.stringify({stored201:ok,firstNon201At:firstFail,after:codes.slice(firstFail,firstFail+4)}));
const planner=await app.inject({method:'GET',url:'/app/api/journey?line=1&from=METRO-107&to=METRO-108',headers:{'x-real-ip':'10.0.0.9'}});
console.log('planner during storage fault:',planner.statusCode);
try{await app.close();}catch(e){console.log('close:',e.message);}
const files=readdirSync(dir);const f=files.find(n=>/^feedback-/.test(n));
const txt=f?readFileSync(dir+'/'+f,'utf8'):'';
const lines=txt.split('\n');const torn=!txt.endsWith('\n')&&txt.length>0;
let valid=0,bad=0;for(const l of lines.filter(Boolean)){try{JSON.parse(l);valid++;}catch{bad++;}}
console.log(JSON.stringify({files,fileEndsWithNewline:txt.endsWith('\n'),validLines:valid,unparsableLines:bad,acknowledged201:ok,ackEqualsDurableLines:ok===valid}));
