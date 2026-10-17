/* MarkLens red-pen reader.

   Finds what the teacher wrote in red ink on a photo of an exam answer sheet, cuts each
   mark out and reads its digits with a small model trained for this (models/digits-v1.json,
   trained by tools/digits/train.py). Everything runs on the phone; nothing is sent anywhere.

   The functions work on plain {width, height, data: RGBA} images, so the same code runs
   in the browser (inside js/redpen-worker.js) and in the tests under tests/.

   Steps for one page:
     1. paper colour       estimate the paper colour in small blocks, so shadows and
                           yellow indoor light don't change what counts as "red"
     2. red ink            pixels that are clearly redder than the paper (pink and
                           crimson pens too), grown from strong seeds into faint edges
     3. printed lines      long straight red lines (the margin line of answer booklets,
                           underlines) are removed; fingers and other big red objects too
     4. marks              nearby red strokes are grouped into marks; circles and boxes
                           around a number are recognised and set aside
     5. digits             each character is normalised like MNIST and read by the model;
                           ticks, crosses and letters come out as "other"
     6. meaning            3, 10, 3/5, 3 over 5, 2½ become numbers; remarks become text   */

const MODEL_SIZE = 28;

/* ------------------------------------------------------------------ 1. paper colour */

export function paperGrid(img) {
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
export const TUNING = { strong: 0.42, weak: 0.24, darkStrong: 0.1, darkWeak: 0.045, massStrong: 1.0, massWeak: 0.35, orange: 0.5 };

export function analyzeRed(img, opts = {}) {
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
  const dark = new Uint8Array(N), own = new Int8Array(N);          // own: the pixel's own redness, -127..127
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
      if (off[by + Math.min(gw - 1, (x / B) | 0)]) continue;            // the table, not the paper
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
  const mask = red.slice();
  const band = removeLines(mask, W, H);
  const afterLines = opts.debug ? mask.slice() : null;
  const { labels, comps, page, dropped } = components(mask, W, H, stack, band, opts.debug);
  return { width: W, height: H, dark, red, mask, labels, comps, page, afterLines, band: opts.debug ? band : null, dropped };
}

// Printed rules (the margin line of answer booklets, header lines) and long underlines are not marks.
// The photo is seldom straight, so every red pixel votes for lines tilted up to 5 degrees, and a line
// must run along a good part of the page. Only thin stretches of the line are erased, so a number
// written across the margin line keeps its strokes.
function removeLines(mask, W, H) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  const band = new Uint8Array(W * H);   // a strip either side of every rule found: leftovers there are debris
  if (!n) return band;
  const xs = new Int32Array(n), ys = new Int32Array(n);
  for (let i = 0, k = 0; i < mask.length; i++) if (mask[i]) { ys[k] = (i / W) | 0; xs[k] = i - ys[k] * W; k++; }
  const kill = new Uint8Array(W * H);
  for (const vertical of [true, false]) {
    const L = vertical ? H : W, M = vertical ? W : H;
    const need = Math.max(150, 0.12 * L);
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
    for (const f of found) if (!lines.some(l => Math.abs(l.o - f.o) <= 6 && Math.abs(l.t - f.t) <= 0.03)) lines.push(f);
    for (const ln of lines.slice(0, 8)) {
      // fit the line exactly (the vote is only good to half a degree)
      let sa = 0, sb = 0, saa = 0, sab = 0, cnt = 0;
      for (let k = 0; k < n; k++) {
        const a = vertical ? ys[k] : xs[k], b = vertical ? xs[k] : ys[k];
        const d = b - a * ln.t - ln.o;
        if (d >= -8 && d <= 8) { sa += a; sb += b; saa += a * a; sab += a * b; cnt++; }
      }
      if (cnt < 10) continue;
      const den = cnt * saa - sa * sa;
      if (Math.abs(den) > 1e-6) { ln.t = (cnt * sab - sa * sb) / den; ln.o = (sb - ln.t * sa) / cnt; }
      // only the stretches where the line really runs (gaps under 8 px) count as the line;
      // a mark that merely sits in line with a rule elsewhere on the page is left alone
      const occ = new Uint8Array(L);
      for (let k = 0; k < n; k++) {
        const a = vertical ? ys[k] : xs[k], d = (vertical ? xs[k] : ys[k]) - a * ln.t - ln.o;
        if (d >= -3.5 && d <= 3.5) occ[a] = 1;
      }
      const seg = new Uint8Array(L), minSeg = vertical ? 0.08 * H : 0.1 * W;
      let st = -1, last = -1;
      for (let a = 0; a <= L; a++) {
        if (a < L && occ[a]) { if (st < 0) st = a; last = a; continue; }
        if (st >= 0 && (a === L || a - last > 8)) {
          if (last - st >= minSeg) {
            seg.fill(1, st, last + 1);
            for (let q = Math.max(0, st - 20); q <= Math.min(L - 1, last + 20); q++) {
              const c0 = Math.round(ln.o + q * ln.t);
              for (let b = c0 - 12; b <= c0 + 12; b++) if (b >= 0 && b < M) band[vertical ? q * W + b : b * W + q] = 1;
            }
          }
          st = -1;
        }
      }
      for (let k = 0; k < n; k++) {
        const x = xs[k], y = ys[k], a = vertical ? y : x;
        if (!seg[a]) continue;
        const d = (vertical ? x : y) - a * ln.t - ln.o;
        if (d < -3.5 || d > 3.5) continue;
        // thickness across the line at this point: a stroke crossing the rule is kept
        let run = 1;
        if (vertical) { for (let q = x - 1; q >= 0 && mask[y * W + q]; q--) run++; for (let q = x + 1; q < W && mask[y * W + q]; q++) run++; }
        else { for (let q = y - 1; q >= 0 && mask[q * W + x]; q--) run++; for (let q = y + 1; q < H && mask[q * W + x]; q++) run++; }
        if (run <= 9) kill[y * W + x] = 1;
      }
    }
  }
  for (let i = 0; i < kill.length; i++) if (kill[i]) mask[i] = 0;
  return band;
}

function components(mask, W, H, stack, band, debug) {
  const N = W * H, labels = new Int32Array(N), comps = [], maxSide = Math.max(W, H);
  const minArea = Math.max(8, Math.round(N * 3e-6));
  const maxStroke = Math.max(14, maxSide * 0.016), blobStroke = Math.max(10, maxSide * 0.009), blobArea = N * 0.004;
  let next = 1;
  for (let i = 0; i < N; i++) {
    if (!mask[i] || labels[i]) continue;
    const id = next++;
    let sp = 0; stack[sp++] = i; labels[i] = id;
    let area = 0, bound = 0, x0 = W, y0 = H, x1 = 0, y1 = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, inBand = 0;
    while (sp) {
      const j = stack[--sp], y = (j / W) | 0, x = j - y * W;
      area++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; inBand += band[j];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x === 0 || x === W - 1 || y === 0 || y === H - 1 || !mask[j - 1] || !mask[j + 1] || !mask[j - W] || !mask[j + W]) bound++;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= W) continue;
          const k = yy * W + xx;
          if (mask[k] && !labels[k]) { labels[k] = id; stack[sp++] = k; }
        }
      }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, stroke = 2 * area / Math.max(1, bound);
    const c = { id, x0, y0, x1, y1, w, h, area, stroke, cx: sx / area, cy: sy / area, fill: area / (w * h) };
    // second moments -> main direction and how line-like the stroke is (for "/" and fraction bars)
    const mxx = sxx / area - c.cx * c.cx, myy = syy / area - c.cy * c.cy, mxy = sxy / area - c.cx * c.cy;
    const tr = mxx + myy, det = mxx * myy - mxy * mxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
    c.elong = Math.sqrt(l1 / l2);
    c.angle = Math.atan2(2 * mxy, mxx - myy) / 2 * 180 / Math.PI;   // 0 = horizontal, +/-90 = vertical (image y points down)
    let drop = area < minArea;
    if (c.elong >= 10 && Math.max(w, h) >= 0.06 * maxSide) drop = true;               // a long straight stroke: underline, edge
    if (x0 === 0 || y0 === 0 || x1 === W - 1 || y1 === H - 1) drop = true;              // cut off by the edge of the photo
    if ((inBand >= 0.6 * area && Math.min(w, h) <= 18 && c.elong >= 2.2) || (inBand >= 0.85 * area && Math.min(w, h) <= 24)) drop = true;   // what is left of a printed rule
    if (stroke > maxStroke || (stroke > blobStroke && area > blobArea)) drop = true;    // a finger, a red object
    if (Math.max(w, h) >= 0.1 * maxSide && Math.min(w, h) <= 0.015 * maxSide) drop = true;   // a long thin rule
    if (area > 0.012 * N) drop = true;
    if (drop) { c.dropped = true; }
    comps.push(c);
  }
  const hs = comps.filter(c => !c.dropped && c.area >= 40).map(c => c.h).sort((a, b) => a - b);
  const medianH = hs.length ? hs[hs.length >> 1] : 20;
  // underlines shorter than a printed rule: flat, thin and much longer than the writing is tall
  for (const c of comps) if (!c.dropped && Math.abs(c.angle) < 15 && c.elong >= 6 && c.w >= 4 * medianH) c.dropped = true;
  const keep = comps.filter(c => !c.dropped);
  for (const c of comps) if (c.dropped) for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) { const k = y * W + x; if (labels[k] === c.id) { labels[k] = 0; mask[k] = 0; } }
  return { labels, comps: keep, page: { medianH }, dropped: debug ? comps.filter(c => c.dropped) : undefined };
}

/* ------------------------------------------------------------------ 4. group strokes into marks */

const ovl = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) + 1;
const inside = (c, x, y) => x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1;

const ringy = c => c.elong < 5;
function shouldJoin(a, b) {
  if ((ringy(a) && inside(a, b.cx, b.cy)) || (ringy(b) && inside(b, a.cx, a.cy))) return true;   // a ring or box around a number
  const hRef = Math.min(Math.max(a.h, b.h), 2.5 * Math.min(a.h, b.h));
  const gapX = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1) - 1);
  const gapY = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1) - 1);
  if (gapX <= 0.5 * hRef && ovl(a.y0, a.y1, b.y0, b.y1) >= 0.3 * Math.min(a.h, b.h)) return true;   // side by side
  if (gapY <= 0.45 * hRef && ovl(a.x0, a.x1, b.x0, b.x1) >= 0.3 * Math.min(a.w, b.w)) return true; // stacked
  return false;
}

export function clusters(comps) {
  const list = comps.length > 2500 ? [...comps].sort((a, b) => b.area - a.area).slice(0, 2500) : comps;
  const n = list.length, parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const order = [...list.keys()].sort((i, j) => list[i].x0 - list[j].x0);
  for (let oi = 0; oi < n; oi++) {
    const a = list[order[oi]], reach = a.x1 + Math.max(a.h, 8) * 1.3;
    for (let oj = oi + 1; oj < n; oj++) {
      const b = list[order[oj]];
      if (b.x0 > reach) break;
      if (b.y0 > a.y1 + 1.3 * Math.max(a.h, b.h) || a.y0 > b.y1 + 1.3 * Math.max(a.h, b.h)) continue;
      if (shouldJoin(a, b)) { const ra = find(order[oi]), rb = find(order[oj]); if (ra !== rb) parent[ra] = rb; }
    }
  }
  // containment can be missed by the sweep when the ring starts left of the reach window: one more pass for big rings
  for (let i = 0; i < n; i++) {
    const a = list[i]; if (a.fill > 0.4 || a.h < 15 || !ringy(a)) continue;
    for (let j = 0; j < n; j++) if (i !== j && inside(a, list[j].cx, list[j].cy)) { const ra = find(i), rb = find(j); if (ra !== rb) parent[ra] = rb; }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(list[i]); }
  return [...groups.values()].map(items => {
    const b = { items, x0: Infinity, y0: Infinity, x1: -1, y1: -1, area: 0 };
    for (const c of items) { b.x0 = Math.min(b.x0, c.x0); b.y0 = Math.min(b.y0, c.y0); b.x1 = Math.max(b.x1, c.x1); b.y1 = Math.max(b.y1, c.y1); b.area += c.area; }
    b.w = b.x1 - b.x0 + 1; b.h = b.y1 - b.y0 + 1;
    return b;
  });
}

/* ------------------------------------------------------------------ 5. digits */

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
export function normalizeGlyph(mask, w, h) {
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

/** models/digits-v1.json -> { predict(glyph) -> Float32Array(11) probabilities } */
export function loadModel(json) {
  const w = {};
  for (const [k, t] of Object.entries(json.weights)) {
    const q = b64(t.data), f = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) f[i] = q[i] * t.scale;
    w[k] = f;
  }
  const c1 = new Float32Array(26 * 26 * 16), p1 = new Float32Array(13 * 13 * 16), c2 = new Float32Array(11 * 11 * 32), p2 = new Float32Array(800), d1 = new Float32Array(64), d2 = new Float32Array(11);
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
    for (let o = 0; o < 11; o++) d2[o] = E2[o];
    for (let i = 0; i < 64; i++) { const v = d1[i]; if (!v) continue; const r = i * 11; for (let o = 0; o < 11; o++) d2[o] += v * D2[r + o]; }
    return d2;
  }
  return {
    classes: json.classes,
    logits: x => Float32Array.from(logits(x)),
    predict(x) {
      const l = logits(x); let m = -Infinity; for (const v of l) if (v > m) m = v;
      const p = new Float32Array(11); let s = 0;
      for (let i = 0; i < 11; i++) { p[i] = Math.exp(l[i] - m); s += p[i]; }
      for (let i = 0; i < 11; i++) p[i] /= s;
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

/* ------------------------------------------------------------------ 6. reading one mark */

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
  let best = 0; for (let i = 1; i < 11; i++) if (p[i] > p[best]) best = i;
  return { cls: best, p: p[best] };
}

/** Read one group of red strokes. Returns {kind: 'mark'|'text'|'tick'|'noise', got, max, text, conf, circled, ...}. */
export function readCluster(an, cl, model) {
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

/* ------------------------------------------------------------------ one page */

/** All red marks on a page, in reading order. img is the photo at analysis size (about 1600 px). */
export function readPage(img, model, opts = {}) {
  const an = analyzeRed(img, opts.tuning);
  const W = an.width, H = an.height;
  const marks = [];
  for (const cl of clusters(an.comps)) {
    if (cl.area < 25 || cl.h < 14) continue;                    // a digit is never this small in a 2000 px photo
    if (cl.w > 0.45 * W || cl.h > 0.3 * H) continue;          // a big tick across an answer, a crossed-out block
    const r = readCluster(an, cl, model);
    if (r.kind === 'noise') continue;
    const cx = (cl.x0 + cl.x1) / 2;
    marks.push({
      ...r, x0: cl.x0, y0: cl.y0, x1: cl.x1, y1: cl.y1, w: cl.w, h: cl.h,
      margin: cx < 0.2 * W ? 'left' : cx > 0.8 * W ? 'right' : '',
      top: cl.y1 < 0.3 * H
    });
  }
  sortReading(marks);
  let redPx = 0; for (let i = 0; i < an.mask.length; i++) redPx += an.mask[i];
  return { width: W, height: H, marks, redShare: redPx / (W * H), analysis: opts.keep ? an : undefined };
}

export function sortReading(items) {
  items.sort((a, b) => {
    const ha = Math.max(8, Math.min(a.h, b.h));
    if (Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) < 0.6 * ha) return a.x0 - b.x0;
    return (a.y0 + a.y1) - (b.y0 + b.y1);
  });
  return items;
}

/* ------------------------------------------------------------------ helpers for the other readers */

/** Share of the ink inside a box that is red. Used to tell the teacher's words from the student's in Google's reading. */
export function inkInBox(an, x0, y0, x1, y1) {
  const W = an.width, H = an.height;
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W - 1, Math.ceil(x1)); y1 = Math.min(H - 1, Math.ceil(y1));
  let ink = 0, red = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0, i = y * W + x0; x <= x1; x++, i++) {
    if (an.dark[i] >= 50) ink++;
    if (an.red[i]) red++;
  }
  return { ink, red, share: red / Math.max(1, Math.max(ink, red)) };
}

/** Grey, shadow-free copy of the page with the teacher's red ink kept bright red, for the AI reader.
    The AI then knows exactly which writing is the teacher's, and the file is as small as a grey photo. */
export function highlightRed(img, an) {
  const { width: W, height: H } = img, out = new Uint8ClampedArray(W * H * 4), red = an.mask;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, p = i * 4;
    const near = red[i] || (x > 0 && red[i - 1]) || (x < W - 1 && red[i + 1]) || (y > 0 && red[i - W]) || (y < H - 1 && red[i + W]);
    if (near) { out[p] = 215; out[p + 1] = 18; out[p + 2] = 28; }
    else { const v = 255 - Math.min(255, an.dark[i] * 1.35); out[p] = out[p + 1] = out[p + 2] = v; }
    out[p + 3] = 255;
  }
  return { width: W, height: H, data: out };
}

/* ------------------------------------------------------------------ marks to questions */

/**
 * Give each mark found on the sheet to a question of the paper, keeping the order the
 * student wrote in. A mark can't be higher than its question's maximum, a "3/5" must sit on
 * a 5-mark question, ringed marks in the margin are trusted most, and numbers that fit
 * nowhere (corrections in the working, step marks) are left out. Dynamic programming over
 * marks x questions, so it always finds the best overall fit.
 *
 * marks:     [{got, max, conf, circled, margin, label}]   label = question number written next to it, if known
 * questions: [{q, max}]                                   from the question paper, in order
 * returns    [{mark: index, q, ...}] for the marks that were placed
 */
export function alignMarks(marks, questions) {
  const n = marks.length, m = questions.length;
  if (!m) return marks.map((mk, i) => ({ mark: i, q: String(i + 1) }));
  const NEG = -1e9, dp = [], from = [];
  for (let i = 0; i <= n; i++) { dp.push(new Float64Array(m + 1).fill(NEG)); from.push(new Int8Array(m + 1)); }
  dp[0][0] = 0;
  const trust = mk => (mk.circled ? 0.6 : 0) + (mk.margin ? 0.4 : 0) + (mk.max != null ? 0.3 : 0) + 0.5 * (mk.conf ?? 0.5);
  const fit = (mk, qq) => {
    if (qq.max > 0 && mk.got > qq.max + 1e-9) return NEG;
    if (mk.max != null && qq.max > 0 && mk.max !== qq.max) return mk.label ? 0.2 : -1.2;
    let s = 1 + trust(mk);
    if (mk.max != null && qq.max > 0 && mk.max === qq.max) s += 0.8;
    if (mk.label) s += String(mk.label) === String(qq.q) ? 2.5 : -1.5;
    return s;
  };
  for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
    const cur = dp[i][j]; if (cur <= NEG / 2) continue;
    if (i < n) {   // this mark is not a question mark: a correction, a step mark
      const v = cur - (0.15 + 0.6 * trust(marks[i]));
      if (v > dp[i + 1][j]) { dp[i + 1][j] = v; from[i + 1][j] = 1; }
    }
    if (j < m) {   // this question has no mark on the sheet (or it was not found)
      const v = cur - 0.35;
      if (v > dp[i][j + 1]) { dp[i][j + 1] = v; from[i][j + 1] = 2; }
    }
    if (i < n && j < m) {
      const s = fit(marks[i], questions[j]);
      if (s > NEG / 2 && cur + s > dp[i + 1][j + 1]) { dp[i + 1][j + 1] = cur + s; from[i + 1][j + 1] = 3; }
    }
  }
  const out = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const f = from[i][j];
    if (f === 3) { out.push({ mark: i - 1, q: questions[j - 1].q }); i--; j--; }
    else if (f === 1) i--;
    else if (f === 2) j--;
    else break;
  }
  return out.reverse();
}

/** The teacher's total, if one of the marks is it: the ringed or fraction number at the top of the first page
    that equals the sum of the others (within a mark), or whose "out of" equals the paper's total. */
export function findTotal(marks, paperTotal) {
  const cands = marks.filter(mk => mk.kind === 'mark' && mk.page === 0 && (mk.top || mk.circled) && mk.got >= 1);
  let best = null;
  for (const c of cands) {
    const others = marks.filter(o => o !== c && o.kind === 'mark');
    // the size of a typical big question mark (80th percentile, so one misread "71" doesn't count)
    const sorted = others.map(o => o.got).sort((a, b) => a - b), biggest = sorted.length ? sorted[Math.floor(0.8 * (sorted.length - 1))] : 0;
    const rest = others.reduce((a, o) => a + o.got, 0);
    let score = 0;
    if (c.max != null && paperTotal && Math.abs(c.max - paperTotal) < 1e-9) score += 3;
    if (rest > 0 && Math.abs(rest - c.got) <= 1) score += 2;
    if (c.top) score += 1;
    if (c.max != null && c.max >= 10) score += 1;
    if (c.got >= 10) score += 0.5;
    // a total is bigger than any one question's mark (unless its "out of" says it is the paper's total)
    const big = c.got >= 1.5 * biggest || (c.max != null && (c.max >= 10 || (paperTotal && Math.abs(c.max - paperTotal) < 1e-9)));
    if (score >= 3 && big && (!best || score > best.score)) best = { ...c, score };
  }
  return best;
}
