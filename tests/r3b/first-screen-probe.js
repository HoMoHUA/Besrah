// First-screen probe: pure measurement of the live DOM. No mutation except scrolling to the top.
(() => {
  const vw = innerWidth, vh = innerHeight, vv = window.visualViewport;
  const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY), height: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; };
  const visible = el => { if (!el || el.hidden) return false; const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const byText = (sel, re) => [...document.querySelectorAll(sel)].filter(visible).find(e => re.test((e.innerText || e.textContent || '').trim()));
  const nav = document.querySelector('#nav') || document.querySelector('.cm-bottom');
  const navR = nav ? nav.getBoundingClientRect() : null;
  const header = document.querySelector('.app-header, header.cm-header, #search-host')?.closest('header') || document.querySelector('header');
  const view = document.querySelector('.view--metro');
  const cta = byText('button', /دیدن برآورد سفر|دیدن زمان|برآورد سفر/);
  const from = document.querySelector('#journey-from'), to = document.querySelector('#journey-to');
  const mode = document.querySelector('#journey-mode');
  const time = document.querySelector('#journey-time, #journey-date');
  const swap = byText('button', /جابه ?جا/) || [...document.querySelectorAll('button')].filter(visible).find(e => /جابه ?جا/.test(e.getAttribute('aria-label') || ''));
  const out = {
    viewport: { w: vw, h: vh, visualH: vv ? Math.round(vv.height) : null, scrollY: Math.round(scrollY) },
    docHeight: document.documentElement.scrollHeight,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    nav: navR ? { top: Math.round(navR.top), height: Math.round(navR.height), position: getComputedStyle(nav).position } : null,
    appHeader: rect(document.querySelector('.cm-header, .app-header, header')),
    metroHead: rect(document.querySelector('.metro-head')),
    modelNote: rect(document.querySelector('.metro-model-note')),
    access: rect(document.querySelector('.metro-access')),
    rideTabs: rect(document.querySelector('.ride-tabs, [role=tablist]')),
    journey: rect(document.querySelector('.journey')),
    from: rect(from), to: rect(to), swap: rect(swap), mode: rect(mode), time: rect(time), cta: rect(cta),
    board: rect(document.querySelector('.metro-current-board')),
    trackerDetail: rect(document.querySelector('.metro-tracker-detail')),
  };
  const navTop = navR ? navR.top : vh;
  const usableBottom = Math.min(vh, navTop);
  out.usableViewportHeight = Math.round(usableBottom);
  const fields = { from: out.from, to: out.to, cta: out.cta, time: out.time || out.mode };
  out.visibleAtScroll0 = {};
  for (const [k, r] of Object.entries(fields)) out.visibleAtScroll0[k] = r ? (r.top >= 0 && r.bottom <= usableBottom) : null;
  if (out.cta) out.scrollNeededForCta = Math.max(0, Math.round(out.cta.bottom + 8 - usableBottom));
  if (out.cta) out.ctaTopFromViewportTop = out.cta.top;
  // Covered check: sample centre of each visible interactive control while at the top.
  const covered = [];
  for (const e of document.querySelectorAll('.view--metro button, .view--metro input, .view--metro select, .view--metro summary, .view--metro a')) {
    if (!visible(e)) continue; const r = e.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh) continue;
    const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(cx, cy);
    if (hit && !e.contains(hit) && !hit.contains(e) && nav && nav.contains(hit)) covered.push((e.id || e.innerText || e.tagName).toString().slice(0, 40));
  }
  out.coveredByNav = covered;
  const interactive = [...document.querySelectorAll('.view--metro button, .view--metro input, .view--metro select, .view--metro summary')].filter(visible);
  out.interactiveCount = interactive.length;
  out.aboveCta = out.cta ? interactive.filter(e => e.getBoundingClientRect().top + scrollY < out.cta.top).length : null;
  out.smallTargets = interactive.filter(e => { const r = e.getBoundingClientRect(); return r.height < 40 || r.width < 40; }).map(e => ({ t: (e.id || e.innerText || e.tagName).toString().slice(0, 28), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) })).slice(0, 12);
  out.textBeforeCta = out.cta ? [...view.querySelectorAll('p, small, h1, h2, h3')].filter(visible).filter(e => e.getBoundingClientRect().top + scrollY < out.cta.top).map(e => (e.innerText || '').trim()).filter(Boolean) : [];
  out.font = getComputedStyle(document.body).fontFamily.split(',')[0];
  return out;
})()
