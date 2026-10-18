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
  function parsePaper(text){
    const qs = []; let section = '', secId = '', subject = '', cur = null;
    const lineRe = new RegExp(String.raw`^\s*(?:Q(?:uestion)?\.?\s*)?(\d+)\s*(?:[.):\-]\s*|(?=${PART}))(.+)`, 'i');
    for (const raw of halves(text).split(/\r?\n/)) {
      const line = raw.trim(); if (!line) continue;
      // "Subject: Physics", or a line that is only a subject name (PHYSICS), starts a subject; its sections are its lessons
      const subj = line.match(/^subject\s*[:\-–]\s*(.+)$/i) || (line.length <= 40 && INS.canonSubject(line.replace(/[:.]$/, '')) ? [line, line.replace(/[:.]$/, '')] : null);
      if (subj) { subject = subj[1].trim(); section = ''; secId = ''; cur = null; continue; }
      const sec = line.match(/^(?:section|part|unit|chapter|lesson)\s+(\w+)\s*[:\-–]?\s*(.*)$/i);
      if (sec) { secId = sec[1].toUpperCase(); section = sec[2] ? sec[2].trim() : ''; cur = null; continue; }
      const m = line.match(lineRe);
      if (m) { cur = { n: +m[1], text: m[2], section, secId, subject }; qs.push(cur); } else if (cur) cur.text += ' ' + line;
    }
    // Papers that restart numbering in each section (A1-5, B1-5) get section labels, so no question overwrites another.
    const restarts = new Set(qs.map(o => o.n)).size < qs.length;
    const tags = qs.map(o => (o.text.match(/#([A-Za-z][\w &-]*)/) || o.text.match(/\btopic\s*[:\-]\s*([^\]\)|,#]+)/i) || [])[1] || '');
    const where = INS.classify(qs.map((o, i) => ({ subject: o.subject, heading: o.section, tag: tags[i], text: o.text })));
    return qs.map((o, i) => {
      // [1×5=5] or (2 x 3 = 6) -> the total; otherwise the last marks label wins, so f(2) inside the question is not
      // read as marks; lowercase "m" alone is metres. A question split into parts (a) [2] (b) [3] gets the sum of the parts.
      const all = [...o.text.matchAll(/[\[(]\s*\d+(?:\.\d+)?\s*[x×*]\s*\d+(?:\.\d+)?\s*=\s*(\d+(?:\.\d+)?)\s*(?:[Mm]arks?)?\s*[\])]|[\[(]\s*(\d+(?:\.\d+)?)\s*(?:[Mm]arks?|[Mm])?\s*[\])]|(\d+(?:\.\d+)?)\s*(?:[Mm]arks?\b|M\b)/g)];
      const val = mk => num(mk[1] || mk[2] || mk[3]);
      const firm = all.filter(mk => mk[0][0] === '[' || /marks?|M\b|=/.test(mk[0]));
      const parts = (o.text.match(new RegExp(PART, 'gi')) || []).length;
      const max = parts >= 2 && firm.length >= 2 ? firm.reduce((a, mk) => a + val(mk), 0) : all.length ? val(all.at(-1)) : 0;
      const sid = o.secId || 'S' + (1 + qs.slice(0, i).filter(p => p.n === o.n).length);
      return { q: restarts ? sid + (/^\d/.test(sid) ? '.' : '') + o.n : String(o.n), n: o.n, subject: where[i].subject, topic: where[i].lesson, type: guessType(o.text, max), max };
    });
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
    .replace(/^(\d{1,3})\s+(?=[A-Z(])/, '$1. ')                              // "1 Solve" -> "1. Solve"
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

  // Answer key: "1-B", "Q2: D", "3) a", "4-AC" (either is right), "5-*" (bonus: everyone gets it), a row of letters "BDACB".
  // "Subject: Physics" (or a heading that names a subject, like "Section A: Physics") starts a subject; "Chapter: Optics"
  // (or any other heading, such as "Section B: Optics" or "Optics:") starts a lesson inside it. "#Optics" tags one line.
  function parseKey(text){
    const items = new Map(), heads = [], tagged = new Map(); let subject = '', lesson = '';
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim(); if (!line) continue;
      const h = line.match(/^(section|part|unit|chapter|lesson|subject|topic)\s*[A-Za-z0-9]{0,3}\s*[:\-–]\s*(.+)$/i) || line.match(/^()([A-Za-z][A-Za-z &/-]{2,40}):\s*$/);
      if (h) {
        const name = h[2].trim();
        if (/^subject$/i.test(h[1]) || INS.canonSubject(name)) { subject = name; lesson = ''; } else lesson = name;
        heads.push({ subject, lesson, q: null }); continue;
      }
      const tag = (line.match(/#([A-Za-z][\w &-]*)/) || [])[1];
      const open = heads.length && heads[heads.length - 1].q === null ? heads[heads.length - 1] : null;   // a heading starts at its first question
      let found = false;
      for (const m of line.matchAll(/(?:^|[\s,;])Q?(\d{1,3})\s*[-.):=]?\s*([A-Ha-h]{1,4}(?:\s*[,/&]\s*[A-Ha-h])*|\*)(?=$|[\s,;#?])/g)) {
        const q = +m[1]; if (q < 1 || q > 300) continue;
        items.set(q, { q, keys: m[2] === '*' ? '*' : [...new Set(m[2].toUpperCase().replace(/[^A-H]/g, ''))].sort().join(''), said: subject, lesson });
        if (tag) tagged.set(q, tag.trim()); else tagged.delete(q);
        if (open && open.q === null) open.q = q;
        found = true;
      }
      if (!found && /^[A-Ha-h][A-Ha-h\s,]+$/.test(line) && line.replace(/[^A-Ha-h]/g, '').length >= 2) {   // a row of letters: BDACB
        let q = items.size ? Math.max(...items.keys()) + 1 : 1;
        if (open) open.q = q;
        for (const ch of line.toUpperCase().replace(/[^A-H]/g, '')) items.set(q, { q: q++, keys: ch, said: subject, lesson });
      }
    }
    // A question's subject and lesson follow its number: a line like "26-*" added at the end still belongs to the
    // heading that covers question 26, not to the last heading above it.
    const ranges = heads.filter(x => x.q !== null).sort((a, b) => a.q - b.q);
    const list = [...items.values()].sort((a, b) => a.q - b.q);
    for (const it of list) { const r = ranges.filter(x => x.q <= it.q).pop(); if (r) { it.said = r.subject; it.lesson = r.lesson; } }
    const where = INS.classify(list.map(it => ({ subject: it.said, heading: it.lesson, tag: tagged.get(it.q) || '' })));
    return list.map((it, i) => ({ q: it.q, keys: it.keys, said: it.said, subject: where[i].subject, topic: where[i].lesson }));
  }
  // The student's marks: "7: C", "8: -" (blank), "9: AB" (more than one bubble), "10: D ?" (check the photo)
  function parseOmrAnswers(text){
    const m = new Map();
    for (const raw of String(text).split(/\r?\n/)) {
      const x = raw.match(/^\s*Q?(\d{1,3})\s*[-.):=]?\s*([A-Ha-h]{1,6}|[-–—]|blank)?\s*(\?)?\s*$/i);
      if (!x) continue;
      m.set(+x[1], { marked: x[2] && /^[A-H]+$/i.test(x[2]) ? [...new Set(x[2].toUpperCase())].sort().join('') : '', check: !!x[3] });
    }
    return m;
  }

  // key text from a scanned key sheet, keeping the subjects and chapters already typed for those questions
  function keyText(answers, old){
    const prev = new Map(parseKey(old).map(k => [k.q, k])), out = []; let cs = null, cl = null;
    for (const a of answers) {
      if (!a.marked) continue;
      const k = prev.get(a.q), sub = k ? k.said : '', les = k && k.topic !== 'General' ? k.topic : '';
      if (sub !== cs) { if (sub) out.push(`Subject: ${sub}`); cs = sub; cl = null; }
      if (les !== cl) { if (les) out.push(`Chapter: ${les}`); else if (cl && sub) out.push(`Subject: ${sub}`); cl = les; }
      out.push(`${a.q}-${a.marked}${a.flag ? ' ?' : ''}`);
    }
    return out.join('\n');
  }

  return { CAUSE_WORDS, guessType, classifyCause, halves, qName, PART, parsePaper, parseSheet, matchSheet, tidyCommon, tidyPaper, tidySheet, chunkPages, parseKey, parseOmrAnswers, keyText };
});
