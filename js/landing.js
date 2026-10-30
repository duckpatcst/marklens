/* MarkLens landing: the example paper, marked as you scroll.
   Every number on this part of the page is worked out here, from the same example paper and marked sheet the Analyzer
   loads (#demoPaper, #demoSheet), with the same parser (MarkLensParse) and the same maths (MarkLensInsights). Nothing
   is typed in by hand except the student's handwriting, which is example text and says so.

   Act 1 (pinned) is driven by its scroll progress p (the engine publishes it as --sc-p on the act):
     0.00-0.20  the unmarked sheet and the question
     0.07-0.38  the red pen marks each answer; the score adds up
     0.42-0.74  every lost mark lifts off the sheet and lands in its lesson   <- the peak
     0.76-1.00  what to fix first, and how far that gets you
   Under reduced motion nothing travels: marks and chips fade in place. */
(function () {
  'use strict';
  const P = window.MarkLensParse, I = window.MarkLensInsights, EX = window.MarkLensExams;
  const $ = (s, r = document) => r.querySelector(s);
  const land = $('.land');
  if (!land || !P || !I) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = v => (Math.round(v * 10) / 10).toString();
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const ease = t => 1 - Math.pow(1 - t, 3);
  const easeIO = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  /* ---------------------------------------------------------------- the data, worked out the Analyzer's way -- */
  const paper = P.parsePaper($('#demoPaper').textContent);
  const sheet = P.matchSheet(paper, P.parseSheet($('#demoSheet').textContent));
  const byQ = new Map(sheet.map(s => [String(s.q), s]));
  const rows = paper.map(p => {
    const s = byQ.get(String(p.q)) || { got: 0, remark: '' }, got = Math.min(s.got, p.max), remark = String(s.remark || '').trim();
    return { q: String(p.q), subject: p.subject, topic: p.topic, sub: p.sub || '', type: p.type, max: p.max, got, remark, cause: P.classifyCause(remark, p.max - got) };
  });
  const A = I.analyze(rows);
  const total = A.total, plan = A.plan.slice(0, 3), gain = plan.reduce((a, it) => a + it.gain, 0);
  const lost = rows.filter(r => r.got < r.max);

  // what the student wrote (example handwriting, short)
  const WROTE = {
    1: '2x = 8,  x = 4', 2: '(x − 2)(x + 3)', 3: '(b)', 4: '∠A + ∠B + ∠C = …', 5: 'πr² = 154', 6: 'a² + b² = c,  c = 5',
    7: '½ + ½ = 1', 8: '', 9: '40 ÷ 4 = 10', 10: 'median 6.5, mode 4', 11: '3/8', 12: 'bars touch, …'
  };

  /* ------------------------------------------------------------------------------------- the sheet --------- */
  const svgTick = '<svg class="pen pen--tick" viewBox="0 0 34 26" aria-hidden="true"><path pathLength="1" d="M2.5 14.5 C6 17 8 20 10.5 23.5 C16 14 22 7.5 31.5 2.5"/></svg>';
  const svgCross = '<svg class="pen pen--cross" viewBox="0 0 26 26" aria-hidden="true"><path pathLength="1" d="M3 3.5 C9 9 15 16 23 23"/><path pathLength="1" d="M22.5 3 C15 10 9 16 3.5 23"/></svg>';
  const list = $('#mkRows');
  list.innerHTML = rows.map(r => {
    const full = r.got >= r.max, zero = r.got === 0;
    const mark = full ? svgTick : `<span class="ink-red r__num">${fmt(r.got)}<small>/${fmt(r.max)}</small></span>`;
    const note = full ? '' : esc(r.remark.replace(/\s+while\s+.*/i, '').replace(/,.*$/, ''));
    return `<li class="r${full ? ' r--full' : ''}${zero ? ' r--zero' : ''}" data-q="${esc(r.q)}">
      <span class="r__n ink">${esc(r.q)}.</span>
      <span class="r__a ink">${esc(WROTE[r.q] ?? '')}${zero ? svgCross : ''}</span>
      <span class="r__note ink-red">${note}</span>
      <span class="r__mark">${mark}</span>
    </li>`;
  }).join('');
  $('#mkMax').textContent = fmt(total.max);
  $('#sheetFig').setAttribute('aria-label', `Example answer sheet, marked by the teacher: ${fmt(total.got)} out of ${fmt(total.max)}`);

  /* ------------------------------------------------------------------------------------- the panel --------- */
  for (const el of document.querySelectorAll('[data-mk="lost"]')) el.textContent = fmt(total.lost);
  for (const el of document.querySelectorAll('[data-mk="max"]')) el.textContent = fmt(total.max);
  for (const el of document.querySelectorAll('[data-mk="got"]')) el.textContent = fmt(total.got);
  for (const el of document.querySelectorAll('[data-mk="n"]')) el.textContent = rows.length;
  for (const el of document.querySelectorAll('[data-mk="gain"]')) el.textContent = fmt(gain);
  for (const el of document.querySelectorAll('[data-mk="reach"]')) el.textContent = fmt(total.got + gain);
  for (const el of document.querySelectorAll('[data-mk="subject"]')) el.textContent = rows[0].subject || 'Maths';

  // lessons (the paper's section headings), in paper order, with the marks each one lost
  const bins = [];
  for (const r of rows) {
    let b = bins.find(x => x.name === r.topic);
    if (!b) bins.push(b = { name: r.topic, max: 0, lost: 0, qs: [] });
    b.max += r.max; if (r.got < r.max) { b.lost += r.max - r.got; b.qs.push(r.q); }
  }
  const binMax = Math.max(...bins.map(b => b.lost), 1);
  $('#mkBins').innerHTML = bins.map((b, i) => `<li class="bin" data-bin="${i}">
      <span class="bin__name">${esc(b.name)}</span>
      <span class="bin__qs mono">${b.qs.length ? b.qs.map(q => 'Q' + esc(q)).join(' ') : 'nothing lost'}</span>
      <span class="bin__dock"></span>
      <b class="bin__tot mono"><span>0</span><small> of ${fmt(b.max)}</small></b>
      <i class="bin__bar"><i style="--w:${(b.lost / binMax).toFixed(3)}"></i></i>
    </li>`).join('');

  $('#mkPlan').innerHTML = plan.map(it => `<li>
      <span class="pl__t"><b>${esc(it.title)}</b><small>${it.kind === 'habit' ? 'Exam habit' : 'Study'} · ${esc(it.qs.map(q => 'Q' + q).join(', '))} · about ${hours(it.hours)}</small></span>
      <em class="mono">+${fmt(it.gain)}</em>
    </li>`).join('');
  function hours(h){ return h < 1 ? Math.round(h * 60) + ' min' : (h % 1 ? fmt(h) : h) + ' h'; }
  $('.reach__got').style.setProperty('--w', (total.got / total.max).toFixed(4));
  $('.reach__gain').style.setProperty('--x', (total.got / total.max).toFixed(4));
  $('.reach__gain').style.setProperty('--w', (gain / total.max).toFixed(4));

  // the chips: one per question that lost marks, from its red mark on the sheet to its lesson's row
  const chipLayer = $('#mkChips');
  chipLayer.innerHTML = lost.map(r => `<span class="chip ink-red" data-q="${esc(r.q)}">−${fmt(r.max - r.got)}<small>Q${esc(r.q)}</small></span>`).join('');
  const chips = [...chipLayer.children].map((el, i) => {
    const r = lost[i], b = bins.findIndex(x => x.name === r.topic);
    return { el, r, bin: b, slot: bins[b].qs.indexOf(r.q), lost: r.max - r.got };
  });

  /* ------------------------------------------------------------------------ act 1: driven by --sc-p -------- */
  const act = $('#act-mark'), stage = $('.mk', act);
  const rowEls = [...list.children];
  const binEls = [...$('#mkBins').children];
  const N = rows.length, M0 = 0.07, M1 = 0.355, step = (M1 - M0) / N, DUR = 0.05;
  const F0 = 0.42, FSTEP = Math.min(0.04, 0.2 / Math.max(1, chips.length - 1)), FDUR = 0.11;
  let geo = null, lastP = -1;

  // positions inside the stage, from layout (offset* ignores transforms, so a cue mid-rise does not move a target)
  const offsetIn = (el, root) => { let x = 0, y = 0; while (el && el !== root) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; } return { x, y }; };
  function measure(){
    const cw = chips[0] ? chips[0].el.offsetWidth : 0, ch = chips[0] ? chips[0].el.offsetHeight : 0;
    geo = chips.map(c => {
      const row = rowEls[rows.indexOf(c.r)], mark = $('.r__mark', row) || row, s = offsetIn(mark, stage);
      const dock = $('.bin__dock', binEls[c.bin]), d = offsetIn(dock, stage);
      return {
        sx: s.x + mark.offsetWidth / 2 - cw / 2, sy: s.y + mark.offsetHeight / 2 - ch / 2,
        dx: d.x + c.slot * (cw * 0.86 + 4), dy: d.y + (dock.offsetHeight - ch * 0.86) / 2 - ch * 0.07
      };
    });
    lastP = -1;
  }

  function frame(){
    const p = parseFloat(act.style.getPropertyValue('--sc-p')) || 0;
    if (Math.abs(p - lastP) < 0.0004 || !geo) return;
    lastP = p;

    // the red pen, one answer at a time
    let soFar = 0, cur = -1;
    rowEls.forEach((el, i) => {
      const t = clamp01((p - (M0 + i * step)) / DUR);
      el.style.setProperty('--t', t.toFixed(3));
      el.classList.toggle('is-marked', t > 0);
      if (t > 0) cur = i;
      if (t >= 0.6) soFar += rows[i].got;
    });
    $('#mkTotal').textContent = fmt(soFar);
    stage.style.setProperty('--ring', clamp01((p - 0.345) / 0.05).toFixed(3));
    if (cur >= 0) {
      const r = rows[cur];
      $('#mkQ').textContent = 'Q' + r.q;
      $('#mkLine').textContent = `${fmt(r.got)} of ${fmt(r.max)}` + (r.got < r.max && r.remark ? ` · ${r.remark}` : r.got >= r.max ? ' · full marks' : '');
      $('#mkSoFar').textContent = fmt(soFar);
    }

    // the peak: each lost mark lifts off the sheet and lands in its lesson
    const landed = bins.map(() => 0);
    const fade = 1 - clamp01((p - 0.745) / 0.05);
    chips.forEach((c, i) => {
      const g = geo[i], t = clamp01((p - (F0 + i * FSTEP)) / FDUR);
      if (t <= 0 || fade <= 0) { c.el.style.opacity = '0'; return; }
      if (t >= 1) landed[c.bin] += c.lost;
      if (reduce) {
        c.el.style.transform = `translate3d(${g.dx}px,${g.dy}px,0) scale(.86)`;
        c.el.style.opacity = (clamp01(t * 3) * fade).toFixed(3);
        return;
      }
      const e = easeIO(t), x = g.sx + (g.dx - g.sx) * e, dist = Math.hypot(g.dx - g.sx, g.dy - g.sy);
      const y = g.sy + (g.dy - g.sy) * e - Math.sin(Math.PI * e) * Math.min(140, dist * 0.28);
      const rot = (1 - e) * (i % 2 ? 7 : -6) + Math.sin(Math.PI * e) * (i % 2 ? -10 : 9), sc = 1 + Math.sin(Math.PI * e) * 0.22 - e * 0.14;
      c.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${rot.toFixed(2)}deg) scale(${sc.toFixed(3)})`;
      c.el.style.opacity = (clamp01(t * 6) * fade).toFixed(3);
      c.el.classList.toggle('is-flying', t > 0 && t < 1);
    });
    binEls.forEach((el, i) => {
      el.querySelector('.bin__tot span').textContent = landed[i] ? '−' + fmt(landed[i]) : '0';
      el.style.setProperty('--fill', (landed[i] / binMax).toFixed(3));
      el.classList.toggle('has-loss', landed[i] > 0);
    });

    // what to fix first
    const d = ease(clamp01((p - 0.8) / 0.14));
    stage.style.setProperty('--plan', d.toFixed(3));
    $('#mkReachNum').textContent = fmt(total.got + gain * d);
  }

  /* --------------------------------------------------------------------------- act 2: the exams rail ------- */
  if (EX && $('#exRail')) {
    const pick = ['cbse', 'icse', 'state', 'neet', 'jee-main', 'jee-adv', 'cuet', 'cet', 'ssc', 'bank', 'upsc', 'gate', 'university'];
    const exact = v => String(+v), sign = v => (v > 0 ? '−' : '') + exact(v);
    const cards = pick.map(id => EX.get ? EX.get(id) : (EX.EXAMS || EX.list || []).find(e => e.id === id)).filter(Boolean);
    $('#exRail').insertAdjacentHTML('beforeend', cards.map(e => {
      const omr = e.format === 'omr';
      const big = omr ? `<span class="ex__big mono">+${exact(e.right)} <span class="ex__neg">${e.wrong ? sign(e.wrong) : '0'}</span></span><span class="ex__lab">right · wrong</span>`
        : `<span class="ex__big mono">${e.pass}%</span><span class="ex__lab">pass mark</span>`;
      const facts = [e.questions ? e.questions + ' questions' : '', e.minutes ? e.minutes / 60 + (e.minutes === 60 ? ' hour' : ' hours') : '', e.sections ? e.sections.map(s => s[0]).join(' · ') : ''].filter(Boolean).join(' · ');
      return `<article class="ex__card${omr ? ' ex__card--omr' : ''}">
        <span class="ex__group mono">${esc(e.group)}</span>
        <h3>${esc(e.name)}</h3>
        <div class="ex__scheme">${big}</div>
        <p>${esc(e.about || '')}</p>
        ${facts ? `<p class="ex__facts mono">${esc(facts)}</p>` : ''}
      </article>`;
    }).join(''));
  }

  /* ----------------------------------------------------------------- the close: an actual exam picker ------ */
  const startSel = $('#startExam'), appSel = $('#exam');
  if (startSel && appSel) {
    startSel.innerHTML = appSel.innerHTML;
    startSel.value = appSel.value;
    $('#startGo').addEventListener('click', () => {
      if (appSel.value !== startSel.value) { appSel.value = startSel.value; appSel.dispatchEvent(new Event('change', { bubbles: true })); }
      const to = $('#analyze');
      to.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      setTimeout(() => appSel.focus({ preventScroll: true }), reduce ? 0 : 700);
    });
  }

  /* ------------------------------------------------------------------------------------ mount ------------- */
  window.ScrollCraft.mount(land);
  const remeasure = () => { measure(); frame(); };
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(remeasure);
  addEventListener('resize', () => requestAnimationFrame(remeasure));
  measure();
  (function loop(){ frame(); requestAnimationFrame(loop); })();
})();
