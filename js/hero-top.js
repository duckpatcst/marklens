/* MarkLens · hero top. Two small jobs:
   1. the "New" mlchip above the headline cycles through what MarkLens can do; each line links to where it is shown
   2. the nav's "Analyze my paper" stays hidden while the hero's own button is on screen (no double button),
      and slides in once that button has scrolled away */
(function () {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 1. the mlchip
  const mlchip = document.getElementById('heroChip');
  const ITEMS = [
    ['Reads your teacher’s red-ink marks', '#how'],
    ['CBSE, NEET, JEE and 9 more exams', '#exams'],
    ['Turns lost marks into a study plan', '#how'],
    ['Your papers stay on your device', 'privacy.html']
  ];
  if (mlchip) {
    const txt = mlchip.querySelector('.mlchip__txt'), win = mlchip.querySelector('.mlchip__win');
    const dots = document.createElement('span'); dots.className = 'mlchip__dots'; dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = ITEMS.map((_, n) => `<i class="${n ? '' : 'on'}"></i>`).join('');
    mlchip.insertBefore(dots, mlchip.querySelector('.mlchip__go'));
    // the window is as wide as the longest line, so the mlchip never jumps in size
    const fit = () => { const p = txt.cloneNode(); p.style.cssText = 'position:absolute;visibility:hidden'; win.appendChild(p); let w = 0;
      for (const [t] of ITEMS) { p.textContent = t; w = Math.max(w, p.offsetWidth); } p.remove(); win.style.width = Math.ceil(w) + 'px'; };
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(fit);
    let i = 0, hover = false, seen = true;
    mlchip.addEventListener('pointerenter', () => { hover = true; });
    mlchip.addEventListener('pointerleave', () => { hover = false; });
    new IntersectionObserver(es => { seen = es[0].isIntersecting; }).observe(mlchip);
    if (!reduce) setInterval(() => {
      if (hover || !seen || document.hidden) return;
      i = (i + 1) % ITEMS.length;
      txt.classList.add('is-out');
      setTimeout(() => {
        txt.textContent = ITEMS[i][0]; mlchip.href = ITEMS[i][1];
        dots.querySelectorAll('i').forEach((d, n) => d.classList.toggle('on', n === i));
        txt.classList.remove('is-out'); txt.classList.add('is-in'); void txt.offsetWidth; txt.classList.remove('is-in');
      }, 380);
    }, 3800);
  }

  // 2. the nav button
  const heroCta = document.querySelector('.hero__cta'), navCta = document.querySelector('.nav-cta'), root = document.documentElement;
  if (heroCta && navCta) {
    // out = the hero's button has scrolled away, or the example window has risen over the hero and hidden it
    const stage = heroCta.closest('.mk');
    let gone = false, faded = false;
    const set = () => { const out = gone || faded; root.classList.toggle('cta-out', out); navCta.tabIndex = out ? 0 : -1; };
    new IntersectionObserver(es => { const e = es[0]; gone = !e.isIntersecting && e.boundingClientRect.top < innerHeight / 2; set(); },
      { rootMargin: '-64px 0px 0px 0px' }).observe(heroCta);
    if (stage) new MutationObserver(() => { faded = stage.dataset.hero === 'off'; set(); }).observe(stage, { attributes: true, attributeFilter: ['data-hero'] });
  } else if (navCta) navCta.tabIndex = 0;
})();
