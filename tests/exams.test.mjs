// Unit tests for js/exams.js. Run from the project folder with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const E = createRequire(import.meta.url)('../js/exams.js');

test('every exam has a name, a group and a known format', () => {
  const ids = new Set();
  for (const e of E.EXAMS) {
    assert.ok(e.id && e.name && e.group, e.id);
    assert.ok(['', 'omr', 'written'].includes(e.format), e.id);
    if (e.format === 'omr') assert.ok(e.right > 0 && e.wrong >= 0, e.id);
    for (const [, a, b] of e.sections || []) assert.ok(a <= b, e.id);
    assert.ok(!ids.has(e.id)); ids.add(e.id);
  }
  assert.equal(E.get('nonsense').id, 'general');
});

test('marking schemes of the big exams', () => {
  const s = id => { const e = E.get(id); return [e.right, e.wrong]; };
  assert.deepEqual(s('neet'), [4, 1]);
  assert.deepEqual(s('jee-main'), [4, 1]);
  assert.deepEqual(s('cuet'), [5, 1]);
  assert.deepEqual(s('ssc'), [2, 0.5]);
  assert.equal(E.get('jee-adv').multi, 'partial');
  assert.equal(E.get('gate').multi, 'all');
});

test('subjects by question number', () => {
  const neet = E.get('neet');
  assert.equal(E.sectionOf(neet, 1), 'Physics');
  assert.equal(E.sectionOf(neet, 90), 'Chemistry');
  assert.equal(E.sectionOf(neet, 91), 'Botany');
  assert.equal(E.sectionOf(neet, 180), 'Zoology');
  assert.equal(E.sectionOf(neet, 181), '');
  assert.equal(E.sectionOf(E.get('jee-main'), 26), 'Physics');
  assert.equal(E.sectionOf(E.get('school'), 3), '');
});

test('grades and pass marks', () => {
  assert.equal(E.grade(91, E.get('cbse')).stamp, 'A1');
  assert.equal(E.grade(90.4, E.get('cbse')).stamp, 'A2');
  assert.equal(E.grade(33, E.get('cbse')).stamp, 'D');
  assert.equal(E.grade(32, E.get('cbse')).pass, false);
  assert.equal(E.grade(85, E.get('university')).stamp, 'A+');
  assert.equal(E.grade(39, E.get('university')).stamp, 'F');
  assert.equal(E.grade(34, E.get('isc')).stamp, 'Below');
  assert.equal(E.grade(35, E.get('isc')).stamp, 'Pass');
  assert.equal(E.grade(95, E.get('neet')).stamp, '');                 // ranked by marks, no grade
  assert.equal(E.grade(72, E.get('general')).stamp, 'B');
});

test('when a guess is worth it under negative marking', () => {
  assert.equal(E.guessValue(4, 1, 4, 0), 0.25);
  assert.equal(Math.round(E.guessValue(4, 1, 4, 1) * 100) / 100, 0.67);
  assert.equal(E.guessValue(4, 1, 4, 2), 1.5);
  assert.equal(E.breakEven(4, 1), 0.2);
  assert.equal(E.breakEven(1, 0), 0);
  assert.ok(E.summary(E.get('neet')).includes('Physics 1–45'));
});
