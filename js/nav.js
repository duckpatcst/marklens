/* MarkLens · top bar: the Dynamic Island (css/nav.css).
   - a light slides under the link you point at, and rests under the section you are reading
   - after a little scrolling the island turns compact: "You're on <section>" and a ring that fills as you read
   - while MarkLens is checking a paper (the Siri glow is on), the island says what it is doing
   - on phones the menu button opens the island into a menu; a link, a tap outside, scrolling or Esc closes it */
(function () {
  'use strict';
  const nav = document.getElementById('nav'); if (!nav) return;
  const root = document.documentElement;
  const ul = nav.querySelector('.isl__links'), lamp = nav.querySelector('.isl__lamp'), bar = nav.querySelector('.isl__bar');
  const links = [...ul.querySelectorAll('a')], sheetLinks = [...nav.querySelectorAll('.isl__sheet a[data-sec]')];
  const ring = nav.querySelector('.isl__pring .fg'), menu = nav.querySelector('.isl__menu');
  const liveSmall = nav.querySelector('.isl__live small'), liveB = nav.querySelector('.isl__live b');
  const RING = 56.55;

  // the sliding light
  let current = null, hovering = null;
  function lampTo(a){
    if (!a || getComputedStyle(ul).display === 'none') { lamp.classList.remove('on'); return; }
    lamp.style.width = a.offsetWidth + 'px'; lamp.style.transform = `translate3d(${a.offsetLeft}px,0,0)`;
    lamp.classList.add('on');
  }
  for (const a of links) {
    a.addEventListener('pointerenter', () => { hovering = a; lampTo(a); });
    a.addEventListener('focus', () => lampTo(a));
  }
  ul.addEventListener('pointerleave', () => { hovering = null; lampTo(current); });

  // the live label
  let place = 'Home', busy = false;
  const label = () => {
    const small = busy ? 'MarkLens' : 'You’re on', text = busy ? (busyText() || 'Working…') : place;
    if (liveSmall.textContent !== small) liveSmall.textContent = small;
    if (liveB.textContent !== text) liveB.textContent = text;
  };
  const busyText = () => { const l = document.querySelector('.siri__label'); return l && l.textContent.trim(); };

  // which section is on screen
  const secs = links.map(a => document.getElementById(a.dataset.sec)).filter(Boolean);
  const vis = new Set();
  const pick = () => {
    const best = secs.find(s => vis.has(s)) || null, id = best && best.id;
    current = links.find(a => a.dataset.sec === id) || null;
    for (const a of links) a.classList.toggle('is-on', a === current);
    for (const a of sheetLinks) a.classList.toggle('is-on', a.dataset.sec === id);
    place = current ? current.textContent : (scrollY < innerHeight * 0.4 ? 'Home' : 'Example paper');
    label();
    if (!hovering) lampTo(current);
  };
  const io = new IntersectionObserver(es => { for (const e of es) e.isIntersecting ? vis.add(e.target) : vis.delete(e.target); pick(); },
    { rootMargin: '-40% 0px -55% 0px' });
  secs.forEach(s => io.observe(s));

  // compact state and reading ring (one update per frame at most)
  let ticking = false;
  const onScroll = () => {
    ticking = false;
    const y = scrollY, max = Math.max(1, root.scrollHeight - innerHeight);
    root.classList.toggle('nav-scrolled', y > 40);
    ring.style.strokeDashoffset = (RING * (1 - Math.min(1, y / max))).toFixed(2);
    if (!current) { const p = y < innerHeight * 0.4 ? 'Home' : 'Example paper'; if (p !== place) { place = p; label(); } }
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener('resize', () => lampTo(hovering || current));
  bar.addEventListener('transitionend', e => { if (e.propertyName === 'width') lampTo(hovering || current); });
  onScroll();

  // open the compact island while it is pointed at (mouse) or tabbed into (keyboard); close it after a click,
  // when the page scrolls, or when focus leaves, even if the mouse is still resting on it
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  let over = false, armed = true;
  const peek = on => nav.classList.toggle('is-peek', on);
  bar.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { over = true; if (fine && armed) peek(true); } });
  bar.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && fine && !armed && (Math.abs(e.movementX) + Math.abs(e.movementY) > 3)) { armed = true; peek(true); } });
  bar.addEventListener('pointerleave', () => { over = false; armed = true; if (!nav.contains(document.activeElement) || !kbd) peek(false); });
  bar.addEventListener('click', e => { if (e.target.closest('a')) { armed = false; peek(false); e.target.closest('a').blur(); } });
  let kbd = false;
  addEventListener('keydown', e => { if (e.key === 'Tab') kbd = true; }, true);
  addEventListener('pointerdown', () => { kbd = false; }, true);
  nav.addEventListener('focusin', () => { if (kbd) peek(true); });
  nav.addEventListener('focusout', e => { if (!nav.contains(e.relatedTarget) && !over) peek(false); });
  let lastY = scrollY;
  addEventListener('scroll', () => { if (nav.classList.contains('is-peek') && Math.abs(scrollY - lastY) > 30 && !nav.contains(document.activeElement)) { armed = false; peek(false); } if (!nav.classList.contains('is-peek')) lastY = scrollY; }, { passive: true });
  bar.addEventListener('pointerenter', () => { lastY = scrollY; });

  // MarkLens is checking something (js/thinking.js sets .siri-on)
  new MutationObserver(() => {
    const on = root.classList.contains('siri-on');
    if (on !== busy) { busy = on; label(); }
  }).observe(root, { attributes: true, attributeFilter: ['class'] });
  setInterval(() => { if (busy) label(); }, 600);

  // phone menu
  let openedAt = 0;
  const setOpen = open => { root.classList.toggle('nav-open', open); menu.setAttribute('aria-expanded', String(open)); openedAt = scrollY; };
  menu.addEventListener('click', () => setOpen(!root.classList.contains('nav-open')));
  nav.querySelector('.isl__sheet').addEventListener('click', e => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('pointerdown', e => { if (root.classList.contains('nav-open') && !nav.contains(e.target)) setOpen(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
  addEventListener('scroll', () => { if (root.classList.contains('nav-open') && Math.abs(scrollY - openedAt) > 60) setOpen(false); }, { passive: true });
})();
