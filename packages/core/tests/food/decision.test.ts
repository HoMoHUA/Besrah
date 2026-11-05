import { describe, expect, it } from 'vitest';
import { decideFoodResults } from '../../src/food/decision.js';
import type { FoodVendorDto } from '../../src/food/search.js';
const NOW=Date.parse('2026-11-05T12:00:00Z');
const captured=new Date(NOW-3600_000).toISOString();
const vendor=(id:string,price:number|null,over:Partial<FoodVendorDto>={}):FoodVendorDto=>({
  id,provider:id.startsWith('s:')?'snappfood':'tapsifood',name:'غذاپز',branch:null,
  category:'رستوران',vertical:'restaurant',verticalLabel:'رستوران',verticalBasis:'provider_category',
  address:null,lat:36.3,lon:59.58,distanceM:null,rating:8,commentCount:20,
  minOrderToman:null,minOrderState:'unknown',
  openSnapshot:{value:'unknown',capturedAt:captured,note:'not live'},
  capturedAt:captured,orderUrl:'https://example.test/vendor',orderCode:id.slice(2),
  matchedCount:1,cheapestMatchedToman:price,
  matched:[{name:'چلو کباب کوبیده',variation:'',category:'غذا',priceToman:price,finalPriceToman:price,discounted:false,priceState:price===null?'unknown':'known'}],
  ...over
});
describe('food evidence and Core',()=>{
  it('only labels the lowest RECORDED ITEM price of fresh equally named/variant options',()=>{
    const d=decideFoodResults([vendor('s:a',150000),vendor('t:b',190000)],NOW);
    expect(d.status).toBe('ok');
    expect(d.byVendor['s:a'].label).toContain('قیمت ثبت‌شده');
    expect(d.byVendor['t:b'].label).toBeNull();
    expect(d.notes.join(' ')).toMatch(/هزینهٔ نهایی سفارش نیست/);
  });
  it('never compares cake against chelo kabab or bouquet, regardless of price',()=>{
    const d=decideFoodResults([
      vendor('s:a',150000),
      vendor('s:b',10000,{vertical:'sweets',matched:[{name:'کیک',variation:null,category:'کیک',priceToman:10000,finalPriceToman:10000,discounted:false,priceState:'known'}]}),
      vendor('s:c',5000,{vertical:'flowers',matched:[{name:'شاخه گل',variation:null,category:'گل',priceToman:5000,finalPriceToman:5000,discounted:false,priceState:'known'}]}),
    ],NOW);
    expect(Object.values(d.byVendor).every(x=>x.label===null)).toBe(true);
  });
  it('does not assert cheapest when stale or missing price, and avoids zero assumptions',()=>{
    const d=decideFoodResults([vendor('s:a',150000,{capturedAt:new Date(NOW-100*3600_000).toISOString()}),vendor('t:b',null)],NOW);
    expect(d.byVendor['s:a'].reason).toBe('snapshot_stale');
    expect(d.byVendor['t:b'].reason).toBe('price_or_capture_unknown');
    expect(Object.values(d.byVendor).every(x=>x.label===null)).toBe(true);
  });
  it('does not claim global cheapest with only a single vendor',()=>{
    const d=decideFoodResults([vendor('s:a',160000)],NOW);
    expect(d.byVendor['s:a'].label).toBeNull();
  });
});
