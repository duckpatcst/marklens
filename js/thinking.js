/* MarkLens · thinking: the Siri glow shown while MarkLens works (checking answers, reading pages, sorting Lens text).
   A soft colour glow around the edges of the screen, like Siri on iPhone, plus a small status pill at the bottom.
   It never blocks the page: everything stays usable underneath.

   MarkLensThinking.track(promise, label)  shows the glow until the promise settles, then returns its result
   MarkLensThinking.start(label) -> done() the same, by hand
   MarkLensThinking.wait(seconds)          "busy, trying again in N s" (the API client's countdown)
   MarkLensThinking.demo(ms)               shows it for a moment (also: open the page with #siri)
   Shown only after 300 ms, so instant jobs never flash it; once shown it stays at least 1.2 s.
   Motion is transform and opacity only; reduced motion gets a still glow. */
(function (root) {
  'use strict';
  const doc = root.document;
  const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let el = null, labelEl = null, statusEl = null, timeEl = null;
  const jobs = [];             // { label, at }
  let showTimer = 0, shownAt = 0, hideTimer = 0, clock = 0;

  function build(){
    if (el) return;
    el = doc.createElement('div');
    el.className = 'siri';
    el.innerHTML = `
      <div class="siri__edges" aria-hidden="true"><i class="t"><b></b></i><i class="r"><b></b></i><i class="b"><b></b></i><i class="l"><b></b></i></div>
      <div class="siri__pill" role="status" aria-live="polite">
        <span class="siri__orb" aria-hidden="true"><i></i></span>
        <span class="siri__txt"><b class="siri__label"></b><small class="siri__status"></small></span>
        <span class="siri__time" aria-hidden="true"></span>
      </div>`;
    doc.body.appendChild(el);
    labelEl = el.querySelector('.siri__label'); statusEl = el.querySelector('.siri__status'); timeEl = el.querySelector('.siri__time');
  }

  const STEPS = ['Reading the page', 'Thinking it through', 'Checking the details', 'Almost there'];
  function render(){
    if (!el || !jobs.length) return;
    const job = jobs[jobs.length - 1], secs = Math.floor((performance.now() - job.at) / 1000);
    if (labelEl.textContent !== job.label) labelEl.textContent = job.label;
    if (!job.waiting) {
      const s = STEPS[Math.min(STEPS.length - 1, Math.floor(secs / 4))] + '…';
      if (statusEl.textContent !== s) statusEl.textContent = s;
    }
    const t = secs >= 2 ? secs + 's' : '';
    if (timeEl.textContent !== t) timeEl.textContent = t;
  }

  function show(){
    build(); clearTimeout(hideTimer);
    el.classList.remove('is-leaving'); void el.offsetWidth;
    el.classList.add('is-on'); doc.documentElement.classList.add('siri-on');
    shownAt = performance.now(); render();
    clearInterval(clock); clock = setInterval(render, 500);
  }
  function hide(){
    clearTimeout(showTimer); showTimer = 0;
    if (!el || !el.classList.contains('is-on')) return;
    const wait = Math.max(0, 1200 - (performance.now() - shownAt));
    hideTimer = setTimeout(() => {
      clearInterval(clock); clock = 0;
      el.classList.add('is-leaving'); el.classList.remove('is-on'); doc.documentElement.classList.remove('siri-on');
      if (statusEl) statusEl.textContent = '';
    }, wait);
  }

  function start(label){
    const job = { label: label || 'MarkLens is working', at: performance.now(), waiting: false };
    jobs.push(job);
    if (el && el.classList.contains('is-on')) { clearTimeout(hideTimer); render(); }
    else if (!showTimer) showTimer = setTimeout(() => { showTimer = 0; if (jobs.length) show(); }, 300);
    let done = false;
    return () => { if (done) return; done = true; const i = jobs.indexOf(job); if (i >= 0) jobs.splice(i, 1); if (!jobs.length) hide(); else render(); };
  }
  function track(promise, label){
    const done = start(label);
    return Promise.resolve(promise).finally(done);
  }
  function wait(secs){
    const job = jobs[jobs.length - 1]; if (!job) return;
    job.waiting = secs > 1;
    if (statusEl) statusEl.textContent = secs > 1 ? `The free AI is busy. Trying again in ${secs}s…` : 'Trying again…';
  }
  function demo(ms = 6000){
    const done = start('Checking your answers');
    setTimeout(() => wait(0), ms * 0.5);
    setTimeout(done, ms);
  }

  root.MarkLensThinking = { start, track, wait, demo };
  if (root.location && root.location.hash === '#siri') root.addEventListener('load', () => demo(8000));
  if (reduce && doc) doc.documentElement.classList.add('siri-still');
})(typeof self !== 'undefined' ? self : this);
