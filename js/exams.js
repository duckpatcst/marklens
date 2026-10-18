/* MarkLens exam types: the marking scheme, sections and pass or grade rules of the exams students sit, so the
   dashboard reads a NEET OMR sheet, a JEE numerical answer, a CBSE board paper or a university exam the way that
   exam is actually marked. Pure data and maths with no page access, so the same file runs in the browser
   (window.MarkLensExams) and in Node for the tests. Patterns checked October 2026; a key's own "Marks:" and
   "Subject:" lines always win over these defaults. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MarkLensExams = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // format: 'omr' = answered by choosing options (OMR or computer-based), 'written' = marked by a teacher, '' = either.
  // right / wrong: marks for a right answer and the minus for a wrong one. multi: what a key with several letters means:
  // 'any' = either option is accepted (NTA's rule when a question has two right answers), 'partial' = all of them are the
  // answer and part-right gets part marks (JEE Advanced), 'all' = all of them, no part marks (GATE MSQ).
  // sections: [subject, first question, last question], used when the key has no Subject lines.
  const EXAMS = [
    { id: 'general', group: 'Any exam', name: 'Any exam', format: '', grading: 'letter' },
    { id: 'school', group: 'School', name: 'School test or term exam', format: 'written', grading: 'cbse', pass: 33 },
    { id: 'cbse', group: 'School', name: 'CBSE board (Class 10 or 12)', format: 'written', grading: 'cbse', pass: 33, about: 'Grades A1 to E2. Pass mark 33% in each subject.' },
    { id: 'icse', group: 'School', name: 'ICSE (Class 10)', format: 'written', grading: 'percent', pass: 33, about: 'Pass mark 33% in each subject.' },
    { id: 'isc', group: 'School', name: 'ISC (Class 12)', format: 'written', grading: 'percent', pass: 35, about: 'Pass mark 35% in each subject.' },
    { id: 'state', group: 'School', name: 'State board (SSC, HSC, SSLC, PUC)', format: 'written', grading: 'percent', pass: 35, about: 'Most state boards pass at 35% in each subject. Check your board\'s rule.' },
    { id: 'neet', group: 'Entrance exams', name: 'NEET (UG)', format: 'omr', right: 4, wrong: 1, questions: 180, minutes: 180,
      sections: [['Physics', 1, 45], ['Chemistry', 46, 90], ['Botany', 91, 135], ['Zoology', 136, 180]], about: '180 questions, all compulsory. +4 right, −1 wrong.' },
    { id: 'jee-main', group: 'Entrance exams', name: 'JEE Main (Paper 1)', format: 'omr', right: 4, wrong: 1, questions: 75, minutes: 180, numeric: true,
      sections: [['Maths', 1, 25], ['Physics', 26, 50], ['Chemistry', 51, 75]], about: '20 MCQs and 5 numerical answers per subject. +4 right, −1 wrong in both.' },
    { id: 'jee-adv', group: 'Entrance exams', name: 'JEE Advanced', format: 'omr', right: 3, wrong: 1, multi: 'partial', numeric: true,
      about: 'Marking changes every year. Put a line like "Marks: +4 -2 partial" before each section of the key.' },
    { id: 'cuet', group: 'Entrance exams', name: 'CUET (UG)', format: 'omr', right: 5, wrong: 1, questions: 50, minutes: 60, about: '50 questions per test. +5 right, −1 wrong.' },
    { id: 'cet', group: 'Entrance exams', name: 'State CET (KCET, MHT CET, EAPCET)', format: 'omr', right: 1, wrong: 0, about: 'No minus marks. MHT CET gives 2 marks for Maths: add "Marks: +2 0" before it.' },
    { id: 'ssc', group: 'Government jobs', name: 'SSC CGL (Tier 1)', format: 'omr', right: 2, wrong: 0.5, questions: 100, minutes: 60,
      sections: [['Reasoning', 1, 25], ['General awareness', 26, 50], ['Quantitative aptitude', 51, 75], ['English', 76, 100]], about: '4 sections of 25 questions. +2 right, −0.5 wrong.' },
    { id: 'bank', group: 'Government jobs', name: 'Bank PO or Clerk prelims (IBPS, SBI)', format: 'omr', right: 1, wrong: 0.25, questions: 100, minutes: 60, about: '+1 right, −0.25 wrong. Add Subject lines for English, Quant and Reasoning.' },
    { id: 'upsc', group: 'Government jobs', name: 'UPSC Prelims (GS Paper I)', format: 'omr', right: 2, wrong: 0.66, questions: 100, minutes: 120, about: '+2 right, −0.66 wrong (a third of the marks).' },
    { id: 'gate', group: 'College', name: 'GATE', format: 'omr', right: 1, wrong: 0.33, multi: 'all', numeric: true, questions: 65, minutes: 180,
      about: '1- and 2-mark questions. Put "Marks: +2 -0.66" before 2-mark MCQs and "Marks: +1 0" before MSQ and numerical ones.' },
    { id: 'university', group: 'College', name: 'University or college exam', format: 'written', grading: 'ugc', pass: 40, about: 'Grades on the usual 10-point scale (O to F). Your university\'s scale may differ.' }
  ];
  const byId = new Map(EXAMS.map(e => [e.id, e]));
  const get = id => byId.get(id) || byId.get('general');

  // a short line under the exam picker
  function summary(e){
    if (!e || e.id === 'general') return 'Works for any paper: written, multiple choice, or both.';
    const bits = [];
    if (e.about) bits.push(e.about);
    else if (e.format === 'omr' && e.right != null) bits.push(`+${num(e.right)} for a right answer, ${e.wrong ? '−' + num(e.wrong) : 'no minus'} for a wrong one.`);
    if (e.sections) bits.push('Subjects by question number: ' + e.sections.map(([s, a, b]) => `${s} ${a}–${b}`).join(', ') + '.');
    return bits.join(' ');
  }
  const num = n => String(Math.round(n * 100) / 100);

  // the subject of question q from the exam's sections ('' when the exam has none or q is outside them)
  function sectionOf(e, q){
    const n = parseInt(q, 10);
    if (!e || !e.sections || !(n > 0)) return '';
    const s = e.sections.find(([, a, b]) => n >= a && n <= b);
    return s ? s[0] : '';
  }

  /* ---------- grades and pass marks ---------- */

  // CBSE's 9-point scale (marks out of 100), and the UGC 10-point scale many universities use
  const CBSE = [[91, 'A1'], [81, 'A2'], [71, 'B1'], [61, 'B2'], [51, 'C1'], [41, 'C2'], [33, 'D'], [21, 'E1'], [0, 'E2']];
  const UGC = [[90, 'O', 10], [80, 'A+', 9], [70, 'A', 8], [60, 'B+', 7], [55, 'B', 6], [50, 'C', 5], [40, 'P', 4], [0, 'F', 0]];
  const LETTER = [[90, 'A+'], [80, 'A'], [70, 'B'], [60, 'C'], [50, 'D'], [0, 'F']];
  // { stamp: what the red-pen stamp says, title: what it means, pass: true/false/null }
  function grade(pct, e){
    e = e || get('general');
    const p = Math.max(0, pct), r = Math.round(p);
    const pass = e.pass ? p >= e.pass - 1e-9 : null;
    switch (e.grading) {
      case 'cbse': { const g = CBSE.find(([lo]) => r >= lo)[1]; return { stamp: g, title: `Grade ${g} on the CBSE scale`, pass }; }
      case 'ugc': { const [, g, gp] = UGC.find(([lo]) => p >= lo); return { stamp: g, title: `Grade ${g}, ${gp} grade points on the 10-point scale`, pass }; }
      case 'percent': return { stamp: pass ? 'Pass' : 'Below', title: pass ? `Above the ${e.pass}% pass mark` : `Below the ${e.pass}% pass mark`, pass };
      default:
        if (e.format === 'omr' && e.id !== 'general') return { stamp: '', title: '', pass: null };   // entrance and job exams rank by marks, not grades
        return { stamp: LETTER.find(([lo]) => p >= lo)[1], title: 'Grade', pass };
    }
  }

  /* ---------- negative marking: when is a guess worth it? ---------- */

  // average marks from answering after ruling out some options: (right - wrong x (wrong options left)) / options left
  const guessValue = (right, wrong, options = 4, ruledOut = 0) => { const k = Math.max(1, options - ruledOut); return (right - (k - 1) * wrong) / k; };
  // the least sure you can be and still gain from answering, on average
  const breakEven = (right, wrong) => wrong > 0 ? wrong / (right + wrong) : 0;

  return { EXAMS, get, summary, sectionOf, grade, guessValue, breakEven, CBSE, UGC };
});
