// node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as RP from '../js/redpen.js';

const vectors = JSON.parse(fs.readFileSync(new URL('./fixtures/digit-vectors.json', import.meta.url), 'utf8'));
const model = RP.loadModel(JSON.parse(fs.readFileSync(new URL('../models/digits-v1.json', import.meta.url), 'utf8')));
const unpack = v => { const bits = Buffer.from(v.mask, 'base64'), m = new Uint8Array(v.w * v.h); for (let i = 0; i < m.length; i++) m[i] = (bits[i >> 3] >> (7 - (i & 7))) & 1; return m; };

test('glyph normalisation and the model match the Python training code', () => {
  for (const v of vectors) {
    const g = RP.normalizeGlyph(unpack(v), v.w, v.h);
    const want = new Float32Array(Buffer.from(v.glyph, 'base64').buffer.slice(0));
    for (let i = 0; i < 784; i++) assert.ok(Math.abs(g[i] - want[i]) < 1e-6, 'glyph pixel ' + i);
    const l = model.logits(want);
    for (let i = 0; i < 11; i++) assert.ok(Math.abs(l[i] - v.logits[i]) < 1e-3, 'logit ' + i);
  }
});

// a small "photo": warm paper, blue ruled lines, a pink margin line, the student's digit in blue
// and the teacher's mark in red in the right margin
function page(redMask, rw, rh, blueMask, bw, bh) {
  const W = 700, H = 900, d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, shade = 1 - 0.12 * x / W;
    let r = 244 * shade, g = 238 * shade, b = 222 * shade;
    if (y % 40 === 0) { r *= 0.8; g *= 0.85; b *= 0.98; }
    if (x === 90 || x === 91) { r *= 0.95; g *= 0.6; b *= 0.65; }
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  const paint = (m, mw, mh, ox, oy, k, ink) => {
    for (let y = 0; y < mh * k; y++) for (let x = 0; x < mw * k; x++) {
      if (!m[((y / k) | 0) * mw + ((x / k) | 0)]) continue;
      const i = ((oy + y) * W + ox + x) * 4;
      d[i] = d[i] * ink[0]; d[i + 1] = d[i + 1] * ink[1]; d[i + 2] = d[i + 2] * ink[2];
    }
  };
  paint(redMask, rw, rh, 560, 300, 1, [0.85, 0.15, 0.2]);
  paint(blueMask, bw, bh, 250, 600, 1, [0.2, 0.25, 0.75]);
  return { width: W, height: H, data: d };
}

test('a red digit in the margin is read, a blue one is not', () => {
  const red = vectors.find(v => v.h >= 40 && model.predict(RP.normalizeGlyph(unpack(v), v.w, v.h)).indexOf(Math.max(...model.predict(RP.normalizeGlyph(unpack(v), v.w, v.h)))) === v.label);
  const blue = vectors.find(v => v !== red && v.h >= 40);
  assert.ok(red && blue, 'test vectors');
  const res = RP.readPage(page(unpack(red), red.w, red.h, unpack(blue), blue.w, blue.h), model);
  const marks = res.marks.filter(m => m.kind === 'mark');
  assert.equal(marks.length, 1, JSON.stringify(res.marks));
  assert.equal(marks[0].got, red.label);
  assert.equal(marks[0].margin, 'right');
  assert.ok(marks[0].x0 >= 550 && marks[0].x0 <= 570);
});

test('alignMarks follows the paper and the maximum marks', () => {
  const qs = [{ q: '1', max: 2 }, { q: '2', max: 3 }, { q: '3', max: 1 }, { q: '4', max: 5 }];
  // a correction "7" in the working can fit nowhere and is left out; Q3 has no mark
  const marks = [{ got: 2, conf: 0.9, margin: 'right' }, { got: 3, conf: 0.9, margin: 'right' }, { got: 7, conf: 0.5 }, { got: 4, max: 5, conf: 0.9, margin: 'right', circled: true }];
  const al = RP.alignMarks(marks, qs);
  assert.deepEqual(al.map(a => [a.q, marks[a.mark].got]), [['1', 2], ['2', 3], ['4', 4]]);
  // a written question label wins over order
  const lab = [{ got: 3, conf: 0.9, label: '2' }, { got: 1, conf: 0.9, label: '3' }];
  assert.deepEqual(RP.alignMarks(lab, qs).map(a => a.q), ['2', '3']);
});

test('findTotal picks the ringed number at the top that adds up', () => {
  const marks = [
    { kind: 'mark', page: 0, top: true, circled: true, got: 9, max: null, x0: 1, y0: 1 },
    { kind: 'mark', page: 0, got: 2 }, { kind: 'mark', page: 0, got: 3 }, { kind: 'mark', page: 1, got: 4 }
  ];
  assert.equal(RP.findTotal(marks, 12).got, 9);
  assert.equal(RP.findTotal(marks.slice(1), 12), null);
});
