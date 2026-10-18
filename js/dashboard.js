/* MarkLens dashboard: draws the analysis from insights.js as a marked script turned into a study plan.
   The score ruler fills once when the dashboard first comes into view; after that every edit glides the bars and
   numbers from their old values to the new ones. Status colours always carry a second cue (fill level, a cross,
   a dashed edge) and every number is also written out, so nothing depends on colour alone. */
(function () {
  'use strict';
  const I = window.MarkLensInsights, E = window.MarkLensExams;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = n => String(Math.round(n * 10) / 10);
  const signed = n => (n < 0 ? '−' : '') + fmt(Math.abs(n));
  const pct = (a, b) => b ? a / b * 100 : 0;
  const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
  const qName = q => /^\d/.test(String(q)) ? 'Q' + q : String(q);
  const qList = qs => { const a = qs.map(qName); return a.length <= 5 ? a.join(', ') : `${a.slice(0, 4).join(', ')} +${a.length - 4} more`; };
  const plus = n => (n < 0 ? '−' : '+') + String(Math.round(Math.abs(n) * 100) / 100);
  const clip = (t, n) => { t = String(t || ''); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; };
  const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : '';
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'source'; } };
  const hours = h => h < 1 ? `${Math.round(h * 60)} min` : `${String(h).replace('.5', '½').replace('.25', '¼').replace('.75', '¾')} h`;
  const still = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const lessonName = l => l === 'General' ? 'Other questions' : l;
  const PAPERS = 'marklens-papers';
  const LEVEL = { weak: 'Weak', shaky: 'Needs work', strong: 'Strong' };

  const SHORT = {
    'Careless / calculation': 'Five minutes of checking at the end wins most of them back.',
    'Units & signs': 'A units-and-signs check on every answer wins most of them back.',
    'Presentation': 'Labelled diagrams, the formula written first and underlined answers win most of them back.',
    'Time management': 'Timed practice papers, easy questions first, win many of them back.',
    'Bubbling error': 'One dark bubble per question, with changes rubbed out fully, wins them back.'
  };
  const STATUS = {
    full: 'Full marks', part: 'Part marks', zero: 'No marks', blank: 'Left blank', wrong: 'Wrong answer', multi: 'More than one bubble'
  };

  const picked = new Map();   // plan item id -> in the student's plan (default: the first three)
  const last = new Map();     // animation key -> value on screen
  const notes = { answers: '', topics: '' };   // progress lines for the AI buttons, kept across redraws
  let seen = false, io = null, root = null, st = null, an = null, showAll = false, showAllTopics = false, showAllAns = false, lastKey = null;
  const exam = () => (st && st.exam) || (E ? E.get('general') : { id: 'general' });

  const isPicked = (p, i) => picked.has(p.id) ? picked.get(p.id) : i < 3;
  const planned = () => an.plan.filter(isPicked);
  const reachNow = () => Math.min(an.total.max, an.total.got + planned().reduce((a, p) => a + p.gain, 0));

  /* ---------- pieces ---------- */

  function ruler(){
    const t = an.total, max = t.max, got = Math.max(0, t.got), reach = reachNow();
    const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500].find(s => max / s <= 8) || Math.ceil(max / 8);
    const minor = step % 5 === 0 ? step / 5 : step / 2;
    let ticks = '';
    for (let k = 0, v = 0; v < max - 1e-9; k++, v = k * minor) {   // the end of the ruler is always labelled with the maximum
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-9, nearEnd = (max - v) / max < 0.07;
      ticks += `<span class="tick${major ? ' major' : ''}" style="left:${pct(v, max)}%">${major && !nearEnd ? `<b>${fmt(v)}</b>` : ''}</span>`;
    }
    ticks += `<span class="tick major end" style="left:100%"><b>${fmt(max)}</b></span>`;
    const all = an.reachAll > reach + 0.05 ? `<span class="r-all" style="left:${pct(an.reachAll, max)}%" title="Fix everything: ${fmt(an.reachAll)}"></span>` : '';
    return `<div class="ruler" role="img" aria-label="Score ${fmt(t.got)} of ${fmt(max)}. With your plan, about ${fmt(reach)}.${all ? ` Fixing everything: about ${fmt(an.reachAll)}.` : ''}">
      <div class="ruler-track"><span class="r-got" data-w="${clamp(pct(got, max))}" data-key="r-got"></span><span class="r-reach${got > 0 ? ' gap' : ''}" data-w="${clamp(pct(reach - got, max))}" data-key="r-reach"></span></div>
      ${all}<div class="ruler-scale" aria-hidden="true">${ticks}</div>
    </div>
    <div class="r-legend" aria-hidden="true"><span><i class="lg-got"></i>Scored</span><span><i class="lg-reach"></i>Won back with your plan</span>${all ? `<span><i class="lg-all"></i>Fix everything: ${fmt(an.reachAll)}</span>` : ''}</div>`;
  }

  function lead(){
    const P = an.plan, t = an.total;
    if (!P.length) return `<p class="db-lead"><b>Nothing to win back here.</b> ${t.lost > 0 ? 'The few marks lost are too small to plan around.' : 'Full marks on every question.'}</p>`;
    const out = [], q = an.quick;
    if (q && q.gain >= 0.5) out.push(`<b>Fastest marks:</b> ${esc(q.title.toLowerCase().replace(/^./, c => c.toUpperCase()))} cost you ${fmt(q.lost)} marks in ${esc(qList(q.qs))}. ${esc(SHORT[q.cause] || '')} <span class="gain">+${fmt(q.gain)}</span> in about ${hours(q.hours)}.`);
    // the focus follows the study-time split below, so the two always agree
    const study = an.share.parts.filter(p => p.kind === 'study');
    if (an.share.by === 'subject' && study.length) {
      const s = study[0], ins = s.inner.slice(0, 2).map(x => x.name);
      out.push(`<b>Focus subject: ${esc(s.name)}.</b> Give it ${s.pct}% of your study time: <span class="gain">+${fmt(s.gain)}</span> marks to win back${ins.length ? ` in ${esc(ins.join(' and '))}` : ''}.`);
    } else {
      const ls = study.filter(p => !/other questions$/i.test(p.name)).slice(0, 2);
      if (ls.length) out.push(`<b>Focus ${ls.length > 1 ? 'lessons' : 'lesson'}: ${esc(ls.map(l => l.name).join(' and '))}.</b> ${ls.length > 1 ? 'They get' : 'It gets'} ${ls.reduce((a, l) => a + l.pct, 0)}% of your study time and ${ls.length > 1 ? 'hold' : 'holds'} <span class="gain">+${fmt(ls.reduce((a, l) => a + l.gain, 0))}</span> of the ${fmt(an.reachAll - Math.max(0, t.got))} marks within reach.`);
    }
    if (!out.length) out.push(`<b>Biggest win:</b> ${esc(P[0].title)}, <span class="gain">+${fmt(P[0].gain)}</span> in about ${hours(P[0].hours)}.`);
    const g = guessLine(); if (g) out.push(g);
    return out.map(x => `<p class="db-lead">${x}</p>`).join('');
  }

  // Negative marking: how sure to be before answering, and what this student's own attempts say
  function guessLine(){
    const sc = st.scheme;
    if (st.mode !== 'omr' || !sc || !(sc.wrong > 0) || !E) return '';
    const be = Math.round(E.breakEven(sc.right, sc.wrong) * 100), k = sc.options || 4;
    const g0 = E.guessValue(sc.right, sc.wrong, k, 0), g1 = E.guessValue(sc.right, sc.wrong, k, 1);
    const R = st.rows.filter(r => r.max > 0 && r.key !== 'any' && r.type !== 'Numerical');
    const tried = R.filter(r => r.marked && r.marked !== '–'), right = tried.filter(r => r.cause === 'None').length;
    const blanks = R.filter(r => !r.marked || r.marked === '–').length, pen = R.reduce((a, r) => a + Math.max(0, -r.got), 0), acc = tried.length ? right / tried.length : 0;
    let you = '';
    if (tried.length >= 5 && acc >= 0.75 && blanks >= 2) you = ` You were right on ${Math.round(acc * 100)}% of your attempts and left ${blanks} blank, so answering the ones where you can rule out an option should add marks.`;
    else if (tried.length >= 5 && acc < 0.5 && pen > 0) you = ` Wrong answers took away ${fmt(pen)} marks: answer only when you can rule out at least two options.`;
    return `<b>When to guess (+${fmt(sc.right)} / −${fmt(sc.wrong)}):</b> answer when you are at least ${be}% sure. A blind guess is worth ${plus(g0)} on average; ruling out one option makes it ${plus(g1)}.${you}`;
  }

  function stats(){
    const c = an.counts, t = an.total, R = st.rows.filter(r => r.max > 0);
    let s = [];
    if (st.mode === 'omr') {
      const tried = R.filter(r => r.marked && r.marked !== '–'), right = tried.filter(r => r.cause === 'None').length, pen = R.reduce((a, r) => a + Math.max(0, -r.got), 0);
      if (tried.length) s.push([`${Math.round(right / tried.length * 100)}%`, `Accuracy: ${right} of ${tried.length} attempted right`]);
      if (pen > 0) s.push([`−${fmt(pen)}`, `Negative marks from ${c.wrong + c.multi} wrong`]);
      else if (c.wrong) s.push([String(c.wrong), 'Wrong answers']);
      s.push([String(c.blank), c.blank === 1 ? 'Question left blank' : 'Questions left blank']);
      if (c.multi) s.push([String(c.multi), 'With more than one bubble']);
      if (c.part) s.push([String(c.part), 'Part marks (some options missed)']);
    } else {
      s.push([`−${fmt(Math.max(0, t.lost))}`, 'Marks lost']);
      s.push([`${c.full}/${c.n}`, 'Full marks']);
      if (c.part) s.push([String(c.part), 'Part marks']);
      if (c.zero + c.blank) s.push([String(c.zero + c.blank), c.blank ? 'No marks or left blank' : 'No marks']);
    }
    const ex = exam();
    if (ex.pass && an.subjects.length > 1) {
      const below = an.subjects.filter(x => x.pct < ex.pass);
      s.push([`${an.subjects.length - below.length}/${an.subjects.length}`, below.length ? `Subjects above the ${ex.pass}% pass mark` : `Subjects passed (${ex.pass}% needed)`]);
    }
    return `<div class="db-stats">${s.map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>`;
  }

  function hero(){
    const t = an.total, p = pct(t.got, t.max), reach = reachNow(), n = planned().length, ex = exam();
    const g = E ? E.grade(p, ex) : { stamp: '', title: '', pass: null };
    const passNote = g.pass === null || ex.grading === 'percent' ? '' : `<span class="db-pass ${g.pass ? 'ok' : 'no'}">${g.pass ? `Above the ${ex.pass}% pass mark` : `Below the ${ex.pass}% pass mark`}</span>`;
    return `<section class="panel db-hero" aria-label="Your score">
      <div class="db-nums">
        <div class="db-score">
          <div class="db-k">Your score${ex.id !== 'general' ? ` <span class="db-examname">${esc(ex.name)}</span>` : ''}</div>
          <div class="db-big" data-k="score" aria-label="Score ${fmt(t.got)} of ${fmt(t.max)}"><span data-n="${t.got}" data-key="n-got">${fmt(t.got)}</span><small>/ ${fmt(t.max)}</small></div>
          <div class="db-sub">${g.stamp ? `<span class="db-stamp${g.stamp.length > 3 ? ' word' : ''}" title="${esc(g.title)}" aria-label="${esc(g.title)}">${esc(g.stamp)}</span>` : ''}<span class="db-pct"><b data-n="${p}" data-key="n-pct" data-int="1">${Math.round(p)}</b>%</span>${passNote}</div>
        </div>
        <div class="db-reach">
          <div class="db-k">Within reach</div>
          <div class="db-big" data-k="reach" aria-live="polite"><span data-n="${reach}" data-key="n-reach">${fmt(reach)}</span><small>/ ${fmt(t.max)}</small></div>
          <div class="db-sub" data-k="reach-note">${n ? `<b class="gain">+${fmt(reach - t.got)}</b> marks if you work on the ${n === 1 ? 'one item' : n + ' items'} in your plan` : 'Add items from the plan below to see what you can win back'}</div>
        </div>
      </div>
      ${ruler()}
      ${lead()}
      ${stats()}
    </section>`;
  }

  function plan(){
    const P = an.plan;
    if (!P.length) return `<section class="panel db-plan"><h3>Where to focus</h3><p class="hint">No marks to win back on this paper.</p></section>`;
    const multi = an.subjects.length > 1, shown = showAll ? P : P.slice(0, 6), hintAt = P.findIndex(p => p.noLessons);   // the chapter tip once, not on every item
    const item = (p, i) => {
      const on = isPicked(p, i);
      return `<li class="fi${on ? ' on' : ''}" data-id="${esc(p.id)}">
        <span class="fi-n" aria-hidden="true">${i + 1}</span>
        <div class="fi-body">
          <div class="fi-top"><h4>${esc(p.title)}</h4><span class="fi-gain">+${fmt(p.gain)}<small> marks</small></span></div>
          <div class="fi-meta"><span class="fi-kind ${p.kind}">${p.kind === 'habit' ? 'Exam habit' : 'Study'}</span>${multi && p.subject && p.title !== p.subject ? `<span>${esc(p.subject)}</span>` : ''}${p.kind === 'habit' && p.where.length ? `<span>${esc(p.where.slice(0, 3).join(', '))}${p.where.length > 3 ? '…' : ''}</span>` : ''}<span>${esc(qList(p.qs))}</span><span>about ${hours(p.hours)}</span></div>
          <p>${esc(p.fix)}</p>
          ${i === hintAt && st.mode === 'omr' ? '<p class="hint fi-hint">Add lines like <span class="mono">Chapter: Optics</span> to the answer key to see which lessons these came from.</p>' : ''}
          <button type="button" class="fi-add" aria-pressed="${on}" aria-label="${on ? 'Remove' : 'Add'} ${esc(p.title)} ${on ? 'from' : 'to'} my plan">${on ? 'In my plan' : 'Add to my plan'}</button>
        </div></li>`;
    };
    return `<section class="panel db-plan">
      <h3>Where to focus</h3>
      <p class="hint">Ordered by marks won back for each hour of study. Gains are estimates of what a student typically wins back.</p>
      <ol class="focus">${shown.map(item).join('')}</ol>
      ${P.length > 6 ? `<button type="button" class="btn fi-more" data-more>${showAll ? 'Show fewer' : `Show all ${P.length}`}</button>` : ''}
    </section>`;
  }

  // a scored bar with the marks within reach hatched after it
  const mini = (got, max, gain, key) => `<span class="mr" aria-hidden="true"><span class="mr-got" data-w="${clamp(pct(Math.max(0, got), max))}" data-key="${esc(key)}-g"></span><span class="mr-rc${got > 0 ? ' gap' : ''}" data-w="${clamp(pct(gain, max))}" data-key="${esc(key)}-r"></span></span>`;

  function lessonRows(s, key, limit){
    const ls = s.lessons, rows = l => `<li><span class="ls-name">${esc(lessonName(l.name))}</span>${mini(l.got, l.max, l.gain, key + ':' + l.name)}<span class="ls-v">${Math.round(l.pct)}%</span></li>`;
    if (ls.length <= limit) return `<ul class="ls">${ls.map(rows).join('')}</ul>`;
    return `<ul class="ls">${ls.slice(0, limit).map(rows).join('')}</ul><details class="ls-more"><summary>All ${ls.length} lessons</summary><ul class="ls">${ls.slice(limit).map(rows).join('')}</ul></details>`;
  }

  // one subject: the topics panel already shows its lessons
  function subjects(){
    const S = an.subjects, ex = exam();
    if (S.length < 2) return '';
    return `<section class="panel db-subj"><h3>Subjects</h3><p class="hint">Most marks to win back first. Hatched: marks within reach.${ex.pass ? ` Pass mark: ${ex.pass}% in each subject.` : ''}</p>
      ${S.map(s => {
        const named = s.lessons.some(l => l.name !== 'General'), below = ex.pass && s.pct < ex.pass;
        return `<div class="sj"><div class="sj-head"><h4>${esc(s.name || 'Other')}</h4><span class="sj-pct">${Math.round(s.pct)}%</span><span class="sj-gain">${s.gain > 0 ? `+${fmt(s.gain)} within reach` : 'Nothing to win back'}</span></div>
          ${mini(s.got, s.max, s.gain, 's:' + s.name)}<div class="sj-sub">${fmt(s.got)} of ${fmt(s.max)} marks${below ? ` · <b class="below">below the ${ex.pass}% pass mark</b>` : ''}</div>
          ${named ? lessonRows(s, 's:' + s.name, 3) : ''}</div>`;
      }).join('')}
      ${st.mode === 'omr' && !S.some(s => s.lessons.some(l => l.name !== 'General')) ? '<p class="hint">Add lines like <span class="mono">Chapter: Optics</span> under each subject in the answer key, or add the question paper, to see the weak lessons too.</p>' : ''}
    </section>`;
  }

  // Weak topics: the finest level known for each question, biggest losses first. Each bar is as long as the topic's
  // share of the paper, so a big portion scored badly stands out from a one-mark slip.
  function topics(){
    const T = an.topics.filter(t => t.max > 0);
    if (!T.length) return '';
    const big = Math.max(...T.map(t => t.max)), multi = an.subjects.length > 1, shown = showAllTopics ? T : T.slice(0, 8);
    const anySub = T.some(t => t.sub), lessonsOnly = !anySub;
    const row = t => {
      const ctx = [multi ? t.subject : '', t.sub && t.lesson !== 'General' ? t.lesson : ''].filter(Boolean).join(' › ');
      return `<li class="tp">
        <div class="tp-head"><span class="tp-name">${esc(t.sub || (t.lesson !== 'General' ? t.lesson : t.subject ? `${t.subject}, other questions` : 'Other questions'))}</span><span class="tp-lvl ${t.level}">${LEVEL[t.level]}</span></div>
        ${ctx ? `<div class="tp-ctx">${esc(ctx)}</div>` : ''}
        <div class="tp-bar" style="width:${Math.max(10, t.max / big * 100).toFixed(1)}%">${mini(t.got, t.max, t.gain, 't:' + t.id)}</div>
        <div class="tp-sub"><span class="mono">${Math.max(0, Math.round(t.pct))}%</span><span>${signed(t.got)} of ${fmt(t.max)} marks</span><span>${Math.round(t.portion)}% of the paper</span>${t.lostQs.length ? `<span>lost in ${esc(qList(t.lostQs))}</span>` : ''}</div>
      </li>`;
    };
    const canAI = st.ai && st.ai.topics && st.rows.some(r => r.text);
    return `<section class="panel db-topics"><h3>${lessonsOnly ? (multi ? 'Weak lessons' : `Lessons${an.subjects[0] && an.subjects[0].name ? ' in ' + esc(an.subjects[0].name) : ''}`) : 'Weak topics'}</h3>
      <p class="hint">Biggest losses first. Each bar is as long as the ${lessonsOnly ? 'lesson' : 'topic'}'s share of the paper: blue is what you scored, hatched is what you can win back.</p>
      <ol class="tps">${shown.map(row).join('')}</ol>
      ${T.length > 8 ? `<button type="button" class="btn fi-more" data-more-topics>${showAllTopics ? 'Show fewer' : `Show all ${T.length}`}</button>` : ''}
      ${canAI ? `<div class="tp-ai"><button type="button" class="btn" data-topics>${anySub ? 'Check the topics with AI' : 'Find the topic of every question with AI'}</button><span class="tp-st" role="status">${esc(notes.topics)}</span></div>
        <p class="hint">${anySub ? 'Topics come from the question paper\'s words.' : 'Lessons come from the paper\'s headings.'} The AI reads every question and names its chapter and topic; you can change them in the table.</p>`
        : !anySub && st.rows.some(r => r.text) ? '<p class="hint">Add <span class="mono">## Chapter &gt; Topic</span> at the end of a question line to name its topic.</p>' : ''}
    </section>`;
  }

  function qmap(){
    const R = st.rows.map((r, i) => ({ r, i })).filter(x => x.r.max > 0);
    const small = R.length > 60, groups = new Map();
    for (const x of R) { const k = an.subjects.length > 1 ? (x.r.subject || 'Other') : ''; groups.set(k, [...(groups.get(k) || []), x]); }
    const present = new Set();
    const tile = ({ r, i }) => {
      const s = I.statusOf(r); present.add(s);
      const f = s === 'part' ? clamp(r.got / r.max, 0.12, 0.88) : s === 'full' ? 1 : 0;
      return `<button type="button" class="qt ${s}" style="--f:${f.toFixed(2)}" data-i="${i}" aria-label="${esc(tipText(r, s))}"><span>${small ? '' : esc(String(r.q).replace(/^Q/i, ''))}</span></button>`;
    };
    const body = [...groups].map(([k, xs]) => {
      const full = xs.filter(x => I.statusOf(x.r) === 'full').length;
      return `<div class="qg">${k ? `<h4>${esc(k)} <small>${full} of ${xs.length} full marks</small></h4>` : ''}<div class="qtiles">${xs.map(tile).join('')}</div></div>`;
    }).join('');
    const legend = ['full', 'part', 'zero', 'wrong', 'multi', 'blank'].filter(s => present.has(s)).map(s => `<span><i class="qt ${s}" style="--f:${s === 'part' ? .5 : s === 'full' ? 1 : 0}"></i>${STATUS[s]}</span>`).join('');
    return `<section class="panel db-map${small ? ' small' : ''}"><h3>Question map</h3><p class="hint">One box per question, filled as far as it scored. Tap a box for details.</p>
      ${body}<div class="qlegend">${legend}</div><p class="qdetail" aria-live="polite"></p><div class="qtip" role="tooltip" hidden></div></section>`;
  }
  function tipText(r, s){
    const where = [r.subject, r.topic && r.topic !== 'General' ? r.topic : '', r.sub].filter(Boolean).join(', ');
    const marks = `${fmt(r.got)} of ${fmt(r.max)} marks`;
    const omr = r.marked !== undefined ? (r.key === 'any' ? 'dropped question, full marks for all' : `marked ${r.marked === '–' ? 'nothing' : r.marked}, answer ${r.key}`) : '';
    return `${qName(r.q)}${where ? ', ' + where : ''}: ${marks}. ${omr ? omr + '. ' : ''}${s === 'full' ? '' : (r.cause && r.cause !== 'None' ? r.cause : STATUS[s] || '')}`.trim();
  }

  function causes(){
    const C = an.causes;
    if (!C.length) return '';
    const top = Math.max(...C.map(c => c.lost));
    const row = c => `<div class="cb"><span>${esc(c.name)}</span><span class="bar"><span data-w="${pct(c.lost, top)}" data-key="c:${esc(c.name)}"></span></span><span class="mono">−${fmt(c.lost)}</span></div>`;
    const habits = C.filter(c => c.kind === 'habit'), study = C.filter(c => c.kind === 'study');
    const types = weakType();
    return `<section class="panel db-causes"><h3>Why marks were lost</h3>
      ${habits.length ? `<h4>Exam habits <small>fixable before the next test</small></h4>${habits.map(row).join('')}` : ''}
      ${study.length ? `<h4>Gaps in learning <small>need the lesson again</small></h4>${study.map(row).join('')}` : ''}
      ${types}</section>`;
  }
  function weakType(){
    const by = new Map(), t = an.total;
    st.rows.filter(r => r.max > 0).forEach(r => { const g = by.get(r.type) || { got: 0, max: 0 }; g.got += r.got; g.max += r.max; by.set(r.type, g); });
    if (by.size < 2) return '';
    const p = pct(t.got, t.max), w = [...by].map(([n, g]) => ({ n, p: pct(g.got, g.max), lost: g.max - g.got })).filter(x => x.lost > 0 && x.p < p - 8).sort((a, b) => a.p - b.p)[0];
    return w ? `<p class="hint db-type"><b>${esc(w.n)} questions</b> scored ${Math.round(w.p)}% against ${Math.round(p)}% overall. Practise this question style on its own.</p>` : '';
  }

  // Where study time should go, as a share of whatever time the student has
  function share(){
    const S = an.share;
    if (!S.parts.length) return '';
    const row = p => `<li class="sh ${p.kind}">
        <div class="sh-head"><span class="sh-name">${esc(p.name)}</span><span class="sh-pct"><b data-n="${p.pct}" data-key="sh:${esc(p.name)}" data-int="1">${p.pct}</b>%</span></div>
        <span class="sh-bar" aria-hidden="true"><span data-w="${p.pct}" data-key="shb:${esc(p.name)}"></span></span>
        <div class="sh-sub"><span class="gain">+${fmt(p.gain)}</span><span>${p.kind === 'habit' ? 'marks from timed practice and a checking routine' : 'marks to win back with study'}</span>${p.inner.length ? `<span class="sh-in">${p.inner.slice(0, 3).map(x => `${esc(x.name)} ${x.pct}%`).join(' · ')}${p.inner.length > 3 ? ' · …' : ''}</span>` : ''}</div>
      </li>`;
    return `<section class="panel db-share"><h3>Where your study time should go</h3>
      <p class="hint">The share of your revision time for each ${S.by === 'subject' ? 'subject' : 'lesson'}, set to win back the most marks: more marks to win back, and slower ones to fix, get more time.</p>
      <ol class="shs" aria-label="Study time by ${S.by}">${S.parts.map(row).join('')}</ol>
      <p class="hint sh-eg">Use these shares for whatever time you have before the next test. Inside each ${S.by === 'subject' ? 'subject' : 'lesson'}, follow the order of “Where to focus”.</p>
    </section>`;
  }

  /* ---------- correct answers for the questions where marks were lost ---------- */

  const lostRows = () => st.rows.map((r, i) => ({ r, i })).filter(x => x.r.max > 0 && x.r.got < x.r.max && x.r.key !== 'any');
  const searchText = r => clip(String(r.text || '').replace(/\s+/g, ' '), 220);
  function answers(){
    const L = lostRows();
    if (!L.length) return '';
    const withText = L.filter(x => x.r.text), got = withText.filter(x => st.answerOf && st.answerOf(x.r)).length, todo = withText.length - got;
    const canAI = !!(st.ai && st.ai.solve), shown = showAllAns ? L : L.slice(0, 8), omrNoText = st.mode === 'omr' && !withText.length;
    const via = st.ai && st.ai.search ? ` The AI searches ${esc(st.ai.search)} first and lists the sources it used.` : '';
    const intro = omrNoText
      ? `The right option for each of the ${L.length} questions you lost marks on. Add the question paper under the answer key to get worked answers and search links.`
      : `For the ${L.length} ${L.length === 1 ? 'question' : 'questions'} where you lost marks.${canAI ? via : ' Tap Search Google to see each answer on the web.'}`;
    return `<section class="panel db-ans"><div class="an-headrow"><div><h3>Correct answers</h3><p class="hint">${intro}</p></div>
        ${canAI && todo ? `<button type="button" class="btn primary" data-solve-all>${got ? `Find the other ${todo}` : `Find ${todo === 1 ? 'the answer' : `all ${todo} answers`}`}</button>` : ''}</div>
      <p class="an-st" role="status">${esc(notes.answers)}</p>
      <ol class="anl">${shown.map(item).join('')}</ol>
      ${L.length > 8 ? `<button type="button" class="btn fi-more" data-more-ans>${showAllAns ? 'Show fewer' : `Show all ${L.length}`}</button>` : ''}
      ${canAI && withText.length ? `<p class="hint">Answers are written by AI from search results and can be wrong, so check them against your textbook or teacher. The question text goes to this site's AI company${st.ai.search ? ` and to ${esc(st.ai.search)}` : ''}; <a class="inline" href="privacy.html">privacy notice</a>.</p>` : ''}
    </section>`;
  }
  function item({ r, i }){
    const a = st.answerOf ? st.answerOf(r) : null, canAI = !!(st.ai && st.ai.solve);
    const where = [an.subjects.length > 1 ? r.subject : '', r.topic && r.topic !== 'General' ? r.topic : (a && a.chapter) || '', r.sub || (a && a.topic) || ''].filter(Boolean);
    const q = searchText(r), lost = r.max - r.got;
    return `<li class="an" data-i="${i}">
      <div class="an-top"><span class="an-q">${esc(qName(r.q))}</span><span class="an-where">${esc(where.join(' › '))}</span><span class="an-lost">−${fmt(lost)}</span></div>
      ${r.text ? `<p class="an-text">${esc(clip(r.text, 300))}</p>` : ''}
      ${r.key ? `<p class="an-key"><span>Right answer <b>${esc(r.key)}</b></span><span>You answered <b>${esc(r.marked || '–')}</b></span></p>` : ''}
      ${a ? solution(a) : ''}
      ${r.text ? `<div class="an-links">${canAI && !a ? `<button type="button" class="an-get" data-solve="${i}">Get the answer</button>` : ''}<a href="https://www.google.com/search?q=${encodeURIComponent(q)}" target="_blank" rel="noopener">Search Google</a><a href="https://www.youtube.com/results?search_query=${encodeURIComponent(clip(q, 120) + ' solution')}" target="_blank" rel="noopener">Video solutions</a></div>` : ''}
    </li>`;
  }
  function solution(a){
    const src = (a.sources || []).filter(s => safeUrl(s.url));
    return `<div class="an-sol${a.confidence === 'low' ? ' low' : ''}">
      <p class="an-ans"><span class="an-k">Answer</span>${esc(a.answer)}</p>
      ${a.working ? `<details class="an-work"><summary>Worked solution</summary><p>${esc(a.working).replace(/\n/g, '<br>')}</p></details>` : ''}
      <p class="an-src">${src.length ? `Sources: ${src.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener nofollow">${esc(clip(s.title || host(s.url), 70))}</a>`).join(' · ')}` : `Worked out by the AI${a.search ? `: ${esc(a.search)} had no result that matched` : ''}.`}${a.confidence === 'low' ? ' <b class="an-low">The AI is unsure: check this one with your teacher.</b>' : ''}</p>
    </div>`;
  }

  function examiner(){
    const fb = st.rows.filter(r => r.feedback), x = st.aiExtra;
    if (!x && !fb.length) return '';
    return `<section class="panel db-exam"><h3>Examiner's notes</h3>
      ${x && x.summary ? `<p>${esc(x.summary)}</p>` : ''}
      ${x && x.plan && x.plan.length ? `<ol class="plan">${x.plan.map(p => `<li>${esc(p)}</li>`).join('')}</ol>` : ''}
      ${fb.length ? `<h4>Feedback by question</h4>${fb.map(r => `<p class="fb"><span class="mono">${esc(qName(r.q))} ${fmt(r.got)}/${fmt(r.max)}</span><span>${esc(r.feedback)}</span></p>`).join('')}` : ''}
    </section>`;
  }

  /* ---------- my papers: progress kept on this device ---------- */

  const loadPapers = () => { try { const a = JSON.parse(localStorage.getItem(PAPERS) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
  const storePapers = a => { try { localStorage.setItem(PAPERS, JSON.stringify(a.slice(-40))); return true; } catch { return false; } };
  const defaultName = () => {
    const names = an.subjects.map(s => s.name).filter(Boolean);
    const base = names.length ? (names.length > 2 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join(' and ')) : 'Exam';
    return `${base} ${st.mode === 'omr' ? 'test' : 'paper'}`;
  };
  const day = iso => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch { return ''; } };

  function papers(){
    const list = loadPapers(), mine = st.paperKey && list.find(p => p.key === st.paperKey);
    const save = st.sample
      ? '<p class="hint">Load your own paper to start tracking your progress. The example is not saved.</p>'
      : `<form class="pp-save" data-save><label class="vh" for="ppName">Name for this paper</label><input id="ppName" maxlength="60" value="${esc(mine ? mine.name : defaultName())}"><button class="btn primary" type="submit">${mine ? 'Update saved paper' : 'Save to my papers'}</button></form>`;
    let body = '';
    if (list.length) {
      const A = I.acrossPapers(list);
      body += A.papers.length > 1 ? trend(A.papers) : '';
      if (A.subjects.length > 1 && A.papers.length > 1) {
        const top = Math.max(...A.subjects.map(s => s.lost), 1);
        body += `<h4>Across your papers</h4><p class="hint">Marks lost in each subject over all saved papers. The longest bar is where steady work pays most.</p>${A.subjects.map(s => `<div class="cb"><span>${esc(s.name || 'Other')} <small>${Math.round(s.pct)}%</small></span><span class="bar"><span data-w="${pct(s.lost, top)}" data-key="pp:${esc(s.name)}"></span></span><span class="mono">−${fmt(s.lost)}</span></div>`).join('')}`;
      }
      if (A.lessons.length) body += `<h4>Lessons that keep costing marks</h4><ul class="pp-less">${A.lessons.map(l => `<li><b>${esc(l.name)}</b> <span>${esc(l.subject)}</span> <span class="mono">${Math.round(l.pct)}% over ${l.papers} papers</span></li>`).join('')}</ul>`;
      body += `<ul class="pp-list">${[...A.papers].reverse().map(p => `<li><span class="mono">${esc(day(p.at))}</span><span>${esc(p.name)}</span><span class="mono">${Math.round(p.pct)}%</span><button type="button" data-del="${esc(p.id)}" aria-label="Remove ${esc(p.name)} from my papers">✕</button></li>`).join('')}</ul>`;
    }
    return `<section class="panel db-papers"><h3>My papers</h3><p class="hint">Save each test to see your progress and the subjects that keep costing marks. Saved on this device only.</p>${save}<p class="pp-st" role="status"></p>${body}</section>`;
  }
  function trend(P){
    const W = 600, H = 170, pl = 34, pr = 14, pt = 14, pb = 26, n = P.length;
    const x = i => pl + (n === 1 ? (W - pl - pr) / 2 : i * (W - pl - pr) / (n - 1)), y = v => pt + (H - pt - pb) * (1 - clamp(v) / 100);
    let s = `<div class="pp-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Score in each saved paper, oldest first: ${P.map(p => `${p.name} ${Math.round(p.pct)}%`).join(', ')}">`;
    for (const v of [0, 50, 100]) s += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`;
    s += `<polyline fill="none" stroke="var(--st-score)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${P.map((p, i) => `${x(i)},${y(p.pct)}`).join(' ')}"/>`;
    P.forEach((p, i) => { s += `<g><title>${esc(p.name)}, ${esc(day(p.at))}: ${Math.round(p.pct)}%</title><circle cx="${x(i)}" cy="${y(p.pct)}" r="12" fill="transparent"/><circle cx="${x(i)}" cy="${y(p.pct)}" r="4.5" fill="var(--st-score)" stroke="var(--surface)" stroke-width="2"/></g>`; });
    const a = P[0].pct, b = P[n - 1].pct;
    s += `<text x="${x(n - 1)}" y="${y(b) - 10}" text-anchor="end" class="pp-last">${Math.round(b)}%</text></svg></div>`;
    return `${s}<p class="hint pp-change">${b > a + 0.5 ? `Up ${Math.round(b - a)} points since your first saved paper.` : b < a - 0.5 ? `Down ${Math.round(a - b)} points since your first saved paper.` : 'Level with your first saved paper.'}</p>`;
  }

  /* ---------- motion ---------- */

  // bars and numbers start from what was on screen (or zero the first time) and glide to the new values
  function prime(){
    const zero = !seen;
    root.querySelectorAll('[data-w]').forEach(el => { const k = el.dataset.key, from = zero ? 0 : (last.has(k) ? last.get(k) : +el.dataset.w); el.style.width = from + '%'; });
    root.querySelectorAll('[data-n]').forEach(el => { const k = el.dataset.key, from = zero ? 0 : (last.has(k) ? last.get(k) : +el.dataset.n); show(el, from); });
  }
  const show = (el, v) => { el.textContent = el.dataset.int ? String(Math.round(v)) : signed(v); };
  function play(ms){
    const now = still();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.querySelectorAll('[data-w]').forEach(el => { if (now) el.style.transition = 'none'; el.style.width = el.dataset.w + '%'; last.set(el.dataset.key, +el.dataset.w); });
      root.querySelectorAll('[data-n]').forEach(el => tween(el, now ? 0 : ms));
    }));
  }
  function tween(el, ms){
    const k = el.dataset.key, to = +el.dataset.n, from = last.has(k) && seen ? last.get(k) : 0;
    last.set(k, to);
    if (!ms || from === to) { show(el, to); return; }
    const t0 = performance.now(), ease = x => 1 - Math.pow(1 - x, 3);
    const step = t => { const x = Math.min(1, (t - t0) / ms); show(el, from + (to - from) * ease(x)); if (x < 1 && el.isConnected) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function watch(){
    if (seen) { play(450); return; }
    if (still() || !('IntersectionObserver' in window)) { seen = true; play(0); return; }
    if (io) io.disconnect();
    io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); io = null; play(1000); seen = true; } }, { threshold: 0.25 });
    io.observe(root.querySelector('.db-hero'));
  }

  /* ---------- interaction ---------- */

  function updateReach(){
    const reach = reachNow(), n = planned().length, el = root.querySelector('[data-key=n-reach]'), t = an.total, got = Math.max(0, t.got);
    el.dataset.n = reach; tween(el, still() ? 0 : 450);
    const r = root.querySelector('.r-reach'); r.dataset.w = clamp(pct(reach - got, t.max)); r.style.width = r.dataset.w + '%'; last.set('r-reach', +r.dataset.w);
    root.querySelector('[data-k=reach-note]').innerHTML = n ? `<b class="gain">+${fmt(reach - t.got)}</b> marks if you work on the ${n === 1 ? 'one item' : n + ' items'} in your plan` : 'Add items from the plan below to see what you can win back';
    root.querySelector('.ruler').setAttribute('aria-label', `Score ${fmt(t.got)} of ${fmt(t.max)}. With your plan, about ${fmt(reach)}.`);
  }
  function tip(btn, sticky){
    const box = root.querySelector('.qtip'), map = root.querySelector('.db-map'), r = st.rows[+btn.dataset.i];
    if (!box || !r) return;
    const text = btn.getAttribute('aria-label');
    box.textContent = text; box.hidden = false;
    const a = btn.getBoundingClientRect(), m = map.getBoundingClientRect();
    const left = clamp(a.left - m.left + a.width / 2, 120, m.width - 120);
    box.style.left = left + 'px'; box.style.top = (a.top - m.top - 8) + 'px';
    if (sticky) root.querySelector('.qdetail').textContent = text;
  }
  function wire(el){
    if (el.dataset.wired) return; el.dataset.wired = '1';
    el.addEventListener('click', e => {
      const add = e.target.closest('.fi-add');
      if (add) {
        const li = add.closest('.fi'), p = an.plan.find(x => x.id === li.dataset.id), i = an.plan.indexOf(p), on = !isPicked(p, i);
        picked.set(p.id, on); li.classList.toggle('on', on); add.setAttribute('aria-pressed', on); add.textContent = on ? 'In my plan' : 'Add to my plan';
        add.setAttribute('aria-label', `${on ? 'Remove' : 'Add'} ${p.title} ${on ? 'from' : 'to'} my plan`);
        updateReach(); return;
      }
      if (e.target.closest('[data-more]')) { showAll = !showAll; const sec = root.querySelector('.db-plan'); sec.outerHTML = plan(); return; }
      if (e.target.closest('[data-more-topics]')) { showAllTopics = !showAllTopics; redraw('topics'); return; }
      if (e.target.closest('[data-more-ans]')) { showAllAns = !showAllAns; redraw('answers'); return; }
      const tb = e.target.closest('[data-topics]');
      if (tb && st.onTopics) { tb.disabled = true; st.onTopics(); return; }
      const all = e.target.closest('[data-solve-all]');
      if (all && st.onSolve) { all.disabled = true; st.onSolve(lostRows().map(x => x.r).filter(r => r.text && !(st.answerOf && st.answerOf(r)))); return; }
      const one = e.target.closest('[data-solve]');
      if (one && st.onSolve) { one.disabled = true; one.textContent = 'Finding the answer…'; st.onSolve([st.rows[+one.dataset.solve]].filter(Boolean)); return; }
      const qt = e.target.closest('.db-map .qtiles .qt'); if (qt) { tip(qt, true); return; }
      const del = e.target.closest('[data-del]');
      if (del) { storePapers(loadPapers().filter(p => p.id !== del.dataset.del)); redrawPapers('Removed.'); }
    });
    el.addEventListener('submit', e => {
      if (!e.target.matches('[data-save]')) return;
      e.preventDefault();
      const name = e.target.querySelector('input').value.trim() || defaultName(), list = loadPapers(), old = list.find(p => p.key === st.paperKey);
      const snap = I.snapshot(st.rows, { name, mode: st.mode, omr: st.mode === 'omr', id: old ? old.id : undefined, at: old ? old.at : undefined });
      snap.key = st.paperKey;
      const next = old ? list.map(p => p.id === old.id ? snap : p) : list.concat([snap]);
      redrawPapers(storePapers(next) ? (old ? 'Saved paper updated.' : 'Saved to my papers.') : 'Could not save: this browser is blocking storage.');
    });
    el.addEventListener('pointerover', e => { const qt = e.target.closest('.db-map .qtiles .qt'); if (qt && e.pointerType === 'mouse') tip(qt); });
    el.addEventListener('pointerout', e => { if (e.target.closest('.db-map .qtiles .qt') && e.pointerType === 'mouse') hideTip(); });
    el.addEventListener('focusin', e => { const qt = e.target.closest('.db-map .qtiles .qt'); if (qt) tip(qt, true); });
    el.addEventListener('focusout', e => { if (e.target.closest('.db-map .qtiles .qt')) hideTip(); });
  }
  const hideTip = () => { const b = root && root.querySelector('.qtip'); if (b) b.hidden = true; };
  function redrawPapers(msg){
    const sec = root.querySelector('.db-papers'); sec.outerHTML = papers();
    const n = root.querySelector('.db-papers');
    n.querySelectorAll('[data-w]').forEach(el => { el.style.transition = 'none'; el.style.width = el.dataset.w + '%'; });
    n.querySelector('.pp-st').textContent = msg || '';
  }

  /* ---------- entry point ---------- */

  // state: { rows, mode: 'marked' | 'ai' | 'omr', aiExtra, sample, paperKey, exam (from exams.js), scheme: { right, wrong,
  //          options } for OMR, ai: { solve, topics, search } when the site's AI is on, answerOf(row) -> saved answer,
  //          onSolve(rows), onTopics() }
  function render(el, state){
    if (state.paperKey !== lastKey) { notes.answers = ''; notes.topics = ''; showAllAns = false; showAllTopics = false; lastKey = state.paperKey; }   // a new paper starts clean
    root = el; st = state; an = I.analyze(state.rows, { omr: state.mode === 'omr' });
    const known = new Set(an.plan.map(p => p.id));
    for (const k of [...picked.keys()]) if (!known.has(k)) picked.delete(k);
    el.innerHTML = `<div class="db">
      ${hero()}
      <div class="db-cols"><div class="db-col">${plan()}${topics()}</div><div class="db-col">${share()}${subjects()}${qmap()}${causes()}</div></div>
      ${answers()}
      ${examiner()}
      ${papers()}
    </div>`;
    wire(el); prime(); watch();
  }
  // redraw one part without touching the rest (the AI buttons fill these in while the student reads)
  function redraw(part){
    if (!root || !st) return;
    const sec = root.querySelector(part === 'topics' ? '.db-topics' : '.db-ans'), html = part === 'topics' ? topics() : answers();
    if (sec) sec.outerHTML = html || '<span hidden></span>';
    const n = root.querySelector(part === 'topics' ? '.db-topics' : '.db-ans');
    if (n) n.querySelectorAll('[data-w]').forEach(x => { x.style.transition = 'none'; x.style.width = x.dataset.w + '%'; });
  }
  function note(part, msg){
    notes[part] = msg || '';
    const el = root && root.querySelector(part === 'topics' ? '.tp-st' : '.an-st');
    if (el) el.textContent = notes[part];
  }

  window.MarkLensDash = { render, redraw, note, analyze: rows => I.analyze(rows) };
})();
