/* MarkLens red-ink marks reader: what the teacher marked on a photo of an answer sheet, read on the phone.

   Teachers mark in different ways: a number beside each answer ("2", "1½", "3/5"), a tick or a cross on each
   short answer, a subtotal for the section in the margin, the total circled at the top. This reader finds all of
   them in the red ink, tells them apart, and gives each one to its question:

     1. paper colour     the paper's colour block by block, so shadows and yellow light don't change what is "red"
     2. red ink          pixels clearly redder than the paper; long printed rules (a red margin line) are wiped
     3. layout           the ruled lines give the line spacing, the unit for every size below; the margin line
                         splits the student's question numbers (left) from the answers (right)
     4. marks            nearby red strokes are grouped; a small model (models/marks-v2.json, trained by
                         tools/marks/train.py) says if a group is a tick, a cross, a digit or something else, and
                         numbers are read digit by digit (also ½, 3/5 and circled numbers)
     5. numbers          the student's question numbers left of the margin are found and read
     6. one page         marks with where they point to: the corner of a tick, the middle of anything else
     7. the whole sheet  question numbers are matched to the question paper in order; each question gets the marks
                         in its part of the page; margin subtotals and the circled total check the result and fill a
                         mark the teacher forgot to write; anything unsure is flagged for the student to check

   Everything runs in the phone's browser (inside js/redmarks-worker.js); no photo is sent anywhere. The functions
   work on plain {width, height, data: RGBA} images, so the same file runs in Node for the tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RedMarks = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MODEL_SIZE = 28;
  let TICK = 10, CROSS = 11;   // class numbers in the model (set by loadModel from its class list)

  /* ------------------------------------------------------------------ 1-2. paper colour and red ink */

  function paperGrid(img) {
    const { width: W, height: H, data } = img;
    const B = Math.max(12, Math.round(Math.max(W, H) / 48));
    const gw = Math.ceil(W / B), gh = Math.ceil(H / B), n = gw * gh;
    const R = new Float32Array(n), G = new Float32Array(n), Bl = new Float32Array(n), L = new Float32Array(n);
    const hist = new Uint32Array(256);
    for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
      const x0 = bx * B, y0 = by * B, x1 = Math.min(W, x0 + B), y1 = Math.min(H, y0 + B);
      hist.fill(0); let cnt = 0;
      for (let y = y0; y < y1; y++) for (let x = x0, p = (y * W + x0) * 4; x < x1; x++, p += 4) {
        hist[(data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8]++; cnt++;
      }
      // the brightest 12% of a block is paper, even in a block full of writing
      let t = 255, acc = 0; const want = cnt * 0.12;
      while (t > 0 && (acc += hist[t]) < want) t--;
      let sr = 0, sg = 0, sb = 0, c = 0;
      for (let y = y0; y < y1; y++) for (let x = x0, p = (y * W + x0) * 4; x < x1; x++, p += 4) {
        if (((data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8) >= t) { sr += data[p]; sg += data[p + 1]; sb += data[p + 2]; c++; }
      }
      const k = by * gw + bx;
      R[k] = sr / c; G[k] = sg / c; Bl[k] = sb / c; L[k] = t;
    }
    // a block covered by a big blob of ink or a shadow edge is an outlier: take the median of its neighbours
    const fix = a => {
      const out = new Float32Array(n), win = [];
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        win.length = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) win.push(a[yy * gw + xx]);
        }
        win.sort((p, q) => p - q);
        out[y * gw + x] = Math.max(a[y * gw + x], win[win.length >> 1]);   // paper is never darker than its neighbours' median
      }
      return out;
    };
    const fr = fix(R), fg = fix(G), fb = fix(Bl);
    // blocks that are not paper at all (the table or bag the page lies on): much darker than the paper,
    // or darker and clearly coloured (wood, cloth). Shadows on the paper stay: they are grey, not brown.
    const lum = new Float32Array(n), chroma = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      lum[k] = 0.3 * fr[k] + 0.59 * fg[k] + 0.11 * fb[k];
      chroma[k] = Math.max(fr[k], fg[k], fb[k]) - Math.min(fr[k], fg[k], fb[k]);
    }
    const med = a => { const s = Float32Array.from(a).sort(); return s[s.length >> 1]; };
    const Lm = med(lum), Cm = med(chroma), off = new Uint8Array(n);
    for (let k = 0; k < n; k++) off[k] = lum[k] < 0.55 * Lm || (lum[k] < 0.82 * Lm && chroma[k] > Math.max(42, Cm + 22)) ? 1 : 0;
    return { B, gw, gh, R: fr, G: fg, Bl: fb, off };
  }

  /* ------------------------------------------------------------------ 2-3. red ink */

  // Phone JPEGs keep colour at half resolution, so a thin red stroke looks pale pixel by pixel. Darkness
  // is kept at full resolution. So "how red" is measured as the colour of the ink pooled over a small
  // window (6x6 px): sum of redness / sum of darkness. That ratio is about the same for a thick or a
  // thin stroke of the same pen, near 1 for red and pink pens, 0 for black and pencil, negative for blue.
  const TUNING = { strong: 0.42, weak: 0.24, darkStrong: 0.1, darkWeak: 0.045, massStrong: 1.0, massWeak: 0.35, orange: 0.5 };

  function analyzeRed(img, opts = {}) {
    const T = { ...TUNING, ...opts };
    const { width: W, height: H, data } = img, N = W * H;
    const { B, gw, gh, R, G, Bl, off } = paperGrid(img);
    const xa = new Int32Array(W), xb = new Int32Array(W), xu = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      const f = (x + 0.5) / B - 0.5; let a = Math.floor(f), u = f - a;
      if (a < 0) { a = 0; u = 0; }
      if (a >= gw - 1) { a = gw - 1; u = 0; }
      xa[x] = a; xb[x] = Math.min(a + 1, gw - 1); xu[x] = u;
    }
    const hw = (W + 1) >> 1, hh = (H + 1) >> 1, HN = hw * hh;
    const dark = new Uint8Array(N), own = new Int8Array(N), table = new Uint8Array(N);          // own: the pixel's own redness, -127..127
    const sD = new Float32Array(HN), sC = new Float32Array(HN), sG = new Float32Array(HN);
    for (let y = 0; y < H; y++) {
      const f = (y + 0.5) / B - 0.5; let a = Math.floor(f), t = f - a;
      if (a < 0) { a = 0; t = 0; }
      if (a >= gh - 1) { a = gh - 1; t = 0; }
      const r0 = a * gw, r1 = Math.min(a + 1, gh - 1) * gw, s = 1 - t, by = Math.min(gh - 1, (y / B) | 0) * gw, hy = (y >> 1) * hw;
      for (let x = 0, i = y * W, p = i * 4; x < W; x++, i++, p += 4) {
        const k0 = r0 + xa[x], k1 = r0 + xb[x], k2 = r1 + xa[x], k3 = r1 + xb[x], u = xu[x], v = 1 - u;
        const bR = (R[k0] * v + R[k1] * u) * s + (R[k2] * v + R[k3] * u) * t;
        const bG = (G[k0] * v + G[k1] * u) * s + (G[k2] * v + G[k3] * u) * t;
        const bB = (Bl[k0] * v + Bl[k1] * u) * s + (Bl[k2] * v + Bl[k3] * u) * t;
        let rn = data[p] / (bR > 40 ? bR : 40), gn = data[p + 1] / (bG > 40 ? bG : 40), bn = data[p + 2] / (bB > 40 ? bB : 40);
        if (rn > 1.2) rn = 1.2; if (gn > 1.2) gn = 1.2; if (bn > 1.2) bn = 1.2;
        let d = 1 - (rn + gn + bn) / 3;
        if (d < 0) d = 0; else if (d > 1) d = 1;
        dark[i] = (d * 255) | 0;
        if (off[by + Math.min(gw - 1, (x / B) | 0)]) { table[i] = 1; continue; }   // the table, not the paper
        const c = rn - (gn > bn ? gn : bn);
        own[i] = c <= -1 ? -127 : c >= 1 ? 127 : (c * 127) | 0;
        const k = hy + (x >> 1);
        sD[k] += d; sC[k] += c; sG[k] += gn - bn;
      }
    }
    // 3x3 sums on the half-size grid = 6x6 pixels
    const box = a => {
      const t1 = new Float32Array(HN), o = new Float32Array(HN);
      for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) { const k = y * hw + x; t1[k] = a[k] + (x > 0 ? a[k - 1] : 0) + (x < hw - 1 ? a[k + 1] : 0); }
      for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) { const k = y * hw + x; o[k] = t1[k] + (y > 0 ? t1[k - hw] : 0) + (y < hh - 1 ? t1[k + hw] : 0); }
      return o;
    };
    const bD = box(sD), bC = box(sC), bG = box(sG);
    const level = new Uint8Array(N);   // 2 strong, 1 weak
    for (let y = 0; y < H; y++) for (let x = 0, i = y * W; x < W; x++, i++) {
      const d = dark[i] / 255; if (d < T.darkWeak || own[i] < 3) continue;
      const k = (y >> 1) * hw + (x >> 1), mass = bD[k];
      if (mass < T.massWeak) continue;
      const ratio = bC[k] / mass, orange = bG[k] / mass;
      if (orange > T.orange) continue;
      if (ratio >= T.strong && d >= T.darkStrong && mass >= T.massStrong) level[i] = 2;
      else if (ratio >= T.weak) level[i] = 1;
    }
    // grow from strong red seeds into the faint edges of the stroke (hysteresis)
    const red = new Uint8Array(N), stack = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      if (red[i] || level[i] !== 2) continue;
      let sp = 0; stack[sp++] = i; red[i] = 1;
      while (sp) {
        const j = stack[--sp], y = (j / W) | 0, x = j - y * W;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= W) continue;
            const k = yy * W + xx;
            if (!red[k] && level[k]) { red[k] = 1; stack[sp++] = k; }
          }
        }
      }
    }
    // printed rules in red (the margin line of answer booklets, header lines) run along a good part of the page;
    // a tick or an underline never does. Thin stretches of them are wiped, so a number written across one keeps its strokes.
    const mask = red.slice(), redRules = [];
    for (const vertical of [true, false]) {
      const ls = findLines(red, W, H, vertical, 0.3, 1);
      eraseLines(mask, W, H, ls, vertical, 9);
      for (const l of ls) redRules.push({ ...l, vertical });
    }
    return { width: W, height: H, dark, own, table, redAll: red, red: mask, redRules };
  }

  /* ------------------------------------------------------------------ 3. printed lines and the margin */

  // Straight lines across the page (ruled lines, the margin line), found by voting: every pixel of the mask votes for
  // lines tilted up to 5 degrees, because the photo is seldom straight. Returns [{t, o, cover, segs}] where the line is
  // b = o + a * t (a runs along the line: y for vertical lines, x for horizontal ones) and segs are the stretches where
  // it really runs, as [start, end] along a.
  function findLines(mask, W, H, vertical, minCover, step) {
    step = step || 1;
    let n = 0;
    for (let i = 0; i < mask.length; i += step) n += mask[i] ? 1 : 0;
    if (!n) return [];
    const xs = new Int32Array(n), ys = new Int32Array(n);
    for (let i = 0, k = 0; i < mask.length && k < n; i += step) if (mask[i]) { ys[k] = (i / W) | 0; xs[k] = i - ys[k] * W; k++; }
    const L = vertical ? H : W, M = vertical ? W : H, need = Math.max(60, minCover * L / step);
    const found = [];
    for (let deg = -5; deg <= 5.001; deg += 0.5) {
      const t = Math.tan(deg * Math.PI / 180), pad = Math.ceil(L * Math.abs(t)) + 3;
      const votes = new Int32Array(M + 2 * pad);
      for (let k = 0; k < n; k++) votes[Math.round(vertical ? xs[k] - ys[k] * t : ys[k] - xs[k] * t) + pad]++;
      for (let o = 2; o < votes.length - 2; o++) {
        const v = votes[o - 1] + votes[o] + votes[o + 1];
        if (v >= need && votes[o] >= votes[o - 1] && votes[o] >= votes[o + 1]) found.push({ t, o: o - pad, v });
      }
    }
    found.sort((a, b) => b.v - a.v);
    const lines = [];
    for (const f of found) if (!lines.some(l => Math.abs(l.o - f.o) <= 5 && Math.abs(l.t - f.t) <= 0.04)) lines.push(f);
    const out = [];
    for (const ln of lines.slice(0, 80)) {
      // fit it exactly, then find where it really runs (gaps under 2% of the page)
      let sa = 0, sb = 0, saa = 0, sab = 0, cnt = 0;
      for (let k = 0; k < n; k++) {
        const a = vertical ? ys[k] : xs[k], b = vertical ? xs[k] : ys[k], d = b - a * ln.t - ln.o;
        if (d >= -4 && d <= 4) { sa += a; sb += b; saa += a * a; sab += a * b; cnt++; }
      }
      if (cnt < 10) continue;
      const den = cnt * saa - sa * sa;
      if (Math.abs(den) > 1e-6) { ln.t = (cnt * sab - sa * sb) / den; ln.o = (sb - ln.t * sa) / cnt; }
      const occ = new Uint8Array(L);
      for (let k = 0; k < n; k++) {
        const a = vertical ? ys[k] : xs[k], d = (vertical ? xs[k] : ys[k]) - a * ln.t - ln.o;
        if (d >= -3 && d <= 3) for (let q = 0; q < step && a + q < L; q++) occ[a + q] = 1;
      }
      // a printed line is there almost all along a stretch and thin; a row of handwriting is neither
      const gap = Math.max(10, 0.02 * L), segs = []; let st = -1, last = -1, cover = 0, on = 0;
      for (let a = 0; a <= L; a++) {
        if (a < L && occ[a]) { if (st < 0) { st = a; on = 0; } last = a; on++; continue; }
        if (st >= 0 && (a === L || a - last > gap)) { if (last - st >= 0.06 * L && on >= 0.85 * (last - st + 1)) { segs.push([st, last]); cover += last - st + 1; } st = -1; }
      }
      if (segs.length) {
        const runs = [];
        for (const [s0, e0] of segs) for (let a = s0; a <= e0; a += 7) {
          const c = Math.round(lineAt(ln, a)); let best = 99;
          for (let d = -2; d <= 2; d++) {
            const b = c + d, at = q => q >= 0 && q < M && (vertical ? mask[a * W + q] : mask[q * W + a]);
            if (!at(b)) continue;
            let b0 = b, b1 = b; while (at(b0 - 1)) b0--; while (at(b1 + 1)) b1++;
            best = Math.min(best, b1 - b0 + 1);
          }
          if (best < 99) runs.push(best);
        }
        runs.sort((x, y) => x - y);
        if (runs.length && runs[runs.length >> 1] > 7) continue;
      }
      if (cover >= minCover * L && !out.some(l => Math.abs(l.o - ln.o) <= 5 && Math.abs(l.t - ln.t) <= 0.04)) out.push({ t: ln.t, o: ln.o, cover: cover / L, segs });
    }
    return out;
  }
  const lineAt = (ln, a) => ln.o + a * ln.t;

  // Follow a line along the page: paper curls, so a printed line bends a little. track[a] is where the line's ink
  // really is at a (NaN where nothing was found, e.g. under a stroke of writing that crosses it).
  function trackLine(mask, W, H, ln, vertical, maxRun) {
    const L = vertical ? H : W, M = vertical ? W : H, tr = new Float32Array(L).fill(NaN);
    const at = (a, b) => b >= 0 && b < M && mask[vertical ? a * W + b : b * W + a];
    for (const [s0, e0] of ln.segs) {
      let pos = lineAt(ln, s0), lost = 0;
      for (let a = s0; a <= e0; a++) {
        // a bend is slow: at most one pixel sideways per step, so a stroke of writing that touches the line can't lead it away
        let hit = false;
        for (const d of [0, -1, 1]) {
          const b = Math.round(pos) + d;
          if (!at(a, b)) continue;
          let b0 = b, b1 = b; while (at(a, b0 - 1)) b0--; while (at(a, b1 + 1)) b1++;
          if (b1 - b0 + 1 > maxRun) break;   // something thick crosses here: keep going straight
          const c = (b0 + b1) / 2;
          if (Math.abs(c - pos) <= 1.5) { pos = c; tr[a] = c; hit = true; }
          break;
        }
        if (!hit && ++lost > 0.05 * L) { pos = lineAt(ln, a); lost = 0; } else if (hit) lost = 0;
      }
    }
    return tr;
  }
  // the track with its gaps filled in (straight across a gap, the fitted line beyond the ends)
  function filledTrack(ln, L) {
    const tr = ln.track, out = new Float32Array(L);
    if (!tr) { for (let a = 0; a < L; a++) out[a] = lineAt(ln, a); return out; }
    let prev = -1;
    for (let a = 0; a <= L; a++) {
      if (a < L && isNaN(tr[a])) continue;
      for (let k = prev + 1; k < a; k++) {
        if (prev < 0 && a < L) out[k] = tr[a] + (k - a) * ln.t;
        else if (a >= L && prev >= 0) out[k] = tr[prev] + (k - prev) * ln.t;
        else if (prev >= 0) out[k] = tr[prev] + (tr[a] - tr[prev]) * (k - prev) / (a - prev);
        else out[k] = lineAt(ln, k);
      }
      if (a < L) out[a] = tr[a];
      prev = a;
    }
    return out;
  }
  // Wipe the lines out of a mask along their tracks: only thin runs go, so a stroke of writing crossing a line keeps its pixels.
  function eraseLines(mask, W, H, lines, vertical, maxRun) {
    const M = vertical ? W : H;
    for (const ln of lines) {
      if (!ln.track) ln.track = trackLine(mask, W, H, ln, vertical, maxRun);
      const tr = filledTrack(ln, vertical ? H : W);
      for (const [s0, e0] of ln.segs) for (let a = s0; a <= e0; a++) {
        const c = Math.round(tr[a]);
        for (let b = c - 2; b <= c + 2; b++) {
          if (b < 0 || b >= M) continue;
          const i = vertical ? a * W + b : b * W + a;
          if (!mask[i]) continue;
          let run = 1;
          if (vertical) { for (let q = b - 1; q >= 0 && mask[a * W + q]; q--) run++; for (let q = b + 1; q < W && mask[a * W + q]; q++) run++; }
          else { for (let q = b - 1; q >= 0 && mask[q * W + a]; q--) run++; for (let q = b + 1; q < H && mask[q * W + a]; q++) run++; }
          if (run <= maxRun) mask[i] = 0;
        }
      }
    }
  }
  // Where a red stroke crosses a printed line, the pixels are neither red nor blue, so the stroke falls in two. If there
  // is red just before and just after the line, the dark pixels on the line between them are red ink too.
  function mendRed(an, lines) {
    const W = an.width, H = an.height, red = an.red;
    const any = (x0, x1, y0, y1) => { for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) if (red[y * W + x]) return true; return false; };
    const fill = [];
    for (const { ln, vertical } of lines) {
      const tr = ln.track; if (!tr) continue;
      for (const [s0, e0] of ln.segs) for (let a = s0; a <= e0; a++) {
        const c = Math.round(isNaN(tr[a]) ? lineAt(ln, a) : tr[a]);
        const ok = vertical ? any(c - 7, c - 2, a - 6, a + 6) && any(c + 2, c + 7, a - 6, a + 6) : any(a - 6, a + 6, c - 7, c - 2) && any(a - 6, a + 6, c + 2, c + 7);
        if (!ok) continue;
        for (let b = c - 3; b <= c + 3; b++) { const i = vertical ? a * W + b : b * W + a; if (i >= 0 && i < W * H && an.dark[i] >= 40 && an.own[i] > -60) fill.push(i); }
      }
    }
    for (const i of fill) red[i] = 1;
  }

  // The page's layout from the pen and pencil ink (not the red ink): the ruled lines give the line spacing, which is the
  // unit for every size below, and the margin line splits the question numbers (left) from the answers (right).
  function layout(an) {
    const W = an.width, H = an.height, N = W * H, ink = new Uint8Array(N), faint = new Uint8Array(N);
    const nearRed = dilateMask(an.redAll, W, H, 2);
    // printed lines are often pale blue: they are looked for in a fainter mask than the writing
    for (let i = 0; i < N; i++) if (an.own[i] <= 6 && !nearRed[i] && !an.table[i]) { if (an.dark[i] >= 28) faint[i] = 1; if (an.dark[i] >= 60) ink[i] = 1; }
    const rules = findLines(faint, W, H, false, 0.35, 2).filter(l => Math.abs(l.t) < 0.07);
    const ys = rules.map(l => lineAt(l, W / 2)).sort((a, b) => a - b), gaps = [];
    for (let i = 1; i < ys.length; i++) { const g = ys[i] - ys[i - 1]; if (g >= 0.012 * H && g <= 0.12 * H) gaps.push(g); }
    gaps.sort((a, b) => a - b);
    let lineGap = gaps.length >= 3 ? gaps[gaps.length >> 1] : 0;
    eraseLines(faint, W, H, rules, false, 6);
    eraseLines(ink, W, H, rules, false, 6);
    // vertical lines: the margin of a notebook (sometimes doubled), in ink or in red
    const vert = [...findLines(faint, W, H, true, 0.35, 2), ...an.redRules.filter(l => l.vertical).map(l => ({ ...l, red: true }))].filter(l => Math.abs(l.t) < 0.07);
    // the margin: a long vertical line in the left part of the page. Its position is measured band by band down the
    // page (the leftmost line of a double margin), then a smooth curve is fitted, because a curled page bends it.
    // (the paper's own edge against the table is a long straight line too, but it has paper on one side only)
    const paperBoth = l => {
      let dl = 0, dr = 0, n = 0;
      for (let y = (0.1 * H) | 0; y < 0.9 * H; y += 9) {
        const x = Math.round(lineAt(l, y));
        for (let d = 6; d <= 16; d += 2) { const a = x - d, b = x + d; if (a < 0 || b >= W) continue; dl += an.table[y * W + a] ? 255 : an.dark[y * W + a]; dr += an.table[y * W + b] ? 255 : an.dark[y * W + b]; n++; }
      }
      return n && dl / n < 70 && dr / n < 70;
    };
    const cands = vert.filter(l => { const x = lineAt(l, H / 2); return x > 0.02 * W && x < 0.45 * W && paperBoth(l); }).sort((a, b) => b.cover - a.cover);
    let mx = null;
    if (cands.length) {
      const ref = cands[0], B = Math.max(40, Math.round(H / 24)), pts = [];
      for (let y0 = 0; y0 + B <= H; y0 += B) {
        const yc = y0 + B / 2, base = lineAt(ref, yc), lo = Math.max(1, Math.round(base - 0.035 * W)), hi = Math.min(W - 2, Math.round(base + 0.035 * W)), cnt = new Float32Array(hi - lo + 1);
        for (let y = y0; y < y0 + B; y++) { const sh = lineAt(ref, y) - base; for (let x = lo; x <= hi; x++) { const xx = Math.round(x + sh); if (xx > 0 && xx < W && (faint[y * W + xx] || (an.redAll[y * W + xx] && !an.red[y * W + xx]))) cnt[x - lo]++; } }
        for (let k = 1; k < cnt.length - 1; k++) if (cnt[k] >= 0.55 * B && cnt[k] >= cnt[k - 1] && cnt[k] >= cnt[k + 1]) { pts.push([yc, lo + k]); break; }
      }
      mx = smoothFit(pts, H);
    }
    const margin = mx ? cands[0] : null;
    eraseLines(faint, W, H, vert, true, 7);
    eraseLines(ink, W, H, vert, true, 7);
    // the margin itself, along the fitted curve (a double margin is two lines a few pixels apart)
    if (mx) for (let y = 0; y < H; y++) for (let x = Math.max(0, Math.round(mx[y]) - 2); x <= Math.min(W - 1, Math.round(mx[y]) + 14); x++) {
      let run = 0; for (let q = x; q < W && ink[y * W + q]; q++) run++;
      if (ink[y * W + x] && run <= 7 && (x === 0 || !ink[y * W + x - 1])) for (let q = x; q < x + run; q++) ink[y * W + q] = 0;
    }
    if (!lineGap) {
      // no ruled lines: the height of the handwriting, from the ink's own lines of text
      const prof = new Float32Array(H);
      for (let y = 0; y < H; y++) { let s = 0; for (let x = (W * 0.1) | 0; x < W * 0.9; x++) s += ink[y * W + x]; prof[y] = s; }
      lineGap = Math.max(24, Math.min(0.08 * H, periodOf(prof, Math.round(0.015 * H), Math.round(0.08 * H)) || 0.035 * H));
    }
    return { ink, rules, vert, lineGap, margin, marginX: y => mx ? mx[Math.round(Math.max(0, Math.min(H - 1, y)))] : -1 };
  }
  // A curve through the band points that follows the page's bends: each point is checked against its neighbours (a
  // point far from both is a stroke of writing, not the line), then the curve runs straight from point to point.
  function smoothFit(pts, H) {
    if (pts.length < 3) return null;
    const ok = pts.filter((p, i) => {
      const nb = [pts[i - 2], pts[i - 1], pts[i + 1], pts[i + 2]].filter(Boolean).map(q => q[1]).sort((x, y) => x - y);
      const med = nb.length % 2 ? nb[nb.length >> 1] : (nb[nb.length / 2 - 1] + nb[nb.length / 2]) / 2;
      return Math.abs(p[1] - med) <= 9;
    });
    if (ok.length < 3) return null;
    const out = new Float32Array(H);
    for (let y = 0, k = 0; y < H; y++) {
      while (k < ok.length - 2 && ok[k + 1][0] <= y) k++;
      const [ya, xa] = ok[k], [yb, xb] = ok[k + 1];
      out[y] = y <= ok[0][0] ? ok[0][1] : y >= ok[ok.length - 1][0] ? ok[ok.length - 1][1] : xa + (xb - xa) * (y - ya) / (yb - ya);
    }
    return out;
  }
  // the strongest period of a profile between lo and hi (autocorrelation)
  function periodOf(p, lo, hi) {
    const n = p.length; let mean = 0; for (const v of p) mean += v; mean /= n;
    let best = 0, bestLag = 0;
    for (let lag = lo; lag <= hi; lag++) {
      let s = 0; for (let i = 0; i + lag < n; i++) s += (p[i] - mean) * (p[i + lag] - mean);
      s /= n - lag; if (s > best) { best = s; bestLag = lag; }
    }
    return bestLag;
  }
  function dilateMask(m, W, H, r) {
    const a = new Uint8Array(W * H), b = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) { let last = -1e9; for (let x = 0; x < W; x++) { if (m[y * W + x]) last = x; if (x - last <= r) a[y * W + x] = 1; } last = 1e9; for (let x = W - 1; x >= 0; x--) { if (m[y * W + x]) last = x; if (last - x <= r) a[y * W + x] = 1; } }
    for (let x = 0; x < W; x++) { let last = -1e9; for (let y = 0; y < H; y++) { if (a[y * W + x]) last = y; if (y - last <= r) b[y * W + x] = 1; } last = 1e9; for (let y = H - 1; y >= 0; y--) { if (a[y * W + x]) last = y; if (last - y <= r) b[y * W + x] = 1; } }
    return b;
  }

  // Connected pieces of a mask. Pieces closer than `bridge` px count as one (a red stroke is broken where it crosses a
  // blue ruled line, because there the pixel is neither red nor blue). Labels go on the mask's own pixels only.
  function pieces(mask, W, H, bridge, valueOf) {
    const N = W * H, joined = bridge ? dilateMask(mask, W, H, bridge) : mask, labels = new Int32Array(N), out = [], stack = new Int32Array(N);
    let next = 1;
    for (let i = 0; i < N; i++) {
      if (!joined[i] || labels[i]) continue;
      const id = next++;
      let sp = 0; stack[sp++] = i; labels[i] = id;
      let area = 0, bound = 0, x0 = W, y0 = H, x1 = -1, y1 = -1, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, val = 0;
      while (sp) {
        const j = stack[--sp], y = (j / W) | 0, x = j - y * W;
        if (mask[j]) {
          area++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; if (valueOf) val += valueOf(j);
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          if (x === 0 || x === W - 1 || y === 0 || y === H - 1 || !mask[j - 1] || !mask[j + 1] || !mask[j - W] || !mask[j + W]) bound++;
        }
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= W) continue;
            const k = yy * W + xx;
            if (joined[k] && !labels[k]) { labels[k] = id; stack[sp++] = k; }
          }
        }
      }
      if (!area) continue;
      const w = x1 - x0 + 1, h = y1 - y0 + 1, c = { id, x0, y0, x1, y1, w, h, area, stroke: 2 * area / Math.max(1, bound), cx: sx / area, cy: sy / area, fill: area / (w * h), val: val / area };
      const mxx = sxx / area - c.cx * c.cx, myy = syy / area - c.cy * c.cy, mxy = sxy / area - c.cx * c.cy;
      const tr = mxx + myy, det = mxx * myy - mxy * mxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
      c.elong = Math.sqrt((tr / 2 + disc) / Math.max(1e-6, tr / 2 - disc));
      c.angle = Math.atan2(2 * mxy, mxx - myy) / 2 * 180 / Math.PI;
      out.push(c);
    }
    for (let i = 0; i < N; i++) if (!mask[i]) labels[i] = 0;
    return { labels, comps: out };
  }

  /* ------------------------------------------------------------------ 4. the teacher's red marks */

  const ovl = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) + 1;
  const inside = (c, x, y) => x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1;
  const boxOf = items => { const b = { x0: Infinity, y0: Infinity, x1: -1, y1: -1, area: 0 }; for (const c of items) { b.x0 = Math.min(b.x0, c.x0); b.y0 = Math.min(b.y0, c.y0); b.x1 = Math.max(b.x1, c.x1); b.y1 = Math.max(b.y1, c.y1); b.area += c.area; } b.w = b.x1 - b.x0 + 1; b.h = b.y1 - b.y0 + 1; return b; };

  // A ring or loop drawn round something: hollow, and its ink stays near its outline all the way round.
  function ringLike(an, c) {
    if (c.fill > 0.35 || c.w < 12 || c.h < 12 || c.w > 6 * c.h || c.h > 6 * c.w) return 0;
    const ex = (c.x0 + c.x1) / 2, ey = (c.y0 + c.y1) / 2, rx = c.w / 2, ry = c.h / 2, S = 36, sec = new Uint8Array(S), W = an.width;
    let outer = 0, tot = 0;
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      if (an.labels[y * W + x] !== c.id) continue;
      const dx = (x - ex) / rx, dy = (y - ey) / ry, r = Math.hypot(dx, dy);
      tot++; if (r > 0.62) outer++;
      sec[Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * S) % S] = 1;
    }
    let cov = 0; for (let k = 0; k < S; k++) cov += sec[k];
    return outer >= 0.8 * tot && cov >= 0.72 * S ? cov / S : 0;
  }

  // Strokes that belong together: the 1 and 3 of "13", the pieces of a ½, a ring and the number in it. Two big strokes
  // are never joined, because two ticks on neighbouring lines often nearly touch.
  function groupMarks(an, comps, gap) {
    const n = comps.length, par = [...Array(n).keys()];
    const f = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
    const big = c => Math.max(c.w, c.h) > 1.1 * gap;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = comps[i], b = comps[j];
      if ((a.ring && inside(a, b.cx, b.cy) && b.w < a.w && b.h < a.h) || (b.ring && inside(b, a.cx, a.cy) && a.w < b.w && a.h < b.h)) { par[f(i)] = f(j); continue; }
      if (big(a) && big(b)) continue;
      const gx = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1), gy = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
      const ref = Math.min(Math.max(a.h, b.h), gap);
      if (gx <= 0.45 * ref && ovl(a.y0, a.y1, b.y0, b.y1) >= 0.25 * Math.min(a.h, b.h)) par[f(i)] = f(j);        // side by side
      else if (gy <= 0.35 * ref && ovl(a.x0, a.x1, b.x0, b.x1) >= 0.25 * Math.min(a.w, b.w)) par[f(i)] = f(j);   // stacked
    }
    const groups = new Map();
    comps.forEach((c, i) => { const r = f(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); });
    return [...groups.values()].map(items => ({ items, ...boxOf(items) }));
  }

  // What one group of red strokes is: a tick, a cross, a number (read as a mark), a ring round the student's words,
  // an underline, or something else. Returns {kind, got, max, text, conf, circled, ...}.
  function readMark(an, g, model, gap) {
    const one = g.items.length === 1 ? g.items[0] : null;
    // a ring with nothing red inside: the teacher circled a mistake in the answer
    if (one && one.ring && Math.max(one.w, one.h) > 0.8 * gap) return { kind: 'ring', conf: 0.9 };
    // a flat line under or through the writing
    if (one && one.elong >= 6 && Math.abs(one.angle) < 20 && one.w >= 1.2 * gap) return { kind: 'line', conf: 0.9 };
    const m = partsMask(an, g.items), p = model.predict(normalizeGlyph(m.d, m.w, m.h));
    let best = 0; for (let i = 1; i < p.length; i++) if (p[i] > p[best]) best = i;
    const pt = p[TICK] || 0, px = p[CROSS] || 0, size = Math.max(g.w, g.h);
    if (best === TICK && size >= 0.45 * gap) return { kind: 'tick', conf: pt, probs: p };
    if (best === CROSS && size >= 0.3 * gap) return { kind: 'cross', conf: px, probs: p };
    // a number, maybe with a ring round it or a "/5" after it
    const r = readCluster(an, g, model);
    if (r.kind === 'mark') return { ...r, probs: p };
    // what the whole shape most looks like, if not a number
    if (pt >= 0.35 && pt >= px && size >= 0.45 * gap) return { kind: 'tick', conf: pt, probs: p };
    if (px >= 0.35 && size >= 0.3 * gap) return { kind: 'cross', conf: px, probs: p };
    return { kind: r.kind === 'tick' ? 'other' : r.kind === 'noise' ? 'noise' : 'other', conf: r.conf || 0.3, probs: p };
  }

  // Where a mark points to on the page: the corner of a tick (its lowest point on the left), the middle of anything else.
  function anchorOf(an, g, kind) {
    if (kind !== 'tick') return { x: (g.x0 + g.x1) / 2, y: (g.y0 + g.y1) / 2 };
    const W = an.width, ids = new Set(g.items.map(c => c.id)); let by = -1, bx = 0;
    for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x0 + 0.6 * g.w; x++) if (ids.has(an.labels[y * W + x]) && y > by) { by = y; bx = x; }
    return by < 0 ? { x: (g.x0 + g.x1) / 2, y: g.y1 } : { x: bx, y: by };
  }

  /* ------------------------------------------------------------------ 5. question numbers in the margin */

  // The student's question numbers: pen or pencil writing left of the margin line ("1.", "13·", a circled 10, "11)").
  // Each becomes {x0, y0, x1, y1, reads: [digit probabilities per character]}; the order down the page matters more
  // than the reading, which only has to tell the numbers apart where the order alone can't (a "Section A" line, a skip).
  function findLabels(an, lay, model) {
    const W = an.width, H = an.height, gap = lay.lineGap;
    if (!lay.margin) return [];
    // question numbers are written in the margin, near the margin line and clear of the paper's edge (where the
    // paper meets the table there is a dark line and a shadow)
    const left = new Uint8Array(W * H), edge = new Int32Array(H);
    for (let y = 0; y < H; y++) {
      let e = 0; while (e < W && an.table[y * W + e]) e++;
      edge[y] = e;
      const mx = lay.marginX(y) - 7, from = Math.max(e + Math.round(0.2 * gap), Math.round(mx - 4.5 * gap), 0);
      for (let x = from; x < mx; x++) if (lay.ink[y * W + x]) left[y * W + x] = 1;
    }
    // what is left of the printed lines out here: long thin runs across (ruled lines) or down (the margin's edge)
    const longX = Math.round(0.6 * gap), longY = Math.round(1.3 * gap);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; ) {
      if (!left[y * W + x]) { x++; continue; }
      let e = x; while (e < W && left[y * W + e]) e++;
      if (e - x >= longX) for (let q = x; q < e; q++) { let t = 1; for (let d = 1; d < 6 && y - d >= 0 && left[(y - d) * W + q]; d++) t++; for (let d = 1; d < 6 && y + d < H && left[(y + d) * W + q]; d++) t++; if (t <= 4) left[y * W + q] = 2; }
      x = e;
    }
    for (let x = 0; x < W; x++) for (let y = 0; y < H; ) {
      if (!left[y * W + x]) { y++; continue; }
      let e = y; while (e < H && left[e * W + x]) e++;
      if (e - y >= longY) for (let q = y; q < e; q++) { let t = 1; for (let d = 1; d < 6 && x - d >= 0 && left[q * W + x - d]; d++) t++; for (let d = 1; d < 6 && x + d < W && left[q * W + x + d]; d++) t++; if (t <= 5) left[q * W + x] = 2; }
      y = e;
    }
    for (let i = 0; i < W * H; i++) if (left[i] === 2) left[i] = 0;
    const { labels, comps } = pieces(left, W, H, 1);
    const view = { labels, width: W };
    // a number ends near the margin line; the paper's edge, a shadow or a crease further left is not one
    const ok = comps.filter(c => c.x0 > 0 && c.y0 > 0 && c.y1 < H - 1 && Math.max(c.w, c.h) >= 0.12 * gap && c.area >= 0.004 * gap * gap && c.h <= 1.6 * gap && c.w <= 3 * gap &&
      c.x1 >= lay.marginX(c.cy) - 2.5 * gap && !(c.w <= 0.12 * gap && c.h >= 0.5 * gap && c.x0 <= edge[Math.round(c.cy)] + gap));
    // pieces on the same line of writing make one number
    ok.sort((a, b) => a.cy - b.cy);
    const rows = [];
    for (const c of ok) {
      const r = rows.find(r => Math.abs(r.cy - c.cy) < 0.4 * gap || ovl(r.y0, r.y1, c.y0, c.y1) >= 0.5 * Math.min(r.y1 - r.y0 + 1, c.h));
      if (r) { r.items.push(c); r.y0 = Math.min(r.y0, c.y0); r.y1 = Math.max(r.y1, c.y1); r.cy = (r.y0 + r.y1) / 2; }
      else rows.push({ items: [c], y0: c.y0, y1: c.y1, cy: c.cy });
    }
    const out = [];
    for (const r of rows) {
      // the number is the cluster of pieces nearest the margin line; specks further left are not part of it
      r.items.sort((a, b) => b.x1 - a.x1);
      const kept = [r.items[0]]; let x0 = r.items[0].x0;
      for (const c of r.items.slice(1)) if (c.x1 >= x0 - 0.8 * gap) { kept.push(c); x0 = Math.min(x0, c.x0); }
      r.items = kept;
      const b = boxOf(r.items), tall = Math.max(...r.items.map(c => c.h));
      if (tall < 0.3 * gap || b.w < 0.08 * gap) continue;                 // dots, specks and slivers only
      let parts = r.items.filter(c => Math.max(c.w, c.h) >= 0.3 * tall);   // drop the full stop
      let circled = false;
      // a circle round the number: drop the ring, read what is inside
      const ring = parts.find(c => ringLike(view, c) && c.h >= 0.8 * tall && parts.every(o => o === c || inside(c, o.cx, o.cy)));
      let masks;
      if (ring && parts.length > 1) { circled = true; parts = parts.filter(c => c !== ring); masks = parts.sort((a, b) => a.x0 - b.x0).map(c => partsMask(view, [c])); }
      else if (parts.length === 1 && parts[0].w >= 0.75 * parts[0].h && ringLike(view, parts[0]) >= 0.85 && (masks = (() => {
        const inner = ringSplit(view, parts[0]);
        return inner ? splitMask(inner).filter(m => m.h >= 0.25 * parts[0].h) : [];
      })()).length) circled = true;   // a circled number touching its ring (a 9 or a 6 has a loop too: read as it is)
      else {
        parts.sort((a, b) => a.x0 - b.x0);
        const chars = [];
        for (const c of parts) { const ch = chars.find(g => ovl(g.x0, g.x1, c.x0, c.x1) >= 0.5 * Math.min(c.w, g.x1 - g.x0 + 1)); if (ch) { ch.items.push(c); Object.assign(ch, boxOf(ch.items)); } else chars.push({ items: [c], ...boxOf([c]) }); }
        masks = chars.map(g => partsMask(view, g.items));
      }
      // a ")" or "." after the number, or "Q" before it, is read too: the scoring allows one extra character
      const reads = masks.slice(0, 4).map(m => { const p = model.predict(normalizeGlyph(m.d, m.w, m.h)); return Array.from({ length: 10 }, (_, d) => p[d]); });
      out.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, cy: (b.y0 + b.y1) / 2, reads, circled });
    }
    return out;
  }

  // How well a label's reading fits question number n (log-likelihood, about 0 for a clear match, below -6 for none)
  function labelFit(label, n) {
    if (!label || !label.reads.length) return -2;
    const ds = String(n).split('').map(Number), R = label.reads, lp = (p, d) => Math.log((p[d] || 0) + 0.03);
    const fit = rs => rs.reduce((a, p, i) => a + lp(p, ds[i]), 0);
    let best = -9;
    if (R.length === ds.length) best = Math.max(best, fit(R));
    if (R.length === ds.length + 1) for (let k = 0; k < R.length; k++) best = Math.max(best, fit(R.filter((_, i) => i !== k)) - 0.8);   // "11)" or "Q5"
    if (R.length === ds.length - 1 && ds.length === 2) best = Math.max(best, lp(R[0], ds[0]) - 2.5);   // two digits written as one shape
    return best;
  }

  /* ------------------------------------------------------------------ 6. one page */

  /** Everything the teacher marked on one page, and where the student's question numbers are.
      img: {width, height, data: RGBA} at about 1600 px; model: from loadModel(models/marks-v2.json). */
  function readPage(img, model, opts = {}) {
    const an = analyzeRed(img, opts.tuning);
    const W = an.width, H = an.height, lay = layout(an), gap = lay.lineGap;
    mendRed(an, [...lay.rules.map(ln => ({ ln, vertical: false })), ...lay.vert.filter(ln => !ln.red).map(ln => ({ ln, vertical: true }))]);
    const { labels, comps } = pieces(an.red, W, H, 2, i => an.dark[i]);
    an.labels = labels; an.page = { medianH: 0.45 * gap };
    const maxSide = Math.max(W, H);
    const keep = comps.filter(c => {
      if (c.area < Math.max(12, 0.01 * gap * gap) || Math.max(c.w, c.h) < 0.18 * gap) return false;       // specks
      if (c.stroke > Math.max(14, 0.25 * gap) || c.area > 0.02 * W * H) return false;                        // a finger, a red object
      if (Math.max(c.w, c.h) >= 0.45 * maxSide) return false;                                                // a rule the line finder missed
      return true;
    });
    // ink that shows through from the back of the page is much fainter than the ink on this side
    const strong = keep.filter(c => Math.max(c.w, c.h) >= 0.5 * gap).map(c => c.val).sort((a, b) => a - b);
    const typical = strong.length ? strong[strong.length >> 1] : 0;
    const marks = [];
    for (const c of keep) c.ring = ringLike(an, c) > 0;
    for (const g of groupMarks(an, keep.filter(c => !typical || c.val >= 0.55 * typical), gap)) {
      if (Math.max(g.w, g.h) < 0.25 * gap) continue;
      const r = readMark(an, g, model, gap);
      if (r.kind === 'noise') continue;
      const a = anchorOf(an, g, r.kind), mx = lay.marginX(a.y);
      const edge = g.x0 <= 1 || g.y0 <= 1 || g.x1 >= W - 2 || g.y1 >= H - 2;
      marks.push({ kind: r.kind, got: r.got, max: r.max ?? null, text: r.text || '', conf: r.conf, circled: !!r.circled,
        x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, w: g.w, h: g.h, ax: a.x, ay: a.y, edge,
        side: mx > 0 && (g.x0 + g.x1) / 2 < mx ? 'left' : (g.x0 + g.x1) / 2 > 0.85 * W ? 'right' : '' });
    }
    marks.sort((a, b) => a.ay - b.ay || a.ax - b.ax);
    const labelsFound = findLabels(an, lay, model);
    return { width: W, height: H, lineGap: gap, margin: lay.margin ? { x0: lay.marginX(0), x1: lay.marginX(H) } : null, labels: labelsFound, marks, analysis: opts.keep ? { an, lay } : undefined };
  }

  /* ------------------------------------------------------------------ 7. the whole sheet */

  // Match the question numbers found on the pages to the paper's questions, in order. Dynamic programming: a number
  // may be skipped ("I." above question 1, a "Section B" mistaken for a number), questions may be missing (not
  // answered, or on a page not photographed), and neighbouring numbers usually go to neighbouring questions.
  function matchLabels(labels, questions) {
    const L = labels.length, m = questions.length;
    if (!L || !m) return [];
    const NEG = -1e9, fit = (i, j) => 2 + 0.7 * Math.max(-6, labelFit(labels[i], questions[j].n));
    const best = Array.from({ length: L }, () => new Float64Array(m).fill(NEG)), from = Array.from({ length: L }, () => new Int32Array(m * 2).fill(-1));
    const SKIP_LABEL = 1.6, SKIP_Q = 0.5, NEXT = 1.2;
    for (let i = 0; i < L; i++) for (let j = 0; j < m; j++) {
      const f = fit(i, j);
      let b = f - SKIP_LABEL * i - 0.15 * j, fi = -1, fj = -1;   // the first number matched: questions before it are cheap to skip (another page)
      for (let pi = Math.max(0, i - 5); pi < i; pi++) for (let pj = Math.max(0, j - 15); pj < j; pj++) {
        const prev = best[pi][pj]; if (prev <= NEG / 2) continue;
        // a number skipped between two questions that follow each other is less likely than one above them (a heading)
        const v = prev + f - (SKIP_LABEL + (j === pj + 1 ? 0.3 : 0)) * (i - pi - 1) - SKIP_Q * (j - pj - 1) + (j === pj + 1 ? NEXT : 0);
        if (v > b) { b = v; fi = pi; fj = pj; }
      }
      best[i][j] = b; from[i][2 * j] = fi; from[i][2 * j + 1] = fj;
    }
    let bi = -1, bj = -1, bv = 0;
    for (let i = 0; i < L; i++) for (let j = 0; j < m; j++) { const v = best[i][j] - SKIP_LABEL * (L - 1 - i); if (v > bv) { bv = v; bi = i; bj = j; } }
    const out = [];
    while (bi >= 0) { out.push({ label: bi, q: bj }); const ni = from[bi][2 * bj], nj = from[bi][2 * bj + 1]; bi = ni; bj = nj; }
    return out.reverse();
  }

  const round2 = v => Math.round(v * 2) / 2;
  const qText = q => /^\d/.test(String(q)) ? 'Q' + q : String(q);

  /**
   * Read a whole marked sheet. pages: readPage results in page order. questions: the paper's questions in order,
   * [{q, n, max, sec}] (from MarkLensParse.parsePaper), or [] when there is no paper yet.
   * Returns { rows: [{q, got, max, how, check, why}], total, notes: [text], lines: sheet text for the page }.
   */
  function readSheet(pages, questions) {
    questions = (questions || []).map(q => ({ ...q, n: q.n ?? parseInt(String(q.q).replace(/^\D+/, ''), 10) }));
    const noPaper = !questions.length;
    const labels = [];
    pages.forEach((pg, p) => pg.labels.forEach((l, k) => labels.push({ ...l, page: p, k })));
    labels.sort((a, b) => a.page - b.page || a.cy - b.cy);
    if (noPaper) {   // no paper: number the answers in order, starting from what the first number looks like
      let n = 1;
      const firstRead = labels.find(l => l.reads.length);
      if (firstRead) { let b = 1, bv = -1e9; for (let k = 1; k <= 60; k++) { const v = labelFit(firstRead, k); if (v > bv) { bv = v; b = k; } } if (bv > -1.5) n = b; }
      labels.forEach(l => questions.push({ q: String(n), n: n++, max: 0, sec: '' }));
    }
    const match = matchLabels(labels, questions);
    const qOfLabel = new Map(match.map(mt => [mt.label, mt.q]));
    // each page split into the stretches that belong to each question: from its number to the next number
    const blocks = [];
    pages.forEach((pg, p) => {
      const ls = labels.map((l, i) => ({ ...l, i })).filter(l => l.page === p), pad = 0.35 * pg.lineGap;
      ls.forEach((l, k) => blocks.push({ page: p, y0: l.y0 - pad, y1: k + 1 < ls.length ? ls[k + 1].y0 - pad : Infinity, q: qOfLabel.has(l.i) ? qOfLabel.get(l.i) : null, label: l }));
      // above the first number: the page's header on page 1 (the total, the teacher's name); on later pages, the
      // end of the answer that ran over from the page before
      const top = ls.length ? ls[0].y0 - pad : Infinity;
      const prevQ = [...blocks].reverse().find(b => b.page < p && b.q !== null);
      blocks.push({ page: p, y0: -Infinity, y1: top, q: p > 0 && prevQ ? prevQ.q : null, header: p === 0 || !prevQ });
    });
    const per = questions.map(() => ({ items: [] })), header = [], loose = [];
    pages.forEach((pg, p) => {
      for (const mk of pg.marks) {
        const b = blocks.find(b => b.page === p && mk.ay >= b.y0 && mk.ay < b.y1);
        const it = { ...mk, page: p };
        if (!b || b.q === null) (b && b.header ? header : loose).push(it);
        else per[b.q].items.push(it);
      }
    });
    // A question number the reader missed (a red subtotal written over it, a smudge): the answer above it then holds two
    // marks on different lines. The lower one goes to the missing question, to be checked.
    const matchedQ = new Set(match.map(mt => mt.q)), gapOf = p => pages[p].lineGap, guessed = new Set();
    for (let j = 0; j + 1 < questions.length; j++) {
      // only between two numbers that were found, and for short answers: a long answer often has several marks
      if (!matchedQ.has(j) || matchedQ.has(j + 1) || guessed.has(j) || !match.some(mt => mt.q === j + 2) || (questions[j].max || 1) > 1) continue;
      const ms = per[j].items.filter(i => i.kind === 'tick' || i.kind === 'cross').sort((a, b) => a.page - b.page || a.ay - b.ay);
      if (ms.length < 2) continue;
      let cut = -1, best = 0;
      for (let k = 1; k < ms.length; k++) { const d = ms[k].page !== ms[k - 1].page ? 1e9 : ms[k].ay - ms[k - 1].ay; if (d >= 0.7 * gapOf(ms[k].page) && d > best) { best = d; cut = k; } }
      if (cut < 0) continue;
      const moved = new Set(ms.slice(cut));
      per[j + 1].items.push(...per[j].items.filter(i => moved.has(i) || (i.kind !== 'tick' && i.kind !== 'cross' && i.kind !== 'mark' && i.ay >= ms[cut].ay - 0.3 * gapOf(i.page))));
      per[j].items = per[j].items.filter(i => !per[j + 1].items.includes(i));
      guessed.add(j + 1); matchedQ.add(j + 1);
    }
    const rows = [], notes = [];
    const maxOf = j => questions[j].max || 0;
    // the marks for each question
    const subtotals = [];
    questions.forEach((qq, j) => {
      const its = per[j].items, onSheet = matchedQ.has(j);
      if (!onSheet && !its.length) return;
      const max = maxOf(j), ticks = its.filter(i => i.kind === 'tick'), crosses = its.filter(i => i.kind === 'cross');
      const nums = its.filter(i => i.kind === 'mark' && i.got != null);
      const fits = nums.filter(i => (!max || i.got <= max + 1e-9) && (i.max == null || !max || i.max === max));
      for (const n of nums) if (!fits.includes(n)) subtotals.push({ ...n, j });
      const marked = its.some(i => i.kind === 'ring' || i.kind === 'line');
      const row = { q: qq.q, max, got: null, how: '', check: false, why: '' };
      if (fits.length) {
        const pick = fits.find(i => i.side === 'left') || [...fits].sort((a, b) => b.conf - a.conf)[0];
        row.got = pick.got; row.how = pick.text || String(pick.got);
        if (pick.max != null && !max) row.max = pick.max;
        if (pick.conf < 0.6) { row.check = true; row.why = `the teacher's "${row.how}" was hard to read`; }
        if (fits.length > 1 && new Set(fits.map(i => i.got)).size > 1) { row.check = true; row.why = `more than one number next to this answer (${fits.map(i => i.text).join(', ')})`; }
      } else if (ticks.length && !crosses.length) {
        row.got = max || 1; row.how = '✓';
        if (!max) row.max = 1;
        if (marked && max > 1) { row.check = true; row.why = 'ticked, but the teacher also circled or underlined part of it: maybe not full marks'; }
        if (ticks.every(t => t.conf < 0.5)) { row.check = true; row.why = 'the tick was hard to make out'; }
      } else if (crosses.length && !ticks.length) {
        row.got = 0; row.how = '✗'; if (!max) row.max = 1;
        if (crosses.every(t => t.conf < 0.5)) { row.check = true; row.why = 'the cross was hard to make out'; }
      } else if (ticks.length && crosses.length) {
        row.got = max > 1 ? round2(max * ticks.length / (ticks.length + crosses.length)) : 0; row.how = '✓✗'; if (!max) row.max = 1;
        row.check = true; row.why = 'there is a tick and a cross on this answer';
      } else {
        row.got = 0; row.how = '';
        row.check = true; row.why = its.length ? 'the red marks next to this answer could not be read' : 'no red mark found next to this answer';
        row.unmarked = !its.length;
      }
      if (guessed.has(j)) { row.check = true; row.why = `its question number was not found on the photo; the mark under ${qText(questions[j - 1].q)} was taken as this one's` + (row.why ? ` (${row.why})` : ''); }
      row.j = j; row.page = (its[0] || {}).page;
      rows.push(row);
    });
    // subtotals: a number bigger than the question it sits next to, usually in the margin. It is the sum of a run of
    // questions: the same section on this page, else the whole page, else the section so far.
    const rowOf = new Map(rows.map(r => [r.j, r]));
    const pageOfQ = j => { const mt = match.find(m => m.q === j); return mt ? labels[mt.label].page : rows.find(r => r.j === j)?.page ?? -1; };
    for (const st of subtotals) {
      const sec = questions[st.j].sec, pg = st.page;
      const ranges = [
        rows.filter(r => pageOfQ(r.j) === pg && questions[r.j].sec === sec && r.j <= st.j + 30),
        rows.filter(r => pageOfQ(r.j) === pg),
        rows.filter(r => questions[r.j].sec === sec && r.j <= Math.max(st.j, ...rows.filter(x => pageOfQ(x.j) === pg).map(x => x.j)))
      ].filter(rg => rg.length);
      let done = false;
      for (const rg of ranges) {
        const unknown = rg.filter(r => r.unmarked), known = rg.filter(r => !r.unmarked), sum = known.reduce((a, r) => a + r.got, 0), diff = st.got - sum;
        const name = `${qText(questions[rg[0].j].q)}–${qText(questions[rg[rg.length - 1].j].q)}`;
        if (!unknown.length && Math.abs(diff) < 1e-9) { rg.forEach(r => { r.confirmed = true; }); notes.push(`The teacher's subtotal ${st.text} for ${name} matches the marks read.`); done = true; break; }
        if (unknown.length === 1 && diff >= 0 && diff <= (unknown[0].max || 1) + 1e-9) {
          const r = unknown[0]; r.got = diff; r.how = 'subtotal'; r.check = true; r.unmarked = false;
          r.why = `no mark next to this answer; the teacher's subtotal ${st.text} for ${name} says it got ${diff}`;
          notes.push(`${qText(r.q)} has no mark of its own: the teacher's subtotal ${st.text} for ${name} gives it ${diff}.`);
          done = true; break;
        }
      }
      if (!done && ranges.length) {
        const rg = ranges[0], sum = rg.reduce((a, r) => a + r.got, 0);
        const r = rowOf.get(st.j);
        if (r && st.side !== 'left' && !r.check) { r.check = true; r.why = `the teacher wrote ${st.text}, more than this question's ${r.max} marks`; }
        notes.push(`The teacher wrote ${st.text} in the margin near ${qText(questions[st.j].q)}, but the marks read for ${qText(questions[rg[0].j].q)}–${qText(questions[rg[rg.length - 1].j].q)} add up to ${fmt(sum)}. Check these against the photo.`);
        rg.filter(x => !x.check).forEach(x => { x.check = true; x.why = x.why || `the marks of this part add up to ${fmt(sum)}, but the teacher's subtotal says ${st.text}`; });
      }
    }
    // the total: a circled number, or a fraction out of 10 or more, in the header of page 1
    let total = null;
    const paperTotal = questions.reduce((a, q) => a + (q.max || 0), 0);
    const cands = header.filter(i => i.kind === 'mark' && i.page === 0 && !i.edge && (i.circled || (i.max != null && i.max >= 10) || i.got >= 10));
    for (const c of cands) {
      const score = (c.circled ? 2 : 0) + (c.max != null && paperTotal && c.max === paperTotal ? 3 : 0) + (c.max != null ? 1 : 0) + c.conf;
      if (!total || score > total.score) total = { got: c.got, max: c.max, text: c.text, score, conf: c.conf };
    }
    if (total) {
      const all = rows.reduce((a, r) => a + r.got, 0), maxAll = rows.reduce((a, r) => a + (r.max || 0), 0);
      notes.unshift(`Teacher's total: ${total.text}${total.max == null && paperTotal ? ' of ' + fmt(paperTotal) : ''}. ` +
        (Math.abs(all - total.got) < 1e-9 ? 'The marks read add up to the same.' : `The marks read on these pages add up to ${fmt(all)} of ${fmt(maxAll)}${total.got > all ? ': photograph the other pages too' : ': check the marks below'}.`));
    }
    const lines = rows.map(r => `${r.q}: ${fmt(r.got)}/${fmt(r.max || 0)}${r.how && r.how !== 'subtotal' ? ' ' + r.how : ''}${r.check ? ' – check: ' + r.why : ''}`);
    return { rows: rows.map(({ j, unmarked, ...r }) => r), total: total && { got: total.got, max: total.max, text: total.text }, notes, lines };
  }
  const fmt = v => String(Math.round(v * 100) / 100).replace(/\.5$/, '½').replace(/^0½$/, '½');

  /* ------------------------------------------------------------------ reading digits (shared with the marks) */

  function roundHalf(x) { return Math.floor(x + 0.5); }

  function crop(m) {
    let x0 = m.w, y0 = m.h, x1 = -1, y1 = -1;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.d[y * m.w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return { w: 0, h: 0, d: new Uint8Array(0) };
    const w = x1 - x0 + 1, h = y1 - y0 + 1, d = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = m.d[(y + y0) * m.w + x + x0];
    return { w, h, d };
  }
  function dilate(m) {
    const w = m.w + 2, h = m.h + 2, d = new Uint8Array(w * h);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.d[y * m.w + x])
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) d[(y + dy) * w + x + dx] = 1;
    return { w, h, d };
  }
  function erode(m) {
    const { w, h } = m, d = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let all = 1;
      for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || yy >= h || xx < 0 || xx >= w || !m.d[yy * w + xx]) { all = 0; break; }
      }
      d[y * w + x] = all;
    }
    return { w, h, d };
  }
  function strokeWidth(m) {
    let area = 0, inner = 0;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      if (!m.d[y * m.w + x]) continue;
      area++;
      if (y > 0 && y < m.h - 1 && x > 0 && x < m.w - 1 && m.d[(y - 1) * m.w + x] && m.d[(y + 1) * m.w + x] && m.d[y * m.w + x - 1] && m.d[y * m.w + x + 1]) inner++;
    }
    return area ? 2 * area / Math.max(area - inner, 1) : 0;
  }
  const count = m => { let s = 0; for (let i = 0; i < m.d.length; i++) s += m.d[i]; return s; };
  const firstRow = m => { for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.d[y * m.w + x]) return y; return 0; };
  const firstCol = m => { for (let x = 0; x < m.w; x++) for (let y = 0; y < m.h; y++) if (m.d[y * m.w + x]) return x; return 0; };
  function weights(nOut, nIn) {
    const W = new Float64Array(nOut * nIn), scale = nIn / nOut;
    for (let i = 0; i < nOut; i++) {
      const a = i * scale, b = (i + 1) * scale, j0 = Math.floor(a), j1 = Math.ceil(b);
      for (let j = j0; j < Math.min(j1, nIn); j++) W[i * nIn + j] = Math.max(0, Math.min(b, j + 1) - Math.max(a, j)) / scale;
    }
    return W;
  }

  /** Binary mask (Uint8Array w*h, 1 = ink) -> Float32Array(784), exactly like tools/digits/glyph.py normalize(). */
  function normalizeGlyph(mask, w, h) {
    let m = crop({ w, h, d: mask });
    const out = new Float32Array(MODEL_SIZE * MODEL_SIZE);
    if (!m.w) return out;
    // even out the pen width
    let s = 20 / Math.max(m.h, m.w);
    const t = strokeWidth(m);
    if (t * s < 1.8) {
      const n = Math.min(4, Math.ceil((2.6 / s - t) / 2));
      for (let k = 0; k < n; k++) m = dilate(m);
    } else if (t * s > 3.8) {
      const n = Math.min(2, Math.floor((t - 2.6 / s) / 2));
      for (let k = 0; k < n; k++) { const e = erode(m); if (count(e) < 0.45 * count(m)) break; m = e; }
      m = crop(m);
    }
    s = 20 / Math.max(m.h, m.w);
    const nh = Math.max(1, roundHalf(m.h * s)), nw = Math.max(1, roundHalf(m.w * s));
    const Wr = weights(nh, m.h), Wc = weights(nw, m.w);
    const T = new Float64Array(m.h * nw);              // T = M @ Wc^T
    for (let a = 0; a < m.h; a++) for (let b = 0; b < m.w; b++) {
      if (!m.d[a * m.w + b]) continue;
      for (let j = 0; j < nw; j++) T[a * nw + j] += Wc[j * m.w + b];
    }
    const g = new Float64Array(nh * nw);               // g = Wr @ T
    for (let i = 0; i < nh; i++) for (let a = 0; a < m.h; a++) {
      const wv = Wr[i * m.h + a]; if (!wv) continue;
      for (let j = 0; j < nw; j++) g[i * nw + j] += wv * T[a * nw + j];
    }
    let tot = 0, cy = 0, cx = 0;
    for (let i = 0; i < nh; i++) for (let j = 0; j < nw; j++) { const v = g[i * nw + j]; tot += v; cy += v * i; cx += v * j; }
    if (tot <= 0) return out;
    cy /= tot; cx /= tot;
    const oy = Math.min(Math.max(Math.floor(14 - cy), 0), MODEL_SIZE - nh);
    const ox = Math.min(Math.max(Math.floor(14 - cx), 0), MODEL_SIZE - nw);
    for (let i = 0; i < nh; i++) for (let j = 0; j < nw; j++) { const v = g[i * nw + j]; out[(oy + i) * MODEL_SIZE + ox + j] = v < 0 ? 0 : v > 1 ? 1 : v; }
    return out;
  }

  const b64 = s => {
    if (typeof atob === 'function') { const bin = atob(s), a = new Int8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i) << 24 >> 24; return a; }
    return new Int8Array(Buffer.from(s, 'base64'));
  };

  /** models/marks-v2.json -> { classes, predict(glyph) -> Float32Array of probabilities, one per class } */
  function loadModel(json) {
    const w = {}, NC = json.classes.length;
    for (const [k, t] of Object.entries(json.weights)) {
      const q = b64(t.data), f = new Float32Array(q.length);
      for (let i = 0; i < q.length; i++) f[i] = q[i] * t.scale;
      w[k] = f;
    }
    TICK = json.classes.indexOf('tick'); CROSS = json.classes.indexOf('cross');
    const c1 = new Float32Array(26 * 26 * 16), p1 = new Float32Array(13 * 13 * 16), c2 = new Float32Array(11 * 11 * 32), p2 = new Float32Array(800), d1 = new Float32Array(64), d2 = new Float32Array(NC);
    function logits(x) {
      const W1 = w.c1w, B1 = w.c1b, W2 = w.c2w, B2 = w.c2b, D1 = w.d1w, E1 = w.d1b, D2 = w.d2w, E2 = w.d2b;
      for (let y = 0; y < 26; y++) for (let xx = 0; xx < 26; xx++) {
        const o0 = (y * 26 + xx) * 16;
        for (let o = 0; o < 16; o++) c1[o0 + o] = B1[o];
        for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++) {
          const v = x[(y + ky) * 28 + xx + kx]; if (!v) continue;
          const wb = (ky * 3 + kx) * 16;
          for (let o = 0; o < 16; o++) c1[o0 + o] += v * W1[wb + o];
        }
        for (let o = 0; o < 16; o++) if (c1[o0 + o] < 0) c1[o0 + o] = 0;
      }
      pool(c1, 26, 16, p1, 13);
      for (let y = 0; y < 11; y++) for (let xx = 0; xx < 11; xx++) {
        const o0 = (y * 11 + xx) * 32;
        for (let o = 0; o < 32; o++) c2[o0 + o] = B2[o];
        for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++) {
          const i0 = ((y + ky) * 13 + xx + kx) * 16, wb = (ky * 3 + kx) * 16 * 32;
          for (let i = 0; i < 16; i++) {
            const v = p1[i0 + i]; if (!v) continue;
            const wr = wb + i * 32;
            for (let o = 0; o < 32; o++) c2[o0 + o] += v * W2[wr + o];
          }
        }
        for (let o = 0; o < 32; o++) if (c2[o0 + o] < 0) c2[o0 + o] = 0;
      }
      pool(c2, 11, 32, p2, 5);
      for (let o = 0; o < 64; o++) d1[o] = E1[o];
      for (let i = 0; i < 800; i++) { const v = p2[i]; if (!v) continue; const r = i * 64; for (let o = 0; o < 64; o++) d1[o] += v * D1[r + o]; }
      for (let o = 0; o < 64; o++) if (d1[o] < 0) d1[o] = 0;
      for (let o = 0; o < NC; o++) d2[o] = E2[o];
      for (let i = 0; i < 64; i++) { const v = d1[i]; if (!v) continue; const r = i * NC; for (let o = 0; o < NC; o++) d2[o] += v * D2[r + o]; }
      return d2;
    }
    return {
      classes: json.classes,
      logits: x => Float32Array.from(logits(x)),
      predict(x) {
        const l = logits(x); let m = -Infinity; for (const v of l) if (v > m) m = v;
        const p = new Float32Array(NC); let s = 0;
        for (let i = 0; i < NC; i++) { p[i] = Math.exp(l[i] - m); s += p[i]; }
        for (let i = 0; i < NC; i++) p[i] /= s;
        return p;
      }
    };
  }
  function pool(src, n, ch, dst, m) {
    for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) for (let c = 0; c < ch; c++) {
      const a = src[((2 * y) * n + 2 * x) * ch + c], b = src[((2 * y) * n + 2 * x + 1) * ch + c], d = src[((2 * y + 1) * n + 2 * x) * ch + c], e = src[((2 * y + 1) * n + 2 * x + 1) * ch + c];
      dst[(y * m + x) * ch + c] = Math.max(a, b, d, e);
    }
  }

  // pixels of a set of components, as a mask over their joint bounding box
  function partsMask(an, parts, keep) {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (const p of parts) { x0 = Math.min(x0, p.x0); y0 = Math.min(y0, p.y0); x1 = Math.max(x1, p.x1); y1 = Math.max(y1, p.y1); }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, d = new Uint8Array(w * h), ids = new Set(parts.map(p => p.id)), W = an.width;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const id = an.labels[y * W + x];
      if (ids.has(id) && (!keep || keep(x, y, id))) d[(y - y0) * w + x - x0] = 1;
    }
    return { w, h, d, x0, y0 };
  }

  function ringSplit(an, c) {
    // A ring drawn round the number and touching it. In each of 48 directions from the centre, the ring is the
    // outermost ink; everything more than about one pen width inside it is the number.
    const ex = (c.x0 + c.x1) / 2, ey = (c.y0 + c.y1) / 2, rx = c.w / 2, ry = c.h / 2, S = 48, W = an.width;
    const outer = new Float32Array(S), sec = (x, y) => {
      const dx = (x - ex) / rx, dy = (y - ey) / ry;
      return [Math.hypot(dx, dy), Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * S) % S];
    };
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (an.labels[y * W + x] === c.id) {
      const [r, k] = sec(x, y); if (r > outer[k]) outer[k] = r;
    }
    let covered = 0; for (let k = 0; k < S; k++) if (outer[k] > 0.7) covered++;
    if (covered < 0.75 * S) return null;                          // not round all the way: not a ring
    const sm = new Float32Array(S);
    for (let k = 0; k < S; k++) { const w = [-2, -1, 0, 1, 2].map(d => outer[(k + d + S) % S]).sort((a, b) => a - b); sm[k] = w[2]; }
    const t = Math.min(0.45, 1.9 * c.stroke / Math.min(rx, ry));
    let ring = 0, inner = 0;
    const isIn = (x, y) => { const [r, k] = sec(x, y); return r < sm[k] - t; };
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (an.labels[y * W + x] === c.id) { if (isIn(x, y)) inner++; else ring++; }
    if (inner < 0.12 * c.area || ring < 0.35 * c.area) return null;
    return partsMask(an, [c], (x, y) => isIn(x, y));
  }

  // Strokes that together go round the rest of the mark: a ring or a box. Seen from the middle of the mark,
  // they cover most directions and stay near the outside, while the number sits in the middle.
  function findRing(an, parts) {
    if (parts.length < 2) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (const p of parts) { x0 = Math.min(x0, p.x0); y0 = Math.min(y0, p.y0); x1 = Math.max(x1, p.x1); y1 = Math.max(y1, p.y1); }
    const ex = (x0 + x1) / 2, ey = (y0 + y1) / 2, rx = (x1 - x0 + 1) / 2, ry = (y1 - y0 + 1) / 2, S = 36, W = an.width;
    // a ring piece is big, hollow and reaches the outer box of the mark
    const cand = parts.filter(p => p.fill < 0.5 && (p.w >= 0.55 * 2 * rx || p.h >= 0.55 * 2 * ry) &&
      (p.x0 - x0 <= 0.12 * rx || x1 - p.x1 <= 0.12 * rx || p.y0 - y0 <= 0.12 * ry || y1 - p.y1 <= 0.12 * ry));
    if (!cand.length || cand.length === parts.length) return null;
    const rest = parts.filter(p => !cand.includes(p));
    // the rest (the number) must be inside, away from the edge
    if (!rest.every(p => Math.hypot((p.cx - ex) / rx, (p.cy - ey) / ry) < 0.62)) return null;
    const sec = new Uint8Array(S), ids = new Set(cand.map(c => c.id));
    let outside = 0, tot = 0;
    for (const c of cand) for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      if (an.labels[y * W + x] !== c.id) continue;
      const dx = (x - ex) / rx, dy = (y - ey) / ry, r = Math.hypot(dx, dy);
      tot++; if (r > 0.6) outside++;
      sec[Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * S) % S] = 1;
    }
    let cov = 0; for (let k = 0; k < S; k++) cov += sec[k];
    return cov >= 0.7 * S && outside >= 0.75 * tot && ids.size ? cand : null;
  }

  // A ½ or a fraction whose bar touches the numbers comes out as one shape: cut it at the bar.
  function splitStack(m) {
    const { w, h, d } = m;
    if (h < 1.1 * w || h < 14) return null;
    const span = new Int32Array(h);
    for (let y = 0; y < h; y++) {
      let lo = -1, hi = -1;
      for (let x = 0; x < w; x++) if (d[y * w + x]) { if (lo < 0) lo = x; hi = x; }
      span[y] = lo < 0 ? 0 : hi - lo + 1;
    }
    // the bar is the widest row in the middle of the shape, clearly wider than what is above it
    let ym = -1, best = 0;
    for (let y = Math.floor(0.2 * h); y <= Math.ceil(0.8 * h) && y < h; y++) if (span[y] > best) { best = span[y]; ym = y; }
    if (ym < 0 || best < 0.5 * w) return null;
    let a = ym, b = ym;
    while (a - 1 >= 0 && span[a - 1] >= 0.8 * best) a--;
    while (b + 1 < h && span[b + 1] >= 0.8 * best) b++;
    if (b - a + 1 > Math.max(4, 0.3 * h) || a < 3 || b > h - 4) return null;
    let above = 0; for (let y = 0; y < a; y++) above += span[y];
    if (above / a > 0.75 * best) return null;
    const part = (y0, y1) => {
      const out = { w, h: y1 - y0 + 1, d: new Uint8Array(w * (y1 - y0 + 1)), x0: m.x0, y0: m.y0 + y0 };
      let n = 0;
      for (let y = y0; y <= y1; y++) for (let x = 0; x < w; x++) if (d[y * w + x]) { out.d[(y - y0) * w + x] = 1; n++; }
      return n >= 6 ? out : null;
    };
    const top = part(0, a - 1), bot = part(b + 1, h - 1);
    return top && bot ? { top, bot } : null;
  }

  function splitMask(m) {
    // connected pieces of a small mask, left to right (used for what was inside a touching ring)
    const { w, h, d } = m, lab = new Int32Array(w * h), out = [];
    let id = 0;
    for (let i = 0; i < w * h; i++) {
      if (!d[i] || lab[i]) continue;
      id++; const st = [i]; lab[i] = id; let x0 = w, y0 = h, x1 = -1, y1 = -1, area = 0;
      while (st.length) {
        const j = st.pop(), y = (j / w) | 0, x = j - y * w; area++;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx; if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
          const k = yy * w + xx; if (d[k] && !lab[k]) { lab[k] = id; st.push(k); }
        }
      }
      if (area < 8) continue;
      const pw = x1 - x0 + 1, ph = y1 - y0 + 1, pd = new Uint8Array(pw * ph);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (lab[y * w + x] === id) pd[(y - y0) * pw + x - x0] = 1;
      out.push({ w: pw, h: ph, d: pd, x0: m.x0 + x0, y0: m.y0 + y0, x1: m.x0 + x1, y1: m.y0 + y1, area });
    }
    return out.sort((a, b) => a.x0 - b.x0);
  }

  const isBarLike = (p, refH) => p.w >= 2.2 * p.h && p.h <= 0.4 * refH && Math.abs(p.angle ?? 0) < 25;
  // "/" between two numbers: a long thin stroke leaning right (image y points down, so its angle is negative)
  const isSlashLike = (p, refH) => p.elong >= 3.2 && p.h >= 0.55 * refH && p.angle < -25 && p.angle > -84 && p.stroke < 0.35 * p.h;

  function classify(model, m) {
    const p = model.predict(normalizeGlyph(m.d, m.w, m.h));
    let best = 0; for (let i = 1; i < 10; i++) if (p[i] > p[best]) best = i;
    let not = 0; for (let i = 10; i < p.length; i++) not += p[i];
    return not > p[best] ? { cls: 10, p: not } : { cls: best, p: p[best] };
  }

  /** Read one group of red strokes. Returns {kind: 'mark'|'text'|'tick'|'noise', got, max, text, conf, circled, ...}. */
  function readCluster(an, cl, model) {
    let parts = cl.items.map(c => ({ ...c }));
    let circled = false;
    const glyphs = [];
    // rings and boxes drawn round the number are set aside (also a ring drawn in two or three strokes)
    const ring = findRing(an, parts);
    if (ring) { parts = parts.filter(o => !ring.includes(o)); circled = true; }
    const refH = Math.max(8, ...parts.filter(p => !isBarLike(p, 1e9)).map(p => p.h));
    // fraction bars: thin horizontal strokes with something above and below
    const bars = parts.filter(p => isBarLike(p, refH) && parts.some(o => o !== p && o.cy < p.y0 && ovl(o.x0, o.x1, p.x0, p.x1) > 0) && parts.some(o => o !== p && o.cy > p.y1 && ovl(o.x0, o.x1, p.x0, p.x1) > 0));
    parts = parts.filter(p => !bars.includes(p));
    // strokes of one character (the top of a 5, the two strokes of a 4) go together
    const n = parts.length, par = [...Array(n).keys()];
    const f = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = parts[i], b = parts[j];
      const ox = ovl(a.x0, a.x1, b.x0, b.x1), gy = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
      const barBetween = bars.some(r => ovl(r.x0, r.x1, Math.max(a.x0, b.x0), Math.min(a.x1, b.x1)) > 0 && r.cy > Math.min(a.cy, b.cy) && r.cy < Math.max(a.cy, b.cy));
      const small = Math.max(a.h, b.h) < 0.75 * refH;   // two small stacked pieces are a ½, not one character
      if (!barBetween && ox >= 0.5 * Math.min(a.w, b.w) && gy <= 0.3 * Math.max(a.h, b.h) && !(small && gy > 0)) par[f(i)] = f(j);
    }
    const groups = new Map();
    parts.forEach((p, i) => { const r = f(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });
    for (const ps of groups.values()) {
      const m = partsMask(an, ps), one = ps.length === 1 ? ps[0] : null;
      const g = { mask: m, x0: m.x0, y0: m.y0, x1: m.x0 + m.w - 1, y1: m.y0 + m.h - 1, w: m.w, h: m.h, slash: !!one && isSlashLike(one, refH), angle: one ? one.angle : 0, ...classify(model, m) };
      const piece = pc => { const q = crop(pc); const x0 = pc.x0 + firstCol(pc), y0 = pc.y0 + firstRow(pc); return { mask: { ...q, x0, y0 }, x0, y0, x1: x0 + q.w - 1, y1: y0 + q.h - 1, w: q.w, h: q.h, slash: false, angle: 0, ...classify(model, q) }; };
      // a ring drawn round the number and touching it makes one shape the model can't read: look inside the ring
      if (one && one.fill < 0.5 && one.w / one.h > 0.5 && one.w / one.h < 2 && one.h > 1.2 * an.page.medianH && (g.cls === 0 || g.cls === 10 || g.p < 0.85)) {
        const inner = ringSplit(an, one);
        const pieces = inner ? splitMask(inner).filter(pc => pc.h >= 0.25 * one.h) : [];
        const read = pieces.map(piece);
        if (read.length && read.length <= 3 && read.every(r => r.cls < 10 && r.p >= 0.55) && (g.cls !== 0 || read.some(r => r.cls !== 0))) { glyphs.push(...read); circled = true; continue; }
      }
      // a ½ (or 3 over 5) whose bar touches the numbers
      if (g.cls === 10 || g.p < 0.75 || g.cls === 1 || g.cls === 8 || g.cls === 6) {
        const st = splitStack(m);
        if (st) {
          const top = piece(st.top), bot = piece(st.bot);
          const others = parts.filter(p => !ps.includes(p)).map(p => p.h), big = others.length ? Math.max(...others) : 0;
          // "1" over something small, beside a bigger number: that is ½ (the 2 is often just a blob at this size)
          if (top.cls === 1 && top.p >= 0.5 && big && Math.max(top.h, bot.h) <= 0.7 * big) {
            if (bot.cls !== 2) { bot.cls = 2; bot.p = 0.5; }
            glyphs.push(top, bot); continue;
          }
          if (top.cls < 10 && bot.cls < 10 && top.p >= 0.5 && bot.p >= 0.5 && (g.cls === 10 || g.p < 0.75 || (top.cls === 1 && bot.cls === 2))) { glyphs.push(top, bot); continue; }
        }
      }
      glyphs.push(g);
    }
    for (const g of glyphs) { g.cx = (g.x0 + g.x1) / 2; g.cy = (g.y0 + g.y1) / 2; }
    return interpret(glyphs, bars, Math.max(refH, ...glyphs.map(g => g.h)), circled);
  }

  function interpret(glyphs, bars, refH, circled) {
    const out = { circled, glyphs: glyphs.length };
    if (!glyphs.length) return { ...out, kind: 'noise', conf: 0 };
    glyphs.sort((a, b) => a.cx - b.cx);
    // columns: characters written above one another (3 over 5, the ½ of 2½)
    const cols = [];
    for (const g of glyphs) {
      const col = cols.find(c => c.some(o => ovl(o.x0, o.x1, g.x0, g.x1) >= 0.4 * Math.min(o.w, g.w) && (g.cy < o.y0 || g.cy > o.y1)));
      if (col) col.push(g); else cols.push([g]);
    }
    let tokens = [];
    for (const col of cols) {
      if (col.length === 1) {
        const g = col[0];
        tokens.push(g.cls === 10 && !g.slash ? { t: 'x', g } : { t: 'd', v: g.cls === 10 ? 1 : g.cls, g });
      } else {
        col.sort((a, b) => a.cy - b.cy);
        const top = col[0], bot = col[col.length - 1], small = Math.max(top.h, bot.h) < 0.75 * refH;
        if (top.cls < 10 && bot.cls < 10) tokens.push({ t: 'frac', top, bot, small });
        // a small 1 over a shape the model can't read, beside a bigger number: the 2 of a ½ joined to its bar
        else if (small && top.cls === 1 && top.p >= 0.5 && tokens.some(t => t.t === 'd')) tokens.push({ t: 'frac', top, bot: { ...bot, cls: 2, p: 0.5 }, small });
        else col.forEach(g => tokens.push(g.cls === 10 ? { t: 'x', g } : { t: 'd', v: g.cls, g }));
      }
    }
    // ticks and crosses next to the number are not part of it
    while (tokens.length && tokens[0].t === 'x') tokens.shift();
    while (tokens.length && tokens[tokens.length - 1].t === 'x') tokens.pop();
    const others = glyphs.filter(g => g.cls === 10 && !g.slash).length;
    if (!tokens.length) return { ...out, kind: glyphs.length <= 2 ? 'tick' : 'text', conf: Math.min(...glyphs.map(g => g.p)) };
    if (others >= 3 && others >= tokens.filter(t => t.t !== 'x').length) return { ...out, kind: 'text', conf: 0.5 };
    if (tokens.some(t => t.t === 'x')) {
      const digits = tokens.filter(t => t.t !== 'x').length;
      if (digits < 2 * tokens.filter(t => t.t === 'x').length) return { ...out, kind: 'text', conf: 0.4 };
      tokens = tokens.filter(t => t.t !== 'x');
    }
    let conf = 1;
    const use = g => { conf = Math.min(conf, g.p); };
    const num = list => { if (!list.length || list.length > 2) return null; let v = 0; for (const t of list) { if (t.t !== 'd') return null; v = v * 10 + t.v; } list.forEach(t => use(t.g)); return v; };
    // a slanted stroke between two numbers is "/" (a mark never has three digits, so "3 1 5" can't be a number)
    for (let i = 1; i < tokens.length - 1; i++) {
      const t = tokens[i];
      if (t.t === 'd' && t.g.slash && tokens[i - 1].t === 'd' && tokens[i + 1].t === 'd') { t.t = '/'; break; }
    }
    let got = null, max = null, text = '';
    const slash = tokens.findIndex(t => t.t === '/');
    const fr = tokens.findIndex(t => t.t === 'frac');
    if (slash > 0) {
      got = num(tokens.slice(0, slash)); max = num(tokens.slice(slash + 1));
      if (got !== null && max !== null) text = `${got}/${max}`; else { got = null; max = null; }
    } else if (fr >= 0) {
      const f0 = tokens[fr], a = f0.top.cls, b = f0.bot.cls;
      use(f0.top); use(f0.bot);
      const before = fr ? num(tokens.slice(0, fr)) : null;
      // small digits stacked after a number are a fraction of a mark: ½ (also ¼, ¾). A small 1 is easily read as 7,
      // and the 2 under a bar is often a blob, so in this position 7 counts as 1 and 7 or Z as 2.
      const ta = a === 7 ? 1 : a, tb = b === 7 || b === 1 ? 2 : b;
      if (f0.small && fr === tokens.length - 1 && (fr > 0 ? before !== null : true) && ((ta === 1 && tb === 2) || (ta === 1 && tb === 4) || (ta === 3 && tb === 4))) {
        got = (before ?? 0) + ta / tb; text = `${before ?? ''}${ta === 1 && tb === 2 ? '½' : ta === 1 ? '¼' : '¾'}`;
        if (a !== ta || b !== tb) conf *= 0.8;
      }
      else if (fr === 0 && tokens.length === 1) { got = a; max = b; text = `${a}/${b}`; }
      else if (before !== null) { got = before; text = String(before); conf *= 0.7; }
    } else if (tokens.length === 3 && tokens[1].v === 1) {
      // "3 1 5": the middle 1 is almost always the slash of 3/5
      got = num([tokens[0]]); max = num([tokens[2]]); use(tokens[1].g); conf *= 0.8;
      if (got !== null && max !== null) text = `${got}/${max}`;
    } else {
      got = num(tokens);
      if (got !== null) text = String(got);
    }
    if (got === null) return { ...out, kind: 'text', conf: 0.3 };
    if (max !== null && got > max) conf *= 0.5;
    return { ...out, kind: 'mark', got, max, text, conf };
  }

  return { analyzeRed, layout, findLines, readPage, readSheet, matchLabels, findLabels, labelFit, normalizeGlyph, loadModel, readCluster, groupMarks, pieces };
});
