import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { assessVertical, verticalMatches, FOOD_VERTICALS } from '../../src/food/verticals.js';
import { parseFoodIndex, searchFood } from '../../src/food/search.js';
const cap=Math.floor(Date.parse('2026-11-05T09:00:00Z')/1000);
const vendor=(id:string,cat:string,name:string,items:any[])=>({
  id,s:id[0],c:id.slice(2),n:name,b:'',t:cat,la:36.3,lo:59.58,a:'مشهد',m:null,r:8,cc:10,o:null,cap,lk:'https://example.test/'+id,i:items
});
const fixture=()=>parseFoodIndex(gzipSync(Buffer.from(JSON.stringify({v:1,capturedFrom:cap,capturedTo:cap,vendors:[
  vendor('s:a','رستوران','چلوکبابی',[['چلو کباب','',150000,null,'غذای ایرانی'],['نوشابه','',20000,null,'نوشیدنی']]),
  vendor('s:b','گلفروشی','گل آفتاب',[['دسته گل رز','',220000,null,'گل و گیاه']]),
  vendor('t:c','کافه','قهوه شهر',[['لاته','',80000,null,'نوشیدنی'],['چای','',35000,null,'نوشیدنی']]),
  vendor('t:d','قنادی','کیک ماه',[['کیک شکلاتی','',240000,null,'کیک و شیرینی']]),
  vendor('s:e','سوپرمارکت','هایپر گل',[['شیر','',45000,null,'لبنیات']]),
  vendor('s:f','متفرقه','فروشگاه نامشخص',[['هدیه','',null,null,'سایر']]),
]}))));
describe('provider category coverage',()=>{
  it.each([['گل فروشی','flowers'],['شیرینی','sweets'],['کافه','cafe'],['سوپرمارکت','grocery'],['نانوایی','bakery'],['فست فود','fast_food'],['رستوران','restaurant'],['میوه','produce'],['پروتئین','protein'],['آجیل','nuts']])(
    'classifies %s to %s',(category,expected)=>expect(assessVertical(category,'یک فروشنده').vertical).toBe(expected)
  );
  it('does not force unclassified shops into restaurants',()=>expect(assessVertical('نامعلوم','فروشگاه معمولی').vertical).toBe('other'));
  it('only uses a significant menu majority for fallback',()=>{
    expect(assessVertical('','',['کیک','کیک','پیتزا']).vertical).toBe('sweets');
    expect(assessVertical('','',['کیک','پیتزا']).vertical).toBe('other');
  });
  it('keeps all verticals discoverable',()=>expect(FOOD_VERTICALS).toContain('flowers'));
});
describe('vertical browse',()=>{
  const idx=fixture();
  it('does not drop flowers, café, sweet, grocery, unknown from all results',()=>{
    const r=searchFood(idx,{vertical:'all'});
    expect(r.total).toBe(6);
    expect(r.vendors.map(v=>v.vertical)).toEqual(expect.arrayContaining(['restaurant','flowers','cafe','sweets','grocery','other']));
  });
  it('meals are separate from gifts, café and groceries',()=>{
    expect(searchFood(idx,{vertical:'meals'}).vendors.map(v=>v.vertical)).toEqual(['restaurant']);
    expect(searchFood(idx,{vertical:'flowers'}).vendors.map(v=>v.name)).toEqual(['گل آفتاب']);
    expect(verticalMatches('flowers','meals')).toBe(false);
  });
  it('drinks in a café are real products, not discarded as restaurant side dishes',()=>{
    expect(searchFood(idx,{vertical:'cafe',q:'لاته'}).vendors[0].matched[0].name).toBe('لاته');
    expect(searchFood(idx,{vertical:'restaurant',q:'نوشابه'}).vendors[0].matched[0].name).toBe('نوشابه');
    expect(searchFood(idx,{vertical:'restaurant',q:'کباب'}).vendors[0].matched.every(x=>x.name!=='نوشابه')).toBe(true);
  });
  it('exposes classification basis and original provider category, not fabricated opening hours',()=>{
    const flower=searchFood(idx,{vertical:'flowers'}).vendors[0];
    expect(flower.category).toBe('گلفروشی');
    expect(flower.verticalBasis).toBe('provider_category');
    expect(flower.openSnapshot.value).toBe('unknown');
  });
});
