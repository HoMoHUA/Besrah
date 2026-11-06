import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { parseShopV2Catalog, searchShopV2, shopV2Product } from '../../src/shop/v2.js';

const NOW = Date.parse('2026-11-06T10:00:00Z');
const obs = '2026-11-06T09:00:00Z';
const until = '2026-11-07T09:00:00Z';
const identity = {brand:'Sony',model:'XB-910N',variant:'black 256',warranty:'18m',condition:'new'};
const offer = (merchantId:string,priceToman:number|null,patch:Record<string,unknown>={})=>({
  sourceId:'licensed_source_'+merchantId,sourceProductId:'sku_'+merchantId,merchantId,
  merchant:'فروشنده '+merchantId,title:'هدفون سونی',
  priceToman,shippingToman:null,stock:'unknown',status:priceToman==null?'price_unknown':'candidate',
  observedAt:obs,validUntil:until,sourceUrl:'https://shop.example.com/product/'+merchantId,...patch
});
const fixture = (changes:Record<string,unknown>={})=>JSON.stringify({
  schemaVersion:2,generatedAt:obs,sources:[],unmatched:[],
  products:[{canonicalId:'besrah:sony-xb910n-black',identity,checkoutTotalKnown:true,
    priceComparisonAvailable:false,lowestListedPriceToman:1,
    offers:[offer('a',1500000),offer('b',1700000)],...changes}]
});

describe('Shop V2 evidence-scoped catalog',()=>{
  it('recomputes a comparable minimum from fresh different merchants; never trusts stale precomputed flags',()=>{
    const c=parseShopV2Catalog(fixture());
    const a=searchShopV2(c,{q:'Sony',maxPrice:1600000},NOW);
    expect(a.total).toBe(1);
    expect(a.products[0]).toMatchObject({lowestListedPriceToman:1500000,
      comparable:true,checkoutTotalKnown:false});
    const p=shopV2Product(c,'besrah:sony-xb910n-black',NOW)!;
    expect(p.offers.map(x=>x.lowestWithinVerifiedGroup)).toEqual([true,false]);
    expect(p.note).toMatch(/هزینه نهایی سفارش تأیید نشده/);
    expect(JSON.stringify(p)).not.toContain('licenseRef');
  });
  it('disables price superlatives after evidence expiration and rejects under-budget stale offers',()=>{
    const c=parseShopV2Catalog(fixture());
    expect(searchShopV2(c,{maxPrice:2000000},NOW+4*86400_000).total).toBe(0);
    const p=shopV2Product(c,'besrah:sony-xb910n-black',NOW+4*86400_000)!;
    expect(p.comparable).toBe(false);
    expect(p.lowestListedPriceToman).toBeNull();
    expect(p.offers.every(x=>!x.lowestWithinVerifiedGroup)).toBe(true);
  });
  it('rejects single merchant, unknown price, unsafe links and invalid variants',()=>{
    expect(shopV2Product(parseShopV2Catalog(fixture({offers:[offer('a',1500000),offer('a',1400000,{sourceProductId:'other'})]})),
      'besrah:sony-xb910n-black',NOW)?.comparable).toBe(false);
    expect(shopV2Product(parseShopV2Catalog(fixture({offers:[offer('a',1500000),offer('b',null)]})),
      'besrah:sony-xb910n-black',NOW)?.comparable).toBe(false);
    expect(()=>parseShopV2Catalog(fixture({offers:[offer('a',1500000,{sourceUrl:'http://bad.example.com'})]}))).toThrow('invalid_shop_v2_offer');
    expect(()=>parseShopV2Catalog(fixture({identity:{...identity,variant:''}}))).toThrow('invalid_shop_v2_identity');
    expect(()=>parseShopV2Catalog(fixture({offers:[offer('a',-1)]}))).toThrow('invalid_shop_v2_offer');
  });
});

describe('V2 routing remains optional, isolated from the working V1 and transit',()=>{
  it('is absent by default and never loads staging data automatically',async()=>{
    const prev=process.env.BESRAH_SHOP_V2_ENABLED;
    delete process.env.BESRAH_SHOP_V2_ENABLED;
    try {
      const app=buildServer({now:()=>NOW});
      expect((await app.inject({url:'/app/api/shop/v2/search'})).statusCode).toBe(404);
      expect((await app.inject({url:'/app/api/stations'})).statusCode).toBe(200);
      await app.close();
    } finally {
      if(prev===undefined) delete process.env.BESRAH_SHOP_V2_ENABLED;
      else process.env.BESRAH_SHOP_V2_ENABLED=prev;
    }
  });
  it('a configured optional V2 exposes separately versioned search/product without V1 replacement',async()=>{
    const app=buildServer({now:()=>NOW,shopV2:{catalog:parseShopV2Catalog(fixture())}});
    const base='/app/api/shop/v2/';
    const results=(await app.inject({url:base+'search?q=Sony'})).json();
    expect(results.total).toBe(1);
    expect(results.products[0].lowestListedPriceToman).toBe(1500000);
    expect((await app.inject({url:base+'product?id=besrah:sony-xb910n-black'})).json().offers).toHaveLength(2);
    expect((await app.inject({url:base+'product?id=besrah:missing'})).statusCode).toBe(404);
    for(const q of ['search?limit=999','search?maxPrice=bad','search?x=1','product?id=../etc/passwd']){
      expect((await app.inject({url:base+q})).statusCode,q).toBe(400);
    }
    expect((await app.inject({url:'/app/api/stations'})).statusCode).toBe(200);
    await app.close();
  });
  it('an absent V2 file returns only a V2 503, leaves public transit active',async()=>{
    const app=buildServer({shopV2:{loader:()=>{throw new Error('offline');}}});
    expect((await app.inject({url:'/app/api/shop/v2/search'})).statusCode).toBe(503);
    expect((await app.inject({url:'/app/api/stations'})).statusCode).toBe(200);
    await app.close();
  });
});
