/** Catalog includes non-restaurants. Classify from provider category first; do not discard shops. */
export const FOOD_VERTICALS = ['restaurant','fast_food','cafe','sweets','bakery','flowers','grocery','produce','protein','nuts','other'] as const;
export type FoodVertical = typeof FOOD_VERTICALS[number];
export type FoodVerticalFilter = FoodVertical | 'meals' | 'all';
export const FOOD_VERTICAL_LABELS: Record<FoodVertical,string> = {
  restaurant:'رستوران و غذای ایرانی',fast_food:'فست‌فود',cafe:'کافه و نوشیدنی',
  sweets:'شیرینی، دسر و بستنی',bakery:'نانوایی',flowers:'گل و هدیه',
  grocery:'سوپرمارکت و خرید روزانه',produce:'میوه و سبزی',
  protein:'پروتئین و گوشت',nuts:'آجیل و خشکبار',other:'سایر فروشگاه‌ها'
};
const fold=(value:unknown):string=>String(value??'').toLowerCase().replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[أإآ]/g,'ا')
  .replace(/[\u200c\u200f\u064b-\u065f]/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const RULES: ReadonlyArray<[FoodVertical,RegExp]> = [
  ['flowers',/گل فروشی|گلفروشی|گل و گیاه|گل و هدیه|دسته گل|باکس گل|گیاه زینتی|شاخه گل|فلوریست|florist|flower shop|flowers?/],
  ['nuts',/اجیل|خشکبار|عطاری|ادویه|گیاهان دارویی|مغزیجات|nuts|dried fruit|herbal/],
  ['produce',/میوه|سبزی|تره بار|صیفی|produce|greengrocer|fruit|vegetable/],
  ['protein',/قصابی|پروتئین|گوشت فروشی|مرغ فروشی|ماهی فروشی|butcher|protein|fish market/],
  ['grocery',/سوپرمارکت|سوپر مارکت|هایپر|خواربار|فروشگاه زنجیره ای|کالای اساسی|خرید روزانه|سوپر|grocery|supermarket|hypermarket/],
  ['sweets',/شیرینی|قنادی|کیک|بستنی|دسر|دونات|ژلاتو|کوکی|شکلات فروشی|باقلوا|pastry|confectionery|dessert|ice cream|cake|sweets/],
  ['bakery',/نانوایی|نانوائی|نان فانتزی|نان سنتی|نان داغ|نانوا|bakery|bread/],
  ['cafe',/کافه|کافی شاپ|قهوه|ابمیوه|اب میوه|اسموتی|cafe|coffee|juice bar|beverage/],
  ['fast_food',/فست فود|فستفود|پیتزا|ساندویچ|برگر|سوخاری|fast food|pizza|burger|sandwich/],
  ['restaurant',/رستوران|غذای ایرانی|چلو|کباب|غذاخوری|دیزی|آشپزخانه|کترینگ|تهیه غذا|غذای خانگی|طباخی|restaurant|catering/],
];
const classify=(text:string):FoodVertical|null=>RULES.find(([,rx])=>rx.test(text))?.[0]??null;
export interface VerticalAssessment {vertical:FoodVertical;basis:'provider_category'|'vendor_name'|'menu_majority'|'unclassified'}
export function assessVertical(category:string,name:string,itemCategories:readonly string[]=[]):VerticalAssessment {
  const byCategory=classify(fold(category));
  if(byCategory)return {vertical:byCategory,basis:'provider_category'};
  const byName=classify(fold(name));
  if(byName)return {vertical:byName,basis:'vendor_name'};
  const votes=new Map<FoodVertical,number>();
  for(const item of itemCategories.slice(0,500)){const key=classify(fold(item));if(key)votes.set(key,(votes.get(key)??0)+1);}
  const counted=[...votes.values()].reduce((a,b)=>a+b,0);
  const winner=[...votes.entries()].sort((a,b)=>b[1]-a[1])[0];
  if(winner&&winner[1]>=2&&winner[1]>=counted*0.6)return {vertical:winner[0],basis:'menu_majority'};
  return {vertical:'other',basis:'unclassified'};
}
export const verticalMatches=(actual:FoodVertical,filter:FoodVerticalFilter|null|undefined):boolean=>
  !filter||filter==='all'||actual===filter||(filter==='meals'&&(actual==='restaurant'||actual==='fast_food'));
export const isMealVertical=(v:FoodVertical)=>v==='restaurant'||v==='fast_food';
