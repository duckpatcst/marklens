/* MarkLens: making sense of the Google reader (Google Cloud Vision) for exam pages.

   Google returns every word with its position, but not its colour. The page itself decides which
   characters are in the teacher's red ink (js/redpen.js looks at the photo), and this file:
     - rebuilds the lines of the page the way a person reads them, with marks in the margin
       joined to the line they sit beside,
     - writes a transcript where the teacher's red writing is tagged ⟦m4 margin: 3/5⟧ for the AI,
     - reads the AI's answer back, including which red mark it used, so MarkLens can show it,
     - and, when no AI is switched on, gives each red mark to a question by itself.
   Pure functions, so they run in tests as well as in the browser. */

/* ------------------------------------------------------------------ Google's answer -> words */

const pt = v => ({ x: Math.max(0, v.x || 0), y: Math.max(0, v.y || 0) });
function bbox(poly) {
  const vs = (poly && poly.vertices || []).map(pt);
  if (!vs.length) return null;
  const xs = vs.map(v => v.x), ys = vs.map(v => v.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Google's reply for one image -> { width, height, words: [{text, conf, x0..y1, syms, brk}] } in reading order. */
export function parseVision(resp) {
  const page = resp && resp.fullTextAnnotation && resp.fullTextAnnotation.pages && resp.fullTextAnnotation.pages[0];
  const out = { width: page ? page.width || 0 : 0, height: page ? page.height || 0 : 0, words: [] };
  if (!page) return out;
  for (const b of page.blocks || []) for (const p of b.paragraphs || []) for (const w of p.words || []) {
    const syms = (w.symbols || []).map(s => ({ t: s.text || '', box: bbox(s.boundingBox), brk: s.property && s.property.detectedBreak && s.property.detectedBreak.type || '' }));
    const text = syms.map(s => s.t).join('');
    const box = bbox(w.boundingBox) || syms.reduce((a, s) => s.box ? (a ? { x0: Math.min(a.x0, s.box.x0), y0: Math.min(a.y0, s.box.y0), x1: Math.max(a.x1, s.box.x1), y1: Math.max(a.y1, s.box.y1) } : { ...s.box }) : a, null);
    if (!text || !box) continue;
    out.words.push({ text, conf: typeof w.confidence === 'number' ? w.confidence : 1, ...box, syms, brk: syms.length ? syms[syms.length - 1].brk : '' });
  }
  return out;
}

/* ------------------------------------------------------------------ words -> lines */

const ovY = (a, b) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);

/**
 * Lines as a person reads them. Google's own line breaks are kept, then pieces on the same row are
 * joined when they are close, or when one of them is short (a mark in the margin, "[3]" at the end
 * of a printed question). Two long columns side by side stay apart.
 */
export function readLines(doc) {
  const W = doc.width || Math.max(1, ...doc.words.map(w => w.x1));
  const pieces = [];
  let cur = null;
  for (const w of doc.words) {
    if (!cur) cur = { words: [] };
    cur.words.push(w);
    if (/LINE_BREAK|EOL_SURE_SPACE/.test(w.brk)) { pieces.push(cur); cur = null; }
  }
  if (cur) pieces.push(cur);
  // a piece Google kept as one line but that jumps across the page is two pieces
  const split = [];
  for (const p of pieces) {
    let part = { words: [] };
    for (const w of p.words) {
      const last = part.words[part.words.length - 1];
      if (last && (w.x0 - last.x1 > 0.18 * W || ovY(last, w) < -0.3 * Math.max(last.y1 - last.y0, w.y1 - w.y0))) { split.push(part); part = { words: [] }; }
      part.words.push(w);
    }
    if (part.words.length) split.push(part);
  }
  for (const p of split) box(p);
  // join pieces on the same row
  split.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lines = [];
  for (const p of split) {
    const h = p.y1 - p.y0;
    let best = null, bestOv = 0;
    for (const l of lines) {
      const o = ovY(l, p) / Math.max(1, Math.min(h, l.y1 - l.y0));
      if (o < 0.5) continue;
      const gap = p.x0 > l.x1 ? p.x0 - l.x1 : l.x0 > p.x1 ? l.x0 - p.x1 : -1;
      if (gap < 0) continue;                         // overlapping sideways: not the same line
      const short = chars(p) <= 9 || chars(l) <= 9;
      if ((gap <= 0.07 * W || short) && o > bestOv) { best = l; bestOv = o; }
    }
    if (best) { best.words.push(...p.words); best.words.sort((a, b) => a.x0 - b.x0); box(best); }
    else lines.push({ ...p, words: [...p.words] });
  }
  lines.sort((a, b) => (Math.abs(a.y0 - b.y0) < 0.5 * Math.min(a.y1 - a.y0, b.y1 - b.y0) ? a.x0 - b.x0 : a.y0 - b.y0));
  return lines;
}
const chars = p => p.words.reduce((a, w) => a + w.text.length, 0);
function box(p) {
  p.x0 = Math.min(...p.words.map(w => w.x0)); p.y0 = Math.min(...p.words.map(w => w.y0));
  p.x1 = Math.max(...p.words.map(w => w.x1)); p.y1 = Math.max(...p.words.map(w => w.y1));
  return p;
}

const joinWords = ws => ws.map(w => w.text).join(' ').replace(/\s+([,.;:!?)\]])/g, '$1').replace(/([(\[])\s+/g, '$1');

/** Plain text of a page, one line per row. */
export function plainText(lines) {
  return lines.map(l => joinWords(l.words)).join('\n');
}

/* ------------------------------------------------------------------ red ink */

/**
 * Mark the teacher's characters. isRed(x0, y0, x1, y1) -> share of the ink in that box that is red
 * (RedPen.inkInBox). Works per character when Google gives character boxes, so a red tick written
 * against a student's word is still told apart. Each word gets .segs: runs of red / not red.
 */
export function tagRed(lines, isRed) {
  for (const l of lines) for (const w of l.words) {
    const flags = w.syms.map(s => s.box ? isRed(s.box.x0, s.box.y0, s.box.x1, s.box.y1) : null);
    let wordShare = null;
    if (flags.some(f => f === null)) wordShare = isRed(w.x0, w.y0, w.x1, w.y1);
    const red = flags.map(f => (f === null ? wordShare : f) >= 0.45);
    w.segs = [];
    w.syms.forEach((s, i) => {
      const last = w.segs[w.segs.length - 1];
      if (last && last.red === red[i]) { last.t += s.t; if (s.box) grow(last, s.box); }
      else w.segs.push({ red: red[i], t: s.t, ...(s.box || { x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 }) });
    });
    w.red = red.every(Boolean);
  }
  return lines;
}
function grow(a, b) { a.x0 = Math.min(a.x0, b.x0); a.y0 = Math.min(a.y0, b.y0); a.x1 = Math.max(a.x1, b.x1); a.y1 = Math.max(a.y1, b.y1); }

/* ------------------------------------------------------------------ what a red mark says */

const CIRCLED = '⓪①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const TICK = /^[✓✔√☑vVJ✗✘xX×/\\|]+$/;

/** "3", "3/5", "2½", "2 1/2", "(3)", "③", "3M", "l" (1 read as l) -> {got, max} or null. */
export function parseRedValue(raw) {
  let t = String(raw || '').trim();
  if (!t || TICK.test(t)) return null;
  t = t.replace(/[⓪①-⑳]/g, c => String(CIRCLED.indexOf(c)));
  t = t.replace(/^[(\[{<]+|[)\]}>.,:;]+$/g, '').replace(/\s*(marks?|m)$/i, '');
  // common misreadings of handwritten digits, only when the whole thing is "digit-like"
  if (/^[0-9OoIl|iSsZzBgq½⁄\/ .-]+$/.test(t) && /[0-9OoIl|iSsZzBgq½]/.test(t)) {
    t = t.replace(/[Oo]/g, '0').replace(/[Il|i]/g, '1').replace(/[Ss]/g, '5').replace(/[Zz]/g, '2').replace(/B/g, '8').replace(/[gq]/g, '9').replace(/⁄/g, '/');
  }
  t = t.replace(/(\d)\s*½/g, '$1.5').replace(/^½$/, '0.5').replace(/(\d)\s+1\s*\/\s*2\b/, '$1.5');
  let m = t.match(/^(\d{1,2}(?:\.\d)?)\s*(?:\/|out of|of)\s*(\d{1,3})$/i);
  if (m) { const got = +m[1], max = +m[2]; return got <= 100 && max <= 200 ? { got, max } : null; }
  m = t.match(/^(\d{1,2}(?:\.\d)?)$/);
  if (m) return +m[1] <= 100 ? { got: +m[1], max: null } : null;
  return null;
}

/* ------------------------------------------------------------------ transcript for the AI */

const LABEL = /^(?:Q(?:ue?s?(?:tion)?)?|Ans(?:wer)?|A)?\s*[.\-:]?\s*(\d{1,2})\s*(?:\(?([a-h]|i{1,3}v?|vi{0,3})\)?)?\s*[.):\-]?$/i;

/**
 * pages: [{ lines (from readLines + tagRed), width }] for the whole answer sheet.
 * -> { text, marks: [{id, page, x0..y1, text, value, margin}] }
 * Red writing next to each other on a line becomes one mark: "3", "/", "5" -> ⟦m4 margin: 3/5⟧.
 */
export function transcript(pages) {
  const marks = [], out = [];
  let id = 0;
  pages.forEach((pg, pi) => {
    const W = pg.width || 1;
    out.push(`PAGE ${pi + 1}`);
    for (const l of pg.lines) {
      // flatten into runs of red / not red, in order
      const runs = [];
      for (const w of l.words) for (const s of (w.segs || [{ red: false, t: w.text, ...w }])) {
        const last = runs[runs.length - 1];
        const h = Math.max(4, s.y1 - s.y0);
        if (last && last.red === s.red && (!s.red || s.x0 - last.x1 <= 1.6 * h)) { last.parts.push(s.t); grow(last, s); }
        else runs.push({ red: s.red, parts: [s.t], x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 });
      }
      const bits = runs.map(r => {
        const text = r.parts.join(r.red ? '' : ' ').replace(/\s+/g, ' ').trim();
        if (!r.red) return text;
        const cx = (r.x0 + r.x1) / 2, margin = cx < 0.2 * W || cx > 0.8 * W;
        const mk = { id: 'm' + (++id), page: pi, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, text, value: parseRedValue(text), margin };
        marks.push(mk);
        return `⟦${mk.id}${margin ? ' margin' : ''}: ${text}⟧`;
      }).filter(Boolean);
      if (bits.length) out.push(bits.join(' '));
    }
  });
  return { text: out.join('\n'), marks };
}

/** A shorter transcript for long sheets: keep lines with red writing, lines that start an answer, and the first line after each. */
export function compactTranscript(text, limit) {
  if (text.length <= limit) return text;
  const lines = text.split('\n'), keep = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^PAGE \d+/.test(l) || l.includes('⟦') || LABEL.test(l.split(/\s+/)[0] || '') || /^(Q|Ans)/i.test(l)) keep.push(l);
  }
  let t = keep.join('\n');
  if (t.length > limit) t = t.slice(0, limit);
  return t;
}

/* ------------------------------------------------------------------ the AI's answer */

/**
 * "2: 1/3 [m4,m5] sign error" lines -> clean sheet lines for the marks box, which red marks each question
 * used (for the pictures in the table), and the teacher's total if the AI found one.
 */
export function parseMarksReply(reply) {
  const used = {}, lines = [];
  let total = null;
  for (const raw of String(reply || '').split(/\r?\n/)) {
    const l = raw.trim(); if (!l) continue;
    const ids = (l.match(/\[([^\]]*)\]/) || [, ''])[1].split(/[,\s]+/).filter(x => /^m\d+$/.test(x));
    const clean = l.replace(/\s*\[[^\]]*\]\s*/, ' ').replace(/\s+/g, ' ').trim();
    const t = clean.match(/^total\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?/i);
    if (t) { total = { got: +t[1], max: t[2] ? +t[2] : null, ids }; continue; }
    const q = clean.match(/^([A-Z]?\d+(?:\s*\(?[a-h]\)?)?)\s*:/i);
    if (q) used[q[1].replace(/\s+/g, '')] = ids;
    lines.push(clean);
  }
  return { lines, used, total };
}

/* ------------------------------------------------------------------ without the AI */

/** Question numbers the student wrote at the start of answers, with where they are. */
export function findLabels(pages) {
  const out = [];
  pages.forEach((pg, pi) => {
    const W = pg.width || 1;
    for (const l of pg.lines) {
      const first = l.words.find(w => !w.red);
      if (!first || first.x0 > 0.45 * W) continue;
      // "Q1)", "Q.1", "Ans 1", "1." ... possibly split over two words ("Q" "1)")
      const head = l.words.filter(w => !w.red).slice(0, 2).map(w => w.text).join(' ');
      const m = head.match(/^(?:Q(?:ue?s?(?:tion)?)?|Ans(?:wer)?)\s*[.\-:]?\s*(\d{1,2})\b/i) || first.text.match(/^(\d{1,2})\s*[.)]$/);
      if (m) out.push({ q: String(+m[1]), page: pi, y: l.y0 });
    }
  });
  return out;
}

/** For each red mark, the question label written at or above it (on its page or an earlier one). */
export function labelMarks(marks, labels) {
  for (const mk of marks) {
    let best = null;
    for (const lb of labels) {
      if (lb.page > mk.page || (lb.page === mk.page && lb.y > mk.y1 + 4)) continue;
      if (!best || lb.page > best.page || (lb.page === best.page && lb.y > best.y)) best = lb;
    }
    mk.label = best ? best.q : null;
  }
  return marks;
}
