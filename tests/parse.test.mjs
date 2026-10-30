// Unit tests for js/parse.js. Run from the project folder with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('../js/parse.js');
const { parsePaper, annotatePaper, parseSheet, matchSheet, parseKey, parseOmrAnswers, scoreAnswer, keyText, classifyCause, tidyPaper, tidySheet, chunkPages } = P;

test('papers that restart numbering in each section get section labels', () => {
  const p = parsePaper('Section A: Algebra\n1. Solve x [2]\n2. Factor [3]\nSection B: Geometry\n1. Area of circle [3]\n2. Prove [5]');
  assert.deepEqual(p.map(x => `${x.q}:${x.max}:${x.topic}`), ['A1:2:Algebra', 'A2:3:Algebra', 'B1:3:Geometry', 'B2:5:Geometry']);
  assert.ok(p.every(x => x.subject === 'Maths'));
  const s = matchSheet(p, parseSheet('1: 2/2\n2: 1/3 sign error\n1: 1/3 forgot units\n2: 0/5 not attempted'));
  assert.deepEqual(s.map(x => `${x.q}:${x.got}`), ['A1:2', 'A2:1', 'B1:1', 'B2:0']);
});

test('marks: parts add up, f(2) is not a mark, x-style totals and halves', () => {
  assert.deepEqual(parsePaper('1. (a) Solve x [2]\n(b) Factor [3]\n2 a) find [1] b) show [2]\n3. f(2) value [4]').map(x => `${x.q}:${x.max}`), ['1:5', '2:3', '3:4']);
  assert.deepEqual(parsePaper('1. Answer any five. [1×5=5]\n2. Define (2 x 3 = 6)\n3. Explain. (5 marks)\n4. Write. 4M\n5. Short [½]').map(x => `${x.q}:${x.max}`), ['1:5', '2:6', '3:5', '4:4', '5:0.5']);
});

test('sheet lines with parts and halves', () => {
  const sh = parseSheet('1(a): 1/2\n1(b): 2/3 careless\nQ2 (i): 1/1\n3a: 0/2\n4: 1½/3\n5: 2.5/3\n6: ½/1\n7 - 3 out of 5 careless');
  assert.equal(sh.length, 8); assert.equal(sh[4].got, 1.5); assert.equal(sh[6].got, 0.5);
  const s = matchSheet(parsePaper('1. a [5]\n2. b [1]\n3. c [2]'), sh);
  assert.deepEqual([s[0].q, s[0].got, s[0].max, s[0].remark], ['1', 3, 5, 'careless']);
  const again = matchSheet(parsePaper('1. a [5]\n2. b [5]'), parseSheet('1: 2/5\n2: 1/5\n2: 3/5'));
  assert.equal(again.length, 2); assert.equal(again[1].got, 3);   // a question repeated across a page break keeps its latest line
});

test('the example paper keeps its types, subject and lessons', () => {
  const p = parsePaper('Section A: Algebra\n1. Solve 2x + 3 = 11 [2]\n2. Factorise x^2 - 5x + 6 [3]\n3. Choose the correct root of x^2 = 49: a) 5 b) 7 c) 9 d) 11 [1]');
  assert.deepEqual(p.map(x => `${x.q}:${x.max}:${x.type}`), ['1:2:Short answer', '2:3:Short answer', '3:1:MCQ']);
  assert.deepEqual([...new Set(p.map(x => x.subject + '/' + x.topic))], ['Maths/Algebra']);
});

test('subjects on a paper: Subject lines, subject-name lines and lessons guessed from the question', () => {
  const p = parsePaper('Subject: Physics\nSection A: Optics\n1. Find the focal length of a lens [3]\nCHEMISTRY\n2. Balance the chemical equation [2]\n3. Name an alkane [1]\nBiology:\n4. Explain photosynthesis [3]');
  assert.deepEqual(p.map(x => `${x.subject}/${x.topic}`), ['Physics/Optics', 'Chemistry/Chemical reactions', 'Chemistry/Organic chemistry', 'Biology/Plant physiology']);
  assert.equal(parsePaper('1. Solve x + 2 = 5 [2] #Linear equations')[0].topic, 'Linear equations');   // a #tag names the lesson
});

test('why marks were lost, from the teacher\'s remark', () => {
  assert.equal(classifyCause('sign error while factorising', 2), 'Units & signs');
  assert.equal(classifyCause('concept not clear, incomplete proof', 3), 'Concept gap');
  assert.equal(classifyCause('not attempted', 5), 'Incomplete / unattempted');
  assert.equal(classifyCause('careless calculation of median', 1), 'Careless / calculation');
  assert.equal(classifyCause('anything', 0), 'None');
});

test('answer keys: common formats, rows of letters, several answers, bonus', () => {
  const show = k => k.map(x => `${x.q}${x.keys}`).join(' ');
  assert.equal(show(parseKey('1-B\n2. d\n3) A\nQ4: C\n5 B')), '1B 2D 3A 4C 5B');
  assert.equal(show(parseKey('BDACB\nCA')), '1B 2D 3A 4C 5B 6C 7A');
  assert.equal(show(parseKey('1-B 2-D 3-A, 4-C; 5-B')), '1B 2D 3A 4C 5B');
  assert.equal(show(parseKey('1-A,C\n2-BD\n3-*')), '1AC 2BD 3*');
  assert.equal(show(parseKey('Total 30 marks\nTime: 1 hour\n1-B')), '1B');
  assert.equal(show(parseKey('4-B ?')), '4B');
});

test('answer keys: subjects, chapters and tags', () => {
  const show = k => k.map(x => `${x.q}:${x.subject}/${x.topic}`).join(' ');
  assert.equal(show(parseKey('Section A: Physics\n1-B\n2-D\nChemistry:\n3-A\n4-C #Organic')), '1:Physics/General 2:Physics/General 3:Chemistry/General 4:Chemistry/Organic');
  assert.equal(show(parseKey('Subject: Physics\nChapter: Optics\n1-A\n2-B\nChapter: Motion\n3-C\nSubject: Chemistry\n4-D')), '1:Physics/Optics 2:Physics/Optics 3:Physics/Motion 4:Chemistry/General');
  // a line added at the end keeps the subject and chapter that cover its number
  assert.equal(show(parseKey('Subject: Physics\nChapter: Optics\n1-A\n2-B\nSubject: Chemistry\n3-C\n4-D\n1-B')), '1:Physics/Optics 2:Physics/Optics 3:Chemistry/General 4:Chemistry/General');
  assert.equal(show(parseKey('Section: Biology\n91-A\nSection: Physics\n1-B\n2-C')), '1:Physics/General 2:Physics/General 91:Biology/General');
  // a chapter heading alone names the subject too
  assert.equal(show(parseKey('Chapter: Electrostatics\n1-A\nChapter: Organic chemistry\n2-B')), '1:Physics/Electrostatics 2:Chemistry/Organic chemistry');
});

test('a scanned key keeps the subjects and chapters typed before', () => {
  const kt = keyText([{ q: 1, marked: 'B' }, { q: 2, marked: 'D', flag: 'check' }, { q: 3, marked: '' }, { q: 4, marked: 'A' }], 'Subject: Physics\nChapter: Optics\n1-A\n2-A\nSubject: Maths\n4-C');
  assert.equal(kt, 'Subject: Physics\nChapter: Optics\n1-B\n2-D ?\nSubject: Maths\n4-A');
  assert.equal(keyText([{ q: 1, marked: 'C' }, { q: 2, marked: 'A' }], ''), '1-C\n2-A');
});

test('student OMR answer lines', () => {
  const a = parseOmrAnswers('1: B\n2: -\n3: AC\n4: d ?\n5: blank\nnotes here');
  assert.deepEqual([...a.entries()].map(([q, x]) => [q, x.marked, x.check]), [[1, 'B', false], [2, '', false], [3, 'AC', false], [4, 'D', true], [5, '', false]]);
  const n = parseOmrAnswers('21: 12\n22: -0.5\n23: 4.25 ?');
  assert.deepEqual([...n.values()].map(x => [x.num, x.marked, x.check]), [[12, '', false], [-0.5, '', false], [4.25, '', true]]);
});

test('Google Lens text: tidy rules and page batches', () => {
  assert.equal(tidyPaper('Q.1 Solve 2x+3=11 [2\nQues 2) Factorise [31]'), '1. Solve 2x+3=11 [2]\n2. Factorise [3]');
  assert.equal(tidySheet('Q1 2 out of 3 careless'), '1: 2/3 careless');
  const c = chunkPages([{ n: 1, text: 'a'.repeat(4000) }, { n: 2, text: 'b'.repeat(4000) }, { n: 3, text: 'c' }]);
  assert.deepEqual(c.map(x => [x.first, x.last]), [[1, 1], [2, 3]]);
});

test('topic notes on question lines: read, kept off the question, and written back', () => {
  const text = 'Subject: Physics\n1. Find the focal length of a lens [3] ## Optics > Lens formula\n2. State Ohm\'s law [2]\n3. Define\n   momentum. [1] ## Physics > Laws of motion > Momentum';
  const p = parsePaper(text);
  assert.deepEqual(p.map(x => [x.q, x.subject, x.topic, x.sub, x.max]), [['1', 'Physics', 'Optics', 'Lens formula', 3], ['2', 'Physics', 'Current electricity', 'Ohm\'s law and resistance', 2], ['3', 'Physics', 'Laws of motion', 'Momentum', 1]]);
  assert.equal(p[0].text, 'Find the focal length of a lens');             // no marks label, no note
  const again = annotatePaper(text, new Map([['1', 'Physics > Ray optics > Thin lens formula'], ['3', 'Laws of motion > Impulse']]));
  assert.match(again, /^1\. Find the focal length of a lens \[3\] ## Physics > Ray optics > Thin lens formula$/m);   // replaces the old note
  assert.match(again, /^   momentum\. \[1\] ## Laws of motion > Impulse$/m);                                    // on the question's last line
  assert.equal(again.split('\n').length, text.split('\n').length);
  assert.deepEqual(parsePaper(again).map(x => x.sub), ['Thin lens formula', 'Ohm\'s law and resistance', 'Impulse']);
});

test('answer keys: numerical answers, ranges and marking lines', () => {
  const k = parseKey('Subject: Maths\nMarks: +4 -1\n1-B\n21 = 12\n22 = 2.30 to 2.35\nMarks: +4 -2 partial\n23-ACD\nMarks: +2 -2/3\n24-C');
  assert.deepEqual(k.map(x => [x.q, x.keys, x.num && [x.num.lo, x.num.hi]]), [[1, 'B', null], [21, '', [12, 12]], [22, '', [2.3, 2.35]], [23, 'ACD', null], [24, 'C', null]]);
  assert.deepEqual(k[0].marks, { right: 4, wrong: 1, multi: '' });
  assert.deepEqual(k[3].marks, { right: 4, wrong: 2, multi: 'partial' });
  assert.equal(Math.round(k[4].marks.wrong * 1000) / 1000, 0.667);
  assert.equal(parseKey('Q5 = -3')[0].num.lo, -3);
  // a heading for questions added at the end still applies by number
  assert.equal(parseKey('Marks: +3 -1\n1-A\nMarks: +4 0\n10 = 7\n2-B').find(x => x.q === 2).marks.right, 3);
});

test('scoring: single answer, either option, bonus, numerical, JEE Advanced partial marks, GATE MSQ', () => {
  const d = { right: 4, wrong: 1 };
  const key = s => parseKey(s)[0], ans = s => parseOmrAnswers('1: ' + s).get(1), sc = (k, a, o = d) => { const r = scoreAnswer(key(k), a === null ? undefined : ans(a), o); return [r.got, r.cause]; };
  assert.deepEqual(sc('1-B', 'B'), [4, 'None']);
  assert.deepEqual(sc('1-B', 'C'), [-1, 'Wrong option']);
  assert.deepEqual(sc('1-B', null), [0, 'Incomplete / unattempted']);
  assert.deepEqual(sc('1-B', 'BC'), [-1, 'Bubbling error']);
  assert.deepEqual(sc('1-A,C', 'C'), [4, 'None']);                   // NTA: either option is right
  assert.deepEqual(sc('1-*', null), [4, 'None']);                    // dropped question
  assert.deepEqual(sc('1 = 2.30 to 2.35', '2.32'), [4, 'None']);
  assert.deepEqual(sc('1 = 12', '13'), [-1, 'Wrong answer']);
  assert.equal(scoreAnswer(key('1 = 12'), ans('12'), d).type, 'Numerical');
  const adv = { right: 4, wrong: 2, multi: 'partial' };
  assert.deepEqual(sc('1-ACD', 'ACD', adv), [4, 'None']);
  assert.deepEqual(sc('1-ACD', 'AD', adv), [2, 'Incomplete / unattempted']);   // two right options, none wrong: +2
  assert.deepEqual(sc('1-ACD', 'AB', adv), [-2, 'Wrong option']);
  assert.equal(scoreAnswer(key('1-ACD'), ans('A'), adv).type, 'Multiple correct');
  assert.deepEqual(sc('1-AC', 'A', { right: 2, wrong: 0, multi: 'all' }), [0, 'Incomplete / unattempted']);   // GATE MSQ: all or nothing
  // a Marks line in the key wins over the boxes
  assert.deepEqual(scoreAnswer(parseKey('Marks: +3 -1\n1-B')[0], ans('C'), d).got, -1);
  assert.deepEqual(scoreAnswer(parseKey('Marks: +3 -1\n1-B')[0], ans('B'), d).max, 3);
});

test('a scanned key keeps numerical answers and marking lines typed before', () => {
  const kt = keyText([{ q: 1, marked: 'B' }, { q: 2, marked: 'C' }], 'Marks: +4 -1\n1-A\n2-A\n3 = 12');
  assert.equal(kt, 'Marks: +4 -1\n1-B\n2-C\n3 = 12');
});

test('marks from the paper\'s rules: ranges, "each question carries", and 10x1=10 beside a section', () => {
  // as printed on a commerce paper: numbered instructions are rules, not questions
  const acc = parsePaper(`General Instructions:
1. This question paper has two parts - Part-A and Part B.
2. Questions from 1 to 3 and 7 to 8 carry 1 mark each.
3. Questions from 4 to 5 and 9 carry 3 marks each.
4. Questions from 6 to 6 carry 6 marks each.
PART-A
SECTION-A
I. CHOOSE THE BEST ANSWER: 3x1=3
1. Which is not capital expenditure?
2. Pick the correct order
1 (A) 50,000 (B) 1,10,000
3. What is revenue?
4. Explain [3]
5. Explain
6. Prepare a ledger
7. Define
8. Define
9. Journalise`);
  assert.deepEqual(acc.map(q => `${q.q}:${q.max}`), ['1:1', '2:1', '3:1', '4:3', '5:3', '6:6', '7:1', '8:1', '9:3']);
  // as printed on a computer science paper, with the section rules as bullets and NxM=T beside each section
  const py = parsePaper(`• Section B, Consist of 2 questions (3-4). Each question carries 2 marks.
SECTION – A 2x1=2
1. What can be the output?
2. Which is unordered?
SECTION -B 2x2=4
3. Write a short note on mutability.
4. Predict the output.
SECTION ~ C
Each question carries 3 marks.
5. Explain loops.`);
  assert.deepEqual(py.map(q => `${q.q}:${q.max}`), ['1:1', '2:1', '3:2', '4:2', '5:3']);
  assert.deepEqual(py.map(q => q.sec), ['A', 'A', 'B', 'B', 'C']);
  // a question's own label still wins, and "Section A: Algebra" still names the lesson
  const own = parsePaper('Section A: Algebra 2x1=2\n1. Solve [5]\n2. Factor');
  assert.deepEqual(own.map(q => `${q.q}:${q.max}:${q.topic}`), ['1:5:Algebra', '2:1:Algebra']);
});

test('tidyPaper: "4, What" is question 4; a stray mark before the options is not', () => {
  assert.equal(tidyPaper('4, What amount is income?'), '4. What amount is income?');
  assert.equal(tidyPaper('1 (A) 50,000 (B) 1,10,000'), '1 (A) 50,000 (B) 1,10,000');
});
