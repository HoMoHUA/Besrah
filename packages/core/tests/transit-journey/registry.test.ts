import { describe, expect, it } from 'vitest';
import { createStationCatalog } from '../../src/transit-journey/registry.js';
const rows = () => [{id:'fixture:a',name:'A',lines:[1]},{id:'fixture:shared',name:'Shared',lines:[1,2]},{id:'fixture:g',name:'G',lines:[1]},{id:'fixture:z',name:'Z',lines:[1]},{id:'fixture:l2',name:'L2',lines:[2]}];
describe('physical station catalog', () => {
 it('keeps one physical shared station with separate line indices', () => {
  const c=createStationCatalog(rows(),['A','Shared','G','Z'],['L2','Shared'],'fixture:g');
  expect(c.stations.filter(s=>s.id==='fixture:shared')).toHaveLength(1);
  expect(c.orders[1][1]).toBe('fixture:shared');expect(c.orders[2][1]).toBe('fixture:shared');
 });
});
