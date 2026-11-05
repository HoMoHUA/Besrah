// One saved destination for service favourites AND explicitly saved marketplace references.
// Only IDs/titles stored on-device; no automatic browsing, purchase or GPS history.
import { SERVICES } from '../services.js';
import { h, icon } from '../ui/dom.js';
import { serviceCard } from '../ui/service-card.js';

export function createSavedView(ctx) {
  const { serviceStore, store, actions } = ctx;
  const body = h('div', { class: 'service-catalog' });
  const root = h('div', { class: 'view view--saved' },
    h('header', { class: 'view__head' }, h('h1', { class: 'view__title', text: 'ذخیره‌ها' }),
      h('p', { class: 'view__sub', text: 'سرویس‌ها، فروشگاه‌ها و کالاهایی که خودتان ذخیره کرده‌اید؛ روی همین دستگاه.' })), body);

  function itemRow(item) {
    const kind = item.kind === 'food' ? 'فروشگاه بسفود' : 'کالای بسپی';
    return h('article', { class: 'cm-card saved-choice', dataset: { id: item.id, kind: item.kind } },
      h('div', { class: 'saved-choice__head' },
        h('b', { text: item.title }), h('span', { class: 'fd-note', text: kind })),
      h('div', { class: 'fd-actions' },
        h('button', { type:'button', class:['cm-btn','cm-btn--sm'],
          onClick:()=> actions.go(item.kind === 'food' ? 'food' : 'shop',
            {q:item.title, ...(item.vertical ? {vertical:item.vertical}:{})}) }, 'جست‌وجوی دوباره'),
        h('button', { type:'button', class:['cm-btn','cm-btn--ghost','cm-btn--sm'],
          onClick:()=> {store?.removeSavedChoice?.(item.kind,item.id); paint();} }, 'حذف ذخیره')));
  }

  function paint() {
    const services = SERVICES.filter(s => serviceStore.has(s.id));
    const items = store?.savedChoices?.() ?? [];
    const sections = [];
    if (services.length) sections.push(
      h('h2', { class:'view__title', text:'سرویس‌های ذخیره‌شده' }),
      ...services.map(s=>serviceCard(s,ctx))
    );
    if (items.length) sections.push(
      h('h2', { class:'view__title', text:'فروشگاه‌ها و کالاهای ذخیره‌شده' }),
      h('p', { class:'fd-note', text:'این فهرست نشان‌دهندهٔ قیمت، موجودی یا فعالیت فعلی فروشنده نیست؛ برای اطلاعات تازه جست‌وجو کنید.' }),
      ...items.map(itemRow)
    );
    if (!sections.length) sections.push(h('div', { class:'cm-card cm-empty saved-empty' },
      icon('heart'), h('h2', { text:'هنوز چیزی ذخیره نشده' }),
      h('p', { text:'در صفحه سرویس‌ها یا نتایج بسفود و بسپی، گزینهٔ ذخیره را انتخاب کنید.' }),
      h('button', {type:'button',class:'cm-btn cm-btn--sm',text:'دیدن سرویس‌ها',onClick:()=>actions.go('services') })));
    body.replaceChildren(...sections);
  }
  serviceStore.subscribe(paint);
  store?.subscribe?.(key=>{ if(key==='choices')paint(); });
  paint();
  return {el:root,onShow:paint};
}
