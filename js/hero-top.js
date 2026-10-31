/* MarkLens · hero top:
   the nav's "Analyze my paper" stays hidden while the hero's own button is on screen (no double button),
      and slides in once that button has scrolled away */
(function () {
  'use strict';
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
