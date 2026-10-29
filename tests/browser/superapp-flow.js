// Run in the browser console/CDP on a QA-only browser profile. Uses actual same-origin API responses.
// Preload a legacy station favourite in the profile to exercise migration preservation.
window.__superappReport = null;
(async () => {
  const checks = [];
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await pause(80); } throw new Error('Timed out waiting for UI state'); };
  const check = (name, condition) => { checks.push({ name, pass: Boolean(condition) }); if (!condition) throw new Error(name); };
  const click = selector => { const el = document.querySelector(selector); if (!el) throw new Error('Missing ' + selector); el.click(); };
  const nav = async view => { click(`#nav > [data-view="${view}"]`); await pause(100); };
  try {
    await wait(() => document.querySelector('.product-panel'));
    check('home isolates metro behind its service card', document.querySelectorAll('#panel [data-service="metro"]').length === 1 && !document.querySelector('#panel .route-list, #panel .board-host, #panel #metro-q'));
    const q = document.querySelector('#q');
    q.focus(); q.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    check('ArrowUp selects the last service on first key', q.getAttribute('aria-activedescendant') === 'service-opt-3');
    q.value = 'غدیر'; q.dispatchEvent(new Event('input', { bubbles: true }));
    check('global search never shows station suggestions', !document.querySelector('#suggest [role="option"]'));
    q.value = 'اتوبوس'; q.dispatchEvent(new Event('input', { bubbles: true }));
    check('category lookup finds the branded service', document.querySelector('#suggest [data-service="bus"]')?.textContent.includes('کاروان'));
    click('#suggest [data-service="bus"]');
    check('unbuilt service does not navigate', !!document.querySelector('.view--home'));
    await nav('services');
    const heart = document.querySelector('[data-product="metro"] .service-save');
    if (heart.getAttribute('aria-pressed') !== 'true') heart.click();
    check('product can be saved', heart.getAttribute('aria-pressed') === 'true');
    await nav('saved');
    check('global saves contain products, not station rows', !!document.querySelector('.view--saved [data-product="metro"]') && !document.querySelector('.view--saved .fav-row'));
    const opener = document.querySelector('.view--saved [data-product="metro"] .service-card__actions button'); opener.focus(); opener.click();
    await wait(() => document.querySelectorAll('.route-row').length === 24);
    check('embedded station view never renders boolean placeholders', !Array.from(document.querySelector('.view--stations').childNodes).some(node => node.nodeType === 3 && /^(false|true|null|undefined)$/.test(node.textContent.trim())));
    click('.stations__tabs [data-mode="line2"]');
    check('line 2 still contains 13 real stations', document.querySelectorAll('.route-row').length === 13);
    const mq = document.querySelector('#metro-q'); mq.focus(); mq.value = 'فکوری'; mq.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(() => document.querySelector('#metro-suggest-list [role="option"]'));
    check('station search stays inside Rail', document.querySelector('#metro-suggest-list [role="option"]').textContent.includes('فکوری'));
    click('#metro-suggest-list [role="option"]');
    await wait(() => document.querySelector('[role="dialog"] .station__asof-text')?.textContent.includes('به روز شده'));
    check('station board consumes the real API', document.querySelector('[role="dialog"] .station__name')?.textContent === 'شهید فکوری');
    check('line 2 timing limitations are disclosed', document.querySelector('[role="dialog"] .station__notes')?.textContent.includes('فاز'));
    click('[role="dialog"] button[aria-label="بستن"]');
    await wait(() => !document.querySelector('[role="dialog"]'));
    check('closing a board stays inside Rail', !!document.querySelector('.view--metro') && !document.documentElement.classList.contains('has-sheet'));
    document.querySelector('.metro-favourites').focus(); click('.metro-favourites');
    check('station favourites remain nested', !!document.querySelector('.view--favourites'));
    click('.back-link'); await wait(() => document.querySelector('.view--metro'));
    check('nested Back restores the invoking control', document.activeElement.classList.contains('metro-favourites'));
    click('.metro-head button'); await wait(() => document.querySelector('.view--saved'));
    check('Rail Back returns to its real origin', !!document.querySelector('.view--saved'));
    check('Rail Back restores origin focus', document.activeElement.textContent === 'باز کردن');
    await nav('settings');
    click('[data-pref="dark"]'); check('dark setting works', document.documentElement.dataset.theme === 'dark');
    click('[data-pref="light"]'); check('light setting works', document.documentElement.dataset.theme === 'light');
    click('[data-pref="auto"]');
    window.__superappReport = { ok: true, checks, qa: window.__qa ?? null };
  } catch (error) {
    window.__superappReport = { ok: false, checks, error: error.message, stack: error.stack };
  }
})();
