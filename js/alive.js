/* MarkLens · alive: small touches that make the page feel lived in. Front end only, no dependencies.
     1. Typewriter slogans in the hero headline (screen readers get the full headline from the hidden copy in the h1;
        the typed letters are aria-hidden). Pauses when the hero is off screen or the tab is hidden.
     2. A cursor bubble that follows the mouse, grows over things you can press, and pulses on click.
        Mouse and trackpad only, never on touch screens. Its loop stops the moment it catches up.
     3. Magnetic buttons ([data-magnetic]) that lean toward the pointer.
     4. Cards and tiles that tilt toward the pointer with a moving light sheen.
     5. Section headings that rise in word by word as they arrive.
   Everything moves with transform and opacity only. Reduced motion: no typing, no bubble, no tilt. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const lite = document.documentElement.classList.contains('lite');

  /* ------------------------------------------------------------------ 1. typewriter slogans -------------- */
  // [plain part, highlighted part]. The first one is in the HTML already, so the headline is never empty.
  const SLOGANS = [
    ['The future of learning is ', 'here.'],
    ['See where your ', 'marks went.'],
    ['Turn red ink into a ', 'study plan.'],
    ['Know exactly what to ', 'study next.'],
    ['Every lost mark, ', 'found.'],
    ['Win back the marks ', 'you lost.']
  ];
  const tw = $('.tw'), twA = $('.tw__a'), twB = $('.tw__b'), h1 = $('#heroTitle');
  if (tw && !reduce) {
    // keep the headline's height steady while it types: as tall as the tallest slogan at this width
    const fitHeight = () => {
      const probe = tw.cloneNode(true); probe.style.cssText = 'position:absolute;visibility:hidden;left:0;right:0;pointer-events:none';
      h1.appendChild(probe); let max = 0;
      for (const [a, b] of SLOGANS) { probe.querySelector('.tw__a').textContent = a; probe.querySelector('.tw__b').textContent = b; max = Math.max(max, probe.offsetHeight); }
      probe.remove(); tw.style.minHeight = max + 'px';
      dispatchEvent(new Event('marklens:layout'));   // the landing re-measures where the window rises from
    };
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(fitHeight);
    let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(fitHeight, 150); });

    let visible = true;
    new IntersectionObserver(es => { visible = es[0].isIntersecting && es[0].intersectionRatio > 0.2; }, { threshold: [0, 0.2, 1] }).observe(h1);
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    // typing pauses while the page is being scrolled, so it never competes with the scroll for a frame
    let lastScroll = 0; addEventListener('scroll', () => { lastScroll = performance.now(); }, { passive: true });
    const idle = () => performance.now() - lastScroll > 350;
    const hero = h1.closest('.mk');
    const waitShown = async () => { while (!visible || document.hidden || !idle() || (hero && hero.dataset.hero === 'off')) await sleep(250); };
    const show = (a, b) => { twA.textContent = a; twB.textContent = b; };
    // a human rhythm: quick letters, a little longer after spaces and punctuation
    const typeDelay = ch => (ch === ' ' ? 70 : /[,.]/.test(ch) ? 160 : 38) + Math.random() * 38;
    (async () => {
      let i = 0;
      await sleep(3200);
      for (;;) {
        await waitShown();
        tw.classList.add('is-typing');
        const [a0, b0] = SLOGANS[i], full0 = a0 + b0;
        for (let n = full0.length; n >= 0; n -= 2) { if (!idle()) await waitShown(); show(full0.slice(0, Math.min(n, a0.length)), n > a0.length ? b0.slice(0, n - a0.length) : ''); await sleep(16); }   // delete, fast
        i = (i + 1) % SLOGANS.length;
        const [a, b] = SLOGANS[i], full = a + b;
        await sleep(260);
        for (let n = 1; n <= full.length; n++) { if (!idle()) await waitShown(); show(full.slice(0, Math.min(n, a.length)), n > a.length ? b.slice(0, n - a.length) : ''); await sleep(typeDelay(full[n - 1])); }
        tw.classList.remove('is-typing');
        await sleep(2800);
      }
    })();
  }

  /* ------------------------------------------------------------------ 5. headings rise in word by word -- */
  const heads = reduce ? [] : $$('.gal__title, .bento__title, .start__card h2');
  for (const h of heads) {
    const words = h.textContent.trim().split(/\s+/);
    h.setAttribute('aria-label', h.textContent.trim());
    h.innerHTML = words.map((w, i) => `<span class="w" aria-hidden="true"><span style="--i:${i}">${w}</span></span>`).join(' ');
  }
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -12% 0px' });
  heads.forEach(h => io.observe(h));

  if (reduce || !fine) return;   // everything below needs a mouse or trackpad

  /* ------------------------------------------------------------------ 2. the cursor bubble -------------- */
  const ring = document.createElement('div'), dot = document.createElement('div');
  ring.className = 'cur-ring'; ring.innerHTML = '<i></i><span></span>'; dot.className = 'cur-dot';
  ring.setAttribute('aria-hidden', 'true'); dot.setAttribute('aria-hidden', 'true');
  document.body.append(ring, dot);
  const label = ring.querySelector('span');
  let tx = -100, ty = -100, rx = -100, ry = -100, dx = -100, dy = -100, raf = 0, shown = false;
  const PRESS = 'a, button, select, summary, label.btn, .gc, .pill, [role="button"], input[type="checkbox"], input[type="radio"]';
  const TEXT = 'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea, [contenteditable="true"]';
  function tick(){
    rx += (tx - rx) * 0.2; ry += (ty - ry) * 0.2;
    dx += (tx - dx) * 0.55; dy += (ty - dy) * 0.55;
    ring.style.transform = `translate3d(${rx.toFixed(1)}px,${ry.toFixed(1)}px,0)`;
    dot.style.transform = `translate3d(${dx.toFixed(1)}px,${dy.toFixed(1)}px,0)`;
    raf = Math.abs(tx - rx) + Math.abs(ty - ry) > 0.3 ? requestAnimationFrame(tick) : 0;   // stop once it has caught up
  }
  addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    tx = e.clientX; ty = e.clientY;
    if (!shown) { shown = true; rx = dx = tx; ry = dy = ty; document.documentElement.classList.add('has-cur'); }
    if (!raf) raf = requestAnimationFrame(tick);
  }, { passive: true });
  document.addEventListener('pointerleave', () => { shown = false; document.documentElement.classList.remove('has-cur'); });
  addEventListener('blur', () => { shown = false; document.documentElement.classList.remove('has-cur'); });
  document.addEventListener('pointerover', e => {
    const t = e.target instanceof Element ? e.target : null;
    const text = t && t.closest(TEXT), press = t && !text && t.closest(PRESS);
    ring.classList.toggle('is-text', !!text);
    ring.classList.toggle('is-press', !!press);
    const card = t && t.closest('.gc');
    ring.classList.toggle('is-label', !!card);
    label.textContent = card ? 'Open' : '';
  });
  addEventListener('pointerdown', () => { ring.classList.remove('is-click'); void ring.offsetWidth; ring.classList.add('is-click'); }, { passive: true });

  /* ------------------------------------------------------------------ 3. magnetic buttons --------------- */
  for (const el of $$('[data-magnetic]')) {
    let f = 0;
    el.addEventListener('pointermove', e => {
      if (f) return;
      f = requestAnimationFrame(() => {
        f = 0;
        const r = el.getBoundingClientRect(), x = (e.clientX - r.left - r.width / 2) / r.width, y = (e.clientY - r.top - r.height / 2) / r.height;
        el.style.transform = `translate3d(${(x * 10).toFixed(1)}px,${(y * 8).toFixed(1)}px,0)`;
      });
    });
    el.addEventListener('pointerleave', () => { cancelAnimationFrame(f); f = 0; el.style.transform = ''; });
  }

  /* ------------------------------------------------------------------ 4. tilt and sheen ----------------- */
  if (!lite) {
    let cur = null, frame = 0, last = null;
    const TILT = '.gc__media, .tile, .start__card';
    const apply = () => {
      frame = 0; if (!cur || !last) return;
      const r = cur.getBoundingClientRect(), px = (last.clientX - r.left) / r.width, py = (last.clientY - r.top) / r.height;
      const max = cur.classList.contains('start__card') ? 3 : cur.classList.contains('tile') ? 4 : 7;
      cur.style.setProperty('--rx', ((0.5 - py) * max).toFixed(2) + 'deg');
      cur.style.setProperty('--ry', ((px - 0.5) * max).toFixed(2) + 'deg');
      cur.style.setProperty('--px', (px * 100).toFixed(1) + '%');
      cur.style.setProperty('--py', (py * 100).toFixed(1) + '%');
    };
    document.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      const t = e.target instanceof Element ? e.target.closest(TILT) : null;
      if (t !== cur) { if (cur) cur.classList.remove('is-tilt'); cur = t; if (cur) cur.classList.add('is-tilt'); }
      last = e; if (cur && !frame) frame = requestAnimationFrame(apply);
    }, { passive: true });
  }

})();
