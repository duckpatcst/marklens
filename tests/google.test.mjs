// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/google.js';

// A tiny Google Vision reply: a student's answer line, a red mark in the right margin, and the total at the top.
const word = (text, x0, y0, x1, y1, brk = 'SPACE') => ({
  boundingBox: { vertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] }, confidence: 0.95,
  symbols: [...text].map((ch, i, a) => {
    const w = (x1 - x0) / a.length, sx = x0 + i * w;
    return { text: ch, boundingBox: { vertices: [{ x: sx, y: y0 }, { x: sx + w, y: y0 }, { x: sx + w, y: y1 }, { x: sx, y: y1 }] }, ...(i === a.length - 1 ? { property: { detectedBreak: { type: brk } } } : {}) };
  })
});
const resp = { fullTextAnnotation: { pages: [{ width: 1500, height: 2000, blocks: [
  { paragraphs: [{ words: [word('21/38', 1200, 60, 1330, 130, 'LINE_BREAK')] }] },
  { paragraphs: [{ words: [word('Q1)', 160, 300, 230, 340), word('2x+3=11', 245, 300, 420, 340, 'LINE_BREAK'), word('x=4', 245, 360, 330, 400, 'LINE_BREAK')] }] },
  { paragraphs: [{ words: [word('2', 1310, 370, 1340, 420, 'LINE_BREAK')] }] },
  { paragraphs: [{ words: [word('Q2)', 160, 500, 230, 540), word('(x-2)(x-3)', 245, 500, 480, 540, 'LINE_BREAK')] }] },
  { paragraphs: [{ words: [word('1', 1300, 505, 1318, 545), word('/', 1320, 505, 1335, 545), word('3', 1338, 505, 1362, 545, 'LINE_BREAK')] }] }
] }] } };

test('parseVision and readLines put the margin mark on its line', () => {
  const doc = G.parseVision(resp);
  assert.equal(doc.width, 1500);
  assert.equal(doc.words.length, 10);
  const lines = G.readLines(doc);
  const text = G.plainText(lines).split('\n');
  assert.deepEqual(text, ['21/38', 'Q1) 2x+3=11', 'x=4 2', 'Q2) (x-2)(x-3) 1 / 3']);
});

test('tagRed and transcript tag only the red writing', () => {
  const lines = G.readLines(G.parseVision(resp));
  // pretend the photo shows red ink right of x=1150
  G.tagRed(lines, (x0) => x0 > 1150 ? 0.95 : 0.02);
  const tr = G.transcript([{ lines, width: 1500 }]);
  assert.match(tr.text, /⟦m1 margin: 21\/38⟧/);
  assert.match(tr.text, /x=4 ⟦m2 margin: 2⟧/);
  assert.match(tr.text, /Q2\) \(x-2\)\(x-3\) ⟦m3 margin: 1\/3⟧/);
  assert.equal(tr.marks.length, 3);
  assert.deepEqual(tr.marks[2].value, { got: 1, max: 3 });
});

test('parseRedValue reads what teachers write', () => {
  const v = G.parseRedValue;
  assert.deepEqual(v('3'), { got: 3, max: null });
  assert.deepEqual(v('3/5'), { got: 3, max: 5 });
  assert.deepEqual(v('2½'), { got: 2.5, max: null });
  assert.deepEqual(v('2 1/2'), { got: 2.5, max: null });
  assert.deepEqual(v('(4)'), { got: 4, max: null });
  assert.deepEqual(v('③'), { got: 3, max: null });
  assert.deepEqual(v('l'), { got: 1, max: null });
  assert.deepEqual(v('O'), { got: 0, max: null });
  assert.deepEqual(v('S/6'), { got: 5, max: 6 });
  assert.equal(v('✓'), null);
  assert.equal(v('v'), null);
  assert.equal(v('sign error'), null);
  assert.equal(v('345'), null);
});

test('parseMarksReply keeps the ids and the total', () => {
  const r = G.parseMarksReply('1: 2/2 [m2]\n2: 1/3 [m3,m4] sign error\n3: 0/5 [] not attempted\nTotal: 21/38 [m1]');
  assert.deepEqual(r.lines, ['1: 2/2', '2: 1/3 sign error', '3: 0/5 not attempted']);
  assert.deepEqual(r.used, { 1: ['m2'], 2: ['m3', 'm4'], 3: [] });
  assert.deepEqual(r.total, { got: 21, max: 38, ids: ['m1'] });
});

test('findLabels and labelMarks give each mark the question above it', () => {
  const lines = G.readLines(G.parseVision(resp));
  G.tagRed(lines, (x0) => x0 > 1150 ? 0.95 : 0.02);
  const pages = [{ lines, width: 1500 }];
  const labels = G.findLabels(pages);
  assert.deepEqual(labels.map(l => l.q), ['1', '2']);
  const tr = G.transcript(pages);
  G.labelMarks(tr.marks, labels);
  assert.deepEqual(tr.marks.map(m => m.label), [null, '1', '2']);
});
