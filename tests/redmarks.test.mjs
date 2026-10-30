// Tests for js/redmarks.js: matching marks to questions (readSheet), and the model's maths against the Python trainer.
// Run from the project folder with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const RM = require('../js/redmarks.js');

// A page as readPage returns it, written by hand: question numbers down the left, marks where the teacher put them.
// read(n): a label whose digits clearly read n.
const read = n => String(n).split('').map(d => Array.from({ length: 10 }, (_, k) => (k === +d ? 0.9 : 0.011)));
const label = (n, y) => ({ x0: 40, y0: y - 12, x1: 70, y1: y + 12, cy: y, reads: n == null ? [] : read(n) });
const tick = (y, extra = {}) => ({ kind: 'tick', conf: 0.95, x0: 300, y0: y - 60, x1: 400, y1: y, w: 100, h: 60, ax: 310, ay: y, side: '', ...extra });
const cross = y => ({ kind: 'cross', conf: 0.9, x0: 300, y0: y - 20, x1: 340, y1: y + 20, w: 40, h: 40, ax: 320, ay: y, side: '' });
const num = (v, y, extra = {}) => ({ kind: 'mark', got: v, max: null, text: String(v), conf: 0.95, x0: 10, y0: y - 15, x1: 30, y1: y + 15, w: 20, h: 30, ax: 20, ay: y, side: 'left', ...extra });
const page = (labels, marks) => ({ width: 1200, height: 1600, lineGap: 44, labels, marks });
const qs = (n, max = 1, sec = 'A') => Array.from({ length: n }, (_, i) => ({ q: String(i + 1), n: i + 1, max: typeof max === 'function' ? max(i + 1) : max, sec: typeof sec === 'function' ? sec(i + 1) : sec }));

test('ticks give full marks, crosses give 0, in the order of the question numbers', () => {
  const pg = page([1, 2, 3, 4].map((n, i) => label(n, 100 + i * 90)), [tick(110), cross(190), tick(290), cross(370)]);
  const r = RM.readSheet([pg], qs(4));
  assert.deepEqual(r.rows.map(x => `${x.q}:${x.got}/${x.max}`), ['1:1/1', '2:0/1', '3:1/1', '4:0/1']);
  assert.ok(r.rows.every(x => !x.check));
  assert.deepEqual(r.lines.slice(0, 2), ['1: 1/1 ✓', '2: 0/1 ✗']);
});

test('a heading such as "I." above question 1 is skipped, and a tick on a 2-mark answer is full marks', () => {
  const pg = page([label(1, 60), ...[1, 2, 3].map((n, i) => label(n, 150 + i * 90))], [tick(160), tick(250), tick(340)]);
  const r = RM.readSheet([pg], qs(3, q => (q === 3 ? 2 : 1)));
  assert.deepEqual(r.rows.map(x => `${x.q}:${x.got}/${x.max}`), ['1:1/1', '2:1/1', '3:2/2']);
});

test('a mark forgotten on one answer is filled from the teacher\'s subtotal, and flagged', () => {
  // questions 1-4 ticked except 3, which has nothing; "4" in the margin is the section subtotal
  const pg = page([1, 2, 3, 4].map((n, i) => label(n, 100 + i * 90)), [tick(110), tick(200), num(4, 250, { h: 80 }), tick(380)]);
  const r = RM.readSheet([pg], qs(4));
  const q3 = r.rows.find(x => x.q === '3');
  assert.equal(q3.got, 1); assert.equal(q3.check, true); assert.match(q3.why, /subtotal 4/);
  assert.equal(r.rows.reduce((a, x) => a + x.got, 0), 4);
});

test('a subtotal that disagrees with the ticks is reported, never silently used', () => {
  const pg = page([1, 2, 3].map((n, i) => label(n, 100 + i * 90)), [tick(110), cross(200), num(3, 230), tick(290)]);
  const r = RM.readSheet([pg], qs(3));
  assert.deepEqual(r.rows.map(x => x.got), [1, 0, 1]);
  assert.ok(r.rows.every(x => x.check));
  assert.ok(r.notes.some(n => /add up to 2/.test(n)));
});

test('the subtotal covers its own section only', () => {
  // section A: Q1-3 (1 mark), section B: Q4 (2 marks, number "1½" beside it)
  const pg = page([1, 2, 3, 4].map((n, i) => label(n, 100 + i * 90)), [tick(110), tick(200), num(2, 210, { h: 70 }), cross(290), num(1.5, 380, { text: '1½' })]);
  const r = RM.readSheet([pg], qs(4, q => (q === 4 ? 2 : 1), q => (q === 4 ? 'B' : 'A')));
  assert.deepEqual(r.rows.map(x => `${x.q}:${x.got}`), ['1:1', '2:1', '3:0', '4:1.5']);
  assert.ok(r.notes.some(n => /subtotal 2 for Q1–Q3 matches/.test(n)));
});

test('the circled total at the top is the total, not a question\'s mark; a signature is ignored', () => {
  const pg = page([1, 2].map((n, i) => label(n, 200 + i * 90)), [
    num(68, 40, { max: 80, text: '68/80', circled: true, side: '', x0: 600, x1: 700 }),
    { kind: 'other', conf: 0.5, x0: 800, y0: 20, x1: 900, y1: 60, w: 100, h: 40, ax: 850, ay: 40, side: '' },
    tick(210), tick(300)]);
  const r = RM.readSheet([pg], qs(2));
  assert.deepEqual(r.total, { got: 68, max: 80, text: '68/80' });
  assert.deepEqual(r.rows.map(x => x.got), [1, 1]);
  assert.match(r.notes[0], /Teacher's total: 68\/80/);
});

test('an answer that runs onto the next page keeps its marks; numbers carry on across pages', () => {
  const p1 = page([1, 2].map((n, i) => label(n, 100 + i * 90)), [tick(110)]);
  const p2 = page([label(3, 300)], [num(2, 120, { side: '' }), tick(310)]);   // the "2" at the top of page 2 belongs to question 2
  const r = RM.readSheet([p1, p2], qs(3, q => (q === 2 ? 3 : 1)));
  assert.deepEqual(r.rows.map(x => `${x.q}:${x.got}/${x.max}`), ['1:1/1', '2:2/3', '3:1/1']);
});

test('a number bigger than the question, ticks and crosses together, and no mark at all are flagged', () => {
  const pg = page([1, 2, 3].map((n, i) => label(n, 100 + i * 90)), [num(4, 110, { side: '' }), tick(200), cross(205)]);
  const r = RM.readSheet([pg], qs(3, 2));
  const by = Object.fromEntries(r.rows.map(x => [x.q, x]));
  assert.equal(by['1'].check, true);
  assert.equal(by['2'].check, true); assert.match(by['2'].why, /tick and a cross/);
  assert.equal(by['3'].check, true); assert.match(by['3'].why, /no red mark/);
});

test('without a question paper, answers are numbered from the first number read', () => {
  const pg = page([5, 6, 7].map((n, i) => label(n, 100 + i * 90)), [tick(110), cross(200), tick(290)]);
  const r = RM.readSheet([pg], []);
  assert.deepEqual(r.lines, ['5: 1/1 ✓', '6: 0/1 ✗', '7: 1/1 ✓']);
});

test('the lines the reader writes are read back by the sheet parser, with the check notes kept apart', () => {
  const P = require('../js/parse.js');
  const sh = P.parseSheet('10: 1/1 – check: no mark next to this answer; the teacher\'s subtotal 13 for Q1–Q13 says it got 1\n11: 1½/2 ✓\n12: 0/1 ✗');
  assert.deepEqual(sh.map(s => `${s.n}:${s.got}/${s.max}`), ['10:1/1', '11:1.5/2', '12:0/1']);
  assert.match(sh[0].remark, /check:/);
});

// The JavaScript model must compute exactly what the Python trainer computed (written by train.py --vectors).
test('model maths match the trainer', { skip: !fs.existsSync(new URL('./fixtures/marks-vectors.json', import.meta.url)) }, () => {
  const model = RM.loadModel(JSON.parse(fs.readFileSync(new URL('../models/marks-v2.json', import.meta.url), 'utf8')));
  const vec = JSON.parse(fs.readFileSync(new URL('./fixtures/marks-vectors.json', import.meta.url), 'utf8'));
  for (const v of vec) {
    const bits = Buffer.from(v.mask, 'base64'), mask = new Uint8Array(v.w * v.h);
    for (let i = 0; i < mask.length; i++) mask[i] = (bits[i >> 3] >> (7 - (i & 7))) & 1;
    const g = RM.normalizeGlyph(mask, v.w, v.h), want = new Float32Array(Buffer.from(v.glyph, 'base64').buffer.slice(0));
    for (let i = 0; i < 784; i++) assert.ok(Math.abs(g[i] - want[i]) < 1e-4, 'glyph pixel ' + i);
    const l = model.logits(g);
    v.logits.forEach((x, i) => assert.ok(Math.abs(l[i] - x) < 2e-3, `logit ${i}: ${l[i]} vs ${x}`));
  }
});

test('a question number hidden under a red subtotal: the second mark in the answer above goes to it, flagged', () => {
  // numbers 1, 2 and 4 found; 3 is hidden. Question 2's stretch holds a tick (line of Q2) and a cross (line of Q3).
  const pg = page([label(1, 100), label(2, 190), label(4, 370)], [tick(110), tick(200), cross(285), tick(380)]);
  const r = RM.readSheet([pg], qs(4));
  assert.deepEqual(r.rows.map(x => `${x.q}:${x.got}`), ['1:1', '2:1', '3:0', '4:1']);
  assert.equal(r.rows[2].check, true); assert.match(r.rows[2].why, /question number was not found/);
});
