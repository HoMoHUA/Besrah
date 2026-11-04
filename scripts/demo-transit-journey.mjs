#!/usr/bin/env node
// Internal model-only CLI. Does not create a server, provider request or stored user memory.
const usage='Usage: node scripts/demo-transit-journey.mjs --line 1|2 --from PHYSICAL_ID --to PHYSICAL_ID --date YYYY-MM-DD --time HH:MM:SS [--calendar strict|weekday_baseline] [--window 1..21600] [--max-candidates 1..64]\n       node scripts/demo-transit-journey.mjs --examples | --stations | --help';
try {
 const argv=process.argv.slice(2),single=new Set(['--help','--examples','--stations']);
 if(argv.length===1&&argv[0]==='--help'){console.log(usage);process.exit(0);}
 const flags=new Map(),allowed=new Set(['--line','--from','--to','--date','--time','--calendar','--window','--max-candidates']);
 const mode=argv.length===1&&single.has(argv[0])?argv[0]:undefined;
 if(!mode){for(let i=0;i<argv.length;i+=2){if(!allowed.has(argv[i])||flags.has(argv[i])||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Invalid argument. '+usage);flags.set(argv[i],argv[i+1]);}if(!['--line','--from','--to','--date','--time'].every(k=>flags.has(k)))throw Error('Missing argument. '+usage);}
 const {createModelSource,planJourney}=await import('../packages/core/dist/transit-journey/index.js');
 const source=createModelSource();
 if(mode==='--stations'){console.log(JSON.stringify({modelOnly:true,stations:source.catalog.stations,orders:source.catalog.orders},null,2));process.exit(0);}
 const base={schemaVersion:1,requestId:'r2a:cli',decisionPermission:'granted'};
 let requests;
 if(mode==='--examples'){
  requests=[
   ['friday-line1-ghadir',1,'METRO-101','METRO-122','2026-10-16','14:00:00','strict'],
   ['friday-line1-airport',1,'METRO-101','METRO-124','2026-10-16','14:00:00','strict'],
   ['friday-line2',2,'METRO-201','METRO-213','2026-10-16','14:00:00','strict'],
   ['friday-line2-reverse',2,'METRO-213','METRO-201','2026-10-16','14:00:00','strict'],
   ['thursday-explicit-weekday-model',1,'METRO-101','METRO-122','2026-10-22','14:00:00','weekday_baseline'],
   ['normal-explicit-weekday-model',2,'METRO-201','METRO-213','2026-10-19','14:00:00','weekday_baseline'],
   ['unknown-calendar',1,'METRO-101','METRO-122','2026-10-19','14:00:00','strict'],
   ['late-friday-end-of-service',1,'METRO-101','METRO-122','2026-10-16','23:59:00','strict'],
  ].map(([id,line,originId,destinationId,date,time,calendar])=>({id,input:{...base,requestId:'r2a:'+id,line,originId,destinationId,readyAt:date+'T'+time+'+03:30',calendar:{mode:calendar},...(String(id).startsWith('late-')?{searchSeconds:30}:{})}}));
 }else{
  if(!['1','2'].includes(flags.get('--line'))||!/^\d{4}-\d{2}-\d{2}$/.test(flags.get('--date'))||!/^\d{2}:\d{2}:\d{2}$/.test(flags.get('--time')))throw Error('Invalid date, time or line argument. '+usage);
  for(const k of ['--window','--max-candidates'])if(flags.has(k)&&!/^\d+$/.test(flags.get(k)))throw Error('Invalid numeric argument. '+usage);
  requests=[{id:'custom',input:{...base,line:Number(flags.get('--line')),originId:flags.get('--from'),destinationId:flags.get('--to'),readyAt:flags.get('--date')+'T'+flags.get('--time')+'+03:30',calendar:{mode:flags.get('--calendar')??'strict'},...(flags.has('--window')?{searchSeconds:Number(flags.get('--window'))}:{}),...(flags.has('--max-candidates')?{maxCandidates:Number(flags.get('--max-candidates'))}:{})}}];
 }
 const experiments=[];for(const {id,input} of requests)experiments.push({id,input,result:await planJourney(input,source)});
 console.log(JSON.stringify({modelOnly:true,notice:'Existing modeled timetable, not live GPS, verified fare or holiday-aware real-time service. Dates are Gregorian; time is Tehran platform-ready time. weekday_baseline explicitly leaves holidays unverified.',dataVersion:source.dataVersion,experiments,cache:source.stats()},null,2));
}catch(error){console.error(error instanceof Error?error.message:'Journey CLI failure');process.exitCode=1;}
