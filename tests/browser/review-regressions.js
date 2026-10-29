// Browser regression checks from the independent review. Use a QA-only browser profile.
window.__reviewReport = null;
(async () => {
  const checks = [];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async f => { for (let i=0;i<100;i++) { if (f()) return; await sleep(60); } throw Error('UI timeout'); };
  const check = (name, ok) => { checks.push({name,pass:!!ok}); if(!ok) throw Error(name); };
  const click = s => { const e=document.querySelector(s); if(!e) throw Error('Missing '+s); e.click(); };
  try {
    click('#nav > [data-view="home"]'); click('[data-service="metro"]');
    await wait(()=>document.querySelectorAll('.route-row').length===24);
    const row = document.querySelector('.route-row'); row.focus(); row.click();
    await wait(()=>document.querySelector('[role="dialog"] .station__asof-text')?.textContent.includes('به روز شده'));
    history.back(); await wait(()=>!document.querySelector('[role="dialog"]'));
    history.forward(); await sleep(450);
    check('native Forward reopens the station sheet', !!document.querySelector('[role="dialog"]'));
    click('[role="dialog"] button[aria-label="بستن"]'); await wait(()=>!document.querySelector('[role="dialog"]'));
    click('.metro-head button'); await wait(()=>document.querySelector('.view--home'));
    check('route and browser history remain aligned after sheet Forward', history.state?.besrahRoute==='home');
    click('#nav > [data-view="services"]');
    let heart=document.querySelector('[data-product="metro"] .service-save'); if(heart.getAttribute('aria-pressed')!=='true') heart.click();
    click('#nav > [data-view="saved"]'); click('[data-product="metro"] .service-save');
    click('#nav > [data-view="services"]'); heart=document.querySelector('[data-product="metro"] .service-save');
    check('catalogue heart follows removal in Saved',heart.getAttribute('aria-pressed')==='false');
    click('[data-product="metro"] .service-card__actions button');
    await wait(()=>document.querySelector('.metro-discovery__card [data-focus-key="metro-station-open"]'));
    const recent=document.querySelector('[data-focus-key="metro-station-open"]');recent.focus();recent.click();
    await wait(()=>document.querySelector('[role="dialog"] .station__asof-text')?.textContent.includes('به روز شده'));
    click('[role="dialog"] button[aria-label="بستن"]');await wait(()=>!document.querySelector('[role="dialog"]'));
    check('recent-station board returns focus to the current equivalent opener',document.activeElement.dataset.focusKey==='metro-station-open');
    window.__reviewReport={ok:true,checks};
  } catch(error) { window.__reviewReport={ok:false,checks,error:error.message}; }
})();
