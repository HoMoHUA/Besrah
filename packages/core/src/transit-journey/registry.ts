import { InputError } from '../intelligence/validation.js';
import { normName } from '../network.js';
import { JOURNEY_LIMITS, type PhysicalStation, type StationCatalog, type MetroLine } from './contracts.js';
export function createStationCatalog(stations: unknown, line1Order: unknown, line2Order: unknown, ghadirId: string): StationCatalog {
  if (!Array.isArray(stations) || stations.length < 2 || stations.length > JOURNEY_LIMITS.stations) throw new InputError('Invalid bounded physical stations');
  const rows: PhysicalStation[] = [], ids=new Set<string>(), names=new Set<string>();
  for (const s of stations) {
    if (!s || typeof s!=='object' || typeof s.id!=='string' || !s.id.trim() || s.id.length>128 || typeof s.name!=='string' || !s.name.trim() || s.name.length>128 || !Array.isArray(s.lines) || !s.lines.length || s.lines.length>2 || s.lines.some((l:unknown)=>l!==1&&l!==2) || new Set(s.lines).size!==s.lines.length) throw new InputError('Invalid physical station');
    if(ids.has(s.id)||names.has(normName(s.name))) throw new InputError('Duplicate physical station identity');
    ids.add(s.id);names.add(normName(s.name));rows.push(Object.freeze({id:s.id,name:s.name,lines:Object.freeze([...s.lines])}));
  }
  const orders={} as Record<MetroLine, readonly string[]>;
  for (const [line,names] of [[1,line1Order],[2,line2Order]] as const) {
    if(!Array.isArray(names)||names.length<2||names.length>JOURNEY_LIMITS.stopsPerTrip) throw new InputError('Invalid line order');
    const order:string[]=[];
    for(const name of names) {
      if(typeof name!=='string')throw new InputError('Invalid station name');
      const station=rows.find(s=>normName(s.name)===normName(name));
      if(!station||!station.lines.includes(line))throw new InputError('Station membership mismatch');
      order.push(station.id);
    }
    if(new Set(order).size!==order.length||rows.some(s=>s.lines.includes(line)&&!order.includes(s.id)))throw new InputError('Incomplete or repeated line membership');
    orders[line]=Object.freeze(order);
  }
  const gh=orders[1].indexOf(ghadirId);
  if(gh<=0||gh>=orders[1].length-1)throw new InputError('Ghadir must be an interior line 1 station');
  return Object.freeze({stations:Object.freeze(rows),orders:Object.freeze(orders),ghadirId});
}
