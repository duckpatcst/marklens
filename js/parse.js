/* MarkLens parsers: turn the text of a question paper, a marked sheet, an answer key and a student's OMR answers into
   questions with marks, subjects and lessons. No page access, so the same file runs in the browser
   (window.MarkLensParse) and in Node for the tests. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./insights.js') : root.MarkLensInsights);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MarkLensParse = api;
})(typeof self !== 'undefined' ? self : this, function (INS) {
  'use strict';
  const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

  const CAUSE_WORDS = [
    ['Concept gap', /concept|not understood|misunderst|wrong (formula|approach|method|theory)|\btheory\b|\blogic|confus/i],
    ['Careless / calculation', /careless|silly|calculation|arithmetic|\bcopy|miscalc|\bslip/i],
    ['Incomplete / unattempted', /incomplete|missing|partial|not attempted|unattempted|blank|skipped|\bsteps\b|no working/i],
    ['Units & signs', /\bunits?\b|\bsigns?\b|decimal|rounding/i],
    ['Presentation', /presentation|diagram|handwriting|illegible|untidy|\blabel/i],
    ['Time management', /\btime\b|rushed|ran out/i]
  ];

  // MCQ: options a) b) c), or (a) (b) (c), on a low-mark question, or the words MCQ / choose / tick. (a) (b) parts of a bigger question are not MCQ.
  const guessType = (t, max) => ((max <= 2 && /\(?a[.)]\s.+\(?b[.)]\s.+\(?c[.)]\s/i.test(t)) || /\b(mcq|choose|tick)\b/i.test(t)) ? 'MCQ' : (max <= 3 ? 'Short answer' : 'Long answer');
  const classifyCause = (rem, lost) => { if (lost <= 0) return 'None'; for (const [c, re] of CAUSE_WORDS) if (re.test(rem)) return c; return 'Unspecified'; };
  // Half marks as teachers write them: 1½ -> 1.5, ½ -> 0.5
  const halves = t => String(t).replace(/(\d)\s*½/g, '$1.5').replace(/½/g, '0.5');
  // "Q1" for plain numbers; section labels such as "B2" are shown as they are
  const qName = q => /^\d/.test(String(q)) ? 'Q' + q : String(q);
  const PART = String.raw`(?:\(\s*(?:[a-h]|[ivx]{1,4})\s*\)|(?:[a-h]|[ivx]{1,4})\))`;   // (a)  b)  (iii)
  // "## Physics > Optics > Lenses" at the end of a question names its subject, chapter and topic. Two parts are
  // "Subject > Chapter" when the first is a subject name, otherwise "Chapter > Topic"; one part is a subject or a chapter.
  function splitNote(s){
    const p = String(s || '').split(/\s*[>›»]\s*/).map(x => x.trim()).filter(Boolean);
    if (!p.length) return {};
    if (p.length >= 3) return { asSubject: p[0], chapter: p[1], sub: p.slice(2).join(', ') };
    if (p.length === 2) return INS.canonSubject(p[0]) ? { asSubject: p[0], chapter: p[1] } : { chapter: p[0], sub: p[1] };
    return INS.canonSubject(p[0]) ? { asSubject: p[0] } : { chapter: p[0] };
  }
  // the question as a student would search for it: no topic note, #tag or marks label
  const MARKS_TAIL = /\s*(?:[\[(]\s*\d+(?:\.\d+)?\s*(?:[x×*]\s*\d+(?:\.\d+)?\s*=\s*\d+(?:\.\d+)?\s*)?(?:[Mm]arks?|[Mm])?\s*[\])]|\d+(?:\.\d+)?\s*(?:[Mm]arks?\b|M\b))\s*$/;
  const plainText = t => String(t || '').replace(/#[A-Za-z][\w &-]*/g, ' ').replace(/\btopic\s*[:\-]\s*[^\]\)|,#]+/i, ' ').replace(MARKS_TAIL, '').replace(/\s+/g, ' ').trim();

  // Marks the paper gives for many questions at once, as printed papers say it:
  //   "Questions from 1 to 16 and 27 to 30 carry 1 mark each."   "Q.21-25 carry 5 marks each"
  //   "Section B, Consist of 5 questions (11-15). Each question carries 2 marks."
  // -> [{ from, to, max }] (a single question is from === to), or null when the line is not such a rule.
  const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5 };
  function markRule(line){
    const s = String(line).replace(/[–—]/g, '-');
    const mk = s.match(/\b(?:carr(?:y|ies)|has|have|of)\s+(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|half)\s*marks?\b/i) ||
      s.match(/\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*marks?\s*(?:each|for each|per question)\b/i);
    if (!mk) return null;
    const max = WORDNUM[mk[1].toLowerCase()] ?? num(mk[1]);
    const head = s.slice(0, mk.index), out = [];
    // question numbers before the marks: ranges "1 to 16", "(11-15)", "Q1-Q5", and single numbers joined by "and" or ","
    const re = /\b(?:Q(?:uestions?)?\.?\s*(?:no\.?\s*)?)?(\d{1,3})\s*(?:-|to)\s*(?:Q\.?\s*)?(\d{1,3})\b|(?:\band\b|,)\s*(?:Q\.?\s*)?(\d{1,3})\b(?!\s*(?:-|to|questions?\b|marks?\b))/gi;
    for (const r of head.matchAll(re)) {
      if (r[1]) { const a = +r[1], b = +r[2]; if (a >= 1 && b >= a && b - a < 200) out.push({ from: a, to: b, max }); }
      else if (out.length) out.push({ from: +r[3], to: +r[3], max });
    }
    // "Each question carries 2 marks" with no question numbers: the section it sits in
    return out.length ? out : /\beach\b/i.test(s) && !/\bquestions?\s+(?:from|no)\b/i.test(head) ? [{ from: 0, to: 0, max }] : null;
  }
  // "16x1=16", "10 × 1 = 10", "(5 x 2 = 10)" next to a heading: so many questions of so many marks
  const sectionTimes = line => {
    const m = String(line).match(/(\d{1,3})\s*[x×X*]\s*(\d+(?:\.\d+)?)\s*=\s*(\d+(?:\.\d+)?)/);
    return m && Math.abs(+m[1] * +m[2] - +m[3]) < 1e-9 ? { count: +m[1], max: +m[2] } : null;
  };
  // "SECTION-A", "SECTION – B", "PART A", "Section B: Optics", "Unit 3 - Light"; also the misread "SECTION ~ 4"
  const SECTION_RE = /^(?:section|part|unit|chapter|lesson)\s*[-–—~:.]?\s*([A-Z]|[0-9]{1,2}|[IVX]{1,4})\b\s*[:\-–—.,]?\s*(.*)$/i;
  const SECTION_WORD_RE = /^(?:section|part|unit|chapter|lesson)\s+(\w+)\s*[:\-–]?\s*(.*)$/i;

  function parsePaper(text){
    const qs = []; let section = '', secId = '', subject = '', cur = null;
    const lineRe = new RegExp(String.raw`^\s*(?:Q(?:uestion)?\.?\s*)?(\d+)\s*(?:[.):\-]\s*|(?=${PART}))(.+)`, 'i');
    // marks set for many questions at once (see markRule and sectionTimes); they never override a question's own label
    const ranged = new Map(); let sectionMax = 0, inInstructions = false;
    halves(text).split(/\r?\n/).forEach((raw, idx) => {
      const line = raw.trim(); if (!line) return;
      // "Subject: Physics", or a line that is only a subject name (PHYSICS), starts a subject; its sections are its lessons
      const subj = line.match(/^subject\s*[:\-–]\s*(.+)$/i) || (line.length <= 40 && INS.canonSubject(line.replace(/[:.]$/, '')) ? [line, line.replace(/[:.]$/, '')] : null);
      if (subj) { subject = subj[1].trim(); section = ''; secId = ''; cur = null; sectionMax = 0; inInstructions = false; return; }
      const rule = markRule(line), times = sectionTimes(line);
      if (rule) for (const r of rule) {
        if (!r.from) { sectionMax = r.max; continue; }
        for (let q = r.from; q <= r.to; q++) ranged.set(q, r.max);
      }
      // "General Instructions:" lists numbered rules, not questions, until the first section or question
      if (/^(?:general\s+)?instructions?\b/i.test(line)) { inInstructions = true; cur = null; return; }
      const sec = !rule && (line.match(SECTION_RE) || line.match(SECTION_WORD_RE));
      if (sec) {
        secId = sec[1].toUpperCase();
        section = (sec[2] || '').replace(/\(?\s*\d{1,3}\s*[x×X*]\s*\d+(?:\.\d+)?\s*=\s*\d+(?:\.\d+)?\s*\)?/g, '').replace(/^[\s:\-–.,]+|[\s:\-–.,]+$/g, '').trim();
        sectionMax = times ? times.max : 0; cur = null; inInstructions = false; return;
      }
      const m = line.match(lineRe);
      if (rule && (inInstructions || !m || /\bquestions?\b/i.test(line))) { cur = null; return; }   // a marks rule, not a question
      if (times && !m) { sectionMax = times.max; cur = null; return; }   // "I. CHOOSE THE BEST ANSWER: 16x1=16"
      if (inInstructions) return;
      // a stray mark read as a number in front of the options ("1 (A) 50,000") is not a new question
      const option = m && cur && +m[1] < cur.n && /^\(?[A-Da-d]\)\s/.test(m[2]);
      if (m && !option) { cur = { n: +m[1], text: m[2], section, secId, subject, first: idx, line: idx, sectionMax }; qs.push(cur); } else if (cur) { cur.text += ' ' + line; cur.line = idx; }
    });
    // the "## ..." note comes off the question before anything else reads it
    for (const o of qs) { const k = o.text.indexOf('##'); o.note = k >= 0 ? splitNote(o.text.slice(k + 2)) : {}; if (k >= 0) o.text = o.text.slice(0, k).trim(); }
    // Papers that restart numbering in each section (A1-5, B1-5) get section labels, so no question overwrites another.
    const restarts = new Set(qs.map(o => o.n)).size < qs.length;
    const tags = qs.map(o => (o.text.match(/#([A-Za-z][\w &-]*)/) || o.text.match(/\btopic\s*[:\-]\s*([^\]\)|,#]+)/i) || [])[1] || '');
    const where = INS.classify(qs.map((o, i) => ({ subject: o.subject, heading: o.section, tag: tags[i], text: o.text, ...o.note })));
    return qs.map((o, i) => {
      // [1×5=5] or (2 x 3 = 6) -> the total; otherwise the last marks label wins, so f(2) inside the question is not
      // read as marks; lowercase "m" alone is metres. A question split into parts (a) [2] (b) [3] gets the sum of the parts.
      const all = [...o.text.matchAll(/[\[(]\s*\d+(?:\.\d+)?\s*[x×*]\s*\d+(?:\.\d+)?\s*=\s*(\d+(?:\.\d+)?)\s*(?:[Mm]arks?)?\s*[\])]|[\[(]\s*(\d+(?:\.\d+)?)\s*(?:[Mm]arks?|[Mm])?\s*[\])]|(\d+(?:\.\d+)?)\s*(?:[Mm]arks?\b|M\b)/g)];
      const val = mk => num(mk[1] || mk[2] || mk[3]);
      const firm = all.filter(mk => mk[0][0] === '[' || /marks?|M\b|=/.test(mk[0]));
      const parts = (o.text.match(new RegExp(PART, 'gi')) || []).length;
      // otherwise the paper's rules: "Questions 1 to 16 carry 1 mark each", then the section's "10x1=10"
      const max = parts >= 2 && firm.length >= 2 ? firm.reduce((a, mk) => a + val(mk), 0) : all.length ? val(all.at(-1)) : ranged.get(o.n) ?? o.sectionMax ?? 0;
      const sid = o.secId || 'S' + (1 + qs.slice(0, i).filter(p => p.n === o.n).length);
      return { q: restarts ? sid + (/^\d/.test(sid) ? '.' : '') + o.n : String(o.n), n: o.n, sec: o.secId || o.section, subject: where[i].subject, topic: where[i].lesson, sub: where[i].topic,
        type: guessType(o.text, max), max, text: plainText(o.text), first: o.first, line: o.line };
    });
  }
  // Writes "## Subject > Chapter > Topic" notes onto the paper's question lines (replacing older notes), so the topics
  // the AI found stay in the text the student can read and correct. notes: Map or object, question label -> note.
  function annotatePaper(text, notes){
    const get = q => notes instanceof Map ? notes.get(q) : notes[q];
    const lines = String(text).split(/\r?\n/);
    for (const p of parsePaper(text)) {
      const note = String(get(p.q) || '').replace(/[\r\n#]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!note) continue;
      for (let k = p.first; k <= p.line; k++) lines[k] = lines[k].replace(/\s*##[^#]*$/, '');
      lines[p.line] = lines[p.line].replace(/\s+$/, '') + ' ## ' + note;
    }
    return lines.join('\n');
  }
  function parseSheet(text){
    // an optional section letter first (A1, B-2), as in papers that restart numbering per section
    const re = new RegExp(String.raw`^\s*(?:([A-PR-Z])\s*[-.]?\s*(?=\d))?(?:Q(?:uestion)?\.?\s*)?(\d+)\s*(${PART}|[a-h](?=[\s.):\-=,]))?(?:\s*[.):\-=,]+\s*|\s+)(\d+(?:\.\d+)?)\s*(?:(?:\/|out of|of)\s*(\d+(?:\.\d+)?))?\s*[-–,:|]?\s*(.*)$`, 'i'), out = [];
    for (const l of halves(text).split(/\r?\n/)) {
      const m = l.match(re);
      if (m) out.push({ sec: (m[1] || '').toUpperCase(), n: +m[2], part: (m[3] || '').replace(/[()\s]/g, '').toLowerCase(), got: num(m[4]), max: m[5] ? num(m[5]) : 0, remark: m[6] || '' });
    }
    return out;
  }
  // Match sheet lines to paper questions. Parts 1(a), 1(b) add up into question 1. When numbering restarts in a new
  // section, the second "1" on the sheet goes to the second question 1 on the paper. A question repeated across a page
  // break keeps its latest line.
  function matchSheet(paper, sheet){
    const byNum = new Map(); paper.forEach(p => byNum.set(p.n, [...(byNum.get(p.n) || []), p.q]));
    const occ = new Map(), out = new Map(); let prev = null;
    for (const s of sheet) {
      const labelled = s.sec ? (byNum.get(s.n) || []).indexOf(s.sec + s.n) : -1;   // "B1" goes straight to B1
      const k = labelled >= 0 ? labelled : occ.has(s.n) && prev && prev.n !== s.n ? occ.get(s.n) + 1 : (occ.get(s.n) ?? 0);
      occ.set(s.n, k);
      const key = (byNum.get(s.n) || [])[k] ?? (k ? `S${k + 1}.${s.n}` : String(s.n));
      const cur = out.get(key) || { q: key, parts: new Map() };
      if (!s.part) cur.parts = new Map();                  // a whole-question line replaces anything before it
      cur.parts.set(s.part || '', s); out.set(key, cur);
      prev = s;
    }
    return [...out.values()].map(({ q, parts }) => {
      const ps = [...parts.values()];
      return { q, got: ps.reduce((a, p) => a + p.got, 0), max: ps.reduce((a, p) => a + p.max, 0), remark: ps.map(p => p.remark).filter(Boolean).join('; ') };
    });
  }

  const tidyCommon = t => t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/\{/g, '[').replace(/\}/g, ']').replace(/[ \t]+/g, ' ')
    .replace(/(\w)\s?~\s?(\d)/g, '$1^$2')
    .split('\n').map(l => l.trim()).filter(l => /\d/.test(l) || (l.match(/[A-Za-z]/g) || []).length > 3).join('\n');
  const tidyPaper = t => tidyCommon(t).split('\n').map(l => l
    .replace(/^Q(?:ue?s?)?\s*[.\-]?\s*(\d{1,3})\s*[.):\-]?\s*/i, '$1. ')     // Q.1 / Ques 1 / Q1) -> 1.
    .replace(/^(\d{1,3})\s*,?\s+(?=[A-Z]|\((?![a-dA-D]\)))/, '$1. ')          // "1 Solve", "4, What" -> "1. Solve", "4. What"; not "1 (A) 50,000"
    .replace(/\[\s*(\d+(?:\.\d+)?)\s*(marks?|M)?\s*$/i, '[$1]')              // "[2" at line end -> "[2]"
    .replace(/\[\s*([2-9])[1lI|]\s*\]?\s*$/, '[$1]')                          // "]" misread as 1: "[31]" -> "[3]"
  ).join('\n');
  const tidySheet = t => tidyCommon(t).split('\n').map(l => l
    .replace(/^Q(?:ue?s?)?\s*[.\-]?\s*(\d{1,3})\s*[.):\-]?\s*/i, '$1: ')
    .replace(/(\d)\s*(?:out of|\\|I|l)\s*(\d)/g, '$1/$2')
  ).join('\n');

  function chunkPages(pages, max = 6000){
    const out = []; let cur = null;
    for (const p of pages) {
      const block = `--- Page ${p.n} ---\n${p.text}`;
      if (cur && cur.text.length + block.length + 2 > max) { out.push(cur); cur = null; }
      if (!cur) cur = { first: p.n, last: p.n, text: block }; else { cur.text += '\n\n' + block; cur.last = p.n; }
    }
    if (cur) out.push(cur);
    return out;
  }

  // "Marks: +4 -1", "Marking: 4, -1", "Marks: +4 -2 partial", "Marks: +2 0 all", "Marks: +2 -2/3" -> { right, wrong, multi }
  const MARKS_LINE = /^mark(?:s|ing)?(?:\s+scheme)?\s*[:=\-–]\s*(.*\d.*)$/i;
  function parseMarks(rest){
    const nums = (String(rest).match(/[-−–]?\s*\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?/g) || []).map(s => {
      const [a, b] = s.replace(/[-−–\s]/g, '').split('/'); return b ? num(a) / num(b) : num(a);
    });
    if (!nums.length || !(nums[0] > 0)) return null;
    const multi = /partial/i.test(rest) ? 'partial' : /\b(all|exact)\b/i.test(rest) ? 'all' : /\b(any|either)\b/i.test(rest) ? 'any' : '';
    return { right: Math.abs(nums[0]), wrong: Math.abs(nums[1] || 0), multi };
  }
  // Answer key: "1-B", "Q2: D", "3) a", "4-AC" (either is right, unless a Marks line or the exam says all of them),
  // "5-*" (bonus: everyone gets it), a row of letters "BDACB", and numerical answers "21 = 12" or "22 = 2.30 to 2.35".
  // "Subject: Physics" (or a heading that names a subject, like "Section A: Physics") starts a subject; "Chapter: Optics"
  // (or any other heading, such as "Section B: Optics" or "Optics:") starts a lesson inside it. "#Optics" tags one line,
  // and "## Optics > Lenses" names the chapter and topic of the questions on that line. "Marks: +4 -2 partial" sets the
  // marking for the questions after it.
  function parseKey(text){
    const items = new Map(), heads = [], markHeads = [], tagged = new Map(), noted = new Map(); let subject = '', lesson = '';
    const startAt = (list, q) => { const open = list.length && list[list.length - 1].q === null ? list[list.length - 1] : null; if (open) open.q = q; };   // a heading starts at its first question
    for (const raw of String(text).split(/\r?\n/)) {
      let line = raw.trim(); if (!line) continue;
      const mk = line.match(MARKS_LINE);
      if (mk) { const marks = parseMarks(mk[1]); if (marks) { markHeads.push({ marks, q: null }); continue; } }
      const h = line.match(/^(section|part|unit|chapter|lesson|subject|topic)\s*[A-Za-z0-9]{0,3}\s*[:\-–]\s*(.+)$/i) || line.match(/^()([A-Za-z][A-Za-z &/-]{2,40}):\s*$/);
      if (h) {
        const name = h[2].trim();
        if (/^subject$/i.test(h[1]) || INS.canonSubject(name)) { subject = name; lesson = ''; } else lesson = name;
        heads.push({ subject, lesson, q: null }); continue;
      }
      const k = line.indexOf('##'), note = k >= 0 ? splitNote(line.slice(k + 2)) : null;
      if (k >= 0) line = line.slice(0, k).trim();
      const tag = (line.match(/#([A-Za-z][\w &-]*)/) || [])[1];
      const add = (q, it) => {
        items.set(q, { q, said: subject, lesson, ...it });
        if (tag) tagged.set(q, tag.trim()); else tagged.delete(q);
        if (note) noted.set(q, note); else noted.delete(q);
        startAt(heads, q); startAt(markHeads, q);
      };
      let found = false;
      for (const m of line.matchAll(/(?:^|[\s,;])Q?(\d{1,3})\s*[-.):]?\s*=\s*(-?\d+(?:\.\d+)?)(?:\s*(?:to|\.\.|–|~)\s*(-?\d+(?:\.\d+)?))?(?=$|[\s,;#?])/gi)) {
        const q = +m[1]; if (q < 1 || q > 300) continue;
        const a = num(m[2]), b = m[3] !== undefined ? num(m[3]) : a;
        add(q, { keys: '', num: { lo: Math.min(a, b), hi: Math.max(a, b) } }); found = true;
      }
      for (const m of line.matchAll(/(?:^|[\s,;])Q?(\d{1,3})\s*[-.):=]?\s*([A-Ha-h]{1,4}(?:\s*[,/&]\s*[A-Ha-h])*|\*)(?=$|[\s,;#?])/g)) {
        const q = +m[1]; if (q < 1 || q > 300) continue;
        add(q, { keys: m[2] === '*' ? '*' : [...new Set(m[2].toUpperCase().replace(/[^A-H]/g, ''))].sort().join('') }); found = true;
      }
      if (!found && /^[A-Ha-h][A-Ha-h\s,]+$/.test(line) && line.replace(/[^A-Ha-h]/g, '').length >= 2) {   // a row of letters: BDACB
        let q = items.size ? Math.max(...items.keys()) + 1 : 1;
        for (const ch of line.toUpperCase().replace(/[^A-H]/g, '')) add(q++, { keys: ch });
      }
    }
    // A question's subject, lesson and marking follow its number: a line like "26-*" added at the end still belongs to
    // the heading that covers question 26, not to the last heading above it.
    const ranges = heads.filter(x => x.q !== null).sort((a, b) => a.q - b.q), mranges = markHeads.filter(x => x.q !== null).sort((a, b) => a.q - b.q);
    const list = [...items.values()].sort((a, b) => a.q - b.q);
    for (const it of list) {
      const r = ranges.filter(x => x.q <= it.q).pop(); if (r) { it.said = r.subject; it.lesson = r.lesson; }
      const mr = mranges.filter(x => x.q <= it.q).pop(); it.marks = mr ? mr.marks : null;
    }
    const where = INS.classify(list.map(it => ({ subject: it.said, heading: it.lesson, tag: tagged.get(it.q) || '', ...(noted.get(it.q) || {}) })));
    return list.map((it, i) => ({ q: it.q, keys: it.keys, num: it.num || null, marks: it.marks, said: it.said, subject: where[i].subject, topic: where[i].lesson, sub: where[i].topic }));
  }
  // The student's answers: "7: C", "8: -" (blank), "9: AB" (more than one bubble), "10: D ?" (check the photo),
  // "21: 12" or "22: -0.5" (a numerical answer)
  function parseOmrAnswers(text){
    const m = new Map();
    for (const raw of String(text).split(/\r?\n/)) {
      const x = raw.match(/^\s*Q?(\d{1,3})\s*[-.):=]?\s*([A-Ha-h]{1,6}|-?\d+(?:\.\d+)?|[-–—]|blank)?\s*(\?)?\s*$/i);
      if (!x) continue;
      const v = x[2] || '', isNum = /^-?\d/.test(v);
      m.set(+x[1], { marked: /^[A-H]+$/i.test(v) ? [...new Set(v.toUpperCase())].sort().join('') : '', num: isNum ? num(v) : null, check: !!x[3] });
    }
    return m;
  }
  const keyLabel = k => k.keys === '*' ? 'any' : k.num ? (k.num.lo === k.num.hi ? String(k.num.lo) : `${k.num.lo} to ${k.num.hi}`) : k.keys;

  // Marks for one answer. k: a parseKey item; a: a parseOmrAnswers entry (or nothing for a blank);
  // d: { right, wrong, multi } from the marking scheme boxes and the exam type, used when no Marks line covers k.
  // multi (for a key with several letters): 'any' = any of them is right (NTA), 'partial' = all of them, with a mark
  // for each right option chosen when no wrong one is (JEE Advanced), 'all' = all of them, no part marks (GATE MSQ).
  function scoreAnswer(k, a, d = {}){
    const sch = k.marks || {}, right = sch.right ?? d.right ?? 1, wrong = sch.wrong ?? d.wrong ?? 0, multi = sch.multi || d.multi || 'any';
    a = a || { marked: '', num: null };
    const many = k.keys && k.keys.length > 1 && k.keys !== '*' && multi !== 'any';
    const type = k.num ? 'Numerical' : many ? 'Multiple correct' : 'MCQ';
    const marked = a.num != null ? String(a.num) : a.marked || '–';
    const out = (got, cause) => ({ got, max: right, cause, type, marked, key: keyLabel(k) });
    if (k.keys === '*') return out(right, 'None');                                    // a dropped question: marks for everyone
    if (k.num) {
      if (a.num == null) return a.marked ? out(-wrong, 'Wrong answer') : out(0, 'Incomplete / unattempted');
      return a.num >= k.num.lo - 1e-9 && a.num <= k.num.hi + 1e-9 ? out(right, 'None') : out(-wrong, 'Wrong answer');
    }
    const m = a.marked || '';
    if (!m) return a.num != null ? out(-wrong, 'Wrong option') : out(0, 'Incomplete / unattempted');
    if (many) {
      const K = new Set(k.keys), M = [...m];
      if (M.some(c => !K.has(c))) return out(-wrong, 'Wrong option');
      if (M.length === K.size) return out(right, 'None');
      return multi === 'partial' ? out(Math.min(right - 0.5, M.length * right / 4), 'Incomplete / unattempted') : out(0, 'Incomplete / unattempted');
    }
    if (m.length > 1) return out(-wrong, 'Bubbling error');                           // more than one bubble counts as wrong
    return k.keys.includes(m) ? out(right, 'None') : out(-wrong, 'Wrong option');
  }

  // key text from a scanned key sheet, keeping the subjects, chapters and marking already typed for those questions,
  // and the numerical answers, which an OMR sheet cannot hold
  function keyText(answers, old){
    const before = parseKey(old), prev = new Map(before.map(k => [k.q, k])), seen = new Set(), out = []; let cs = null, cl = null, cm = null;
    const scanned = answers.filter(a => a.marked).map(a => ({ q: a.q, line: `${a.q}-${a.marked}${a.flag ? ' ?' : ''}` }));
    for (const k of before) if (k.num && !answers.some(a => a.q === k.q && a.marked)) scanned.push({ q: k.q, line: `${k.q} = ${keyLabel(k)}` });
    scanned.sort((a, b) => a.q - b.q);
    for (const a of scanned) {
      if (seen.has(a.q)) continue; seen.add(a.q);
      const k = prev.get(a.q), sub = k ? k.said : '', les = k && k.topic !== 'General' ? k.topic : '', mk = k && k.marks ? `Marks: +${k.marks.right} ${k.marks.wrong ? '-' + k.marks.wrong : '0'}${k.marks.multi ? ' ' + k.marks.multi : ''}` : '';
      if (sub !== cs) { if (sub) out.push(`Subject: ${sub}`); cs = sub; cl = null; }
      if (les !== cl) { if (les) out.push(`Chapter: ${les}`); else if (cl && sub) out.push(`Subject: ${sub}`); cl = les; }
      if (mk !== cm) { if (mk) out.push(mk); cm = mk; }
      out.push(a.line);
    }
    return out.join('\n');
  }

  return { CAUSE_WORDS, guessType, classifyCause, halves, qName, PART, splitNote, plainText, parsePaper, annotatePaper, parseSheet, matchSheet, tidyCommon, tidyPaper, tidySheet, chunkPages, parseMarks, parseKey, parseOmrAnswers, scoreAnswer, keyLabel, keyText };
});
