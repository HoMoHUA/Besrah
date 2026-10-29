/* @ds-bundle: {"format":4,"namespace":"HM7","components":[{"name":"Stage"},{"name":"Surfaces"},{"name":"Buttons"},{"name":"TextField"},{"name":"SearchField"},{"name":"Chips"},{"name":"Badges"},{"name":"Menus"},{"name":"GlassReveal"},{"name":"Elastic"},{"name":"IconMorph"},{"name":"Radio"},{"name":"Switch"},{"name":"Header"},{"name":"BottomNav"},{"name":"FluidTabs"},{"name":"PageTransition"},{"name":"CheckoutSteps"},{"name":"ProductCard"},{"name":"PriceRating"},{"name":"BuyBox"},{"name":"QuantityStepper"},{"name":"CartLines"},{"name":"DropToCart"},{"name":"FlashDeal"},{"name":"Toasts"},{"name":"PriceFilter"},{"name":"CategoryLamps"},{"name":"PromoWidget"},{"name":"Skeleton"},{"name":"EmptyState"},{"name":"QuickActions"},{"name":"NavDock"},{"name":"SoundCues"},{"name":"GlassModes"}]} */
/*!
 * HM7 Immersive Light — motion kit v1.0
 * Vanilla JS, zero dependencies, no network. Pair with hm7-motion.css.
 *
 *   HM7.light(stage)                 light follows the finger, rims react
 *   HM7.particleSlider(el, opts)     glass capsule with a particle force field
 *   HM7.swipeDismiss(card, opts)     swipe, liquid action buttons, backdrop-coloured sand dissolve
 *   HM7.clearAll([swipes], opts)     every card dissolves bottom→top behind a crest of light
 *   HM7.sweep(elements, opts)        the same crest sweep for any elements (chat history, cart)
 *   HM7.dissolve(el, opts)           one element → backdrop-coloured sand, right→left
 *   HM7.iconDrag(stage, opts)        lift icon, elastic magnetic folder membrane, drop ripple
 *   HM7.bounceCard(el, opts)         3D tilt + specular + bouncy-ball spring
 *   HM7.lensTabs(bar, opts)          liquid magnifying lens tab indicator
 *   HM7.edgeGlow(el, level)          'strong' | 'medium' | 'soft' | 'off'
 *   HM7.ripple(container, x, y)      refractive ripple ring
 *   HM7.init(root)                   auto-wire [data-hm7] elements
 */
(function (global) {
  'use strict';

  var RM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dpr() { return Math.min(2, window.devicePixelRatio || 1); }
  function damp(rate, dt) { return 1 - Math.exp(-rate * dt); }
  function isRTL(el) { return getComputedStyle(el).direction === 'rtl'; }
  function relRect(el, root) {
    var a = el.getBoundingClientRect(), b = root.getBoundingClientRect();
    return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
  }

  /* ── shared animation loop, pauses per-instance when offscreen ── */
  var loops = new Set(), rafId = 0, lastT = 0;
  function frame(t) {
    var dt = Math.min(0.05, Math.max(0.001, (t - lastT) / 1000));
    lastT = t;
    // read phase first (layout reads), then write phase — avoids forced synchronous reflow
    loops.forEach(function (f) { if (f.active !== false && f.read) f.read(); });
    loops.forEach(function (f) { if (f.active !== false) f(dt, t / 1000); });
    rafId = loops.size ? requestAnimationFrame(frame) : 0;
  }
  function addLoop(f, watchEl) {
    loops.add(f);
    if (watchEl && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { f.active = es[0].isIntersecting; }, { rootMargin: '120px' }).observe(watchEl);
    }
    if (!rafId) { lastT = performance.now(); rafId = requestAnimationFrame(frame); }
    return function () { loops.delete(f); };
  }

  // controls inside a draggable card keep their own clicks (a stepper in a cart line, a copy button on a coupon)
  var NODRAG = 'button, a[href], input, select, textarea, label, [contenteditable], [data-hm7-nodrag]';
  function ownControl(e, host) { var t = e.target && e.target.closest && e.target.closest(NODRAG); return !!(t && t !== host && host.contains(t)); }

  /* ── critically-tunable spring (semi-implicit Euler, sub-stepped) ── */
  function Spring(x, k, c) { this.x = x || 0; this.v = 0; this.t = this.x; this.k = k || 170; this.c = c || 18; }
  Spring.prototype.step = function (dt) {
    if (RM.matches) { this.x = this.t; this.v = 0; return this.x; }
    var n = Math.ceil(dt / 0.006), h = dt / n;
    while (n--) {
      this.v += (-this.k * (this.x - this.t) - this.c * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  };
  Spring.prototype.settled = function (eps) { eps = eps || 0.01; return Math.abs(this.x - this.t) < eps && Math.abs(this.v) < eps * 10; };

  /* ── soft glow sprite used by every particle system ── */
  var sprite = null;
  function getSprite() {
    if (sprite) return sprite;
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = 32;
    var c = sprite.getContext('2d'), g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(.25, 'rgba(255,255,255,.75)');
    g.addColorStop(.6, 'rgba(255,255,255,.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 32, 32);
    return sprite;
  }
  function fitCanvas(cv, w, h) {
    var r = dpr(), W = Math.round(w * r), H = Math.round(h * r);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    var ctx = cv.getContext('2d');
    ctx.setTransform(r, 0, 0, r, 0, 0);
    return ctx;
  }
  // cheap flow field ("wind") — smooth, divergence-light
  function flow(x, y, t) {
    return Math.sin(x * 0.011 + t * 0.7) * Math.cos(y * 0.017 - t * 0.5) * 3.1416 +
           Math.sin((x + y) * 0.006 + t * 0.3) * 1.2;
  }

  /* ─────────────────────────────────────────────
     1. LIGHT FOLLOWS THE FINGER
     ───────────────────────────────────────────── */
  function light(root, o) {
    o = o || {};
    var baseColor = o.color || '255,255,255';
    var radius = o.radius || 240;
    var auto = o.auto !== false;
    var LAMP_R = o.lampRadius || 230;      // how far a lit tile throws its light
    var WAVE = o.waveSpeed || 760;         // px/s — light reaches neighbours a beat later
    var STEADY = o.steady != null ? o.steady : .3; // glow kept by tiles that are switched on
    var spot = root.querySelector(':scope > .hm7-touchlight');
    if (!spot) { spot = document.createElement('div'); spot.className = 'hm7-touchlight'; root.insertBefore(spot, root.firstChild); }

    var s = { x: 0, y: 0, tx: 0, ty: 0, o: 0, to: 0, down: false, lc: baseColor, idle: 0, init: false };
    var pressed = null, els = [], rects = [], rb = null, lastScan = -1, now = 0;
    var lamps = new Map();                 // key → { x, y, i, ti, c, born, el, kind }

    function local(e) { var r = root.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    function centerOf(el) { var r = relRect(el, root); return [r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h)]; }
    function lamp(key, x, y, target, color, kind) {
      var L = lamps.get(key);
      if (!L) {
        var g = document.createElement('div'); g.className = 'hm7-lampglow'; root.insertBefore(g, spot.nextSibling);
        L = { x: x, y: y, i: 0, ti: target, c: color, born: now, el: g, kind: kind || 'pulse', size: 0 };
        lamps.set(key, L);
      }
      L.x = x; L.y = y; L.ti = target; L.c = color || L.c;
      return L;
    }
    // public: anything can light the scene (e.g. the brightness slider dispatches hm7:lamp)
    root.addEventListener('hm7:lamp', function (e) {
      var d = e.detail || {}, r = root.getBoundingClientRect();
      lamp(d.id || 'ext', d.clientX - r.left, d.clientY - r.top, d.i || 0, d.color || baseColor, 'ext').size = d.size || 0;
    });

    root.addEventListener('pointermove', function (e) {
      var p = local(e); s.tx = p[0]; s.ty = p[1]; s.idle = 0;
      s.to = s.down ? 1 : (e.pointerType === 'mouse' ? .6 : s.to);
      if (!s.init) { s.x = s.tx; s.y = s.ty; s.init = true; }
    });
    root.addEventListener('pointerdown', function (e) {
      var p = local(e); s.tx = p[0]; s.ty = p[1]; s.down = true; s.to = 1; s.idle = 0;
      if (!s.init || e.pointerType !== 'mouse') { s.x = s.tx; s.y = s.ty; s.init = true; }
      var tint = e.target.closest && e.target.closest('[data-hm7-tint]');
      s.lc = tint ? tint.getAttribute('data-hm7-tint') : baseColor;
      var btn = e.target.closest && e.target.closest('.hm7-press');
      if (btn && root.contains(btn)) {
        pressed = btn; btn.classList.add('is-pressed'); btn._hm7t = performance.now();
        var c = centerOf(btn);
        ripple(root, p[0], p[1], { size: c[2] * 1.6 });
        // the touched tile becomes a lamp: flash, then its light washes over the neighbours
        var L = lamp(btn, c[0], c[1], 1, s.lc, 'press'); L.born = now; L.size = c[2];
      }
    });
    function up(e) {
      s.down = false; s.to = e && e.pointerType === 'mouse' ? .6 : 0;
      if (pressed) {
        var btn = pressed; pressed = null; btn.classList.remove('is-pressed');
        if (btn.hasAttribute('data-hm7-toggle')) flip(btn, performance.now() - (btn._hm7t || 0));
      }
    }
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    root.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && !s.down) s.to = 0; });
    // the tile flashes white (≈120 ms rise), the new state appears at the peak (≈300 ms),
    // then it settles into its on/off colour over ≈400 ms — timings from the 1080p capture
    function flip(btn, held) {
      btn.classList.remove('is-flash'); void btn.offsetWidth; btn.classList.add('is-flash');
      setTimeout(function () {
        btn.classList.toggle('is-on');
        btn.setAttribute('aria-pressed', btn.classList.contains('is-on'));
        cue(btn.classList.contains('is-on') ? 'tileOn' : 'tileOff', null, btn);      // on the flash peak, not on the press
        var L = lamps.get(btn); if (L) L.ti = btn.classList.contains('is-on') ? STEADY : 0;
      }, Math.max(0, (o.flipAt || 300) - held));
      clearTimeout(btn._hm7f); btn._hm7f = setTimeout(function () { btn.classList.remove('is-flash'); }, 760);
    }
    root.addEventListener('keydown', function (e) {
      var btn = e.target.closest && e.target.closest('[data-hm7-toggle]');
      if (btn && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        var c = centerOf(btn), L = lamp(btn, c[0], c[1], 1, btn.getAttribute('data-hm7-tint') || baseColor, 'press');
        L.born = now; L.size = c[2];
        flip(btn, 0);
      }
    });

    function scan() {
      els = Array.prototype.slice.call(root.querySelectorAll('.hm7-glass:not([data-hm7-own-light]), [data-hm7-light]'));
      // tiles that are already on glow softly from the start
      if (STEADY > 0) root.querySelectorAll('[data-hm7-toggle].is-on').forEach(function (b) {
        if (!lamps.has(b)) { var c = centerOf(b), L = lamp(b, c[0], c[1], STEADY, b.getAttribute('data-hm7-tint') || baseColor, 'press'); L.i = STEADY; L.born = -9; L.size = c[2]; }
      });
    }

    // READ phase: all layout reads happen before anyone writes this frame (no forced reflow)
    function read() {
      if (now - lastScan > 1.2 || lastScan < 0) { scan(); lastScan = now; }
      var b = root.getBoundingClientRect(); rb = b;
      rects.length = els.length;
      for (var i = 0; i < els.length; i++) {
        var a = els[i].getBoundingClientRect();
        rects[i] = [a.left - b.left, a.top - b.top, a.width, a.height];
      }
    }

    function tick(dt, t) {
      now = t;
      var W = root.clientWidth, H = root.clientHeight;
      s.idle += dt;
      if (auto && s.idle > 2.6 && !s.down) {
        s.tx = W * (.5 + .38 * Math.sin(t * .45));
        s.ty = H * (.5 + .32 * Math.sin(t * .62 + 1.3));
        s.to = .85; s.lc = baseColor;
        if (!s.init) { s.x = s.tx; s.y = s.ty; s.init = true; }
      }
      var k = damp(s.down ? 22 : 9, dt);
      s.x += (s.tx - s.x) * k; s.y += (s.ty - s.y) * k;
      s.o += (s.to - s.o) * damp(8, dt);
      spot.style.transform = 'translate3d(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px,0) scale(' + (s.down ? 1.15 : 1) + ')';
      spot.style.opacity = s.o.toFixed(3);
      spot.style.setProperty('--lc', s.lc);

      // lamps: fast attack, slow warm decay (like a filament), bloom under the glass
      lamps.forEach(function (L, key) {
        var up = L.ti > L.i;
        L.i += (L.ti - L.i) * damp(up ? 26 : 3.2, dt);
        var age = t - L.born;
        var flash = L.kind === 'press' ? Math.exp(-age * 3.2) : 0;     // expanding flash ring
        var size = (L.size || 60) * (2.6 + 2.2 * (1 - Math.exp(-age * 4)));
        L.el.style.setProperty('--lc', L.c);
        L.el.style.transform = 'translate3d(' + L.x.toFixed(1) + 'px,' + L.y.toFixed(1) + 'px,0)';
        L.el.style.width = L.el.style.height = size.toFixed(0) + 'px';
        L.el.style.opacity = Math.min(1, L.i * .9 + flash * .5).toFixed(3);
        L.flash = flash;
        if (L.i < .003 && L.ti === 0 && flash < .01) { L.el.remove(); lamps.delete(key); }
      });

      for (var i = 0; i < els.length; i++) {
        var r = rects[i]; if (!r) continue;
        var nx = clamp(s.x, r[0], r[0] + r[2]), ny = clamp(s.y, r[1], r[1] + r[3]);
        var d = Math.hypot(s.x - nx, s.y - ny);
        var li = clamp(1 - d / radius, 0, 1) * s.o;
        // lamp light: strongest lamp sets direction & colour, all lamps add up (wave-delayed)
        var best = null, bestI = 0, sum = 0, cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2;
        lamps.forEach(function (L, key) {
          var self = key === els[i];
          var qx = clamp(L.x, r[0], r[0] + r[2]), qy = clamp(L.y, r[1], r[1] + r[3]);
          var dd = self ? 0 : Math.hypot(L.x - qx, L.y - qy);
          var f = self ? 1 : Math.pow(clamp(1 - dd / LAMP_R, 0, 1), 1.8);
          if (!f) return;
          var delay = dd / WAVE, age = now - L.born;
          var arrive = L.kind === 'press' ? clamp((age - delay) / .12, 0, 1) : 1;
          var spill = L.kind === 'press' && L.ti > 0 && L.ti < 1 ? .55 : 1;   // a tile that is merely 'on' spills softer light
          var I = (L.i * spill + (L.flash || 0) * .6 * Math.exp(-dd / 120)) * f * arrive * (self ? .35 : 1);
          sum += I;
          if (I > bestI) { bestI = I; best = L; }
        });
        var st = els[i].style;
        st.setProperty('--lx', (s.x - r[0]).toFixed(1) + 'px');
        st.setProperty('--ly', (s.y - r[1]).toFixed(1) + 'px');
        st.setProperty('--li', (li * li * (3 - 2 * li)).toFixed(3));
        st.setProperty('--lc', s.lc);
        var l2 = 1 - Math.exp(-sum * 1.25);           // soft-saturating sum: many lamps never blow out to white
        if (best) {
          st.setProperty('--l2x', (best.x - r[0]).toFixed(1) + 'px');
          st.setProperty('--l2y', (best.y - r[1]).toFixed(1) + 'px');
          st.setProperty('--l2c', best.c);
        }
        if (l2 > .002 || st.getPropertyValue('--l2i') !== '0') st.setProperty('--l2i', l2 > .002 ? l2.toFixed(3) : '0');
      }
    }
    tick.read = read;
    var stop = addLoop(tick, root);
    window.addEventListener('resize', function () { lastScan = -1; });
    return { destroy: stop, state: s, lamp: lamp };
  }

  /* ─────────────────────────────────────────────
     RIPPLE (refractive ring)
     ───────────────────────────────────────────── */
  function ripple(container, x, y, o) {
    o = o || {};
    var size = o.size || 160, rings = o.rings || 2;
    for (var i = 0; i < rings; i++) {
      (function (i) {
        var r = document.createElement('span');
        r.className = 'hm7-ripple';
        r.style.left = x + 'px'; r.style.top = y + 'px';
        r.style.setProperty('--to', (size / 20) * (1 - i * .28));
        r.style.setProperty('--dur', (o.duration || .95) + i * .18 + 's');
        r.style.animationDelay = i * .11 + 's';
        container.appendChild(r);
        r.addEventListener('animationend', function () { r.remove(); });
      })(i);
    }
  }

  /* ─────────────────────────────────────────────
     2. PARTICLE SLIDER (brightness capsule)
     ───────────────────────────────────────────── */
  var SUN = '<i class="hms hms-sun_max_fill" aria-hidden="true"></i>';

  function particleSlider(el, o) {
    o = o || {};
    var value = clamp(o.value != null ? o.value : parseFloat(el.getAttribute('data-value') || .45), 0, 1);
    el.classList.add('hm7-pslider', 'hm7-glass');
    el.setAttribute('role', 'slider');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', '100');
    if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', o.label || 'Brightness');
    el.innerHTML = '<div class="hm7-pslider__fill"></div><canvas></canvas><div class="hm7-pslider__icon">' + (o.icon || SUN) + '</div>';
    var fill = el.firstChild, cv = el.querySelector('canvas');
    var vert = !!(o.vertical || el.getAttribute('data-orientation') === 'vertical');
    var rtl = !vert && isRTL(el);
    if (vert) { el.classList.add('hm7-pslider--v'); el.setAttribute('aria-orientation', 'vertical'); }
    el.style.setProperty('--hm7-end', rtl ? 'left' : 'right');
    // fill tinted from the wallpaper (the capture shows a green fill on a green wallpaper)
    if (o.tint) el.style.setProperty('--hm7-fill', 'linear-gradient(to ' + (vert ? 'top' : (rtl ? 'left' : 'right')) +
      ', rgba(' + o.tint + ',.55), rgba(' + o.tint + ',.78) 70%, rgba(255,255,255,.95))');

    // isolate: while the slider is held, everything else in the panel fades away so the real
    // effect can be judged (HarmonyOS 7 control centre); dim: the screen follows the value
    var iso = o.isolate || null, isoTimer = 0, isoOn = false, ipath = [];
    if (iso) { var q = el; while (q && q !== iso) { ipath.push(q); q = q.parentElement; } }
    var active = false, actT = 0;
    function activate(on) {
      clearTimeout(actT);
      if (on) { active = true; el.classList.add('is-active'); }
      else actT = setTimeout(function () { active = false; el.classList.remove('is-active'); }, o.dimDelay || 520);
    }
    el.addEventListener('focus', function () { activate(true); });
    el.addEventListener('blur', function () { activate(false); });
    var unisoT = 0;
    function isolate(on) {
      if (!iso || on === isoOn) return;
      isoOn = on; clearTimeout(unisoT);
      lastV = -1;                                   // re-evaluate the screen dim
      if (on) {
        ipath.forEach(function (e) { e.classList.add('hm7-ipath'); });
        iso.classList.remove('hm7-unisolate'); iso.classList.add('hm7-isolate');
      } else {
        iso.classList.remove('hm7-isolate'); iso.classList.add('hm7-unisolate');
        unisoT = setTimeout(function () { iso.classList.remove('hm7-unisolate'); ipath.forEach(function (e) { e.classList.remove('hm7-ipath'); }); }, 380);
      }
    }

    var sp = new Spring(value, 260, 30);
    var N = o.count || 170, P = [], W = 0, H = 0;
    var ptr = { x: -1e3, y: -1e3, px: -1e3, py: -1e3, vx: 0, vy: 0, on: false, down: false };
    var sparks = [];

    function seed() {
      P.length = 0;
      for (var i = 0; i < N; i++) P.push({ x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0, s: .5 + Math.random() * 1.6, ph: Math.random() * 6.28, z: Math.random() });
    }
    function setFromPointer(cx, cy) {
      var r = el.getBoundingClientRect();
      var f = vert ? (r.bottom - cy) / r.height : (cx - r.left) / r.width;
      sp.t = clamp(rtl ? 1 - f : f, 0, 1);
    }
    function toLocal(e) { var r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

    el.addEventListener('pointerdown', function (e) {
      el.setPointerCapture(e.pointerId);
      ptr.down = ptr.on = true;
      var p = toLocal(e); ptr.x = ptr.px = p[0]; ptr.y = ptr.py = p[1];
      setFromPointer(e.clientX, e.clientY);
      activate(true);
      clearTimeout(isoTimer); isoTimer = setTimeout(function () { if (ptr.down) isolate(true); }, o.isolateDelay || 420);
    });
    el.addEventListener('pointermove', function (e) {
      var p = toLocal(e); ptr.x = p[0]; ptr.y = p[1]; ptr.on = true;
      if (ptr.down) setFromPointer(e.clientX, e.clientY);
    });
    function release() { ptr.down = false; if (document.activeElement !== el) activate(false); clearTimeout(isoTimer); if (isoOn) isoTimer = setTimeout(function () { isolate(false); }, 260); }
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', function () { if (!ptr.down) ptr.on = false; });
    el.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? .1 : .04, k = e.key;
      var inc = (k === 'ArrowUp' || (!vert && ((k === 'ArrowRight' && !rtl) || (k === 'ArrowLeft' && rtl))));
      var dec = (k === 'ArrowDown' || (!vert && ((k === 'ArrowLeft' && !rtl) || (k === 'ArrowRight' && rtl))));
      if (inc) sp.t = clamp(sp.t + step, 0, 1);
      else if (dec) sp.t = clamp(sp.t - step, 0, 1);
      else if (k === 'Home') sp.t = 0; else if (k === 'End') sp.t = 1; else return;
      e.preventDefault(); activate(true);
    });

    var lastV = -1, img = getSprite();
    var stop = addLoop(function (dt, t) {
      var w = el.clientWidth, h = el.clientHeight;
      if (w !== W || h !== H) { W = w; H = h; seed(); }
      var ctx = fitCanvas(cv, W, H);
      var v = clamp(sp.step(dt), -0.05, 1.05);
      if (Math.abs(v - lastV) > .0005) {
        el.style.setProperty('--v', clamp(v, 0, 1).toFixed(4));
        var pct = Math.round(clamp(sp.t, 0, 1) * 100);
        el.setAttribute('aria-valuenow', pct);
        if (o.onInput) o.onInput(clamp(v, 0, 1), pct);
        if (lastV >= 0 && Math.floor(v * 25) !== Math.floor(lastV * 25)) cue('slide', { rate: .8 + clamp(v, 0, 1) * .7 }, el);   // a detent every 4 %
        lastV = v;
        if (o.dim) o.dim.style.opacity = isoOn || o.dimAlways ? ((1 - clamp(v, 0, 1)) * (o.dimMax != null ? o.dimMax : .62)).toFixed(3) : '0';
        if (o.lamp !== false) {
          var rb = el.getBoundingClientRect(), vv = clamp(v, 0, 1);
          el.dispatchEvent(new CustomEvent('hm7:lamp', { bubbles: true, detail: {
            id: el, size: (vert ? rb.width : rb.height) * .9, color: o.lampColor || o.tint || '235,240,255', i: .12 + vv * .6,
            clientX: vert ? rb.left + rb.width / 2 : (rtl ? rb.right - rb.width * vv : rb.left + rb.width * vv),
            clientY: vert ? rb.bottom - rb.height * vv : rb.top + rb.height / 2 } }));
        }
      }
      var edge = vert ? H * (1 - clamp(v, 0, 1)) : (rtl ? W * (1 - clamp(v, 0, 1)) : W * clamp(v, 0, 1));

      // pointer velocity
      var pvx = (ptr.x - ptr.px) / dt, pvy = (ptr.y - ptr.py) / dt;
      ptr.vx += (pvx - ptr.vx) * .35; ptr.vy += (pvy - ptr.vy) * .35;
      ptr.px = ptr.x; ptr.py = ptr.y;

      // fade previous frame -> trails
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,' + (RM.matches ? 1 : .32) + ')';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';

      var R = Math.max(70, H * .95), force = ptr.down ? 1 : (ptr.on ? .45 : 0);
      for (var i = 0; i < P.length; i++) {
        var p = P[i];
        var a = flow(p.x, p.y, t);
        p.vx += Math.cos(a) * 14 * dt; p.vy += Math.sin(a) * 14 * dt;
        if (force) {
          var dx = p.x - ptr.x, dy = p.y - ptr.y, d = Math.hypot(dx, dy) + .001;
          if (d < R) {
            var f = (1 - d / R); f *= f * force;
            // swirl (tangential) + gentle push + drag along the finger's path
            p.vx += (-dy / d * 520 + dx / d * 180) * f * dt + ptr.vx * f * .06;
            p.vy += (dx / d * 520 + dy / d * 180) * f * dt + ptr.vy * f * .06;
          }
        }
        p.vx *= .955; p.vy *= .955;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.x < -4) p.x += W + 8; else if (p.x > W + 4) p.x -= W + 8;
        if (p.y < -4) p.y += H + 8; else if (p.y > H + 4) p.y -= H + 8;
        var inFill = vert ? p.y > edge : (rtl ? p.x > edge : p.x < edge);
        var tw = .55 + .45 * Math.sin(t * (2 + p.z * 3) + p.ph);
        var sp2 = Math.min(1, Math.hypot(p.vx, p.vy) / 140);
        ctx.globalAlpha = ((inFill ? .18 : .8) * tw * (.6 + .4 * p.z) + sp2 * .3) * (active ? 1 : .45);
        var size = p.s * (inFill ? 2.2 : 2.9) * (1 + sp2 * .8);
        ctx.drawImage(img, p.x - size / 2, p.y - size / 2, size, size);
      }

      // sparks thrown off the leading edge while the value moves
      var edgeSpeed = Math.abs(sp.v) * (vert ? H : W);
      if (edgeSpeed > 40 && !RM.matches) {
        var n = Math.min(6, edgeSpeed / 90 | 0);
        var dir = vert ? (sp.v > 0 ? -1 : 1) : ((sp.v > 0) !== rtl ? 1 : -1);
        for (var j = 0; j < n; j++) {
          var a1 = dir * (60 + Math.random() * edgeSpeed * .35), b1 = (Math.random() - .5) * 80;
          sparks.push(vert ? { x: Math.random() * W, y: edge, vx: b1, vy: a1, life: 1, s: 1 + Math.random() * 2.2 }
                           : { x: edge, y: Math.random() * H, vx: a1, vy: b1, life: 1, s: 1 + Math.random() * 2.2 });
        }
      }
      for (j = sparks.length - 1; j >= 0; j--) {
        var k = sparks[j];
        k.life -= dt * 1.7; k.vx *= .94; k.vy *= .94; k.x += k.vx * dt; k.y += k.vy * dt;
        if (k.life <= 0) { sparks.splice(j, 1); continue; }
        ctx.globalAlpha = k.life;
        var ss = k.s * 4 * k.life + 1;
        ctx.drawImage(img, k.x - ss / 2, k.y - ss / 2, ss, ss);
      }

      // crisp light column on the leading edge
      ctx.globalAlpha = .55 + .2 * Math.sin(t * 5);
      var g = vert ? ctx.createLinearGradient(0, edge - 10, 0, edge + 10) : ctx.createLinearGradient(edge - 10, 0, edge + 10, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.5, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      if (vert) ctx.fillRect(0, edge - 10, W, 20); else ctx.fillRect(edge - 10, 0, 20, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }, el);

    return {
      get value() { return clamp(sp.t, 0, 1); },
      set value(x) { sp.t = clamp(x, 0, 1); },
      destroy: stop
    };
  }

  /* ─────────────────────────────────────────────
     3. NOTIFICATIONS — swipe, liquid action buttons, backdrop-coloured dissolve, clear-all
     Measured from the HarmonyOS 7 Pura X capture (60 fps):
       • swipe reveals glass actions that pinch out of the card's right edge like droplets:
         the outer one (trash) first, the inner one (more) ~100 ms later, each on an elastic neck
       • trash → actions vanish in ~60 ms, then the card turns to sand right→left in ~0.45 s
       • grains take the colour of what is behind the glass and swirl in place for ~0.3 s
       • clear-all: every card dissolves bottom→top behind a bright crest of light
     ───────────────────────────────────────────── */
  var maskCache = {};
  function grainMask(w, h, feather, axis) {
    axis = axis || 'x';
    var key = axis + Math.round(w) + 'x' + Math.round(h) + 'x' + Math.round(feather);
    if (maskCache[key]) return maskCache[key];
    var c = document.createElement('canvas');
    var X = axis === 'x', L = X ? w : h;
    var W = X ? Math.ceil(w * 2 + feather) : Math.ceil(w), H = X ? Math.ceil(h) : Math.ceil(h * 2 + feather);
    c.width = W; c.height = H;
    var ctx = c.getContext('2d'), img = ctx.createImageData(W, H), d = img.data;
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var u = X ? x : y, a;
      if (u < L) a = 255;
      else if (u > L + feather) a = 0;
      else { var f = 1 - (u - L) / feather; a = Math.random() < f * f ? 255 : 0; }
      var i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    var m = { url: c.toDataURL(), W: W, H: H };
    m.img = new Image(); m.img.src = m.url; if (m.img.decode) m.img.decode().catch(function () {});
    return (maskCache[key] = m);
  }
  function stageCanvas(stage) {
    var cv = stage.querySelector(':scope > canvas.hm7-fx');
    if (!cv) {
      cv = document.createElement('canvas');
      cv.className = 'hm7-fx';
      cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:50';
      stage.appendChild(cv);
    }
    return cv;
  }
  function setMask(el, m, pos) {
    var s = el.style;
    if (!m) { s.webkitMaskImage = s.maskImage = s.webkitMaskSize = s.maskSize = s.webkitMaskRepeat = s.maskRepeat = s.webkitMaskPosition = s.maskPosition = ''; return; }
    s.webkitMaskImage = s.maskImage = 'url(' + m.url + ')';
    s.webkitMaskSize = s.maskSize = m.W + 'px ' + m.H + 'px';
    s.webkitMaskRepeat = s.maskRepeat = 'no-repeat';
    s.webkitMaskPosition = s.maskPosition = pos || '0px 0px';
  }
  // what colour is behind the glass at (x, y)? elements opt in with data-hm7-color="r,g,b"
  function backdropSampler(stage, exclude) {
    var sr = stage.getBoundingClientRect(), list = [];
    stage.querySelectorAll('[data-hm7-color]').forEach(function (e) {
      if (exclude && exclude.some(function (x) { return x.contains(e); })) return;
      var r = e.getBoundingClientRect();
      list.push([r.left - sr.left, r.top - sr.top, r.right - sr.left, r.bottom - sr.top, e.getAttribute('data-hm7-color')]);
    });
    return function (x, y) {
      for (var i = 0; i < list.length; i++) { var q = list[i], m = 12; if (x > q[0] - m && x < q[2] + m && y > q[1] - m && y < q[3] + m) return q[4]; }
      return null;
    };
  }
  var GLASS = ['255,255,255', '255,255,255', '238,242,255', '226,236,255', '246,238,255'];

  // shared sand renderer: grains swirl in place and fade (no long wind drift — matches the capture)
  // two looks: additive light on dark/cobalt stages (default) and solid "ink" grains on light pages.
  // A page opts in with CSS: --hm7-sand: ink; --hm7-sand-colors: "r,g,b|r,g,b" (set per theme).
  var INK = ['20,22,58', '47,51,230', '91,95,138', '140,144,190'];
  function Sand(stage) {
    this.cv = stageCanvas(stage); this.stage = stage; this.P = []; this.img = getSprite();
    var cs = getComputedStyle(stage), pal = cs.getPropertyValue('--hm7-sand-colors').replace(/["']/g, '').trim();
    this.ink = cs.getPropertyValue('--hm7-sand').trim() === 'ink';
    this.pal = pal ? pal.split('|').map(function (x) { return x.trim(); }).filter(Boolean) : (this.ink ? INK : GLASS);
  }
  Sand.prototype.glass = function () { return this.pal[(Math.random() * this.pal.length) | 0]; };
  Sand.prototype.emit = function (x, y, color, big) {
    var a = Math.random() * 6.283, sp = 8 + Math.random() * 34;
    this.P.push({ x: x, y: y, vx: Math.cos(a) * sp - 12, vy: Math.sin(a) * sp * .7 - 6,
      l: 1, d: .22 + Math.random() * .26, s: big ? 2.4 + Math.random() * 1.6 : .9 + Math.random() * 1.5, c: color });
  };
  Sand.prototype.step = function (dt, t, extra) {
    var ctx = fitCanvas(this.cv, this.stage.clientWidth, this.stage.clientHeight);
    ctx.clearRect(0, 0, this.stage.clientWidth, this.stage.clientHeight);
    var P = this.P, keep = 0, fr = Math.exp(-dt * 4.2);
    ctx.globalCompositeOperation = this.ink ? 'source-over' : 'lighter';
    var ink = this.ink;
    for (var i = 0; i < P.length; i++) {
      var p = P[i], a = flow(p.x * 1.6, p.y * 1.6, t * 2.2);
      p.vx = (p.vx + Math.cos(a) * 150 * dt) * fr;
      p.vy = (p.vy + Math.sin(a) * 150 * dt) * fr;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.l -= dt / p.d;
      if (p.l <= 0) continue;
      P[keep++] = p;
      var al = Math.min(1, p.l * 1.6);
      if (p.s > 2.3 && !ink) { ctx.globalAlpha = al * .9; var S = p.s * 3; ctx.drawImage(this.img, p.x - S / 2, p.y - S / 2, S, S); }
      else { ctx.globalAlpha = al; ctx.fillStyle = 'rgb(' + p.c + ')'; ctx.fillRect(p.x, p.y, p.s, p.s); }
    }
    P.length = keep;
    if (extra) extra(ctx);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    return keep;
  };

  var NS_SVG = 'http://www.w3.org/2000/svg';
  function swipeDismiss(card, o) {
    o = o || {};
    var row = card.closest('.hm7-notif-row') || card.parentNode;
    var stage = o.stage || card.closest('.hm7-stage') || row.parentNode;
    var body = card.querySelector('.hm7-notif__body') || card;
    var acts = Array.prototype.slice.call(row.querySelectorAll('.hm7-notif__act, .hm7-notif__trash'));
    acts.forEach(function (b) { b.classList.add('hm7-notif__act'); if (b.classList.contains('hm7-notif__trash')) b.setAttribute('data-act', 'trash'); });
    var n = acts.length;
    var GAP = o.gap || 10, EDGE_M = o.margin || 4, NECK = o.neck || 18;
    var R = n ? (acts[0].offsetWidth || 44) / 2 : 22;
    var OPEN = n ? -(GAP + n * 2 * R + (n - 1) * GAP + EDGE_M) : -62;
    var sx = new Spring(0, 320, 30), drag = null, dissolving = false, gone = false, locked = false;
    var lastX = 0, vel = 0, lastMove = 0, blurOn = false, blurVal = 0, armed = false, mask = null;
    var offs = acts.map(function () { return new Spring(-R, 430, 23); });
    var scs = acts.map(function () { return new Spring(.5, 380, 20); });
    var vis = acts.map(function () { return 0; });
    var popped = false;

    // liquid necks between the card edge and each emerging action
    var svg = document.createElementNS(NS_SVG, 'svg');
    svg.setAttribute('class', 'hm7-notif__goo'); svg.setAttribute('aria-hidden', 'true');
    var necks = acts.map(function () {
      var f = document.createElementNS(NS_SVG, 'path'), s = document.createElementNS(NS_SVG, 'path');
      f.setAttribute('class', 'f'); s.setAttribute('class', 's'); svg.appendChild(f); svg.appendChild(s);
      return [f, s];
    });
    if (n) row.insertBefore(svg, row.firstChild);

    var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 60); };
    function prepare() {
      var w = card.offsetWidth, h = card.offsetHeight;
      if (!w || !h) return;
      mask = grainMask(w, h, Math.max(70, w * .22), 'x');
      fitCanvas(stageCanvas(stage), stage.clientWidth, stage.clientHeight);
    }
    idle(prepare);
    if ('ResizeObserver' in window) new ResizeObserver(function () { if (!dissolving) idle(prepare); }).observe(card);
    function arm(on) {
      if (on === armed || !mask) return;
      armed = on; setMask(card, on ? mask : null);
    }
    function setBlur(on) { if (on === blurOn) return; blurOn = on; if (!on) { blurVal = 0; card.style.setProperty('--mb', '0'); } }
    function blurTo(b) { blurVal = b; card.style.setProperty('--mb', b.toFixed(1)); }

    card.addEventListener('pointerdown', function (e) {
      if (dissolving || locked || ownControl(e, card)) return;
      card.setPointerCapture(e.pointerId);
      arm(true);
      drag = { x0: e.clientX, y0: e.clientY, s0: sx.x, axis: null, t: performance.now() };
      lastX = e.clientX; vel = 0;
    });
    card.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.axis) { if (Math.abs(dx) + Math.abs(dy) < 6) return; drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; }
      if (drag.axis !== 'x') return;
      if (!RM.matches) setBlur(true);
      var now = performance.now(), dtm = Math.max(1, now - drag.t); lastMove = now;
      vel = vel * .6 + ((e.clientX - lastX) / dtm * 1000) * .4;
      lastX = e.clientX; drag.t = now;
      var x = drag.s0 + dx;
      if (x > 0) x *= .25;                                   // rubber band to the right
      if (x < OPEN) x = OPEN + (x - OPEN) * .7;              // a little resistance past the actions
      sx.x = sx.t = x; sx.v = vel;
      if (x < -card.offsetWidth * (o.liveAt || .55)) { drag = null; dissolve(); }
    });
    function end() {
      if (!drag) return;
      var wasX = drag.axis === 'x'; drag = null;
      if (!wasX) { sx.t = sx.x < OPEN / 2 ? OPEN : 0; return; }
      if (sx.x < OPEN * (o.dissolveAt || 1.45) || vel < -1300) { dissolve(); return; }
      sx.t = (sx.x < OPEN * .45 || vel < -350) && vel < 600 ? OPEN : 0;
    }
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Delete' || e.key === 'Backspace') dissolve();
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { sx.t = sx.t === 0 ? OPEN : 0; arm(true); }
    });
    acts.forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.getAttribute('data-act') === 'trash') dissolve();
        else { scs[acts.indexOf(b)].v = -6; if (o.onAction) o.onAction(b.getAttribute('data-act'), card); }
      });
    });

    function neckPath(E, cx, cy, r, t) {
      // card edge at x = E; circle (cx, cy, r); t: 0 apart … 1 touching
      var a = r * (.42 + .5 * t), phi = (.55 + .55 * t), w = .18 + .5 * t;
      var p1x = cx - r * Math.cos(phi), p1y = cy - r * Math.sin(phi), p2y = cy + r * Math.sin(phi);
      var mx = (E + p1x) / 2;
      var f = 'M' + E + ' ' + (cy - a) + 'Q' + mx + ' ' + (cy - a * w) + ' ' + p1x + ' ' + p1y +
        'A' + r + ' ' + r + ' 0 0 0 ' + p1x + ' ' + p2y + 'Q' + mx + ' ' + (cy + a * w) + ' ' + E + ' ' + (cy + a) + 'Z';
      var s = 'M' + E + ' ' + (cy - a) + 'Q' + mx + ' ' + (cy - a * w) + ' ' + p1x + ' ' + p1y +
        'M' + E + ' ' + (cy + a) + 'Q' + mx + ' ' + (cy + a * w) + ' ' + p1x + ' ' + p2y;
      return [f, s];
    }

    var lastTx = null;
    function tick(dt) {
      if (locked) return;
      if (drag && performance.now() - lastMove > 40) vel *= Math.exp(-dt * 14);
      var x = dissolving ? holdX : (drag ? sx.x : sx.step(dt));
      var tx = x.toFixed(1);
      if (tx !== lastTx) { card.style.transform = 'translate3d(' + tx + 'px,0,0)'; lastTx = tx; }
      if (!dissolving) {
        var b = Math.min(6, Math.abs(drag ? vel : sx.v) / 300);
        if (blurOn) {
          if (Math.abs(b - blurVal) > .2) blurTo(b * (Math.sign(-(drag ? vel : sx.v)) || 1));
          if (!drag && b < .15 && sx.settled(.4)) setBlur(false);
        }
        if (armed && !drag && sx.t === 0 && sx.settled(.4)) arm(false);
      }
      if (!n) return;
      var W = card.offsetWidth, H = card.offsetHeight, E = W + x, cy = H / 2;
      var p = clamp(x / OPEN, 0, 1.6), spread = Math.max(1, p);
      for (var i = 0; i < n; i++) {
        var start = (n - 1 - i) * .3, prog = popped ? 0 : clamp((p - start) / (1 - start * .9), 0, 1);
        var target = -R * .9 + (GAP + R + i * (2 * R + GAP)) * spread * prog + R * .9 * prog;
        offs[i].t = target; scs[i].t = popped ? .2 : .5 + .5 * prog;
        var off = offs[i].step(dt), s = Math.max(0, scs[i].step(dt));
        var o2 = popped ? Math.max(0, vis[i] - dt * 16) : clamp(prog * 3, 0, 1);
        vis[i] = o2;
        var cx = E + off, r = R * s;
        acts[i].style.transform = 'translate3d(' + (cx - R).toFixed(1) + 'px,-50%,0) scale(' + s.toFixed(3) + ')';
        acts[i].style.opacity = o2.toFixed(3);
        acts[i].style.pointerEvents = o2 > .6 ? '' : 'none';
        if (i === n - 1 && !popped) { var shown = o2 > .6; if (shown && !acts._cued) cue('actions', null, card); acts._cued = shown; }
        acts[i].tabIndex = o2 > .6 ? 0 : -1;
        var g = off - r, t = 1 - clamp(g / NECK, 0, 1);
        if (o2 > .02 && t > 0 && !popped) {
          var d = neckPath(E, cx, cy, r, t);
          necks[i][0].setAttribute('d', d[0]); necks[i][1].setAttribute('d', d[1]);
          necks[i][0].style.opacity = necks[i][1].style.opacity = (o2 * Math.min(1, t * 2.5)).toFixed(3);
        } else if (necks[i][0].getAttribute('d')) { necks[i][0].setAttribute('d', ''); necks[i][1].setAttribute('d', ''); }
      }
    }
    var stopTick = addLoop(tick, row);
    var holdX = 0;

    function dissolve() {
      if (dissolving || locked) return;
      dissolving = true; drag = null;
      cue('dissolve', null, card);
      holdX = Math.max(sx.x, OPEN * 1.05);
      if (!mask || mask.H !== Math.ceil(card.offsetHeight)) prepare();
      arm(true);
      popped = true;                                          // actions vanish first (~60 ms)
      var sr = stage.getBoundingClientRect(), cr = card.getBoundingClientRect();
      var w = card.offsetWidth, h = card.offsetHeight, F = Math.max(70, w * .22);
      var cx = cr.left - sr.left - sx.x + holdX, cy = cr.top - sr.top;
      var sample = backdropSampler(stage, [row]);
      var tint = (card.getAttribute('data-hm7-colors') || '').split('|').filter(Boolean);
      var sand = new Sand(stage), life = -(o.delay != null ? o.delay : .07), dur = RM.matches ? .15 : (o.duration || .45), prev = 0, done = false;
      var kill = addLoop(function (dt, t) {
        life += dt;
        var prog = clamp(life / dur, 0, 1);
        var e = prog * prog * (3 - 2 * prog) * .6 + prog * .4;
        var shift = e * (w + F);
        card.style.webkitMaskPosition = card.style.maskPosition = (-shift).toFixed(1) + 'px 0px';
        if (blurOn) { blurTo(blurVal * .8); if (Math.abs(blurVal) < .15) setBlur(false); }
        if (life > 0 && shift > prev && !RM.matches) {   // emit only while the front advances (else 3–4 grains/frame forever)
          var lo = clamp(w - shift, 0, w), hi = clamp(w - prev + F * .3, 0, w);
          var count = Math.min(260, (hi - lo) * h * .06 + 4);
          for (var i = 0; i < count; i++) {
            var px = lo + Math.random() * (hi - lo), py = Math.random() * h, X = cx + px, Y = cy + py;
            var c = sample(X, Y);
            if (!c || Math.random() < .35) c = (tint.length && px < 64 && Math.random() < .5) ? tint[(Math.random() * tint.length) | 0] : sand.glass();
            sand.emit(X, Y, c, Math.random() < .05);
          }
        }
        prev = shift;
        var alive = sand.step(dt, t);
        if (prog >= 1 && !done) { done = true; gone = true; card.style.visibility = 'hidden'; collapse(); if (o.onDismiss) setTimeout(o.onDismiss, 380); }
        if (done && !alive) kill();
      });
    }

    function collapse() {
      var sibs = [], nx = row.nextElementSibling;
      while (nx) { if (!nx.hidden && nx.offsetHeight) sibs.push(nx); nx = nx.nextElementSibling; }
      var before = sibs.map(function (e) { return e.getBoundingClientRect().top; });
      row.style.overflow = 'hidden'; row.style.height = '0px'; row.style.marginBlock = '0px';
      var springs = sibs.map(function (e, i) { var s = new Spring(before[i] - e.getBoundingClientRect().top, 240, 19); s.t = 0; s.delay = i * .045; return s; });
      if (!sibs.length) return;
      var age = 0;
      var kill = addLoop(function (dt) {
        age += dt; var ok = true;
        sibs.forEach(function (e, i) {
          var s = springs[i]; if (age > s.delay) s.step(dt);
          e.style.transform = 'translate3d(0,' + s.x.toFixed(2) + 'px,0) scale(' + (1 + Math.min(.03, Math.abs(s.v) / 9000)).toFixed(4) + ')';
          if (!s.settled(.3)) ok = false;
        });
        if (ok) { sibs.forEach(function (e) { e.style.transform = ''; }); kill(); }
      });
    }

    function restore() {
      if (!gone && !dissolving && !locked) { sx.t = 0; return; }
      gone = dissolving = locked = popped = false;
      card.hidden = false; card.style.visibility = '';
      row.hidden = false; row.style.height = ''; row.style.marginBlock = ''; row.style.overflow = '';
      armed = true; arm(false);
      sx.x = sx.t = 0; sx.v = 0; holdX = 0; lastTx = null;
      card.style.transform = '';
      offs.forEach(function (s) { s.x = s.t = -R; s.v = 0; });
      vis = acts.map(function () { return 0; });
      stopTick(); stopTick = addLoop(tick, row);
    }
    return {
      card: card, row: row, stage: stage,
      get gone() { return gone || dissolving; },
      dissolve: dissolve, restore: restore, collapse: collapse,
      open: function () { arm(true); sx.t = OPEN; }, close: function () { sx.t = 0; },
      lock: function () { locked = true; popped = true; acts.forEach(function (b) { b.style.opacity = 0; b.style.pointerEvents = 'none'; }); necks.forEach(function (k) { k[0].setAttribute('d', ''); k[1].setAttribute('d', ''); }); },
      markGone: function () { gone = true; card.style.visibility = 'hidden'; }
    };
  }

  // Sweep: one bright crest moves bottom → top; every element turns to sand as it passes.
  // Works on any elements (a chat history, a cart). clearAll() below is the notification wrapper.
  function sweep(els, o) {
    o = o || {};
    els = Array.prototype.slice.call(els).filter(function (e) { return e && e.offsetWidth && e.style.visibility !== 'hidden'; });
    if (!els.length) { if (o.onDone) o.onDone(); return; }
    var stage = o.stage || els[0].closest('.hm7-stage') || els[0].parentNode;
    var sr = stage.getBoundingClientRect(), sample = backdropSampler(stage, o.exclude || els);
    var cards = els.map(function (el) {
      var r = el.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, F = Math.max(40, h * .5);
      setMask(el, grainMask(w, h, F, 'y'), '0px 0px');
      return { el: el, l: r.left - sr.left, t: r.top - sr.top, w: w, h: h, F: F, prev: 0,
        tint: (el.getAttribute('data-hm7-colors') || '').split('|').filter(Boolean) };
    });
    var top = Math.min.apply(null, cards.map(function (c) { return c.t; })), bot = Math.max.apply(null, cards.map(function (c) { return c.t + c.h; }));
    var left = Math.min.apply(null, cards.map(function (c) { return c.l; })), right = Math.max.apply(null, cards.map(function (c) { return c.l + c.w; }));
    var tilt = o.tilt != null ? o.tilt : .16, span = (bot - top) + (right - left) * tilt + 80;
    var sand = new Sand(stage), life = 0, dur = RM.matches ? .2 : (o.duration || .62), done = false;
    var crest = o.crest || (sand.ink ? sand.pal[1] || sand.pal[0] : '255,255,255');
    cue('sweep', null, stage);
    var kill = addLoop(function (dt, t) {
      life += dt;
      var prog = clamp(life / dur, 0, 1), e = prog * prog * (3 - 2 * prog) * .5 + prog * .5;
      var front = bot + 40 - e * span;                       // crest y at the left edge; tilted upward to the right
      cards.forEach(function (c) {
        var yAt = front - (c.l - left) * tilt;
        var shift = clamp(c.t + c.h - yAt, 0, c.h + c.F);
        c.el.style.webkitMaskPosition = c.el.style.maskPosition = '0px ' + (-shift).toFixed(1) + 'px';
        if (!RM.matches && shift > c.prev) {
          var lo = clamp(c.h - shift, 0, c.h), hi = clamp(c.h - c.prev + c.F * .3, 0, c.h);
          var count = Math.min(220, (hi - lo) * c.w * .05 + 3);
          for (var i = 0; i < count; i++) {
            var px = Math.random() * c.w, py = lo + Math.random() * (hi - lo), X = c.l + px, Y = c.t + py;
            var col = sample(X, Y);
            if (!col || Math.random() < .35) col = (c.tint.length && px < 64 && Math.random() < .5) ? c.tint[(Math.random() * c.tint.length) | 0] : sand.glass();
            sand.emit(X, Y, col, Math.random() < .05);
          }
        }
        c.prev = shift;
      });
      var crestA = prog < 1 ? Math.min(1, prog * 6) * (1 - Math.pow(prog, 6)) : 0;
      var alive = sand.step(dt, t, crestA > .01 && !RM.matches ? function (ctx) {
        [[22, .12], [9, .32], [2.4, .95]].forEach(function (L) {
          ctx.globalAlpha = crestA * L[1] * (sand.ink ? .7 : 1); ctx.strokeStyle = 'rgb(' + crest + ')'; ctx.lineWidth = L[0]; ctx.lineCap = 'round';
          ctx.beginPath();
          for (var x = left - 10; x <= right + 10; x += 12) {
            var y = front - (x - left) * tilt + Math.sin(x * .025 + t * 7) * 5;
            if (x === left - 10) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        });
      } : null);
      if (prog >= 1 && !done) {
        done = true;
        cards.forEach(function (c) {
          c.el.style.visibility = 'hidden';
          if (o.collapse) { c.el.style.overflow = 'hidden'; c.el.style.height = '0px'; c.el.style.marginBlock = '0px'; c.el.style.paddingBlock = '0px'; }
        });
        if (o.onDone) setTimeout(o.onDone, 200);
      }
      if (done && !alive) kill();
    });
  }

  function clearAll(list, o) {
    o = o || {};
    list = list.filter(function (x) { return !x.gone; });
    if (!list.length) return;
    list.forEach(function (x) { x.lock(); });
    sweep(list.map(function (x) { return x.card; }), {
      stage: list[0].stage, exclude: list.map(function (x) { return x.row; }), duration: o.duration, tilt: o.tilt, crest: o.crest,
      onDone: function () {
        list.forEach(function (x) { x.markGone(); x.row.style.overflow = 'hidden'; x.row.style.height = '0px'; x.row.style.marginBlock = '0px'; });
        if (o.onDone) o.onDone();
      }
    });
  }

  // Dissolve any single element right → left into backdrop-coloured sand (a message, a cart line)
  function dissolve(el, o) {
    o = o || {};
    if (!el || el._hm7gone) return;
    el._hm7gone = true;
    var stage = o.stage || el.closest('.hm7-stage') || el.parentNode;
    var w = el.offsetWidth, h = el.offsetHeight, F = Math.max(60, w * .22);
    setMask(el, grainMask(w, h, F, 'x'), '0px 0px');
    var sr = stage.getBoundingClientRect(), r = el.getBoundingClientRect();
    var cx = r.left - sr.left, cy = r.top - sr.top;
    var sample = backdropSampler(stage, [el]);
    var tint = (el.getAttribute('data-hm7-colors') || '').split('|').filter(Boolean);
    setTimeout(function () { cue('dissolve', null, el); }, (o.delay || 0) * 1000);
    var sand = new Sand(stage), life = -(o.delay || 0), dur = RM.matches ? .15 : (o.duration || .45), prev = 0, done = false;
    var kill = addLoop(function (dt, t) {
      life += dt;
      var prog = clamp(life / dur, 0, 1);
      var e = prog * prog * (3 - 2 * prog) * .6 + prog * .4, shift = e * (w + F);
      el.style.webkitMaskPosition = el.style.maskPosition = (-shift).toFixed(1) + 'px 0px';
      if (life > 0 && shift > prev && !RM.matches) {   // emit only while the front advances (else 3–4 grains/frame forever)
        var lo = clamp(w - shift, 0, w), hi = clamp(w - prev + F * .3, 0, w);
        var count = Math.min(240, (hi - lo) * h * .06 + 3);
        for (var i = 0; i < count; i++) {
          var px = lo + Math.random() * (hi - lo), py = Math.random() * h, X = cx + px, Y = cy + py;
          var c = sample(X, Y);
          if (!c || Math.random() < .35) c = (tint.length && Math.random() < .5) ? tint[(Math.random() * tint.length) | 0] : sand.glass();
          sand.emit(X, Y, c, Math.random() < .05);
        }
      }
      prev = shift;
      var alive = sand.step(dt, t);
      if (prog >= 1 && !done) {
        done = true; el.style.visibility = 'hidden';
        if (o.collapse !== false) collapseEl(el);
        if (o.onDone) setTimeout(o.onDone, 300);
      }
      if (done && !alive) kill();
    });
  }
  // remove an element's space; the following siblings spring up into it (FLIP)
  function collapseEl(el) {
    var sibs = [], n = el.nextElementSibling;
    while (n) { if (!n.hidden && n.offsetHeight) sibs.push(n); n = n.nextElementSibling; }
    var before = sibs.map(function (e) { return e.getBoundingClientRect().top; });
    el.style.overflow = 'hidden'; el.style.height = '0px'; el.style.marginBlock = '0px'; el.style.paddingBlock = '0px';
    if (!sibs.length) return;
    var springs = sibs.map(function (e, i) { var s = new Spring(before[i] - e.getBoundingClientRect().top, 240, 19); s.t = 0; s.delay = i * .045; return s; });
    var age = 0;
    var kill = addLoop(function (dt) {
      age += dt; var ok = true;
      sibs.forEach(function (e, i) {
        var s = springs[i]; if (age > s.delay) s.step(dt);
        e.style.transform = s.settled(.3) ? '' : 'translate3d(0,' + s.x.toFixed(2) + 'px,0)';
        if (!s.settled(.3)) ok = false;
      });
      if (ok) { sibs.forEach(function (e) { e.style.transform = ''; }); kill(); }
    });
  }

  /* ─────────────────────────────────────────────
     4. ICON DRAG → ELASTIC MAGNETIC FOLDER → DROP RIPPLE
     The folder outline is a live gooey union (smooth-min of two signed
     distance fields: the folder's rounded rect and the floating icon).
     Each of N rays from the folder edge finds where that field crosses
     zero; a per-ray spring makes the membrane stretch, neck, snap and
     wobble like jelly. The icon is lightly pulled toward the free slot.
     ───────────────────────────────────────────── */
  var NS = 'http://www.w3.org/2000/svg', folderSeq = 0;

  function sdRoundBox(px, py, cx, cy, hw, hh, r) {
    var qx = Math.abs(px - cx) - hw + r, qy = Math.abs(py - cy) - hh + r;
    var ox = Math.max(qx, 0), oy = Math.max(qy, 0);
    return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
  }
  function smin(a, b, k) {
    var h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  }

  function ElasticFolder(folder, o) {
    o = o || {};
    var PAD = o.pad || 120, N = o.rays || 128, MAXR = o.maxReach != null ? o.maxReach : 6, WRAP_AT = o.wrapAt || 14;
    var fl = 0;                                   // drop flash
    var id = 'hm7f' + (++folderSeq);
    folder.classList.add('hm7-folder--elastic');
    folder.style.setProperty('--pad', PAD + 'px');

    var shadow = document.createElementNS(NS, 'svg');
    var rim = document.createElementNS(NS, 'svg');
    var skin = document.createElement('div');
    shadow.setAttribute('class', 'hm7-folder__layer hm7-folder__shadow');
    rim.setAttribute('class', 'hm7-folder__layer hm7-folder__rim');
    skin.className = 'hm7-folder__layer hm7-folder__skin';
    [shadow, rim].forEach(function (s) { s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false'); });
    shadow.innerHTML =
      '<defs><filter id="' + id + 'sh" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14"/></filter></defs>' +
      '<path class="s" fill="rgba(8,10,90,.42)" filter="url(#' + id + 'sh)"/>';
    rim.innerHTML =
      '<defs>' +
        '<clipPath id="' + id + 'cl"><path class="p"/></clipPath>' +
        '<radialGradient id="' + id + 'lg" gradientUnits="userSpaceOnUse" r="150">' +
          '<stop offset="0" class="c0"/><stop offset=".55" class="c1"/><stop offset="1" stop-color="#fff" stop-opacity=".42"/>' +
        '</radialGradient>' +
        '<radialGradient id="' + id + 'fg" gradientUnits="userSpaceOnUse" r="170">' +
          '<stop offset="0" class="f0"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>' +
        '</radialGradient>' +
        '<filter id="' + id + 'gl" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="7"/></filter>' +
      '</defs>' +
      '<path class="p glow" fill="none" stroke="url(#' + id + 'lg)" stroke-width="14" filter="url(#' + id + 'gl)"/>' +
      '<g clip-path="url(#' + id + 'cl)">' +
        '<path class="p" fill="url(#' + id + 'fg)"/>' +
        '<path class="p" fill="none" stroke="#fff" stroke-opacity=".34" stroke-width="18" filter="url(#' + id + 'gl)"/>' +
      '</g>' +
      '<path class="p" fill="none" stroke="url(#' + id + 'lg)" stroke-width="1.8"/>';
    folder.insertBefore(skin, folder.firstChild);
    folder.insertBefore(rim, skin.nextSibling);
    folder.insertBefore(shadow, folder.firstChild);

    var paths = rim.querySelectorAll('.p'), shadowPath = shadow.querySelector('.s');
    var lg = rim.querySelector('#' + id + 'lg'), fg = rim.querySelector('#' + id + 'fg');
    var c0 = rim.querySelector('.c0'), c1 = rim.querySelector('.c1'), f0 = rim.querySelector('.f0');

    var W = 0, H = 0, R = 26, base = [], t = [], v = [], tgt = [];
    var src = null, li = 0, lc = '255,255,255', dirty = true, kick = 0;

    function build() {
      W = folder.offsetWidth; H = folder.offsetHeight;
      R = Math.min(parseFloat(getComputedStyle(folder).borderTopLeftRadius) || 26, W / 2, H / 2);
      var sw = W - 2 * R, sh = H - 2 * R, arc = Math.PI * R / 2;
      var per = 2 * sw + 2 * sh + 4 * arc;
      var segs = [
        ['L', R, 0, sw, 0, 0, -1], ['A', W - R, R, -Math.PI / 2],
        ['L', W, R, 0, sh, 1, 0], ['A', W - R, H - R, 0],
        ['L', W - R, H, -sw, 0, 0, 1], ['A', R, H - R, Math.PI / 2],
        ['L', 0, H - R, 0, -sh, -1, 0], ['A', R, R, Math.PI]
      ];
      base = [];
      for (var i = 0; i < N; i++) {
        var s = i / N * per, acc = 0;
        for (var j = 0; j < segs.length; j++) {
          var g = segs[j], len = g[0] === 'L' ? Math.abs(g[3]) + Math.abs(g[4]) : arc;
          if (s <= acc + len || j === segs.length - 1) {
            var u = clamp((s - acc) / (len || 1), 0, 1);
            if (g[0] === 'L') base.push([g[1] + g[3] * u, g[2] + g[4] * u, g[5], g[6]]);
            else {
              var a = g[3] + u * Math.PI / 2;
              base.push([g[1] + Math.cos(a) * R, g[2] + Math.sin(a) * R, Math.cos(a), Math.sin(a)]);
            }
            break;
          }
          acc += len;
        }
      }
      if (t.length !== N) { t = new Array(N).fill(0); v = new Array(N).fill(0); tgt = new Array(N).fill(0); }
      dirty = true;
    }

    // signed field of the union, in folder-local coords
    function field(px, py) {
      var d = sdRoundBox(px, py, W / 2, H / 2, W / 2, H / 2, R);
      if (!src) return d;
      // as the icon touches the glass, the sheet stretches over it (smooth union, faded in by
      // contact); before contact only a few px of bulge — measured from the 1080p capture
      var da = (px - src.ax) * (px - src.ax) + (py - src.ay) * (py - src.ay);
      var f = d - src.reach * Math.exp(-da / (src.sig * src.sig));
      if (src.wrap > 0) {
        var e = sdRoundBox(px, py, src.x, src.y, src.hw, src.hw, src.hw * .5);
        f += (smin(f, e, src.k) - f) * src.wrap;
      }
      return f;
    }

    function solve() {
      for (var i = 0; i < N; i++) {
        if (!src) { tgt[i] = 0; continue; }
        var b = base[i], x = b[0], y = b[1], nx = b[2], ny = b[3], d = 0;
        if (field(x, y) > 0) { tgt[i] = 0; continue; }
        var step = 3, max = PAD - 20, lo = 0, hi = 0, hit = false;
        for (d = step; d <= max; d += step) {
          if (field(x + nx * d, y + ny * d) > 0) { lo = d - step; hi = d; hit = true; break; }
        }
        if (!hit) { tgt[i] = max; continue; }
        for (var k = 0; k < 6; k++) { var m = (lo + hi) / 2; if (field(x + nx * m, y + ny * m) > 0) hi = m; else lo = m; }
        tgt[i] = (lo + hi) / 2;
      }
      // smooth targets along the perimeter so the membrane never kinks
      for (var pass = 0; pass < 2; pass++) {
        var prev = tgt.slice();
        for (i = 0; i < N; i++) tgt[i] = (prev[(i - 1 + N) % N] + 2 * prev[i] + prev[(i + 1) % N]) / 4;
      }
    }

    function render() {
      var pts = [], i;
      for (i = 0; i < N; i++) {
        var b = base[i], d = t[i];
        d = Math.max(d, -6);
        pts.push([b[0] + b[2] * d + PAD, b[1] + b[3] * d + PAD]);
      }
      var mid = function (a, c) { return ((a[0] + c[0]) / 2).toFixed(1) + ' ' + ((a[1] + c[1]) / 2).toFixed(1); };
      var dstr = 'M' + mid(pts[N - 1], pts[0]);
      for (i = 0; i < N; i++) dstr += 'Q' + pts[i][0].toFixed(1) + ' ' + pts[i][1].toFixed(1) + ' ' + mid(pts[i], pts[(i + 1) % N]);
      dstr += 'Z';
      for (i = 0; i < paths.length; i++) paths[i].setAttribute('d', dstr);
      shadowPath.setAttribute('d', dstr);
      shadowPath.setAttribute('transform', 'translate(0 12)');
      // SVG mask (not clip-path): keeps backdrop-filter frosting exactly inside the membrane
      var mw = W + PAD * 2, mh = H + PAD * 2;
      var mask = 'url("data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='" + mw + "' height='" + mh + "' viewBox='0 0 " + mw + ' ' + mh + "'><path fill='#000' d='" + dstr + "'/></svg>") + '")';
      skin.style.webkitMaskImage = mask; skin.style.maskImage = mask;
      var cx = (src ? src.x : W / 2) + PAD, cy = (src ? src.y : -40) + PAD;
      lg.setAttribute('cx', cx.toFixed(1)); lg.setAttribute('cy', cy.toFixed(1));
      fg.setAttribute('cx', cx.toFixed(1)); fg.setAttribute('cy', cy.toFixed(1));
      c0.setAttribute('stop-color', fl > li ? '#fff' : 'rgb(' + lc + ')'); c0.setAttribute('stop-opacity', (.45 + .55 * Math.max(li, fl)).toFixed(3));
      c1.setAttribute('stop-color', li > .02 ? 'rgb(' + lc + ')' : '#fff'); c1.setAttribute('stop-opacity', (.42 + .2 * li).toFixed(3));
      f0.setAttribute('stop-color', 'rgb(' + lc + ')'); f0.setAttribute('stop-opacity', (.42 * li).toFixed(3));
      rim.querySelector('.glow').setAttribute('opacity', (Math.max(li, fl) * .95).toFixed(3));
    }

    build();
    if ('ResizeObserver' in window) new ResizeObserver(build).observe(folder);

    var api = {
      // x,y in folder-local px; half = half the icon size incl. lift scale; strength 0..1
      set: function (x, y, half, strength, color) {
        var s = clamp(strength, 0, 1);
        var ax = clamp(x, 0, W), ay = clamp(y, 0, H), gap = Math.max(0, Math.hypot(x - ax, y - ay) - half);
        var edgeGap = Math.max(0, Math.hypot(x - ax, y - ay) - half);   // icon edge → folder edge
        var wrap = clamp(1 - edgeGap / WRAP_AT, 0, 1);
        src = { x: x, y: y, ax: ax, ay: ay, sig: 34, hw: half + 6, k: 34 + 44 * wrap,
                wrap: wrap * wrap * (3 - 2 * wrap), reach: Math.min(MAXR * Math.pow(s, 1.4), gap * .5) * (1 - wrap) };
        li = s; lc = color || lc; dirty = true;
      },
      release: function () { src = null; li = 0; dirty = true; },
      flash: function () { fl = 1; kick = 1; },
      jelly: function (amount) { for (var i = 0; i < N; i++) v[i] += (amount || 160) * (.8 + .4 * Math.sin(i * .9)); kick = 1; },
      step: function (dt) {
        if (dirty) { solve(); dirty = false; }
        if (fl > 0) { fl = Math.max(0, fl - dt * 2.6); kick = 1; }
        var moving = false, i;
        if (RM.matches) { for (i = 0; i < N; i++) { t[i] = tgt[i]; v[i] = 0; } render(); return; }
        // springs: quicker when reaching out, softer (wobbly) when retracting
        var n = Math.ceil(dt / .006), h = dt / n;
        while (n--) {
          for (i = 0; i < N; i++) {
            var k = tgt[i] > t[i] ? 640 : 520, c = tgt[i] > t[i] ? 26 : 15;
            // neighbour coupling = surface tension
            var lap = t[(i - 1 + N) % N] + t[(i + 1) % N] - 2 * t[i];
            v[i] += (-k * (t[i] - tgt[i]) - c * v[i] + 900 * lap) * h;
            t[i] += v[i] * h;
          }
        }
        for (i = 0; i < N; i++) if (Math.abs(t[i] - tgt[i]) > .05 || Math.abs(v[i]) > .5) { moving = true; break; }
        if (moving || src || kick) { render(); kick = 0; }
      }
    };
    render();
    return api;
  }

  function iconDrag(stage, o) {
    o = o || {};
    var folder = o.folder || stage.querySelector('.hm7-folder');
    folder.setAttribute('data-hm7-own-light', '');
    var membrane = ElasticFolder(folder, o);
    var icons = stage.querySelectorAll('.hm7-icon[data-drag]');
    var active = null, hint = null;
    var CAPTURE = o.capture || 110;      // px from the folder edge where magnetism starts
    var PULL = o.pull != null ? o.pull : 0;   // how far the icon leans toward the folder (fraction of the gap)

    function setHint(slot, color) {
      if (hint === slot) return;
      if (hint) hint.classList.remove('is-hint');
      hint = slot;
      if (slot) { slot.classList.add('is-hint'); slot.style.setProperty('--lc', color); }
    }

    addLoop(function (dt) { membrane.step(dt); }, folder);

    icons.forEach(function (icon) {
      var px = new Spring(0, 900, 48), py = new Spring(0, 900, 48), sc = new Spring(1, 380, 18), rot = new Spring(0, 300, 20);
      var st = { grab: null, home: null, fr: null, lastX: 0, lastY: 0, vx: 0, vy: 0, dropping: null };
      icon.setAttribute('tabindex', '0');
      icon.setAttribute('role', 'button');
      function glow() { return getComputedStyle(icon).getPropertyValue('--glow').trim() || '255,255,255'; }

      icon.addEventListener('pointerdown', function (e) {
        if (st.dropping || icon.style.visibility === 'hidden') return;
        icon.setPointerCapture(e.pointerId);
        icon.style.transform = 'none';
        st.home = relRect(icon, stage); st.fr = relRect(folder, stage);
        st.grab = [e.clientX, e.clientY]; st.raw = [0, 0]; st.lastX = e.clientX; st.lastY = e.clientY;
        px.x = px.t = py.x = py.t = 0; px.v = py.v = 0;
        px.k = py.k = 900; px.c = py.c = 48;
        sc.t = 1.16; rot.t = 0; active = icon;
        icon.classList.add('is-dragging');
      });
      icon.addEventListener('pointermove', function (e) {
        if (!st.grab) return;
        st.raw = [e.clientX - st.grab[0], e.clientY - st.grab[1]];
        st.vx = st.vx * .7 + (e.clientX - st.lastX) * 18; st.vy = st.vy * .7 + (e.clientY - st.lastY) * 18;
        st.lastX = e.clientX; st.lastY = e.clientY;
        rot.t = clamp(st.vx * .012, -14, 14);
      });
      function release() {
        if (!st.grab) return;
        st.grab = null; rot.t = 0;
        var c = center(), fr = st.fr;
        var inside = c[0] > fr.x - 8 && c[0] < fr.x + fr.w + 8 && c[1] > fr.y - 8 && c[1] < fr.y + fr.h + 8;
        var slot = inside && (hint || folder.querySelector('.hm7-folder__slot:empty'));
        setHint(null);
        if (slot) {
          var srr = relRect(slot, stage);
          st.dropping = slot;
          px.t = srr.x + srr.w / 2 - (st.home.x + st.home.w / 2);
          py.t = srr.y + srr.h / 2 - (st.home.y + st.home.h / 2);
          sc.t = srr.w / st.home.w;
          px.k = py.k = 260; px.c = py.c = 26;
          ripple(stage, c[0], c[1], { size: 260, rings: 3 });
        } else {
          px.t = 0; py.t = 0; sc.t = 1;
          px.k = py.k = 230; px.c = py.c = 17;           // springy return; the membrane necks and snaps off
        }
      }
      icon.addEventListener('pointerup', release);
      icon.addEventListener('pointercancel', release);
      icon.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        var slot = folder.querySelector('.hm7-folder__slot:empty');
        if (!slot || st.dropping) return;
        st.home = relRect(icon, stage); st.fr = relRect(folder, stage);
        var srr = relRect(slot, stage);
        st.dropping = slot; active = icon; icon.classList.add('is-dragging');
        px.k = py.k = 260; px.c = py.c = 26;
        px.t = srr.x + srr.w / 2 - (st.home.x + st.home.w / 2);
        py.t = srr.y + srr.h / 2 - (st.home.y + st.home.h / 2);
        sc.t = srr.w / st.home.w;
      });

      function center() { return [st.home.x + st.home.w / 2 + px.x, st.home.y + st.home.h / 2 + py.x]; }

      addLoop(function (dt) {
        if (!st.home || active !== icon) return;
        var fr = st.fr;
        if (st.grab) {
          // magnetic pull of the floating icon toward the folder / free slot
          var rx = st.home.x + st.home.w / 2 + st.raw[0], ry = st.home.y + st.home.h / 2 + st.raw[1];
          var nx = clamp(rx, fr.x, fr.x + fr.w), ny = clamp(ry, fr.y, fr.y + fr.h);
          var dEdge = Math.hypot(rx - nx, ry - ny);
          var inside = dEdge === 0;
          var slot = null, mx = 0, my = 0;
          if (inside) {
            var best = 1e9;
            folder.querySelectorAll('.hm7-folder__slot:empty').forEach(function (s) {
              var r = relRect(s, stage), d = Math.hypot(r.x + r.w / 2 - rx, r.y + r.h / 2 - ry);
              if (d < best) { best = d; slot = s; mx = r.x + r.w / 2 - rx; my = r.y + r.h / 2 - ry; }
            });
            mx = my = 0;                               // no pull once inside: the finger stays in charge
          } else if (dEdge < CAPTURE) {
            var m = Math.pow(1 - dEdge / CAPTURE, 2) * PULL;
            mx = (nx - rx) * m; my = (ny - ry) * m;
          }
          setHint(slot, glow());
          px.t = st.raw[0] + mx; py.t = st.raw[1] + my;
        }
        var x = px.step(dt), y = py.step(dt), s = sc.step(dt), r = rot.step(dt);
        icon.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) rotate(' + r.toFixed(2) + 'deg) scale(' + s.toFixed(3) + ')';

        // feed the membrane: icon position in folder-local coords + proximity
        var c = center();
        var cx = clamp(c[0], fr.x, fr.x + fr.w), cy = clamp(c[1], fr.y, fr.y + fr.h);
        var d = Math.hypot(c[0] - cx, c[1] - cy);
        var strength = clamp(1 - d / CAPTURE, 0, 1);
        if (st.dropping) strength *= .7;
        membrane.set(c[0] - fr.x, c[1] - fr.y, st.home.w / 2 * s, strength, glow());

        if (st.dropping && Math.abs(px.x - px.t) < 1.5 && Math.abs(py.x - py.t) < 1.5) {
          var mini = document.createElement('div');
          var cs = getComputedStyle(icon);
          mini.className = 'hm7-mini is-new'; mini.setAttribute('data-hm7-dropped', '');
          mini.style.backgroundColor = cs.backgroundColor;
          mini.style.backgroundImage = cs.backgroundImage;
          mini.innerHTML = icon.innerHTML;
          st.dropping.appendChild(mini);
          icon.style.visibility = 'hidden';
          icon.classList.remove('is-dragging');
          membrane.release(); membrane.jelly(170); membrane.flash();
          cue('drop', null, folder);
          st.dropping = null; active = null;
          px.x = px.t = py.x = py.t = 0; sc.x = sc.t = 1;
          if (o.onDrop) o.onDrop(icon);
        } else if (!st.grab && !st.dropping && px.settled(.5) && py.settled(.5) && sc.settled(.005)) {
          icon.classList.remove('is-dragging');
          membrane.release();
          active = null;
        }
      }, stage);
    });

    return {
      membrane: membrane,
      reset: function () {
        folder.querySelectorAll('.hm7-mini[data-hm7-dropped]').forEach(function (m) { m.remove(); });   // keep the folder's own contents
        icons.forEach(function (i) { i.style.visibility = ''; i.style.transform = ''; i.classList.remove('is-dragging'); });
        membrane.release(); membrane.jelly(90);
      }
    };
  }

  /* ─────────────────────────────────────────────
     5. BOUNCE CARD — tilt, specular, bouncy-ball spring
     ───────────────────────────────────────────── */
  function bounceCard(el, o) {
    o = o || {};
    var L = o.limit || 150;
    var sx = new Spring(0, o.k || 115, o.c || 7), sy = new Spring(0, o.k || 115, o.c || 7), sc = new Spring(1, 260, 9);
    var TILT = o.tilt != null ? o.tilt : 10;
    var drag = null, vx = 0, vy = 0, lt = 0, lxp = 0, lyp = 0, touched = false;
    var sheen = el.querySelector('.hm7-bcard__sheen');
    if (!sheen) { sheen = document.createElement('div'); sheen.className = 'hm7-bcard__sheen'; el.appendChild(sheen); }
    function rubber(d) { return L * Math.tanh(d / L); }

    el.addEventListener('pointerdown', function (e) {
      if (ownControl(e, el)) return;
      el.setPointerCapture(e.pointerId);
      touched = true;
      drag = { x: e.clientX - sx.x, y: e.clientY - sy.x };
      lxp = e.clientX; lyp = e.clientY; lt = performance.now(); vx = vy = 0;
      sc.t = 1.045; el.classList.add('is-lifted');
    });
    el.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var now = performance.now(), d = Math.max(1, now - lt);
      vx = vx * .5 + (e.clientX - lxp) / d * 1000 * .5;
      vy = vy * .5 + (e.clientY - lyp) / d * 1000 * .5;
      lxp = e.clientX; lyp = e.clientY; lt = now;
      sx.x = sx.t = rubber(e.clientX - drag.x);
      sy.x = sy.t = rubber(e.clientY - drag.y);
    });
    function release() {
      if (!drag) return;
      drag = null;
      sx.t = 0; sy.t = 0; sx.v = vx * .9; sy.v = vy * .9;
      sc.t = 1; sc.v = -1.2;                              // squash on release
      el.classList.remove('is-lifted');
      var spd = Math.hypot(vx, vy); if (spd > 250) cue('bounce', { gain: clamp(spd / 2400, .25, 1), rate: clamp(.8 + spd / 4000, .8, 1.5) }, el);
    }
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);

    var stop = addLoop(function (dt) {
      var x = drag ? sx.x : sx.step(dt), y = drag ? sy.x : sy.step(dt), s = sc.step(dt);
      var mvx = drag ? vx : sx.v, mvy = drag ? vy : sy.v;
      var ry = clamp(mvx * .009 + x * .04, -TILT, TILT);
      var rx = clamp(-mvy * .009 - y * .04, -TILT, TILT);
      // squash & stretch along the dominant velocity axis
      var sp = Math.min(.09, Math.hypot(mvx, mvy) / 14000);
      var stretchX = Math.abs(mvx) > Math.abs(mvy);
      var scx = s * (1 + (stretchX ? sp : -sp * .5)), scy = s * (1 + (stretchX ? -sp * .5 : sp));
      el.style.transform = 'perspective(900px) translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) scale(' + scx.toFixed(4) + ',' + scy.toFixed(4) + ')';
      el.style.setProperty('--sx', (50 + ry * 2.4 - rx * 1.2).toFixed(1));
      el.style.setProperty('--so', clamp((Math.abs(rx) + Math.abs(ry)) / 22 + (drag ? .25 : 0), 0, 1).toFixed(3));
      el.style.setProperty('--shx', (-ry * 1.1 + x * .08).toFixed(1) + 'px');
      el.style.setProperty('--shy', (16 + rx * 1.1 + Math.max(0, -y) * .12 + (s - 1) * 260).toFixed(1) + 'px');
    }, el);

    // one demonstration flick when first seen, until the user touches it
    if (o.demo !== false && !RM.matches && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        if (!es[0].isIntersecting) return;
        io.disconnect();
        setTimeout(function () { if (!touched) { sx.v = -1500; sy.v = -700; } }, 900);
      }, { threshold: .6 });
      io.observe(el);
    }
    return { flick: function (vx2, vy2) { sx.v = vx2; sy.v = vy2; }, destroy: stop };
  }

  /* ─────────────────────────────────────────────
     6. LIQUID LENS TABS
     ───────────────────────────────────────────── */
  function lensTabs(bar, o) {
    o = o || {};
    var items = Array.prototype.slice.call(bar.querySelectorAll('.hm7-tabs__item'));
    var lens = document.createElement('div'); lens.className = 'hm7-lens';
    var inner = document.createElement('div'); inner.className = 'hm7-lens__inner';
    items.forEach(function (it) { var c = it.cloneNode(true); c.setAttribute('tabindex', '-1'); c.setAttribute('aria-hidden', 'true'); inner.appendChild(c); });
    lens.appendChild(inner); bar.appendChild(lens);
    bar.setAttribute('role', 'tablist');
    var idx = Math.max(0, items.findIndex(function (i) { return i.classList.contains('is-active'); }));
    var sx = new Spring(0, 320, 24), sw = new Spring(0, 320, 24), drag = null;
    function geo(i) { var it = items[i]; return { x: it.offsetLeft, w: it.offsetWidth }; }
    function select(i, silent) {
      idx = clamp(i, 0, items.length - 1);
      items.forEach(function (it, k) { it.classList.toggle('is-active', k === idx); it.setAttribute('aria-selected', k === idx); it.setAttribute('role', 'tab'); });
      var g = geo(idx); sx.t = g.x; sw.t = g.w;
      if (!silent) {
        [items[idx], inner.children[idx]].forEach(function (n) { if (!n) return; n.classList.remove('is-pop'); void n.offsetWidth; n.classList.add('is-pop'); });
        if (o.onChange) o.onChange(idx);
        cue('tab', { rate: 1 + idx * .06 }, bar);
      }
    }
    items.forEach(function (it, k) { it.addEventListener('click', function () { if (!drag || !drag.moved) select(k); }); });
    bar.addEventListener('keydown', function (e) {
      var rtl = isRTL(bar), d = e.key === 'ArrowRight' ? (rtl ? -1 : 1) : e.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
      if (!d) return; e.preventDefault(); select(idx + d); items[idx].focus();
    });
    bar.addEventListener('pointerdown', function (e) {
      bar.setPointerCapture(e.pointerId);
      var r = bar.getBoundingClientRect();
      drag = { r: r, moved: false, x0: e.clientX };
    });
    bar.addEventListener('pointermove', function (e) {
      if (!drag) return;
      if (Math.abs(e.clientX - drag.x0) > 6) drag.moved = true;
      if (!drag.moved) return;
      var g = geo(idx), x = e.clientX - drag.r.left - g.w / 2;
      sx.t = clamp(x, items[0].offsetLeft, items[items.length - 1].offsetLeft);
    });
    function end(e) {
      if (!drag) return;
      var moved = drag.moved, r = drag.r; drag = null;
      if (moved) {
        var cx = sx.t + geo(idx).w / 2, best = 0, bd = 1e9;
        items.forEach(function (it, k) { var d = Math.abs(it.offsetLeft + it.offsetWidth / 2 - cx); if (d < bd) { bd = d; best = k; } });
        select(best);
      } else {
        var hit = items.findIndex(function (it) { var b = it.getBoundingClientRect(); return e.clientX >= b.left && e.clientX <= b.right; });
        if (hit >= 0) select(hit);
      }
    }
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', function () { drag = null; select(idx); });

    select(idx, true);
    var g0 = geo(idx); sx.x = g0.x; sw.x = g0.w;
    // the bar can change size (a dock minimising, a rotation): keep the lens on its tab
    if ('ResizeObserver' in window) new ResizeObserver(function () { var g = geo(idx); sx.t = g.x; sw.t = g.w; }).observe(bar);
    var stop = addLoop(function (dt) {
      var x = sx.step(dt), w = sw.step(dt);
      var stretch = 1 + Math.min(.45, Math.abs(sx.v) / 1800);
      var squash = 1 - Math.min(.18, Math.abs(sx.v) / 4200);
      lens.style.width = w.toFixed(1) + 'px';
      lens.style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,0) scale(' + stretch.toFixed(3) + ',' + squash.toFixed(3) + ')';
      inner.style.width = bar.clientWidth + 'px';
      // counter-translate + magnify around the lens centre (undo lens scale so icons stay sharp)
      var mag = o.magnify || 1.16, cx = x + w / 2;
      inner.style.transformOrigin = cx + 'px 50%';
      inner.style.transform = 'translate3d(' + (-x).toFixed(1) + 'px,0,0) scale(' + (mag / stretch).toFixed(3) + ',' + (mag / squash).toFixed(3) + ')';
    }, bar);
    window.addEventListener('resize', function () { select(idx, true); });
    return { select: select, destroy: stop };
  }

  /* ─────────────────────────────────────────────
     7. EDGE GLOW LEVELS
     ───────────────────────────────────────────── */
  function edgeGlow(el, level) {
    el.setAttribute('data-level', level || 'medium');
    el.classList.remove('is-surge'); void el.offsetWidth; el.classList.add('is-surge');
    cue('surge', null, el);
    clearTimeout(el._hm7surge); el._hm7surge = setTimeout(function () { el.classList.remove('is-surge'); }, 1300);
  }

  /* ── auto-init ── */
  /* ─────────────────────────────────────────────
     9. CUES — one event, one moment.
     Sound and haptics fire from the same line of code that starts the motion,
     so they cannot drift apart (the single-score rule of the animation studio).
     ───────────────────────────────────────────── */
  var cueHooks = [];
  function cue(name, data, el) {
    data = data || {};
    if (sound.enabled) sound.play(name, data);
    if (haptics.enabled) haptics.play(name);
    for (var i = 0; i < cueHooks.length; i++) { try { cueHooks[i](name, data, el); } catch (e) {} }
    if (el && el.dispatchEvent) el.dispatchEvent(new CustomEvent('hm7:cue', { bubbles: true, detail: { name: name, data: data } }));
  }

  /* Synthesised interface sounds: no files, nothing to download (intranet-safe), seeded so every play is identical.
     Recipes are small ports of the studio's instruments (wood tick, pop, FM bell, modal ting, music box, marimba, noise sweep). */
  var sound = (function () {
    var ctx = null, out = null, cache = {}, lastAt = {}, gestured = false, api = { enabled: false, volume: .55 };
    var TAU = Math.PI * 2;
    function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 * 2 - 1; }; }
    function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
    function SVF() { this.lo = 0; this.bp = 0; }
    SVF.prototype.run = function (x, f, q, sr) { var g = 2 * Math.sin(Math.PI * Math.min(f, sr * .45) / sr); this.lo += g * this.bp; var hp = x - this.lo - this.bp / q; this.bp += g * hp; return this; };
    function buf(sr, sec) { return new Float32Array(Math.max(1, Math.round(sr * sec))); }
    function mix(a, b, at, g, sr) { var o = Math.round(at * sr); for (var i = 0; i < b.length && o + i < a.length; i++) a[o + i] += b[i] * g; return a; }
    var R = {
      tick: function (sr, p) { var o = buf(sr, .07); p = p || 1; for (var i = 0; i < o.length; i++) { var t = i / sr; o[i] = (Math.sin(TAU * 1900 * p * t) * .6 + Math.sin(TAU * 2870 * p * t) * .3) * Math.exp(-t / .012); } return o; },
      pop: function (sr, f, seed) { var o = buf(sr, .05), w = rng(seed || 28), b = new SVF(); for (var i = 0; i < o.length; i++) { var t = i / sr; o[i] = (Math.sin(TAU * f * t) * .6 + b.run(w(), f * 1.6, 2, sr).bp * .8) * Math.exp(-t / .007); } return o; },
      bell: function (sr, f, d, idx, ratio) { var o = buf(sr, d * 5), pc = 0, pm = 0; for (var i = 0; i < o.length; i++) { var t = i / sr; pm += f * (ratio || 1.414) / sr; var mod = Math.sin(TAU * pm) * (idx || 2) * Math.exp(-t / (d * .6)); pc += f / sr; o[i] = Math.sin(TAU * pc + mod) * Math.exp(-t / d) * Math.min(1, t / .001); } return o; },
      modes: function (sr, f, len, M, from) { var o = buf(sr, len); for (var k = 0; k < M.length; k++) { var r = M[k]; for (var i = from || 0; i < o.length; i++) { var t = (i - (from || 0)) / sr; o[i] += Math.sin(TAU * f * r[0] * t) * r[1] * Math.exp(-t / r[2]) * Math.min(1, t / .0008); } } return o; },
      ting: function (sr, m) { var o = buf(sr, .8); [[0, 0], [1, 5]].forEach(function (s) { mix(o, R.modes(sr, mtof(m + s[1]), .7, [[1, .55, .2], [2.76, .18, .05], [5.4, .08, .02]]), s[0] * .075, 1, sr); }); return o; },
      box: function (sr, m, d) { var f = mtof(m), o = buf(sr, (d || .9) * 3); for (var i = 0; i < o.length; i++) { var t = i / sr, D = d || .9; o[i] = (Math.sin(TAU * f * t) * Math.exp(-t / D) + .28 * Math.sin(TAU * f * 3 * t + .4) * Math.exp(-t / (D * .18)) + .12 * Math.sin(TAU * f * 5.43 * t) * Math.exp(-t / .06)) * Math.min(1, t / .0015) * .8; } return o; },
      marimba: function (sr, m, thock) { var f = mtof(m), o = buf(sr, 1.2), w = rng(13 + m), lp = 0; for (var i = 0; i < o.length; i++) { var t = i / sr; lp += (w() - lp) * .11; o[i] = (Math.sin(TAU * f * t) * Math.exp(-t / .3) + .45 * Math.sin(TAU * f * 3.93 * t) * Math.exp(-t / .07) + lp * Math.exp(-t / .012) * (thock || .3) * 3 + Math.sin(TAU * 120 * t) * Math.exp(-t / .03) * (thock || .3) * .6) * Math.min(1, t / .001) * .75; } return o; },
      sweep: function (sr, len, f0, f1, q, seed, shape) { var o = buf(sr, len), w = rng(seed || 20), b = new SVF(); for (var i = 0; i < o.length; i++) { var x = i / o.length; o[i] = b.run(w(), f0 * Math.pow(f1 / f0, x), q || 1.2, sr).bp * (shape ? shape(x) : Math.sin(Math.PI * x)); } return o; },
      sand: function (sr, len, seed) {                    // a dry hiss with sparse grains, shaped like the sweep that makes it
        var o = buf(sr, len), w = rng(seed || 41), b = new SVF(), g = rng((seed || 41) + 7);
        for (var i = 0; i < o.length; i++) { var x = i / o.length, e = Math.pow(Math.sin(Math.PI * Math.min(1, x * 1.15)), 1.4); b.run(w(), 5200 - 1800 * x, .9, sr); o[i] = (b.bp - b.lo * .15) * .55 * e + (Math.abs(g()) > .9965 ? g() * .9 * e : 0); }
        for (var j = 1; j < o.length; j++) o[j] = o[j] * .7 + o[j - 1] * .3;
        return o;
      },
      thud: function (sr, f) { var o = buf(sr, .22), w = rng(9), lp = 0, ph = 0; for (var i = 0; i < o.length; i++) { var t = i / sr; ph += (f * .55 + f * .45 * Math.exp(-t / .03)) / sr; lp += (w() - lp) * .05; o[i] = Math.tanh((Math.sin(TAU * ph) * Math.exp(-t / .07) + lp * Math.exp(-t / .04) * 1.2) * 1.6) * .8; } return o; },
      glide: function (sr, f0, f1, len) { var o = buf(sr, len), ph = 0; for (var i = 0; i < o.length; i++) { var t = i / sr, x = i / o.length; ph += (f0 + (f1 - f0) * Math.sin(x * Math.PI / 2)) / sr; o[i] = Math.sin(TAU * ph) * Math.sin(Math.PI * x) * .7; } return o; }
    };
    // cue name → { make(sr) → samples, gain, gap (ms between repeats) }
    var CUES = {
      tap:       { g: .22, gap: 25, make: function (sr) { return R.tick(sr, 1); } },
      toggleOn:  { g: .5, make: function (sr) { var o = R.pop(sr, 1900, 3); return mix(mix(buf(sr, .16), o, 0, 1, sr), R.glide(sr, 700, 1200, .08), .01, .35, sr); } },
      toggleOff: { g: .45, make: function (sr) { var o = R.pop(sr, 1300, 4); return mix(mix(buf(sr, .16), o, 0, 1, sr), R.glide(sr, 1000, 620, .08), .01, .3, sr); } },
      tileOn:    { g: .32, make: function (sr) { return mix(R.bell(sr, 1318.5, .22, 1.6), R.pop(sr, 2600, 5), 0, .5, sr); } },
      tileOff:   { g: .26, make: function (sr) { return R.bell(sr, 987.8, .16, 1.2); } },
      actions:   { g: .3, gap: 120, make: function (sr) { return R.pop(sr, 1100, 6); } },
      snap:      { g: .22, gap: 40, make: function (sr) { return R.pop(sr, 1700, 7); } },
      dissolve:  { g: .5, make: function (sr) { return R.sand(sr, .55, 41); } },
      sweep:     { g: .55, make: function (sr) { return mix(R.sand(sr, .8, 43), R.sweep(sr, .7, 500, 5200, 1.4, 21), 0, .5, sr); } },
      drop:      { g: .5, make: function (sr) { return mix(R.marimba(sr, 72, .45), R.bell(sr, 2093, .12, 1), .02, .25, sr); } },
      bounce:    { g: .2, gap: 90, make: function (sr) { return R.glide(sr, 300, 540, .09); } },
      tab:       { g: .22, gap: 30, make: function (sr) { return mix(R.tick(sr, .85), R.pop(sr, 1500, 8), .004, .4, sr); } },
      slide:     { g: .1, gap: 35, make: function (sr) { return R.tick(sr, .7); } },
      surge:     { g: .32, make: function (sr) { return mix(R.sweep(sr, .55, 300, 3200, 1.6, 22, function (x) { return Math.pow(x, 1.6) * (1 - Math.pow(x, 8)); }), R.bell(sr, 1760, .3, 2.2), .5, .45, sr); } },
      morphOpen: { g: .35, gap: 60, make: function (sr) { return R.sweep(sr, .17, 900, 2600, 1.6, 23); } },
      morphClose:{ g: .3, gap: 60, make: function (sr) { return R.sweep(sr, .14, 2400, 850, 1.6, 24); } },
      dock:      { g: .16, gap: 200, make: function (sr) { return R.sweep(sr, .12, 1400, 2200, 2, 25); } },
      send:      { g: .45, make: function (sr) { return mix(R.sweep(sr, .2, 700, 3600, 1.4, 26, function (x) { return Math.sin(Math.PI * Math.pow(x, .7)); }), R.pop(sr, 2400, 9), .18, .7, sr); } },
      receive:   { g: .4, gap: 300, make: function (sr) { return R.ting(sr, 88); } },
      toast:     { g: .3, gap: 300, make: function (sr) { return R.ting(sr, 91); } },
      add:       { g: .42, make: function (sr) { var o = buf(sr, 1.6); mix(o, R.box(sr, 84, .7), 0, 1, sr); mix(o, R.box(sr, 91, .9), .09, .9, sr); return mix(o, R.pop(sr, 2200, 10), 0, .5, sr); } },
      success:   { g: .38, make: function (sr) { var o = buf(sr, 1.7); [84, 88, 91].forEach(function (m, i) { mix(o, R.box(sr, m, .8), i * .07, 1 - i * .1, sr); }); return o; } },
      count:     { g: .16, gap: 45, make: function (sr) { return R.tick(sr, 1.35); } },
      timer:     { g: .14, gap: 500, make: function (sr) { return R.tick(sr, .8); } },
      limit:     { g: .36, gap: 200, make: function (sr) { return mix(R.thud(sr, 150), R.tick(sr, .6), .01, .3, sr); } },
      error:     { g: .4, gap: 300, make: function (sr) { var o = buf(sr, .4); mix(o, R.thud(sr, 140), 0, 1, sr); return mix(o, R.thud(sr, 120), .11, .85, sr); } }
    };
    function ensure() {
      if (ctx) return ctx;
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      ctx = new AC();
      var comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 3; comp.attack.value = .002; comp.release.value = .1;
      out = ctx.createGain(); out.gain.value = api.volume; out.connect(comp); comp.connect(ctx.destination);
      return ctx;
    }
    function render(name, sr) {
      var c = CUES[name]; if (!c) return null;
      var key = name + '@' + sr;
      if (!cache[key]) {
        var s = c.make(sr), pk = 0, x1 = 0, y1 = 0;
        for (var i = 0; i < s.length; i++) { var x = s[i]; y1 = x - x1 + .995 * y1; x1 = x; s[i] = y1; pk = Math.max(pk, Math.abs(y1)); }   // DC blocker
        if (pk > 0) for (var j = 0; j < s.length; j++) s[j] = s[j] / pk * .89;                                                  // every cue peaks at −1 dBFS before its gain
        cache[key] = s;
      }
      return cache[key];
    }
    api.play = function (name, d) {
      var c = CUES[name]; if (!c || document.hidden) return;
      var now = performance.now(); if (c.gap && lastAt[name] && now - lastAt[name] < c.gap) return; lastAt[name] = now;
      if (!gestured || !ensure()) return;                 // never queue sounds before the first gesture (they would burst out later)
      if (ctx.state !== 'running') ctx.resume();
      var s = render(name, ctx.sampleRate), b = ctx.createBuffer(1, s.length, ctx.sampleRate); b.getChannelData(0).set(s);
      var src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = b; src.playbackRate.value = d && d.rate || 1; g.gain.value = c.g * (d && d.gain != null ? d.gain : 1);
      src.connect(g); g.connect(out); src.start();
      if (api.onplay) api.onplay(name, ctx.currentTime, now);
    };
    // synthesise every cue ahead of time (idle slices) so the first play is as instant as the motion it belongs to
    function warm() { if (!ctx) return; var list = Object.keys(CUES), idle = window.requestIdleCallback || function (f) { return setTimeout(f, 16); };
      (function next() { var n = list.shift(); if (!n) return; render(n, ctx.sampleRate); idle(next); })(); }
    api.enable = function (on) {
      api.enabled = on !== false; gestured = true;
      try { localStorage.setItem('hm7-sound', api.enabled ? '1' : '0'); } catch (e) {}
      if (api.enabled && ensure()) { if (ctx.state === 'suspended') ctx.resume(); warm(); }
      return api.enabled;
    };
    api.setVolume = function (v) { api.volume = clamp(v, 0, 1); if (out) out.gain.value = api.volume; };
    api.render = function (name, sr) { var s = render(name, sr || 48000); return s && { samples: s, gain: CUES[name].g }; };
    api.names = Object.keys(CUES);
    api.define = function (name, def) { CUES[name] = def; Object.keys(cache).forEach(function (k) { if (k.indexOf(name + '@') === 0) delete cache[k]; }); api.names = Object.keys(CUES); };
    try { if (localStorage.getItem('hm7-sound') === '1') api.enabled = true; } catch (e) {}
    // browsers start audio only after a gesture: wake the context on the first one
    ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, function () { var first = !gestured; gestured = true; if (api.enabled && ensure()) { if (ctx.state === 'suspended') ctx.resume(); if (first) warm(); } }, { capture: true, passive: true }); });
    return api;
  })();

  var haptics = (function () {
    // Pulses under ~15ms barely spin up most phone motors (Huawei's included), so every pulse is ≥15ms;
    // the pauses between pulses keep their rhythm. HM7.haptics.setStrength(0.5–2) scales the pulses only.
    var P = { tap: 18, toggleOn: 24, toggleOff: 20, tileOn: 26, drop: [28, 40, 32], add: [24, 30, 30], success: [22, 40, 22, 40, 28], limit: 40, error: [45, 50, 45], dissolve: 30, sweep: [22, 30, 22, 30, 22], snap: 15, tab: 18, actions: 20 };
    var api = { enabled: false, strength: 1 };
    function scaled(p) {
      var k = api.strength;
      if (k === 1) return p;
      return typeof p === 'number' ? Math.round(p * k) : p.map(function (v, i) { return i % 2 ? v : Math.round(v * k); });
    }
    api.play = function (name) { var p = P[name]; if (p && navigator.vibrate && !document.hidden) { try { navigator.vibrate(scaled(p)); } catch (e) {} } };
    api.enable = function (on) { api.enabled = on !== false; try { localStorage.setItem('hm7-haptics', api.enabled ? '1' : '0'); } catch (e) {} return api.enabled; };
    api.setStrength = function (k) { api.strength = clamp(+k || 1, 0.5, 2); try { localStorage.setItem('hm7-haptics-strength', String(api.strength)); } catch (e) {} return api.strength; };
    api.patterns = P;
    try { if (localStorage.getItem('hm7-haptics') === '1') api.enabled = true; } catch (e) {}
    try { var st = parseFloat(localStorage.getItem('hm7-haptics-strength')); if (st) api.strength = clamp(st, 0.5, 2); } catch (e) {}
    return api;
  })();

  /* spring → CSS linear() easing, so CSS transitions and WAAPI can use the engine's physics */
  function springEasing(k, c, opts) {
    opts = opts || {};
    var s = new Spring(0, k || 260, c || 20); s.t = 1;
    var pts = [], dt = 1 / 120, t = 0, max = opts.max || 2.5;
    while (t < max) { pts.push(s.x); s.step(dt); t += dt; if (t > .2 && s.settled(.001)) break; }
    pts.push(1);
    var n = Math.min(pts.length, opts.points || 48), outp = [];
    for (var i = 0; i < n; i++) outp.push(+pts[Math.round(i / (n - 1) * (pts.length - 1))].toFixed(4));
    return { easing: 'linear(' + outp.join(', ') + ')', duration: Math.round(t * 1000) };
  }

  /* materialise / dematerialise: glass gels in by light (blur, rim, shadow) instead of fading its opacity */
  function materialize(el, out) {
    if (!el) return Promise.resolve();
    var cls = out ? 'hm7-dematerialize' : 'hm7-materialize';
    el.classList.remove('hm7-materialize', 'hm7-dematerialize'); void el.offsetWidth;
    if (RM.matches) { if (out) el.hidden = true; return Promise.resolve(); }
    el.classList.add(cls);
    return new Promise(function (res) {
      var done = function () { el.removeEventListener('animationend', done); el.classList.remove(cls); if (out) el.hidden = true; res(); };
      el.addEventListener('animationend', done);
      setTimeout(done, 700);
    });
  }

  /* ─────────────────────────────────────────────
     10. GLASS CLUSTER — a group of glass controls that behaves as one body.
     Items grow out of the toggle and stay joined by a liquid bridge until they are
     more than `spacing` apart (GlassEffectContainer + glassEffectID, rebuilt for the web).
     ───────────────────────────────────────────── */
  function bridgePath(c1, r1, c2, r2, t) {
    var dx = c2[0] - c1[0], dy = c2[1] - c1[1], d = Math.hypot(dx, dy) || 1, a = Math.atan2(dy, dx);
    var ca = Math.cos(a), sa = Math.sin(a);
    function P(x, y) { return (c1[0] + x * ca - y * sa).toFixed(1) + ' ' + (c1[1] + x * sa + y * ca).toFixed(1); }
    var phi = Math.min(1.25, .42 + .7 * t), w = Math.min(r1, r2) * (.1 + .66 * Math.pow(t, 1.15));
    var x1 = r1 * Math.cos(phi), y1 = r1 * Math.sin(phi), x2 = d - r2 * Math.cos(phi), y2 = r2 * Math.sin(phi), mx = (x1 + x2) / 2;
    var f = 'M' + P(x1, -y1) + 'Q' + P(mx, -w) + ' ' + P(x2, -y2) + 'A' + r2.toFixed(1) + ' ' + r2.toFixed(1) + ' 0 0 0 ' + P(x2, y2) +
      'Q' + P(mx, w) + ' ' + P(x1, y1) + 'A' + r1.toFixed(1) + ' ' + r1.toFixed(1) + ' 0 0 0 ' + P(x1, -y1) + 'Z';
    var s = 'M' + P(x1, -y1) + 'Q' + P(mx, -w) + ' ' + P(x2, -y2) + 'M' + P(x2, y2) + 'Q' + P(mx, w) + ' ' + P(x1, y1);
    return [f, s];
  }
  function cluster(root, o) {
    if (root._hm7cluster) return root._hm7cluster;
    o = o || {};
    var SP = o.spacing != null ? o.spacing : +(root.getAttribute('data-spacing') || 24);
    var toggle = root.querySelector('.hm7-cluster__toggle');
    var items = Array.prototype.slice.call(root.querySelectorAll('.hm7-cluster__item'));
    root.classList.add('hm7-cluster');
    var svg = document.createElementNS(NS_SVG, 'svg'); svg.setAttribute('class', 'hm7-cluster__goo'); svg.setAttribute('aria-hidden', 'true');
    var necks = items.map(function () { var f = document.createElementNS(NS_SVG, 'path'), s = document.createElementNS(NS_SVG, 'path'); f.setAttribute('class', 'f'); s.setAttribute('class', 's'); svg.appendChild(f); svg.appendChild(s); return [f, s, 0]; });
    root.insertBefore(svg, root.firstChild);
    var sp = items.map(function () { return new Spring(0, o.k || 250, o.c || 18); });
    var open = false, home = [], tc = null, order = [], timers = [];
    function measure() {
      var rr = root.getBoundingClientRect(), keep = items.map(function (it) { var t = [it.style.transform, it.style.transition]; it.style.transition = 'none'; it.style.transform = 'none'; return t; });
      var tb = toggle.getBoundingClientRect();
      tc = [tb.left + tb.width / 2 - rr.left, tb.top + tb.height / 2 - rr.top, tb.width / 2];
      home = items.map(function (it) { var b = it.getBoundingClientRect(); return [b.left + b.width / 2 - rr.left, b.top + b.height / 2 - rr.top, b.width / 2]; });
      items.forEach(function (it, i) { it.style.transform = keep[i][0]; void it.offsetWidth; it.style.transition = keep[i][1]; });
      order = items.map(function (_, i) { return i; }).sort(function (a, b) { return Math.hypot(home[a][0] - tc[0], home[a][1] - tc[1]) - Math.hypot(home[b][0] - tc[0], home[b][1] - tc[1]); });
    }
    function set(on, silent) {
      if (on === open) return; open = on; measure();
      toggle.setAttribute('aria-expanded', on); root.classList.toggle('is-open', on);
      var im = toggle.querySelector('.im'); if (im) Array.prototype.forEach.call(im.children, function (c, k) { c.classList.toggle('on', on ? k === 1 : k === 0); c.classList.toggle('off', on ? k !== 1 : k !== 0); });
      timers.forEach(clearTimeout); timers = []; necks.forEach(function (k) { k[3] = false; });
      var seq = on ? order : order.slice().reverse();
      seq.forEach(function (i, n) { timers.push(setTimeout(function () { sp[i].t = on ? 1 : 0; }, n * (on ? (o.stagger || 45) : 30))); });
      items.forEach(function (it) { it.tabIndex = on ? 0 : -1; it.setAttribute('aria-hidden', !on); });
      if (!silent) cue(on ? 'morphOpen' : 'morphClose', null, root);
      if (o.onToggle) o.onToggle(on);
    }
    toggle.addEventListener('click', function () { set(!open); });
    root.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) { set(false); toggle.focus(); } });
    if (o.autoClose !== false) document.addEventListener('pointerdown', function (e) { if (open && !root.contains(e.target)) set(false); });
    items.forEach(function (it) { it.tabIndex = -1; it.setAttribute('aria-hidden', 'true'); it.addEventListener('click', function () { if (o.closeOnPick !== false) setTimeout(function () { set(false); }, 120); }); });
    measure();
    var stop = addLoop(function (dt) {
      if (!home.length) return;
      var prev = tc;
      for (var n = 0; n < order.length; n++) {
        var i = order[n], p = sp[i].step(dt), h = home[i], it = items[i], k = necks[i];
        var q = Math.max(0, p), sc = .42 + .58 * Math.min(1.06, q);
        var cx = tc[0] + (h[0] - tc[0]) * p, cy = tc[1] + (h[1] - tc[1]) * p;
        it.style.transform = 'translate3d(' + (cx - h[0]).toFixed(1) + 'px,' + (cy - h[1]).toFixed(1) + 'px,0) scale(' + sc.toFixed(3) + ')';
        it.style.visibility = q < .015 && !open ? 'hidden' : '';
        var r1 = prev[2] * (prev === tc ? 1 : prev[3] || 1), r2 = h[2] * sc;
        var gap = Math.hypot(cx - prev[0], cy - prev[1]) - r1 - r2, t = clamp(1 - gap / SP, 0, 1);
        if (q > .015 && t > 0) { var d = bridgePath([prev[0], prev[1]], r1, [cx, cy], r2, t); k[0].setAttribute('d', d[0]); k[1].setAttribute('d', d[1]); k[0].style.opacity = k[1].style.opacity = Math.min(1, t * 2.4).toFixed(3); }
        else if (k[0].getAttribute('d')) { k[0].setAttribute('d', ''); k[1].setAttribute('d', ''); }
        if (open && k[2] > 0 && t === 0 && !k[3]) { k[3] = true; cue('snap', null, it); }   // the bridge breaks: one tiny pop on that very frame
        k[2] = t;
        prev = [cx, cy, h[2], sc];
      }
    }, root);
    window.addEventListener('resize', function () { if (open) measure(); });
    return (root._hm7cluster = { open: function () { set(true); }, close: function () { set(false); }, toggle: function () { set(!open); }, get isOpen() { return open; }, stop: stop });
  }

  /* ─────────────────────────────────────────────
     11. MORPH — a panel grows out of the control that opened it and shrinks back into it
     (Liquid Glass zoom / matched-geometry transition). The panel itself is the shell; its content
     keeps its final size so nothing reflows while the shell springs between the two rectangles.
     ───────────────────────────────────────────── */
  function morph(source, panel, o) {
    if (panel._hm7morph) return panel._hm7morph;
    o = o || {};
    var content = panel.querySelector('.hm7-morph__content') || panel.firstElementChild;
    var p = new Spring(0, o.k || 270, o.c || 23), open = false, running = false, S, F, rS = 0, rF = 0, ax = 0, ay = 0;
    var orig = { w: panel.style.width, h: panel.style.height, r: panel.style.borderRadius, t: panel.style.transform };
    panel.hidden = true; panel.classList.add('hm7-morph');
    source.setAttribute('aria-expanded', 'false'); if (panel.id) source.setAttribute('aria-controls', panel.id);
    function px(v) { return parseFloat(v) || 0; }
    function restore() { panel.style.width = orig.w; panel.style.height = orig.h; panel.style.borderRadius = orig.r; panel.style.transform = orig.t; content.style.width = content.style.height = content.style.boxSizing = ''; content.style.opacity = content.style.transform = ''; }
    function measure() {
      var was = panel.hidden; restore(); panel.hidden = false; panel.style.visibility = 'hidden';
      var cs = getComputedStyle(panel);
      ax = cs.left === 'auto' && cs.right !== 'auto' ? 1 : 0;             // anchored to the right edge (typical in RTL)
      ay = cs.top === 'auto' && cs.bottom !== 'auto' ? 1 : 0;             // anchored to the bottom (sheets, docks)
      F = panel.getBoundingClientRect(); S = source.getBoundingClientRect();
      rF = px(cs.borderTopLeftRadius); rS = Math.min(px(getComputedStyle(source).borderTopLeftRadius), S.height / 2);
      var cr = content.getBoundingClientRect(); content.style.boxSizing = 'border-box'; content.style.width = cr.width + 'px'; content.style.height = cr.height + 'px';
      panel.style.visibility = ''; panel.hidden = was;
    }
    function frame(x) {
      var w = Math.max(1, S.width + (F.width - S.width) * x), h = Math.max(1, S.height + (F.height - S.height) * x);
      var nx = F.left + (F.width - w) * ax, ny = F.top + (F.height - h) * ay;          // where the panel would sit at this size
      var tx = S.left + (F.left - S.left) * x - nx, ty = S.top + (F.top - S.top) * x - ny;
      panel.style.width = w.toFixed(1) + 'px'; panel.style.height = h.toFixed(1) + 'px';
      panel.style.transform = 'translate3d(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px,0)';
      panel.style.borderRadius = Math.max(0, rS + (rF - rS) * clamp(x, 0, 1)).toFixed(1) + 'px';
      var c = clamp((x - (open ? .28 : .45)) / .4, 0, 1);
      content.style.opacity = c.toFixed(3); content.style.transform = 'scale(' + (.94 + .06 * c).toFixed(3) + ')';
    }
    var stop = addLoop(function (dt) {
      if (!running) return;
      frame(p.step(dt));
      if (p.settled(.002)) {
        running = false;
        if (open) restore(); else { panel.hidden = true; restore(); source.style.visibility = ''; if (refocus) { refocus = false; source.focus({ preventScroll: true }); } }
      }
    }, null);
    function set(on) {
      if (on === open) return;
      measure();
      if (on) { panel.hidden = false; source.style.visibility = 'hidden'; if (!running) { p.x = 0; p.v = 0; } }
      else if (!running) { p.x = 1; p.v = 0; }
      open = on; p.t = on ? 1 : 0; running = true;
      if (RM.matches) { p.x = p.t; p.v = 0; }
      panel.classList.toggle('is-open', on); source.setAttribute('aria-expanded', on);
      frame(p.x);
      cue(on ? 'morphOpen' : 'morphClose', null, source);
      if (on) { var f = panel.querySelector('[autofocus], [role=option], button, [href], input, [tabindex]:not([tabindex="-1"])'); if (f) setTimeout(function () { f.focus({ preventScroll: true }); }, 80); }
      else if (panel.contains(document.activeElement)) refocus = true;      // focus returns once the button is visible again
      if (o.onToggle) o.onToggle(on);
    }
    var refocus = false;
    if (o.bind !== false) source.addEventListener('click', function () { set(!open); });
    panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') set(false); });
    if (o.autoClose !== false) document.addEventListener('pointerdown', function (e) { if (open && !panel.contains(e.target) && !source.contains(e.target)) set(false); });
    return (panel._hm7morph = { open: function () { set(true); }, close: function () { set(false); }, toggle: function () { set(!open); }, get isOpen() { return open; }, stop: stop });
  }

  /* ─────────────────────────────────────────────
     12. DOCK — the bottom bar minimises while you scroll down and comes back on scroll up or tap
     (iOS 26 tab-bar minimise + bottom accessory). CSS does the shape change; this only decides when.
     ───────────────────────────────────────────── */
  function dock(el, o) {
    if (el._hm7dock) return el._hm7dock;
    o = o || {};
    var sc = o.scroller || window, th = o.threshold || 28, min = false;
    function y() { return sc === window ? window.scrollY : sc.scrollTop; }
    var lastY = y(), acc = 0;
    function set(m) {
      if (m === min) return; min = m;
      el.classList.toggle('is-min', m); el.setAttribute('data-state', m ? 'min' : 'full');
      cue('dock', null, el); if (o.onChange) o.onChange(m);
    }
    sc.addEventListener('scroll', function () {
      var cy = y(), d = cy - lastY; lastY = cy;
      if (cy < 8) { acc = 0; set(false); return; }
      acc = (d >= 0) === (acc >= 0) ? acc + d : d;
      if (acc > th) set(true); else if (acc < -th * .7) set(false);
    }, { passive: true });
    el.addEventListener('click', function (e) { if (min && !(e.target.closest && e.target.closest('[data-hm7-keep]'))) { e.preventDefault(); e.stopPropagation(); set(false); } }, true);
    el.addEventListener('focusin', function () { set(false); });
    return (el._hm7dock = { minimize: function () { set(true); }, expand: function () { set(false); }, get min() { return min; } });
  }

  function init(root) {
    root = root || document;
    // idempotent: each element is wired once, however many times init runs (AJAX fragments, Elementor popups…)
    function each(kind, f) {
      root.querySelectorAll('[data-hm7="' + kind + '"]:not([data-hm7-ready])').forEach(function (el) { el.setAttribute('data-hm7-ready', ''); f(el); });
    }
    each('light', function (el) { light(el); });
    each('pslider', function (el) { particleSlider(el); });
    each('swipe', function (el) { swipeDismiss(el); });
    each('icons', function (el) { iconDrag(el); });
    each('bounce', function (el) { bounceCard(el); });
    each('lens', function (el) { lensTabs(el); });
    each('cluster', function (el) { cluster(el); });
    each('dock', function (el) { dock(el, { scroller: el.getAttribute('data-hm7-scroller') ? document.querySelector(el.getAttribute('data-hm7-scroller')) : window }); });
    root.querySelectorAll('[data-hm7-morph]:not([data-hm7-ready])').forEach(function (src) { var pnl = document.getElementById(src.getAttribute('data-hm7-morph')); if (pnl) { src.setAttribute('data-hm7-ready', ''); morph(src, pnl); } });
  }

  global.HM7 = {
    light: light, particleSlider: particleSlider, swipeDismiss: swipeDismiss, iconDrag: iconDrag,
    bounceCard: bounceCard, lensTabs: lensTabs, clearAll: clearAll, sweep: sweep, dissolve: dissolve, collapse: collapseEl, edgeGlow: edgeGlow, ripple: ripple,
    cluster: cluster, morph: morph, dock: dock, materialize: materialize, springEasing: springEasing,
    cue: cue, onCue: function (f) { cueHooks.push(f); }, sound: sound, haptics: haptics,
    Spring: Spring, init: init, version: '1.0.0'
  };
  if (!global.HM7_NO_AUTO) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); });
    else init();
  }
})(window);

;(function () {
/* HoMoGram UI interactions — ported from HoMoGram DS v1.6 with the same values:
 * GlassReveal (pointer-following border glow), Elastic press (simple .22 / dual .12 + icon .48),
 * Icon Morph, fluid tab indicator with elastic icon, push/pop page transitions, dual-layer radio,
 * creative switch, swipe-to-reply, composer mic↔send. Vanilla, pointer events, root-scoped.
 * Factory: HMGUI({ glow: ['r,g,b core','mid','deep'], glowInner: ['mid','deep'] }) → api
 */
var HMGUI = function (cfg) {
  // sound/haptic cues go through the engine when it is present (no-op otherwise)
  function cue(n, d, el) { var H = window.HM7; if (H && H.cue) H.cue(n, d, el); }
  'use strict';
  cfg = cfg || {};
  // Reveal colours live in CSS (--hm7-rv-core/mid/deep, per theme). An explicit cfg.glow still wins.
  if (cfg.glow && document.documentElement) {
    var rvRoot = document.documentElement.style;
    rvRoot.setProperty('--hm7-rv-core', cfg.glow[0]); rvRoot.setProperty('--hm7-rv-mid', cfg.glow[1]); rvRoot.setProperty('--hm7-rv-deep', cfg.glow[2]);
  }
  var RM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  /* ── GlassReveal ──
     The element under the pointer lights fully; neighbours whose EDGE is within reach light with the
     (1 − d/reach)^1.5 falloff. Reach = half the element's longest side, clamped 70–180px, so a wide
     card is not lit from across the screen. Colours come from CSS (--hm7-rv-core/mid/deep, per theme
     and per state); JS only moves --gx/--gy/--gr and the opacity. Detached elements are released, and
     HM7.ui.autoReveal() wires elements rendered later (frameworks, AJAX). */
  var GR = { els: [], ptr: { x: 0, y: 0, active: false }, raf: 0, on: false, pressed: null };
  var RV_VOID = /^(INPUT|TEXTAREA|SELECT|IMG|VIDEO|SVG|BR|HR)$/;
  function grSched() { if (!GR.raf) GR.raf = requestAnimationFrame(function () { GR.raf = 0; grUpdate(); }); }
  function grStart() {
    if (GR.on) return; GR.on = true;
    var u = function (e) { GR.ptr.x = e.clientX; GR.ptr.y = e.clientY; GR.ptr.active = true; grSched(); };
    // slime: the light lingers a beat after the finger lifts, then the CSS transition fades it
    var end = function () { setTimeout(function () { GR.ptr.active = false; grSched(); }, 120); };
    window.addEventListener('pointermove', u, { passive: true });
    window.addEventListener('pointerdown', u, { passive: true });
    window.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') end(); }, { passive: true });
    window.addEventListener('pointercancel', end, { passive: true });
    window.addEventListener('scroll', grSched, { passive: true, capture: true });
    document.documentElement.addEventListener('mouseleave', end);
    window.addEventListener('blur', end);
  }
  function glowAt(g, x, y, r, rd) {
    g.style.setProperty('--gx', (x - r.left).toFixed(1) + 'px');
    g.style.setProperty('--gy', (y - r.top).toFixed(1) + 'px');
    g.style.setProperty('--gr', rd.toFixed(0) + 'px');
  }
  function reveal(el, mode) {
    if (!el || el.nodeType !== 1 || RV_VOID.test(el.tagName.toUpperCase())) return el;
    if (el._gr) {
      // a framework may have replaced the children: put the light back
      if (el._gbGlow && el._gbGlow.parentNode !== el) el.appendChild(el._gbGlow);
      if (el._gbGlowInner && el._gbGlowInner.parentNode !== el) el.appendChild(el._gbGlowInner);
      return el;
    }
    el._gr = true;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    var g = el._gbGlow || document.createElement('span'); g.className = 'gb-glow'; g.setAttribute('aria-hidden', 'true');
    el.appendChild(g); el._gbGlow = g; el._mode = mode || el.getAttribute('data-reveal') || 'border';
    if (el._mode === 'full') { var gi = el._gbGlowInner || document.createElement('span'); gi.className = 'gb-glow-inner'; gi.setAttribute('aria-hidden', 'true'); el.appendChild(gi); el._gbGlowInner = gi; }
    GR.els.push(el); grStart();
    return el;
  }
  function grUpdate() {
    var x = GR.ptr.x, y = GR.ptr.y, active = GR.ptr.active, vw = window.innerWidth, vh = window.innerHeight, keep = [];
    GR.els.forEach(function (el) {
      if (!el.isConnected) { el._gr = false; return; }  // released; reveal() can wire it again later
      keep.push(el);
      var g = el._gbGlow, gi = el._gbGlowInner; if (!g || el._grPressed) return;
      if (!active) { g.style.opacity = '0'; if (gi) gi.style.opacity = '0'; return; }
      var r = el.getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) { g.style.opacity = '0'; if (gi) gi.style.opacity = '0'; return; }
      var dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      var dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      var d = Math.hypot(dx, dy), reach = Math.min(180, Math.max(70, Math.max(r.width, r.height) * 0.5));
      if (d > reach) { g.style.opacity = '0'; if (gi) gi.style.opacity = '0'; return; }
      var on = d === 0, it = on ? 1 : Math.pow(1 - d / reach, 1.5);
      var rd = Math.max(80, Math.min(r.width * .65, 155));
      glowAt(g, x, y, r, rd);
      g.style.opacity = (it * (on ? .95 : .6)).toFixed(2);
      if (gi) {
        var ii = on ? 1 : Math.pow(1 - d / reach, 2) * .55;
        if (ii > .04) { glowAt(gi, x, y, r, rd * 1.15); gi.style.opacity = ii.toFixed(2); } else gi.style.opacity = '0';
      }
    });
    GR.els = keep;
  }
  function rvPress(el, cx, cy) {
    if (!el._gbGlow) return;
    el._grPressed = true;
    var g = el._gbGlow;
    g.classList.add('is-pressed');
    glowAt(g, cx, cy, el.getBoundingClientRect(), 100);
    g.style.opacity = '.9';
  }
  function rvRel(el) {
    if (!el._gbGlow) return;
    el._grPressed = false;
    el._gbGlow.classList.remove('is-pressed');
    el._gbGlow.style.opacity = '0';
    grSched();
  }
  // press on any revealed element (not only .el): the ring flashes at the touch point
  function grPressAll() {
    if (GR.pressOn) return; GR.pressOn = true;
    window.addEventListener('pointerdown', function (e) {
      var n = e.target && e.target.closest ? e.target : null;
      while (n && !n._gr) n = n.parentElement;
      if (n && !n._grPressed) { GR.pressed = n; rvPress(n, e.clientX, e.clientY); }
    }, { passive: true });
    var up = function () { if (GR.pressed) { var p = GR.pressed; GR.pressed = null; setTimeout(function () { rvRel(p); }, 60); } };
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });
  }
  /** Wire every element matching `selector` under `root`, now and whenever one is added later. */
  function autoReveal(root, selector) {
    root = root || document.body; selector = selector || '.rv, [data-reveal]';
    if (root._hmRv) return root._hmRv; grPressAll();
    var scan = function (n) {
      if (n.nodeType !== 1 || (n.classList && (n.classList.contains('gb-glow') || n.classList.contains('gb-glow-inner')))) return;
      if (n.matches && n.matches(selector)) reveal(n);
      if (n.querySelectorAll) n.querySelectorAll(selector).forEach(function (el) { reveal(el); });
    };
    scan(root);
    var mo = new MutationObserver(function (recs) {
      recs.forEach(function (m) {
        if (m.type === 'attributes') { if (m.target.matches && m.target.matches(selector)) reveal(m.target); return; }
        if (m.target._gr) reveal(m.target);
        m.addedNodes.forEach(scan);
      });
    });
    mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-reveal'] });
    root._hmRv = { disconnect: function () { mo.disconnect(); root._hmRv = null; } };
    return root._hmRv;
  }

  /* ── Elastic: deeper press, omni 180° (simple maxD .22; dual container .12, icon .48) ── */
  function getET(el, cx, cy, s, md) {
    var r = el.getBoundingClientRect();
    var ex = ((cx - r.left) / r.width - .5) * s, ey = ((cy - r.top) / r.height - .5) * s;
    var sx = 1 - Math.abs(ex) * md, sy = 1 - Math.abs(ey) * md;
    return 'scaleX(' + (sx * (1 + Math.abs(ey) * .06)).toFixed(3) + ') scaleY(' + (sy * (1 + Math.abs(ex) * .06)).toFixed(3) + ')';
  }
  function getIT(el, cx, cy) {
    var r = el.getBoundingClientRect();
    var ex = (cx - r.left) / r.width - .5, ey = (cy - r.top) / r.height - .5;
    var sx = 1 - Math.abs(ex) * .48, sy = 1 - Math.abs(ey) * .48;
    return 'translate(' + (ex * 3.5).toFixed(1) + 'px,' + (ey * 3.5).toFixed(1) + 'px) scaleX(' + sx.toFixed(3) + ') scaleY(' + sy.toFixed(3) + ')';
  }
  var elasticOn = false;
  function elastic(root) {
    root = root || document;
    if (root._hmgEl) return; root._hmgEl = true;
    root.addEventListener('pointerdown', function (e) {
      if (RM.matches) return;
      var cx = e.clientX, cy = e.clientY;
      var el = e.target.closest && e.target.closest('.el:not(.el-d)');
      if (el) { el.classList.add('pr'); el.style.transform = getET(el, cx, cy, 1, .22); rvPress(el, cx, cy); }
      var du = e.target.closest && e.target.closest('.el-d');
      if (du && du !== el) {
        du.classList.add('pr'); du.style.transform = getET(du, cx, cy, .65, .12);
        var ic = du.querySelector('.si'); if (ic) ic.style.transform = getIT(du, cx, cy);
        rvPress(du, cx, cy);
      }
    });
    if (elasticOn) return; elasticOn = true;
    var up = function () {
      document.querySelectorAll('.el.pr,.el-d.pr').forEach(function (el) {
        el.classList.remove('pr'); el.classList.add('rl'); el.style.transform = 'scale(1)';
        var ic = el.querySelector('.si'); if (ic) ic.style.transform = '';
        rvRel(el);
        setTimeout(function () { el.classList.remove('rl'); el.style.transform = ''; }, 540);
      });
    };
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }

  /* ── Icon Morph: two glyphs in .im, .on / .off; .48s --sk with blur + rotate ── */
  function morph(w, state) {
    if (typeof w === 'string') w = document.getElementById(w);
    if (!w) return;
    var kids = w.querySelectorAll(':scope > .on, :scope > .off');
    kids.forEach(function (ic) {
      var toOn = state == null ? ic.classList.contains('off') : (ic === kids[state ? 0 : 1]);
      ic.classList.toggle('on', toOn); ic.classList.toggle('off', !toOn);
    });
    var host = w.closest('[aria-pressed]'); if (host) host.setAttribute('aria-pressed', host.getAttribute('aria-pressed') !== 'true');
  }

  /* ── Tabs: fluid indicator (.48s --sm) + elastic icon on click ── */
  function tabs(bar, o) {
    o = o || {};
    var ind = bar.querySelector('.tb-ind'), items = Array.prototype.slice.call(bar.querySelectorAll('.tb-it'));
    bar.setAttribute('role', 'tablist');
    function mv(t) { var br = bar.getBoundingClientRect(), tr = t.getBoundingClientRect(); ind.style.left = (tr.left - br.left) + 'px'; ind.style.width = tr.width + 'px'; }
    function select(el, silent) {
      items.forEach(function (t) {
        var on = t === el; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
        t.querySelectorAll('.im > *').forEach(function (ic, k) { ic.classList.toggle('on', on ? k === 0 : k === 1); ic.classList.toggle('off', on ? k !== 0 : k !== 1); });
      });
      mv(el);
      if (!silent) cue('tab', null, el);
      if (!silent && o.elastic !== false && !RM.matches) {
        var icon = el.querySelector('.im');
        if (icon) {
          icon.style.transition = 'transform .09s var(--st)'; icon.style.transform = 'scale(.78)';
          setTimeout(function () { icon.style.transition = 'transform .52s var(--sp)'; icon.style.transform = 'scale(1)';
            setTimeout(function () { icon.style.transition = ''; icon.style.transform = ''; }, 560); }, 80);
        }
      }
      if (!silent && o.onChange) o.onChange(items.indexOf(el));
    }
    items.forEach(function (t) {
      t.setAttribute('role', 'tab');
      t.addEventListener('click', function () { select(t); });
      t.addEventListener('keydown', function (e) {
        var i = items.indexOf(t), d = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;   // RTL
        if (getComputedStyle(bar).direction === 'ltr') d = -d;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(t); return; }
        if (!d) return; e.preventDefault(); var n = items[(i + d + items.length) % items.length]; select(n); n.focus();
      });
    });
    var first = bar.querySelector('.tb-it.on') || items[0];
    ind.style.transition = 'none'; select(first, true);
    requestAnimationFrame(function () { mv(first); setTimeout(function () { ind.style.transition = 'left .48s var(--sm),width .48s var(--sm)'; }, 60); });
    window.addEventListener('resize', function () { var cur = bar.querySelector('.tb-it.on'); if (cur) mv(cur); });
    if ('ResizeObserver' in window) new ResizeObserver(function () { var cur = bar.querySelector('.tb-it.on'); if (cur) mv(cur); }).observe(bar);
    return { select: function (i) { select(items[i]); } };
  }

  /* ── Page transitions: list scales to .92 and fades to .18; the next page slides in from 104% ── */
  function pages() {
    return {
      open: function (main, next, o) {
        o = o || {};
        next.className = 'page p-off-r'; next.style.opacity = '0';
        requestAnimationFrame(function () { requestAnimationFrame(function () {
          main.className = 'page p-exit'; next.className = 'page p-enter'; next.style.opacity = '1';
          var list = o.stagger ? next.querySelectorAll(o.stagger) : [];
          list.forEach(function (el, i) {
            el.style.opacity = '0'; el.style.transform = 'translateY(10px)';
            setTimeout(function () { el.style.transition = 'opacity .3s var(--sm) ' + (i * 35) + 'ms,transform .3s var(--sm) ' + (i * 35) + 'ms';
              el.style.opacity = '1'; el.style.transform = 'translateY(0)'; }, 60);
          });
        }); });
      },
      back: function (main, next) {
        next.className = 'page p-return';
        setTimeout(function () { main.className = 'page p-restore'; setTimeout(function () { main.className = 'page p-idle'; }, 440); }, 20);
      }
    };
  }

  /* ── Radio: dual-layer spring (box .96 → 1, icon 1.12 / −4°, check 1.18) ── */
  function radio(group, o) {
    o = o || {};
    var opts = Array.prototype.slice.call(group.querySelectorAll('.ro'));
    group.setAttribute('role', 'radiogroup');
    function sel(el) {
      opts.forEach(function (r) { r.classList.remove('sel'); r.setAttribute('aria-checked', 'false'); r.tabIndex = -1; });
      el.tabIndex = 0; el.setAttribute('aria-checked', 'true');
      el.style.transform = 'scale(.96)';
      cue('tap', null, el);
      setTimeout(function () {
        el.style.transition = 'transform .46s var(--sp),border-color .32s var(--sm),background .32s var(--sm),box-shadow .32s var(--sm)';
        el.style.transform = 'scale(1)'; el.classList.add('sel');
        setTimeout(function () { el.style.transition = ''; }, 500);
      }, 60);
      if (o.onChange) o.onChange(opts.indexOf(el), el);
    }
    opts.forEach(function (r) {
      r.setAttribute('role', 'radio'); r.setAttribute('aria-checked', r.classList.contains('sel')); r.tabIndex = r.classList.contains('sel') ? 0 : -1;
      r.addEventListener('click', function () { sel(r); });
      r.addEventListener('keydown', function (e) {
        var i = opts.indexOf(r), d = (e.key === 'ArrowDown' || e.key === 'ArrowLeft') ? 1 : (e.key === 'ArrowUp' || e.key === 'ArrowRight') ? -1 : 0;
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); sel(r); return; }
        if (!d) return; e.preventDefault(); var n = opts[(i + d + opts.length) % opts.length]; sel(n); n.focus();
      });
    });
    if (!group.querySelector('.ro.sel') && opts[0]) opts[0].tabIndex = 0;
    return { select: function (i) { sel(opts[i]); } };
  }

  /* ── Switch: glass knob, icon swap, inner glow trail ── */
  function switches(root) {
    (root || document).querySelectorAll('.sw-wrap').forEach(function (el) {
      if (el._sw) return; el._sw = true;
      el.setAttribute('role', 'switch'); el.tabIndex = 0;
      el.setAttribute('aria-checked', el.classList.contains('on'));
      var t = function () { el.classList.toggle('on'); el.setAttribute('aria-checked', el.classList.contains('on')); cue(el.classList.contains('on') ? 'toggleOn' : 'toggleOff', null, el); el.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { on: el.classList.contains('on') } })); };
      el.addEventListener('click', t);
      el.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); t(); } });
    });
  }

  /* ── Swipe to reply: bubble stretches (x .0007, y .0005), hint pops at 50px, spring back .52s ── */
  function swipeReply(bub, o) {
    o = o || {};
    var hint = o.hint || bub.parentElement.querySelector('.sw-hint');
    var max = o.max || 100, at = o.trigger || 50, dir = o.dir || -1;
    var sx = 0, dr = false, trig = false;
    bub.style.touchAction = 'pan-y';
    bub.addEventListener('pointerdown', function (e) { bub.setPointerCapture(e.pointerId); sx = e.clientX; dr = true; trig = false; bub.style.transition = ''; });
    bub.addEventListener('pointermove', function (e) {
      if (!dr) return;
      var dx = e.clientX - sx; dx = dir < 0 ? Math.max(-max, Math.min(0, dx)) : Math.min(max, Math.max(0, dx));
      var a = Math.abs(dx);
      bub.style.transform = 'translateX(' + dx + 'px) scaleX(' + (1 + a * .0007) + ') scaleY(' + (1 - a * .0005) + ')';
      if (hint) {
        if (a > at && !trig) { trig = true; hint.style.transform = 'translateY(-50%) scale(1)'; cue('actions', null, bub); }
        else if (a < at && trig) { trig = false; hint.style.transform = 'translateY(-50%) scale(0)'; }
      }
    });
    var up = function () {
      if (!dr) return; dr = false;
      if (hint) hint.style.transform = 'translateY(-50%) scale(0)';
      bub.style.transition = 'transform .52s var(--sp)'; bub.style.transform = 'translateX(0) scale(1)';
      if (trig && o.onReply) o.onReply(bub);
      setTimeout(function () { bub.style.transition = ''; }, 620);
    };
    bub.addEventListener('pointerup', up); bub.addEventListener('pointercancel', up);
  }

  /* ── Composer: mic ↔ send morph as the field fills ── */
  function composer(input, wrap) {
    var upd = function () {
      var has = input.value.trim().length > 0, ics = wrap.querySelectorAll(':scope > *');
      if (ics.length < 2) return;
      ics[0].classList.toggle('on', !has); ics[0].classList.toggle('off', has);
      ics[1].classList.toggle('on', has); ics[1].classList.toggle('off', !has);
      var btn = wrap.closest('button'); if (btn) btn.setAttribute('aria-label', has ? (btn.getAttribute('data-label-send') || 'Send') : (btn.getAttribute('data-label-mic') || 'Record'));
    };
    input.addEventListener('input', upd); upd();
    return { update: upd };
  }

  function init(root) {
    root = root || document;
    root.querySelectorAll('.rv').forEach(function (el) { reveal(el); });
    elastic(root);
    switches(root);
    root.querySelectorAll('.tb-wrap').forEach(function (b) { if (!b._tb) { b._tb = 1; tabs(b); } });
    root.querySelectorAll('[data-radio]').forEach(function (g) { if (!g._ro) { g._ro = 1; radio(g); } });
    root.querySelectorAll('[data-morph]').forEach(function (b) {
      if (b._mo) return; b._mo = 1;
      b.addEventListener('click', function () { morph(b.querySelector('.im')); });
    });
  }

  return { reveal: reveal, elastic: elastic, morph: morph, tabs: tabs, pages: pages, radio: radio,
    switches: switches, swipeReply: swipeReply, composer: composer, init: init, refresh: grUpdate, autoReveal: autoReveal };
};

/* HM7.shop — commerce behaviours on top of the HM7 engine and the v1.6 interaction layer (HM7.ui).
   Vanilla JS, no dependencies. Every function is safe to call twice on the same element. */
var HM7Shop = function (HM7) {
  'use strict';
  var RM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var FA = '۰۱۲۳۴۵۶۷۸۹';
  function cue(n, d, el) { if (HM7.cue) HM7.cue(n, d, el); }
  function fa(n) { return String(n).replace(/[0-9]/g, function (d) { return FA[+d]; }); }
  function latin(s) { return String(s).replace(/[۰-۹]/g, function (d) { return FA.indexOf(d); }).replace(/[٬,]/g, ''); }
  function group(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '٬'); }
  /** money(1250000) → "۱٬۲۵۰٬۰۰۰ تومان" · money(n, { unit: false }) · money(n, { latin: true }) */
  function money(n, o) {
    o = o || {};
    var s = group(n);
    s = o.latin ? s.replace(/٬/g, ',') : fa(s);
    return o.unit === false ? s : s + ' ' + (o.unit || 'تومان');
  }
  function pct(was, now) { return Math.round((1 - now / was) * 100); }

  /* digit roll: only the characters that change slide; direction follows the value */
  function roll(el, text, dir) {
    text = String(text);
    var old = el.getAttribute('data-v');
    if (old == null) old = el.textContent;
    if (old === text) return;
    el.setAttribute('data-v', text);
    if (RM.matches || !el.animate) { el.textContent = text; return; }
    if (!dir) { var a = parseFloat(latin(old)), b = parseFloat(latin(text)); dir = isNaN(a) || isNaN(b) || b >= a ? 1 : -1; }
    // cells live in their own inline-flex wrapper, so the host keeps whatever display it has (grid, flex…)
    var box = document.createElement('span'); box.className = 'cm-roll';
    var same = old.length === text.length, pairs = same ? text.split('').map(function (c, i) { return [old[i], c]; }) : [[old, text]];
    el.textContent = ''; el.appendChild(box);
    var k = 0;
    pairs.forEach(function (p) {
      var cell = document.createElement('span'); cell.className = 'cm-roll__c';
      if (p[0] === p[1]) { cell.textContent = p[1]; box.appendChild(cell); return; }
      var o = document.createElement('span'), n = document.createElement('span');
      o.textContent = p[0]; o.setAttribute('aria-hidden', 'true'); n.textContent = p[1];
      cell.appendChild(o); cell.appendChild(n); box.appendChild(cell);
      var d = (k++) * 34;
      o.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(' + (-dir * 95) + '%)', opacity: 0 }], { duration: 280, delay: d, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' });
      n.animate([{ transform: 'translateY(' + (dir * 95) + '%)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 560, delay: d, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'both' });
    });
    clearTimeout(el._cmRoll);
    el._cmRoll = setTimeout(function () { el.textContent = text; }, 620 + k * 34);
  }

  function bump(el) { if (!el) return; el.classList.remove('cm-bump'); void el.offsetWidth; el.classList.add('cm-bump'); }

  /* quantity stepper: [+] value [− / trash]. At the minimum, minus turns into a trash can. */
  function qty(el, o) {
    if (el._cmQty) return el._cmQty;
    o = o || {};
    var min = o.min != null ? o.min : +(el.getAttribute('data-min') || 1);
    var max = o.max != null ? o.max : +(el.getAttribute('data-max') || 10);
    var v = o.value != null ? o.value : +(el.getAttribute('data-value') || min);
    var removable = o.removable != null ? o.removable : el.hasAttribute('data-removable');
    el.classList.add('cm-qty'); el.setAttribute('role', 'group');
    if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', 'تعداد');
    el.innerHTML = '<button type="button" class="cm-qty__b el" data-d="1" aria-label="یکی بیشتر"><i class="hms hms-plus" aria-hidden="true"></i></button>' +
      '<output class="cm-qty__v" aria-live="polite"></output>' +
      '<button type="button" class="cm-qty__b el" data-d="-1"><span class="im" aria-hidden="true"><i class="hms hms-minus on"></i><i class="hms hms-trash off"></i></span></button>';
    var plus = el.children[0], out = el.children[1], minus = el.children[2], im = minus.querySelector('.im');
    function paint(first) {
      if (first) { out.textContent = fa(v); out.setAttribute('data-v', fa(v)); } else roll(out, fa(v));
      plus.setAttribute('aria-disabled', v >= max);   // stays focusable: a press at the cap explains why (onMax)
      var rm = removable && v <= min;
      minus.disabled = !removable && v <= min;
      minus.classList.toggle('is-remove', rm);
      minus.setAttribute('aria-label', rm ? 'حذف از سبد' : 'یکی کمتر');
      var ics = im.children; ics[0].classList.toggle('on', !rm); ics[0].classList.toggle('off', rm); ics[1].classList.toggle('on', rm); ics[1].classList.toggle('off', !rm);
    }
    function set(n, silent) {
      n = Math.max(min, Math.min(max, n));
      if (n === v) return;
      var up = n > v; v = n; paint();
      if (!silent) cue('count', { rate: up ? 1.12 : .9 }, el);
      if (!silent && o.onChange) o.onChange(v);
    }
    el.addEventListener('click', function (e) {
      var b = e.target.closest('.cm-qty__b'); if (!b || b.disabled) return;
      var d = +b.getAttribute('data-d');
      if (d < 0 && removable && v <= min) { if (o.onRemove) o.onRemove(); return; }
      if (d > 0 && v >= max) { el.classList.remove('is-max'); void el.offsetWidth; el.classList.add('is-max'); cue('limit', null, el); if (o.onMax) o.onMax(max); return; }
      set(v + d);
    });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowUp') { e.preventDefault(); set(v + 1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); set(v - 1); }
    });
    paint(true);
    return (el._cmQty = { get value() { return v; }, set: set });
  }

  /* countdown: el holds [data-u="h"], [data-u="m"], [data-u="s"]; end = Date | ms timestamp | seconds from now (number < 1e9) */
  function countdown(el, o) {
    if (el._cmCd) el._cmCd.stop();
    o = o || {};
    var end = o.end != null ? o.end : el.getAttribute('data-end');
    if (typeof end === 'string') end = /^\d+$/.test(end) ? +end : Date.parse(end);
    if (end instanceof Date) end = +end;
    if (end < 1e9) end = Date.now() + end * 1000;
    var units = { h: el.querySelector('[data-u="h"]'), m: el.querySelector('[data-u="m"]'), s: el.querySelector('[data-u="s"]') }, id = 0, over = false;
    el.setAttribute('role', 'timer');
    function two(n) { return fa(n < 10 ? '0' + n : String(n)); }
    function tick(first) {
      var left = Math.max(0, end - Date.now()), t = Math.ceil(left / 1000);
      var h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
      [['h', h], ['m', m], ['s', s]].forEach(function (u) { var e = units[u[0]]; if (!e) return; if (first) { e.textContent = two(u[1]); e.setAttribute('data-v', two(u[1])); } else roll(e, two(u[1]), -1); });
      el.setAttribute('aria-label', 'زمان باقی‌مانده ' + fa(h) + ' ساعت و ' + fa(m) + ' دقیقه');
      el.classList.toggle('is-last', t > 0 && t <= (o.urgent || 60));
      if (!first && t > 0 && t <= 10) cue('timer', { rate: t <= 3 ? 1.25 : 1 }, el);
      if (t <= 0 && !over) { over = true; el.classList.add('is-over'); if (o.onEnd) o.onEnd(); return; }
      if (o.onTick) o.onTick(t);
      id = setTimeout(tick, (left % 1000) || 1000);
    }
    tick(true);
    return (el._cmCd = { stop: function () { clearTimeout(id); } });
  }

  function meter(el, p) { el.style.setProperty('--p', Math.max(0, Math.min(1, p))); }

  /* fly-to-cart: a copy of `from` arcs into `to`, the target bumps and glows */
  function fly(from, to, o) {
    o = o || {};
    var done = function () { bump(to); to.classList.remove('is-glow'); void to.offsetWidth; to.classList.add('is-glow'); cue('add', null, to); if (o.onArrive) o.onArrive(); };
    if (!from || !to) return done();
    var a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    if (RM.matches || !document.body.animate || !a.width) return done();
    var g = from.cloneNode(true);
    g.removeAttribute('id'); g.classList.add('cm-fly'); g.setAttribute('aria-hidden', 'true');
    g.style.left = a.left + 'px'; g.style.top = a.top + 'px'; g.style.width = a.width + 'px'; g.style.height = a.height + 'px';
    document.body.appendChild(g);
    var dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    var big = Math.max(a.width, a.height), s0 = Math.min(1, 200 / big);      // a large photo is picked up as a thumbnail first
    var s1 = Math.max(.08, Math.min(b.width, b.height) / big * .8);
    var lift = Math.min(170, 60 + Math.abs(dx) * .3), spin = dx > 0 ? 14 : -14, K = [], N = 24;
    for (var i = 0; i <= N; i++) {
      var t = i / N, u = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;       // ease-in-out along the path
      var x = dx * u, y = dy * u - lift * 4 * u * (1 - u);
      var pick = Math.min(1, t / .16), sc0 = 1 + (s0 - 1) * (pick * (2 - pick));
      var v = Math.max(0, (u - .0512) / .9488);                               // shrink phase starts where pick-up ends (u(.16) = .0512)
      var sc = t <= .16 ? sc0 + .05 * Math.sin(pick * Math.PI) : s0 + (s1 - s0) * Math.pow(v, .9);
      K.push({ transform: 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) rotate(' + (spin * Math.sin(u * Math.PI)).toFixed(1) + 'deg) scale(' + sc.toFixed(3) + ')',
        opacity: t > .86 ? 1 - (t - .86) / .14 : 1, borderRadius: (16 + 30 * u) + 'px' });
    }
    var an = g.animate(K, { duration: o.duration || 760, easing: 'linear', fill: 'forwards' });
    an.onfinish = function () { g.remove(); done(); };
  }

  /* heart: outline ↔ fill morph, ring and six sparks */
  function fav(btn, o) {
    if (btn._cmFav) return;
    btn._cmFav = 1; o = o || {};
    btn.addEventListener('click', function () {
      var on = btn.getAttribute('aria-pressed') !== 'true';
      var im = btn.querySelector('.im');
      if (im && HM7.ui) HM7.ui.morph(im, !on);          // morph also flips aria-pressed on the button
      btn.setAttribute('aria-pressed', on);
      cue(on ? 'toggleOn' : 'toggleOff', null, btn);
      if (on && !RM.matches) {
        btn.classList.remove('is-burst'); void btn.offsetWidth; btn.classList.add('is-burst');
        var host = btn.offsetParent || btn.parentNode;
        for (var i = 0; i < 6; i++) {
          var sp = document.createElement('i'); sp.className = 'cm-spark';
          sp.style.left = (btn.offsetLeft + btn.offsetWidth / 2 - 2.5) + 'px'; sp.style.top = (btn.offsetTop + btn.offsetHeight / 2 - 2.5) + 'px';
          host.appendChild(sp);
          var ang = i / 6 * Math.PI * 2 - Math.PI / 2, r = 22 + Math.random() * 8;
          sp.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: 'translate(' + (Math.cos(ang) * r).toFixed(1) + 'px,' + (Math.sin(ang) * r).toFixed(1) + 'px) scale(.2)', opacity: 0 }],
            { duration: 520, easing: 'cubic-bezier(.16,1,.3,1)' }).onfinish = (function (x) { return function () { x.remove(); }; })(sp);
        }
      }
      if (o.onChange) o.onChange(on);
    });
  }

  /* add-to-cart: label swaps, icon morphs bag → check, optional fly to the cart target */
  function add(btn, o) {
    if (btn._cmAdd) return;
    btn._cmAdd = 1; o = o || {};
    btn.addEventListener('click', function () {
      if (btn.classList.contains('is-added') && !o.repeat) return;
      var card = btn.closest('[data-cm-product]') || btn.closest('.cm-product');
      var art = card && (card.querySelector('.cm-product__media') || card);
      var target = o.cart || document.querySelector(btn.getAttribute('data-cm-cart') || '[data-cm-cart]');
      btn.classList.add('is-added');
      var im = btn.querySelector('.im'); if (im && HM7.ui) HM7.ui.morph(im, false);
      btn.setAttribute('aria-label', btn.getAttribute('data-added-label') || 'به سبد افزوده شد');
      fly(art, target, { onArrive: function () {
        var c = target && target.querySelector('.cm-count');
        if (c) { var n = +latin(c.getAttribute('data-v') || c.textContent || '0') + 1; c.setAttribute('data-n', n); roll(c, fa(n)); }
        if (o.onAdd) o.onAdd(card);
      } });
      if (o.revert !== false) setTimeout(function () {
        btn.classList.remove('is-added'); if (im && HM7.ui) HM7.ui.morph(im, true); btn.removeAttribute('aria-label');
      }, o.revertAfter || 2600);
    });
  }

  /* toast: a swipeable glass card; auto-dissolves after `life` ms (paused on hover / focus) */
  function toast(host, o) {
    o = o || {};
    var row = document.createElement('div'); row.className = 'hm7-notif-row cm-toast';
    var life = o.life === 0 ? 0 : (o.life || 4200);
    row.style.setProperty('--life', life + 'ms');
    row.innerHTML = '<div class="hm7-notif" tabindex="0" role="status" data-hm7-colors="' + (o.colors || '') + '"><div class="hm7-notif__body">' +
      '<div class="cm-toast__media"' + (o.tint ? ' style="--tint:' + o.tint + '"' : '') + '><i class="hms hms-' + (o.icon || 'checkmark_circle_fill') + '" aria-hidden="true"></i></div>' +
      '<div class="cm-toast__txt"><b></b><span></span></div>' + (o.action ? '<button type="button" class="cm-toast__go"></button>' : '') + '</div>' +
      (life ? '<i class="cm-toast__bar" aria-hidden="true"></i>' : '') + '</div>' +
      '<button type="button" class="hm7-glass hm7-notif__act" data-act="trash" aria-label="بستن"><i class="hms hms-xmark" aria-hidden="true"></i></button>';
    row.querySelector('b').textContent = o.title || '';
    row.querySelector('.cm-toast__txt span').textContent = o.text || '';
    var go = row.querySelector('.cm-toast__go');
    if (go) {
      go.textContent = o.action;
      go.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      go.addEventListener('click', function () { if (o.onAction) o.onAction(); api.dissolve(); });
    }
    host.insertBefore(row, host.firstChild);
    cue('toast', null, row);
    if (HM7.materialize) HM7.materialize(row.firstChild);          // glass gels in by light, no opacity fade
    var card = row.firstChild, timer = 0, paused = false, t0 = Date.now(), rest = life;
    var api = HM7.swipeDismiss(card, { stage: o.stage || host, onDismiss: function () { row.remove(); if (o.onClose) o.onClose(); } });
    function arm() { if (!life) return; clearTimeout(timer); t0 = Date.now(); timer = setTimeout(function () { api.dissolve(); }, rest); }
    function pause() { if (!life || paused) return; paused = true; clearTimeout(timer); rest -= Date.now() - t0; }
    function resume() { if (!life || !paused) return; paused = false; arm(); }
    row.addEventListener('pointerenter', pause); row.addEventListener('pointerleave', resume);
    row.addEventListener('focusin', pause); row.addEventListener('focusout', resume);
    arm();
    return api;
  }

  /* checkout steps */
  function steps(ol, o) {
    if (ol._cmSteps) return ol._cmSteps;
    o = o || {};
    var items = Array.prototype.slice.call(ol.children);
    ol.style.setProperty('--n', items.length);
    items.forEach(function (li, i) {
      var dot = li.querySelector('.cm-steps__dot');
      if (dot && !dot.querySelector('.im')) dot.innerHTML = '<span class="im" aria-hidden="true"><span class="on">' + fa(i + 1) + '</span><i class="hms hms-checkmark off"></i></span>';
    });
    function go(n) {
      n = Math.max(0, Math.min(items.length - 1, n));
      items.forEach(function (li, i) {
        li.classList.toggle('is-done', i < n); li.classList.toggle('is-current', i === n);
        if (i === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
        var im = li.querySelector('.im'); if (im && HM7.ui) HM7.ui.morph(im, !(i < n));
      });
      ol.style.setProperty('--p', items.length > 1 ? n / (items.length - 1) : 0);
      if (cur != null && n !== cur) cue(n > cur ? 'success' : 'tap', null, ol);
      cur = n; if (o.onChange) o.onChange(n);
    }
    var cur = o.current || 0; go(cur);
    return (ol._cmSteps = { go: go, next: function () { go(cur + 1); }, prev: function () { go(cur - 1); }, get current() { return cur; } });
  }

  /* text field validation: error state shakes once */
  function invalid(field, msg) {
    var help = field.querySelector('.cm-field__help');
    field.classList.remove('is-ok', 'is-shake'); void field.offsetWidth;
    field.classList.add('is-error', 'is-shake');
    cue('error', null, field);
    if (help && msg != null) help.textContent = msg;
    var inp = field.querySelector('input, textarea, select'); if (inp) inp.setAttribute('aria-invalid', 'true');
  }
  function valid(field, msg) {
    var help = field.querySelector('.cm-field__help');
    field.classList.remove('is-error', 'is-shake'); field.classList.add('is-ok');
    cue('success', null, field);
    if (help && msg != null) help.textContent = msg;
    var inp = field.querySelector('input, textarea, select'); if (inp) inp.removeAttribute('aria-invalid');
  }

  function init(root) {
    root = root || document;
    root.querySelectorAll('[data-cm="qty"]').forEach(function (el) { qty(el); });
    root.querySelectorAll('[data-cm="countdown"]').forEach(function (el) { if (!el._cmCd) countdown(el); });
    root.querySelectorAll('[data-cm="fav"]').forEach(function (el) { fav(el); });
    root.querySelectorAll('[data-cm="add"]').forEach(function (el) { add(el); });
    root.querySelectorAll('[data-cm="steps"]').forEach(function (el) { steps(el); });
    root.querySelectorAll('.cm-chip[data-cm-toggle]').forEach(function (el) {
      if (el._cmChip) return; el._cmChip = 1;
      if (!el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', 'false');
      if (!el.querySelector('.cm-chip__check')) el.insertAdjacentHTML('afterbegin', '<span class="cm-chip__check" aria-hidden="true"><i class="hms hms-checkmark"></i></span>');
      el.addEventListener('click', function () { el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') !== 'true'); });
    });
  }

  return { fa: fa, latin: latin, money: money, pct: pct, roll: roll, bump: bump, qty: qty, countdown: countdown, meter: meter,
    fly: fly, fav: fav, add: add, toast: toast, steps: steps, invalid: invalid, valid: valid, init: init };
};

  var H = window.HM7, engineInit = H.init;
  H.ui = HMGUI({});  // reveal colours come from bundle.css (theme- and state-aware)
  H.shop = HM7Shop(H);
  H.version = '1.3.0';
  /** HM7.init(root): wires data-hm7 effects, the v1.6 interactions (.rv .el .tb-wrap [data-radio] .sw-wrap [data-morph]) and data-cm commerce behaviours. Idempotent. */
  H.init = function (root) { root = root || document; engineInit(root); H.ui.init(root); H.shop.init(root); };
})();

/* HM7 1.2 — light-sensitive edges and text-field motion.
 *   HM7.edgeLight(edge)        a sidebar's content-facing hairline (.hm7-edge): tinted by the content beside
 *                              it (CSS backdrop), brightened where the pointer is (this function)
 *   HM7.rim(el)                appends a .hm7-rim ring to a frosted toolbar/dock so its border takes the
 *                              colour of what scrolls underneath; HM7.rim(el, 'bottom') for a header's bottom edge
 *   HM7.fieldMotion(root?)     every text input/textarea under root: focus pops it up, each keystroke gives a
 *                              jelly squash (delete the opposite), a press dents it, hover lifts it; one
 *                              under-damped spring per field — plus the HoMoGram V5 "typing slime": the field's
 *                              border flashes at the caret on every keystroke
 * All three honour prefers-reduced-motion and are opt-in (nothing runs until called). */
(function () {
  'use strict';
  var H = window.HM7;
  if (!H) return;
  var RM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  /* ── edge light ── */
  H.edgeLight = function (edge, o) {
    if (!edge || edge._hmEdge) return edge && edge._hmEdge;
    o = o || {};
    var reach = o.reach || 280, frame = 0, x = 0, y = 0, inside = false;
    var paint = function () {
      frame = 0;
      var r = edge.getBoundingClientRect();
      var lineX = getComputedStyle(edge).direction === 'rtl' ? r.right : r.left;  // the side touching the sidebar
      var i = inside ? Math.pow(Math.max(0, 1 - Math.abs(x - lineX) / reach), 1.6) : 0;
      edge.style.setProperty('--edge-y', (y - r.top).toFixed(1) + 'px');
      edge.style.setProperty('--edge-i', i.toFixed(3));
    };
    var on = function (e) { x = e.clientX; y = e.clientY; inside = true; if (!frame) frame = requestAnimationFrame(paint); };
    var off = function () { inside = false; if (!frame) frame = requestAnimationFrame(paint); };
    window.addEventListener('pointermove', on, { passive: true });
    document.documentElement.addEventListener('mouseleave', off);
    window.addEventListener('blur', off);
    edge._hmEdge = { destroy: function () {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', on);
      document.documentElement.removeEventListener('mouseleave', off);
      window.removeEventListener('blur', off);
      edge._hmEdge = null;
    } };
    return edge._hmEdge;
  };

  /* ── toolbar rim ── */
  H.rim = function (el, side) {
    if (!el) return null;
    var r = el.querySelector(':scope > .hm7-rim');
    if (!r) { r = document.createElement('span'); r.className = 'hm7-rim'; r.setAttribute('aria-hidden', 'true'); el.appendChild(r); }
    r.classList.toggle('hm7-rim--bottom', side === 'bottom');
    return r;
  };

  /* ── field motion ── */
  var FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]):not([type=range]):not([type=color]), textarea';
  var K = 420, C = 17;  // under-damped on purpose: it rings once or twice
  var springs = new WeakMap();
  function spring(el) {
    var s = springs.get(el);
    if (!s) { s = { x: 1, y: 1, vx: 0, vy: 0, tx: 1, ty: 1, raf: 0, last: 0 }; springs.set(el, s); }
    return s;
  }
  function run(el) {
    var s = spring(el);
    if (s.raf) return;
    s.last = performance.now();
    var step = function (t) {
      var dt = Math.min(0.032, (t - s.last) / 1000);
      s.last = t;
      for (var i = 0; i < 4; i++) {
        var h = dt / 4;
        s.vx += (K * (s.tx - s.x) - C * s.vx) * h; s.x += s.vx * h;
        s.vy += (K * (s.ty - s.y) - C * s.vy) * h; s.y += s.vy * h;
      }
      if (Math.abs(s.x - s.tx) < 5e-4 && Math.abs(s.y - s.ty) < 5e-4 && Math.abs(s.vx) + Math.abs(s.vy) < 2e-3) {
        s.x = s.tx; s.y = s.ty; s.vx = s.vy = 0; s.raf = 0;
        el.style.transform = s.tx === 1 && s.ty === 1 ? '' : 'scale(' + s.x + ', ' + s.y + ')';
        return;
      }
      el.style.transform = 'scale(' + s.x.toFixed(4) + ', ' + s.y.toFixed(4) + ')';
      s.raf = requestAnimationFrame(step);
    };
    s.raf = requestAnimationFrame(step);
  }
  function kick(el, vx, vy, rest) {
    if (RM.matches) return;
    var s = spring(el);
    s.vx += vx; s.vy += vy;
    if (rest !== undefined) { s.tx = rest; s.ty = rest; }
    run(el);
  }

  var mirror = null, slime = null, fade = 0;
  function caret(inp) {
    if (!mirror) {
      mirror = document.createElement('div'); mirror.setAttribute('aria-hidden', 'true');
      mirror.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;white-space:pre-wrap;word-wrap:break-word;overflow:hidden;z-index:-1;top:0;left:0';
      document.body.appendChild(mirror);
    }
    var cs = getComputedStyle(inp);
    ['font', 'letterSpacing', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'direction', 'textAlign', 'boxSizing', 'wordBreak']
      .forEach(function (p) { mirror.style[p] = cs[p]; });
    var r = inp.getBoundingClientRect();
    mirror.style.width = r.width + 'px'; mirror.style.height = r.height + 'px'; mirror.style.top = r.top + 'px'; mirror.style.left = r.left + 'px';
    mirror.style.whiteSpace = inp.tagName === 'INPUT' ? 'pre' : 'pre-wrap';
    var value = inp.type === 'password' ? new Array(inp.value.length + 1).join('•') : inp.value;
    var cur = value.length;
    try { if (inp.selectionStart !== null) cur = inp.selectionStart; } catch (e) { /* email/number inputs */ }
    mirror.textContent = value.slice(0, cur);
    var mark = document.createElement('span'); mark.style.cssText = 'display:inline-block;width:1px;height:1em;vertical-align:text-bottom';
    mirror.appendChild(mark); mirror.appendChild(document.createTextNode(value.slice(cur)));
    var m = mark.getBoundingClientRect();
    return { x: Math.max(r.left + 8, Math.min(r.right - 8, m.left - inp.scrollLeft)), y: Math.max(r.top + 4, Math.min(r.bottom - 4, m.top + m.height / 2)) };
  }
  function flash(inp) {
    var r = inp.getBoundingClientRect();
    if (!r.width) return;
    var at = caret(inp);
    if (!slime) { slime = document.createElement('div'); slime.className = 'hm7-field-slime'; slime.setAttribute('aria-hidden', 'true'); document.body.appendChild(slime); }
    var g = slime;
    g.style.left = r.left + 'px'; g.style.top = r.top + 'px'; g.style.width = r.width + 'px'; g.style.height = r.height + 'px';
    g.style.borderRadius = getComputedStyle(inp).borderRadius;
    g.style.transition = 'opacity .04s';
    g.style.setProperty('--sx', (at.x - r.left).toFixed(1) + 'px');
    g.style.setProperty('--sy', (at.y - r.top).toFixed(1) + 'px');
    g.style.opacity = '.85';
    clearTimeout(fade);
    fade = setTimeout(function () { g.style.transition = 'opacity .5s cubic-bezier(.22,1,.36,1)'; g.style.opacity = '0'; }, 140);
  }
  function fieldOf(root, t) {
    return t && t.matches && t.matches(FIELD) && !t.disabled && !t.readOnly && root.contains(t) ? t : null;
  }
  H.fieldMotion = function (root) {
    root = root || document;
    if (root._hmField) return root._hmField;
    var on = function (type, fn, opt) { root.addEventListener(type, fn, opt); return function () { root.removeEventListener(type, fn, opt); }; };
    var offs = [
      on('focusin', function (e) { var f = fieldOf(root, e.target); if (f) kick(f, 0.9, 0.9, 1.012); }),
      on('focusout', function (e) { var f = fieldOf(root, e.target); if (f) kick(f, -0.5, -0.5, 1); }),
      on('input', function (e) {
        var f = fieldOf(root, e.target); if (!f) return;
        var del = e.inputType && e.inputType.indexOf('delete') === 0;
        kick(f, del ? -0.55 : 0.55, del ? 0.7 : -0.7);  // typing stretches sideways, deleting the opposite
        if (f.value.length > 0 && !RM.matches) flash(f);
      }),
      on('pointerdown', function (e) { var f = fieldOf(root, e.target); if (f && document.activeElement !== f) kick(f, -0.9, -0.9); }, { passive: true }),
      on('pointerover', function (e) { if (e.pointerType !== 'mouse') return; var f = fieldOf(root, e.target); if (f && document.activeElement !== f) kick(f, 0.35, 0.35); }, { passive: true })
    ];
    var hide = function () { if (slime) { slime.style.transition = 'none'; slime.style.opacity = '0'; } };
    window.addEventListener('scroll', hide, { passive: true, capture: true });
    root._hmField = { destroy: function () { offs.forEach(function (f) { f(); }); window.removeEventListener('scroll', hide, true); root._hmField = null; } };
    return root._hmField;
  };
})();

/* HM7 1.3 — progressive blur.
 *   HM7.progressiveBlur(host, 'top' | 'bottom')  stacks six backdrop layers whose blur doubles toward the edge
 *   (0.5 → 16px), each masked to its band, plus a page-coloured tint, so content dissolves gradually under a
 *   header ('top', inside the header, reaching 26px past it) or a bottom dock ('bottom': pass document.body,
 *   a fixed band behind the dock). Returns the .hm7-pblur element; calling again returns the same one. */
(function () {
  'use strict';
  var H = window.HM7;
  if (!H) return;
  H.progressiveBlur = function (host, side) {
    if (!host) return null;
    side = side === 'bottom' ? 'bottom' : 'top';
    var el = host.querySelector(':scope > .hm7-pblur--' + side);
    if (el) return el;
    el = document.createElement('div');
    el.className = 'hm7-pblur hm7-pblur--' + side;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<i></i><i></i><i></i><i></i><i></i><i></i>';
    if (side === 'top') host.classList.add('hm7-pblur-host');
    host.insertBefore(el, host.firstChild);
    return el;
  };
})();
