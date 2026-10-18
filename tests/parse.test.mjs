// Unit tests for js/parse.js. Run from the project folder with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('../js/parse.js');
const { parsePaper, parseSheet, matchSheet, parseKey, parseOmrAnswers, keyText, classifyCause, tidyPaper, tidySheet, chunkPages } = P;

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
  assert.deepEqual([...a.entries()], [[1, { marked: 'B', check: false }], [2, { marked: '', check: false }], [3, { marked: 'AC', check: false }], [4, { marked: 'D', check: true }], [5, { marked: '', check: false }]]);
});

test('Google Lens text: tidy rules and page batches', () => {
  assert.equal(tidyPaper('Q.1 Solve 2x+3=11 [2\nQues 2) Factorise [31]'), '1. Solve 2x+3=11 [2]\n2. Factorise [3]');
  assert.equal(tidySheet('Q1 2 out of 3 careless'), '1: 2/3 careless');
  const c = chunkPages([{ n: 1, text: 'a'.repeat(4000) }, { n: 2, text: 'b'.repeat(4000) }, { n: 3, text: 'c' }]);
  assert.deepEqual(c.map(x => [x.first, x.last]), [[1, 1], [2, 3]]);
});
