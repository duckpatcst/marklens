/* MarkLens · idle hint. If someone lands and does nothing for a few seconds, a pill at the bottom invites them:
   "Scroll or move your mouse" on laptops, "Swipe up" on phones and tablets. Any scroll, swipe, key or mouse
   movement hides it at once; it can come back after another quiet spell, but only near the top of the page. */
(function () {
  'use strict';
  const ua = navigator.userAgent || '';
  const touch = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
    || !matchMedia('(hover: hover) and (pointer: fine)').matches;
  const FIRST = 3500, AGAIN = 7000;   // ms of stillness before it shows

  const el = document.createElement('div');
  el.className = 'ihint' + (touch ? ' is-touch' : '');
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="ihint__pill">
      <span class="ihint__ico" aria-hidden="true">${touch ? '<i class="ih-trail"></i><i class="ih-finger"></i>' : '<i class="ih-mouse"></i>'}</span>
      <span>${touch ? '<b>Swipe up</b> for the full experience' : '<b>Scroll</b> or move your mouse to explore'}</span>
      <span class="ihint__chev" aria-hidden="true"><i></i><i></i></span>
    </div>`;
  document.body.appendChild(el);

  let timer = 0, on = false, shownOnce = false, lastX = -1, lastY = -1;
  const nearTop = () => scrollY < innerHeight * 0.6;
  const arm = () => { clearTimeout(timer); timer = setTimeout(show, shownOnce ? AGAIN : FIRST); };
  function show(){
    if (!nearTop() || document.hidden) return arm();
    on = shownOnce = true; el.classList.add('is-on');
    const root = document.documentElement; root.classList.remove('ih-nudge'); void root.offsetWidth; root.classList.add('ih-nudge');
  }
  function wake(){ if (on) { on = false; el.classList.remove('is-on'); } arm(); }

  addEventListener('scroll', wake, { passive: true });
  addEventListener('wheel', wake, { passive: true });
  addEventListener('touchstart', wake, { passive: true });
  addEventListener('keydown', wake);
  addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    if (Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) > 6) { lastX = e.clientX; lastY = e.clientY; wake(); }
  }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) arm(); });
  arm();
})();
