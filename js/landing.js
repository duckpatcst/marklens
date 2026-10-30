/* MarkLens landing · v2.
   Every number on the front of the page is worked out here, from the same example paper and marked sheet the Analyzer
   loads (#demoPaper, #demoSheet), with the same parser (MarkLensParse) and maths (MarkLensInsights). Only the student's
   handwriting is example text.

   On load the teacher's pen marks the sheet by itself (about two seconds). One scroll then does the rest: the first
   part of act 1 (scroll progress p, published by the engine as --sc-p) lifts the headline away and raises the window;
   past p = 0.32 the lost marks fly into their lessons on their own clock (1.5 s, so it is smooth however the page is
   scrolled), and past p = 0.7 the plan appears. Scrolling back plays it in reverse.
   Performance: everything that moves is a transform or an opacity on a layer drawn once. Nothing is blurred live.
   Smooth scrolling: Lenis (wheel only; touch stays native). Reduced motion: no smoothing, nothing travels. */
(function () {
  'use strict';
  const P = window.MarkLensParse, I = window.MarkLensInsights, EX = window.MarkLensExams;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const land = $('.land');
  if (!land || !P || !I) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = v => (Math.round(v * 10) / 10).toString();
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const ease = t => 1 - Math.pow(1 - t, 3);
  const easeIO = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  /* ------------------------------------------------------------- the data, worked out the Analyzer's way -- */
  const paper = P.parsePaper($('#demoPaper').textContent);
  const sheet = P.matchSheet(paper, P.parseSheet($('#demoSheet').textContent));
  const byQ = new Map(sheet.map(s => [String(s.q), s]));
  const rows = paper.map(p => {
    const s = byQ.get(String(p.q)) || { got: 0, remark: '' }, got = Math.min(s.got, p.max), remark = String(s.remark || '').trim();
    return { q: String(p.q), subject: p.subject, topic: p.topic, sub: p.sub || '', type: p.type, max: p.max, got, remark, cause: P.classifyCause(remark, p.max - got) };
  });
  const A = I.analyze(rows), total = A.total, plan = A.plan.slice(0, 3), gain = plan.reduce((a, it) => a + it.gain, 0);
  const lost = rows.filter(r => r.got < r.max);
  const WROTE = { 1: '2x = 8,  x = 4', 2: '(x − 2)(x + 3)', 3: '(b)', 4: '∠A + ∠B + ∠C = …', 5: 'πr² = 154', 6: 'a² + b² = c,  c = 5',
    7: '½ + ½ = 1', 8: '', 9: '40 ÷ 4 = 10', 10: 'median 6.5, mode 4', 11: '3/8', 12: 'bars touch, …' };

  /* ------------------------------------------------------------------------------------ the sheet -------- */
  const svgTick = '<svg class="pen pen--tick" viewBox="0 0 34 26" aria-hidden="true"><path pathLength="1" d="M2.5 14.5 C6 17 8 20 10.5 23.5 C16 14 22 7.5 31.5 2.5"/></svg>';
  const svgCross = '<svg class="pen pen--cross" viewBox="0 0 26 26" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M3 3.5 C9 9 15 16 23 23"/><path pathLength="1" d="M22.5 3 C15 10 9 16 3.5 23"/></svg>';
  const list = $('#mkRows');
  list.innerHTML = rows.map(r => {
    const full = r.got >= r.max, zero = r.got === 0;
    const mark = full ? svgTick : `<span class="ink-red r__num">${fmt(r.got)}<small>/${fmt(r.max)}</small></span>`;
    const note = full ? '' : esc(r.remark.replace(/\s+while\s+.*/i, '').replace(/,.*$/, ''));
    return `<li class="r${zero ? ' r--zero' : ''}"><span class="r__n ink">${esc(r.q)}.</span><span class="r__a ink">${esc(WROTE[r.q] ?? '')}${zero ? svgCross : ''}</span><span class="r__note ink-red">${note}</span><span class="r__mark">${mark}</span></li>`;
  }).join('');
  $('#mkMax').textContent = fmt(total.max);
  $('#sheetFig').setAttribute('aria-label', `Example answer sheet, marked by the teacher: ${fmt(total.got)} out of ${fmt(total.max)}`);
  const put = (k, v) => $$(`[data-mk="${k}"]`).forEach(el => { el.textContent = v; });
  put('lost', fmt(total.lost)); put('max', fmt(total.max)); put('got', fmt(total.got)); put('subject', rows[0].subject || 'Maths');

  // lessons (the paper's section headings), in paper order
  const bins = [];
  for (const r of rows) {
    let b = bins.find(x => x.name === r.topic);
    if (!b) bins.push(b = { name: r.topic, max: 0, lost: 0, qs: [] });
    b.max += r.max; if (r.got < r.max) { b.lost += r.max - r.got; b.qs.push(r.q); }
  }
  const binMax = Math.max(...bins.map(b => b.lost), 1);
  $('#mkBins').innerHTML = bins.map(b => `<li class="bin"><span class="bin__name">${esc(b.name)}</span><span class="bin__dock"></span><b class="bin__tot"><span>0</span><small> of ${fmt(b.max)}</small></b><i class="bin__bar"><i></i></i></li>`).join('');
  const hours = h => h < 1 ? Math.round(h * 60) + ' min' : (h % 1 ? fmt(h) : h) + ' h';
  $('#mkPlan').innerHTML = plan.map(it => `<li><span class="pl__t"><b>${esc(it.title)}</b><small>${it.kind === 'habit' ? 'Exam habit' : 'Study'} · ${esc(it.qs.map(q => 'Q' + q).join(', '))} · about ${hours(it.hours)}</small></span><em>+${fmt(it.gain)}</em></li>`).join('');
  $('.reach__got').style.setProperty('--w', (total.got / total.max).toFixed(4));
  $('.reach__gain').style.setProperty('--x', (total.got / total.max).toFixed(4));
  $('.reach__gain').style.setProperty('--w', (gain / total.max).toFixed(4));

  const chipLayer = $('#mkChips');
  chipLayer.innerHTML = lost.map(r => `<span class="chip ink-red">−${fmt(r.max - r.got)}<small>Q${esc(r.q)}</small></span>`).join('');
  const chips = [...chipLayer.children].map((el, i) => {
    const r = lost[i], b = bins.findIndex(x => x.name === r.topic);
    return { el, r, bin: b, slot: bins[b].qs.indexOf(r.q), lost: r.max - r.got };
  });

  /* ------------------------------------------------------------------------ act 1 ------------------------ */
  const act = $('#act-mark'), stage = $('.mk', act), win = $('#win'), hero = $('.hero', stage), mkp = $('#mkp');
  const rowEls = [...list.children], binEls = [...$('#mkBins').children];
  let geo = null, markT0 = 0, marked = reduce, markedAt = 0, lastNow = 0, lastR = -1, lastState = '', sortV = 0, planV = 0, drawn = -1;
  const ROW_MS = 150, ROW_DUR = 420, SORT_MS = 1500, PLAN_MS = 900;

  const offsetIn = (el, root) => { let x = 0, y = 0; while (el && el !== root) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; } return { x, y }; };
  function measure(){
    const drop = Math.max(0, hero.offsetTop + hero.offsetHeight + 26 - win.offsetTop);
    stage.style.setProperty('--drop', drop + 'px');
    const cw = chips[0] ? chips[0].el.offsetWidth : 0, ch = chips[0] ? chips[0].el.offsetHeight : 0;
    geo = chips.map(c => {
      const row = rowEls[rows.indexOf(c.r)], mark = $('.r__mark', row) || row, s = offsetIn(mark, stage);
      const dock = $('.bin__dock', binEls[c.bin]), d = offsetIn(dock, stage);
      return { sx: s.x + mark.offsetWidth / 2 - cw / 2, sy: s.y + mark.offsetHeight / 2 - ch / 2,
        dx: d.x + c.slot * (cw * 0.86 + 4), dy: d.y + (dock.offsetHeight - ch * 0.86) / 2 - ch * 0.07 };
    });
    drawn = -1;
  }

  // the pen: time-driven on load, so something is happening the moment the page opens
  function penTimes(now){
    let soFar = 0, cur = -1;
    rowEls.forEach((el, i) => {
      const t = marked ? 1 : markT0 ? clamp01((now - markT0 - i * ROW_MS) / ROW_DUR) : 0;
      el.style.setProperty('--t', t.toFixed(3));
      el.classList.toggle('is-marked', t > 0);
      if (t > 0) cur = i;
      if (t >= 0.6) soFar += rows[i].got;
    });
    const last = markT0 ? clamp01((now - markT0 - rowEls.length * ROW_MS - 120) / 380) : 0;
    stage.style.setProperty('--ring', (marked ? 1 : last).toFixed(3));
    if (!marked && markT0 && last >= 1) { marked = true; markedAt = now; }
    $('#mkSoFar').textContent = $('#mkTotal').textContent = fmt(marked ? total.got : soFar);
    if (marked) {
      $('#mkEyebrow').textContent = 'Marked';
      $('#mkLine').textContent = `${fmt(total.lost)} marks lost on ${lost.length} questions. Here's where they went, and how to get them back.`;
    } else if (cur >= 0) {
      const r = rows[cur];
      $('#mkLine').textContent = `Q${r.q} · ${fmt(r.got)} of ${fmt(r.max)}` + (r.got < r.max && r.remark ? ` · ${r.remark}` : ' · full marks');
    }
  }

  // the lost marks in flight, for sort progress s (0..1) and plan progress q (0..1)
  function drawChips(s, q){
    const n = chips.length, DUR = 0.42, STEP = n > 1 ? (1 - DUR) / (n - 1) : 0, fade = 1 - clamp01(q * 2.2);
    const landed = bins.map(() => 0);
    chips.forEach((c, i) => {
      const g = geo[i], t = clamp01((s - i * STEP) / DUR), el = c.el;
      if (t <= 0 || fade <= 0) { el.style.opacity = '0'; return; }
      if (t >= 1) landed[c.bin] += c.lost;
      if (reduce) { el.style.transform = `translate3d(${g.dx}px,${g.dy}px,0) scale(.86)`; el.style.opacity = (clamp01(t * 3) * fade).toFixed(3); return; }
      const e = easeIO(t), x = g.sx + (g.dx - g.sx) * e, dist = Math.hypot(g.dx - g.sx, g.dy - g.sy);
      const y = g.sy + (g.dy - g.sy) * e - Math.sin(Math.PI * e) * Math.min(150, dist * 0.3);
      const rot = (1 - e) * (i % 2 ? 7 : -6) + Math.sin(Math.PI * e) * (i % 2 ? -12 : 10), sc = 1 + Math.sin(Math.PI * e) * 0.25 - e * 0.14;
      el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${rot.toFixed(2)}deg) scale(${sc.toFixed(3)})`;
      el.style.opacity = (clamp01(t * 6) * fade).toFixed(3);
    });
    binEls.forEach((el, i) => {
      const txt = landed[i] ? '−' + fmt(landed[i]) : '0', tot = el.querySelector('.bin__tot span');
      if (tot.textContent !== txt) tot.textContent = txt;
      el.style.setProperty('--fill', (landed[i] / binMax).toFixed(3));
      el.classList.toggle('has-loss', landed[i] > 0);
    });
  }

  function frame(now){
    const dt = lastNow ? Math.min(64, now - lastNow) : 16; lastNow = now;
    const p = parseFloat(act.style.getPropertyValue('--sc-p')) || 0;
    if (!marked && p > 0.2) { marked = true; markedAt = now; }   // the reader scrolled on: finish the marking at once
    if (!marked || now - markedAt < 400) penTimes(now);

    // the window rises with the scroll: one transform
    const r = ease(clamp01(p / 0.3));
    if (Math.abs(r - lastR) > 0.0004) { stage.style.setProperty('--r', r.toFixed(4)); stage.dataset.hero = r > 0.62 ? 'off' : 'on'; lastR = r; }

    // then the sort and the plan play on their own clock, so one scroll is enough and it never stutters
    const sortWant = p > 0.32 ? 1 : 0, planWant = p > 0.7 && sortV >= 1 ? 1 : 0;
    if (sortV !== sortWant) sortV = sortWant ? Math.min(1, sortV + dt / SORT_MS) : Math.max(0, sortV - dt / (SORT_MS * 0.45));
    if (planV !== planWant) planV = planWant ? Math.min(1, planV + dt / PLAN_MS) : Math.max(0, planV - dt / (PLAN_MS * 0.6));
    if (reduce) { sortV = sortWant; planV = planWant; }
    const state = planV > 0.15 || (planWant && planV > 0) ? 'plan' : sortV > 0 ? 'sort' : 'read';
    if (state !== lastState) { mkp.dataset.state = state; lastState = state; }
    const key = sortV * 10 + planV;
    if (key !== drawn && geo) {
      drawChips(sortV, planV);
      const d = ease(planV);
      stage.style.setProperty('--plan', d.toFixed(3));
      $('#mkReachNum').textContent = fmt(total.got + gain * d);
      drawn = key;
    }
    const thinking = !marked || (sortV > 0 && sortV < 1);
    win.classList.toggle('is-thinking', thinking);
    win.classList.toggle('is-calm', !thinking && r > 0.5);
  }

  /* ------------------------------------------------------------------- the room: floaters, parallax ------ */
  const atmos = $('.atmos');
  (function floaters(){
    const box = $('#floaters'); if (!box) return;
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const lite = document.documentElement.classList.contains('lite'), n = innerWidth < 700 ? 6 : lite ? 8 : 12, out = [];
    const tick = '<svg class="tick" viewBox="0 0 34 26"><path d="M2.5 14.5 C6 17 8 20 10.5 23.5 C16 14 22 7.5 31.5 2.5"/></svg>';
    const cross = '<svg class="cross" viewBox="0 0 26 26"><path d="M3 3.5 C9 9 15 16 23 23"/><path d="M22.5 3 C15 10 9 16 3.5 23"/></svg>';
    const scrap = '<svg class="scrap" viewBox="0 0 30 22"><rect x="1" y="1" width="28" height="20" rx="1.5"/><path d="M4 8h22M4 13h22M4 18h14"/></svg>';
    for (let i = 0; i < n; i++) {
      const edge = innerWidth < 700 ? 0.1 : 0.3, side = i % 2 ? rnd() * edge : 1 - edge + rnd() * edge, kind = rnd(), z = 6 + rnd() * 26, s = 10 + (z / 32) * 22;
      out.push(`<span class="fl" style="--x:${(side * 100).toFixed(1)}%;--y:${(innerWidth < 700 ? (rnd() < .3 ? 2 + rnd() * 9 : 58 + rnd() * 36) : 6 + rnd() * 80).toFixed(1)}%;--z:${z.toFixed(1)};--s:${s.toFixed(0)}px;opacity:${(0.35 + z / 50).toFixed(2)}"><span style="--dur:${(6 + rnd() * 7).toFixed(1)}s;--del:-${(rnd() * 8).toFixed(1)}s;--dx:${(rnd() * 60 - 30).toFixed(0)}px;--dy:${(-20 - rnd() * 50).toFixed(0)}px;--r0:${(rnd() * 40 - 20).toFixed(0)}deg;--r1:${(rnd() * 80 - 40).toFixed(0)}deg">${kind < 0.5 ? tick : kind < 0.72 ? cross : scrap}</span></span>`);
    }
    box.innerHTML = out.join('');
  })();
  let mx = 0, my = 0, tmx = 0, tmy = 0, roomDirty = true, lastAtmos = -1;
  if (finePointer && !reduce) addEventListener('pointermove', e => { tmx = e.clientX / innerWidth * 2 - 1; tmy = e.clientY / innerHeight * 2 - 1; }, { passive: true });
  addEventListener('scroll', () => { roomDirty = true; }, { passive: true });
  const startSec = $('#start'), orb = $('.atmos__orb'), arches = $('.arches'), flock = $('#floaters');
  function room(){
    if (Math.abs(tmx - mx) > 0.002 || Math.abs(tmy - my) > 0.002) {
      mx += (tmx - mx) * 0.07; my += (tmy - my) * 0.07;
      orb.style.transform = `translate3d(${(mx * -22).toFixed(1)}px,${(my * -16).toFixed(1)}px,0)`;
      arches.style.transform = `translate3d(${(mx * -12).toFixed(1)}px,0,0)`;
      flock.style.transform = `translate3d(${(mx * 20).toFixed(1)}px,${(my * 12).toFixed(1)}px,0)`;
    }
    if (roomDirty) {
      roomDirty = false;
      const a = 1 - clamp01((scrollY + innerHeight - (startSec.offsetTop + startSec.offsetHeight)) / (innerHeight * 0.5));
      if (Math.abs(a - lastAtmos) > 0.01) { atmos.style.opacity = a.toFixed(2); atmos.style.visibility = a <= 0 ? 'hidden' : ''; lastAtmos = a; }
    }
  }

  /* --------------------------------------------------------------------------- act 2: the gallery -------- */
  const grid = $('#galGrid'), pills = $('#galPills');
  const PAL = {
    'School': ['#14245e', '#3b82f6', '#22d3ee', '#a78bfa'],
    'Entrance exams': ['#2e0d54', '#a855f7', '#ff47a6', '#3d63ff'],
    'Government jobs': ['#5a1a0b', '#ff8f3c', '#ff2d55', '#ffd60a'],
    'College': ['#063b30', '#10b981', '#00c8ff', '#a3e635']
  };
  const RULED = 'repeating-linear-gradient(transparent 0 22px,rgba(255,255,255,.4) 22px 23px)';
  const BUBBLES = 'radial-gradient(circle,rgba(255,255,255,.55) 0 4.5px,transparent 5.5px) 0 0/24px 24px';
  if (EX && grid) {
    const ids = ['cbse', 'icse', 'state', 'neet', 'jee-main', 'jee-adv', 'cuet', 'cet', 'ssc', 'upsc', 'gate', 'university'];
    const exams = ids.map(id => EX.get(id)).filter((e, i) => e && e.id === ids[i]);
    const exact = v => String(+v);
    grid.innerHTML = exams.map(e => {
      const omr = e.format === 'omr', [c0, c1, c2, c3] = PAL[e.group] || PAL.School;
      const scheme = omr ? (e.wrong ? `+${exact(e.right)} −${exact(e.wrong)}<small>right · wrong</small>` : `+${exact(e.right)}<small>no minus marks</small>`) : `${e.pass}%<small>pass mark</small>`;
      const facts = omr ? [`+${exact(e.right)} right`, e.wrong ? `−${exact(e.wrong)} wrong` : 'no minus marks', e.questions ? e.questions + ' questions' : ''].filter(Boolean).join(' · ')
        : String(e.about || '').split('. ')[0].replace(/\.$/, '');
      return `<a class="gc" href="#analyze" data-exam="${esc(e.id)}" data-group="${esc(e.group)}" style="--c0:${c0};--c1:${c1};--c2:${c2};--c3:${c3};--pattern:${omr ? BUBBLES : RULED}">
        <div class="gc__media" aria-hidden="true"><span class="gc__scheme">${scheme}</span></div>
        <div class="gc__cap"><b>${esc(e.name)}</b><span>${esc(facts)}</span><i aria-hidden="true">↘</i></div>
      </a>`;
    }).join('');
    const groups = ['All', ...new Set(exams.map(e => e.group))];
    pills.innerHTML = groups.map((g, i) => `<button type="button" class="pill" data-g="${esc(g)}" aria-pressed="${i ? 'false' : 'true'}">${esc(g === 'Entrance exams' ? 'Entrance' : g === 'Government jobs' ? 'Government' : g)}<sup>${g === 'All' ? exams.length : exams.filter(e => e.group === g).length}</sup></button>`).join('');

    // filtering, with the cards gliding to their new places (FLIP)
    pills.addEventListener('click', ev => {
      const b = ev.target.closest('.pill'); if (!b) return;
      $$('.pill', pills).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      const g = b.dataset.g, cards = $$('.gc', grid), before = new Map(cards.filter(c => !c.hidden).map(c => [c, c.getBoundingClientRect()]));
      cards.forEach(c => { c.hidden = !(g === 'All' || c.dataset.group === g); if (!c.hidden) c.classList.add('in'); });
      cards.filter(c => !c.hidden).forEach((c, i) => {
        const a = before.get(c), n = c.getBoundingClientRect();
        if (reduce || !c.animate) return;
        if (a) c.animate([{ transform: `translate(${a.left - n.left}px,${a.top - n.top}px)` }, { transform: 'none' }], { duration: 620, easing: 'cubic-bezier(.16,1,.3,1)' });
        else c.animate([{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: i * 30, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
      });
    });
    grid.addEventListener('click', ev => {
      const c = ev.target.closest('.gc'); if (!c) return;
      ev.preventDefault(); goAnalyze(c.dataset.exam);
    });
    // cards rise into place as they arrive
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      const i = $$('.gc', grid).filter(c => !c.hidden).indexOf(e.target), cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
      e.target.style.setProperty('--dl', ((i % cols) * 90) + 'ms');
      e.target.classList.add('in'); io.unobserve(e.target);
    }), { rootMargin: '0px 0px -8% 0px' });
    $$('.gc', grid).forEach(c => reduce ? c.classList.add('in') : io.observe(c));
  }

  /* ------------------------------------------------------------- the close: an actual exam picker -------- */
  const startSel = $('#startExam'), appSel = $('#exam');
  let lenis = null;
  function goAnalyze(id){
    if (appSel && id && appSel.value !== id) { appSel.value = id; appSel.dispatchEvent(new Event('change', { bubbles: true })); }
    if (startSel && id) startSel.value = id;
    // switching exams can change the Analyzer's height, so scroll once the new layout has settled
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const to = $('#analyze');
      if (lenis) lenis.scrollTo(to, { offset: -70, duration: 1.4, onComplete: () => lenis.scrollTo(to, { offset: -70, immediate: true }) });
      else to.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      setTimeout(() => appSel && appSel.focus({ preventScroll: true }), reduce ? 0 : 1450);
    }));
  }
  if (startSel && appSel) {
    startSel.innerHTML = appSel.innerHTML; startSel.value = appSel.value;
    $('#startGo').addEventListener('click', () => goAnalyze(startSel.value));
  }

  /* ------------------------------------------------------------------ smooth scroll: Lenis -------------- */
  if (!reduce && window.Lenis) {
    lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true, wheelMultiplier: 1 });
    // in-page links glide too
    document.addEventListener('click', ev => {
      const a = ev.target.closest('a[href^="#"]'); if (!a || a.closest('.gc')) return;
      const id = a.getAttribute('href'); if (id.length < 2) return;
      const t = document.querySelector(id); if (!t) return;
      ev.preventDefault();
      lenis.scrollTo(t, { offset: id === '#top' ? 0 : -70, duration: 1.3 });
      history.replaceState(null, '', id);
    });
  }

  /* ------------------------------------------------------------------------------------ mount ----------- */
  window.ScrollCraft.mount(land);
  const remeasure = () => { measure(); lastR = -1; };
  const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  ready.then(() => { remeasure(); setTimeout(() => { markT0 = performance.now(); }, 450); });
  let rz = 0; addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(remeasure); });
  measure();
  // one loop for the whole landing; it does almost nothing once the landing is off screen
  let onScreen = true;
  new IntersectionObserver(es => { onScreen = es[0].isIntersecting; }).observe(act);
  function loop(t){
    if (lenis) lenis.raf(t);
    room();
    if (onScreen) frame(t);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
