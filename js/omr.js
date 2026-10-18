/* MarkLens OMR: the printable answer sheet's layout and the on-phone reader.
 *
 * Everything here runs in the browser: no photo leaves the device and no AI is used.
 * The sheet has four solid black corner squares and a 14-square code strip along the bottom that says how
 * many questions and options it has. The reader finds the four squares, maps the sheet with a perspective
 * transform (so tilted, rotated or scaled photos work), reads the code, then scores every bubble by how much
 * darker its inside is than the paper just around it. That local comparison copes with shadows and uneven light.
 */
(function (global) {
  'use strict';

  const LETTERS = 'ABCDEFGH';
  const MARKS = [[15, 15], [195, 15], [195, 282], [15, 282]];   // corner square centres in mm: top-left, top-right, bottom-right, bottom-left
  const MARK_SIZE = 10;
  const BITS = 14, BIT_Y = 282, BIT_X0 = 36, BIT_STEP = 9, BIT_SIZE = 4.5;
  const MAX_Q = 100;

  /* ---------- the sheet ---------- */

  // Questions run down each column, then across: up to 25 per column, up to 4 columns.
  function layout(nQ, nOpt) {
    nQ = Math.max(1, Math.min(MAX_Q, Math.round(nQ) || 1));
    nOpt = Math.max(2, Math.min(6, Math.round(nOpt) || 4));
    const cols = Math.ceil(nQ / 25), rows = Math.ceil(nQ / cols);
    const gx0 = 24, gx1 = 186, gy0 = 76, gy1 = 266;
    const colW = (gx1 - gx0) / cols, numW = 10;
    const pitchY = Math.min(9, (gy1 - gy0) / rows);
    const pitchX = Math.min(7.4, (colW - numW - 2) / nOpt);
    const r = Math.min(2.4, pitchX * 0.36, pitchY * 0.32);
    const questions = [];
    for (let q = 1; q <= nQ; q++) {
      const col = Math.floor((q - 1) / rows), row = (q - 1) % rows;
      const x0 = gx0 + col * colW + numW, y = gy0 + row * pitchY + pitchY / 2;
      const opts = [];
      for (let o = 0; o < nOpt; o++) opts.push({ letter: LETTERS[o], x: x0 + o * pitchX + pitchX / 2, y });
      questions.push({ q, col, row, labelX: x0 - 1.4, y, opts });
    }
    const bits = encode(nQ, nOpt).map((on, i) => ({ on, x: BIT_X0 + i * BIT_STEP, y: BIT_Y }));
    return { nQ, nOpt, cols, rows, r, pitchX, pitchY, gx0, gx1, gy0, gy1, colW, questions, bits };
  }

  // 14 squares: 1, 7 bits of question count, 3 bits of (options - 2), 2-bit checksum, 1
  function encode(nQ, nOpt) {
    const data = [];
    for (let i = 6; i >= 0; i--) data.push((nQ >> i) & 1);
    for (let i = 2; i >= 0; i--) data.push(((nOpt - 2) >> i) & 1);
    const sum = data.reduce((a, b) => a + b, 0) % 4;
    return [1, ...data, (sum >> 1) & 1, sum & 1, 1];
  }
  function decode(bits) {
    if (!bits || bits.length !== BITS || !bits[0] || !bits[BITS - 1]) return null;
    const data = bits.slice(1, 11), sum = data.reduce((a, b) => a + b, 0) % 4;
    if (((sum >> 1) & 1) !== bits[11] || (sum & 1) !== bits[12]) return null;
    const nQ = data.slice(0, 7).reduce((a, b) => a * 2 + b, 0), nOpt = data.slice(7).reduce((a, b) => a * 2 + b, 0) + 2;
    if (nQ < 1 || nQ > MAX_Q || nOpt < 2 || nOpt > 6) return null;
    return { nQ, nOpt };
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f = n => Math.round(n * 100) / 100;

  // The printable A4 sheet as SVG (mm units). The white bands just inside the corner squares must stay empty:
  // the reader looks there for the code strip when it tries each way the photo could be turned.
  function svg(L, opt) {
    opt = opt || {};
    const p = [], last = LETTERS[L.nOpt - 1];
    p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297" width="210mm" height="297mm" font-family="Arial, Helvetica, sans-serif" role="img" aria-label="OMR answer sheet, ${L.nQ} questions, options A to ${last}">`);
    p.push('<rect width="210" height="297" fill="#fff"/>');
    for (const [x, y] of MARKS) p.push(`<rect x="${x - MARK_SIZE / 2}" y="${y - MARK_SIZE / 2}" width="${MARK_SIZE}" height="${MARK_SIZE}" fill="#000"/>`);
    p.push(`<text x="24" y="31" font-size="6" font-weight="700" fill="#111">${esc(opt.title || 'OMR answer sheet')}</text>`);
    p.push(`<text x="186" y="31" font-size="3" text-anchor="end" fill="#555">MarkLens · ${L.nQ} questions · A–${last}</text>`);
    const line = (label, x, x1, x2, y) => `<text x="${x}" y="${y}" font-size="3.4" fill="#333">${label}</text><line x1="${x1}" y1="${y + 0.6}" x2="${x2}" y2="${y + 0.6}" stroke="#888" stroke-width="0.3"/>`;
    p.push(line('Name', 24, 36, 122, 43), line('Roll no.', 128, 145, 186, 43), line('Class', 24, 36, 90, 52), line('Date', 96, 106, 150, 52));
    p.push('<text x="24" y="62" font-size="3.1" fill="#333">Fill <tspan font-weight="700">one</tspan> bubble per question completely, with a dark pen or pencil. Don\'t tick or cross.</text>');
    p.push('<text x="24" y="67" font-size="3.1" fill="#333">To change an answer, rub the old mark out fully.</text>');
    p.push('<circle cx="176" cy="63.5" r="2.2" fill="#111"/><text x="181" y="64.6" font-size="2.6" fill="#333">right</text>');
    for (let c = 1; c < L.cols; c++) {
      const x = L.gx0 + c * L.colW - 1.2;
      p.push(`<line x1="${f(x)}" y1="${L.gy0 - 2}" x2="${f(x)}" y2="${L.gy1}" stroke="#ccc" stroke-width="0.25"/>`);
    }
    for (const q of L.questions) {
      if (Math.floor(q.row / 5) % 2 === 1) {   // a pale band on every other group of 5 rows helps students keep their place
        const x0 = L.gx0 + q.col * L.colW + 0.6;
        p.push(`<rect x="${f(x0)}" y="${f(q.y - L.pitchY / 2)}" width="${f(L.colW - 2.4)}" height="${f(L.pitchY)}" fill="#f4f4f4"/>`);
      }
    }
    const fs = Math.min(3.2, L.pitchY * 0.45), ls = L.r * 1.15;
    for (const q of L.questions) {
      p.push(`<text x="${f(q.labelX)}" y="${f(q.y + fs * 0.36)}" font-size="${f(fs)}" font-weight="700" text-anchor="end" fill="#222">${q.q}</text>`);
      for (const o of q.opts) {
        p.push(`<circle cx="${f(o.x)}" cy="${f(o.y)}" r="${f(L.r)}" fill="#fff" stroke="#222" stroke-width="0.28"/>`);
        p.push(`<text x="${f(o.x)}" y="${f(o.y + ls * 0.36)}" font-size="${f(ls)}" text-anchor="middle" fill="#ababab">${o.letter}</text>`);
      }
    }
    for (const b of L.bits) if (b.on) p.push(`<rect x="${b.x - BIT_SIZE / 2}" y="${b.y - BIT_SIZE / 2}" width="${BIT_SIZE}" height="${BIT_SIZE}" fill="#000"/>`);
    p.push('<text x="105" y="293" font-size="2.5" text-anchor="middle" fill="#777">Keep the four black squares clean and inside the photo. Print at 100% on A4.</text>');
    p.push('</svg>');
    return p.join('');
  }

  /* ---------- reading a photo ---------- */

  function loadImage(src) {
    return new Promise((res, rej) => {
      if (src instanceof HTMLImageElement && src.complete) return res(src);
      const img = new Image(), url = src instanceof Blob ? URL.createObjectURL(src) : String(src);
      img.onload = () => { if (src instanceof Blob) URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { if (src instanceof Blob) URL.revokeObjectURL(url); rej(new Error('photo')); };
      img.src = url;
    });
  }

  async function loadGray(src, maxSide) {
    let bmp = null;
    if (src instanceof HTMLCanvasElement) bmp = src;
    else if (src instanceof Blob && typeof createImageBitmap === 'function') { try { bmp = await createImageBitmap(src); } catch (e) { bmp = null; } }
    if (!bmp) bmp = await loadImage(src);
    const sw = bmp.naturalWidth || bmp.width, sh = bmp.naturalHeight || bmp.height;
    const k = Math.min(1, maxSide / Math.max(sw, sh)), w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const d = ctx.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    return { w, h, g, canvas: c };
  }

  // dark = clearly darker than the neighbourhood (adaptive, so shadows and uneven light don't matter)
  function darkMask(img) {
    const { w, h, g } = img, W = w + 1, I = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; }
    }
    const R = Math.max(8, Math.round(Math.min(w, h) / 14)), m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - R), x1 = Math.min(w, x + R + 1);
        const mean = (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
        const v = g[y * w + x];
        m[y * w + x] = v < mean * 0.66 && v < 165 ? 1 : 0;
      }
    }
    return m;
  }

  // connected dark blobs with size, centre and shape (second moments)
  function blobs(m, w, h) {
    const lab = new Int32Array(w * h), stack = new Int32Array(w * h), out = [];
    let id = 0;
    for (let s = 0; s < m.length; s++) {
      if (!m[s] || lab[s]) continue;
      id++;
      let sp = 0, area = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
      stack[sp++] = s; lab[s] = id;
      while (sp) {
        const p = stack[--sp], x = p % w, y = (p / w) | 0;
        area++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && m[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
        if (x < w - 1 && m[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
        if (y > 0 && m[p - w] && !lab[p - w]) { lab[p - w] = id; stack[sp++] = p - w; }
        if (y < h - 1 && m[p + w] && !lab[p + w]) { lab[p + w] = id; stack[sp++] = p + w; }
      }
      if (area < 12) continue;
      const cx = sx / area, cy = sy / area;
      const vxx = sxx / area - cx * cx, vyy = syy / area - cy * cy, vxy = sxy / area - cx * cy;
      const tr = vxx + vyy, det = Math.max(0, vxx * vyy - vxy * vxy), disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
      const l1 = tr / 2 + disc, l2 = Math.max(1e-9, tr / 2 - disc);
      out.push({ area, cx, cy, x0, x1, y0, y1, iso: l2 / l1, solid: area / (4 * Math.PI * Math.sqrt(l1 * l2)) });
    }
    return out;
  }

  const polyArea = pts => Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p.cx * q.cy - q.cx * p.cy; }, 0)) / 2;
  function clockwise(pts) {
    const mx = pts.reduce((a, p) => a + p.cx, 0) / pts.length, my = pts.reduce((a, p) => a + p.cy, 0) / pts.length;
    const o = pts.slice().sort((a, b) => Math.atan2(a.cy - my, a.cx - mx) - Math.atan2(b.cy - my, b.cx - mx));   // y points down: increasing angle = clockwise
    let k = 0; o.forEach((p, i) => { if (p.cx + p.cy < o[k].cx + o[k].cy) k = i; });
    return o.slice(k).concat(o.slice(0, k));   // starts at the top-left-most square
  }
  function convex(q) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      const z = (b.cx - a.cx) * (c.cy - b.cy) - (b.cy - a.cy) * (c.cx - b.cx);
      if (Math.abs(z) < 1e-6) return false;
      if (!sign) sign = Math.sign(z); else if (Math.sign(z) !== sign) return false;
    }
    return true;
  }

  // the four corner squares: the largest group of 4 solid, compact, similar-sized blobs that make a big convex shape
  function findCorners(list, w, h) {
    const short = Math.min(w, h);
    const cand = list.filter(b => {
      const s = Math.max(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
      return s >= short * 0.012 && s <= short * 0.16 && b.iso > 0.55 && b.solid > 0.8;
    }).sort((a, b) => b.area - a.area).slice(0, 12);
    let best = null, bestScore = 0;
    for (let a = 0; a < cand.length; a++) for (let b = a + 1; b < cand.length; b++) for (let c = b + 1; c < cand.length; c++) for (let d = c + 1; d < cand.length; d++) {
      const four = [cand[a], cand[b], cand[c], cand[d]], areas = four.map(x => x.area);
      const ratio = Math.min(...areas) / Math.max(...areas);
      if (ratio < 0.38) continue;
      const q = clockwise(four);
      if (!convex(q)) continue;
      const A = polyArea(q);
      if (A < 0.1 * w * h) continue;
      const score = A * Math.sqrt(ratio);
      if (score > bestScore) { bestScore = score; best = q; }
    }
    return best;
  }

  function solve(A, b) {
    const n = b.length, M = A.map((row, i) => row.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return null;
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const k = M[r][c] / M[c][c];
        for (let k2 = c; k2 <= n; k2++) M[r][k2] -= k * M[c][k2];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }
  // perspective map from sheet millimetres to photo pixels
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [u, v] = src[i], [x, y] = dst[i];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
    }
    const s = solve(A, b);
    return s ? s.concat([1]) : null;
  }
  const map = (H, u, v) => { const d = H[6] * u + H[7] * v + H[8]; return [(H[0] * u + H[1] * v + H[2]) / d, (H[3] * u + H[4] * v + H[5]) / d]; };

  // how much darker a zone (a disc, or a ring from in0 to rIn) is than the paper ring around it: 0 = paper, 1 = black
  function darkness(img, H, u, v, rIn, r1, r2, in0) {
    const [cx, cy] = map(H, u, v), [ax, ay] = map(H, u + 1, v), [bx, by] = map(H, u, v + 1);
    const pxmm = (Math.hypot(ax - cx, ay - cy) + Math.hypot(bx - cx, by - cy)) / 2;
    const ri = rIn * pxmm, r0 = (in0 || 0) * pxmm, ra = r1 * pxmm, rb = r2 * pxmm, { w, h, g } = img;
    let inSum = 0, inN = 0; const ring = [];
    const X0 = Math.max(0, Math.floor(cx - rb)), X1 = Math.min(w - 1, Math.ceil(cx + rb));
    const Y0 = Math.max(0, Math.floor(cy - rb)), Y1 = Math.min(h - 1, Math.ceil(cy + rb));
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
      const d = Math.hypot(x - cx, y - cy), v2 = g[y * w + x];
      if (d <= ri && d >= r0) { inSum += v2; inN++; } else if (d >= ra && d <= rb) ring.push(v2);
    }
    if (!inN || ring.length < 4) return { score: 0, pxmm, out: true };
    ring.sort((a, b) => a - b);
    const paper = Math.max(40, ring[Math.floor(ring.length * 0.75)]), inside = inSum / inN;
    return { score: Math.max(0, Math.min(1, 1 - inside / paper)), pxmm, x: cx, y: cy, out: cx < 0 || cy < 0 || cx >= w || cy >= h };
  }

  function readCode(img, H) {
    const bits = [];
    for (let i = 0; i < BITS; i++) bits.push(darkness(img, H, BIT_X0 + i * BIT_STEP, BIT_Y, 1.3, 2.9, 3.7).score > 0.4 ? 1 : 0);
    return decode(bits);
  }

  const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

  /**
   * Read a photo of a MarkLens OMR sheet.
   * src: Blob, image or canvas. opts.expect: {nQ, nOpt} to use if the sheet's code can't be read.
   * Returns { ok, nQ, nOpt, codeRead, answers: [{ q, marked: 'B' | '' | 'AC', flag: '' | 'check' | 'multiple', scores }], overlay, pxPerMm }
   * or { ok: false, error: 'no_sheet' | 'too_far' | 'code' | 'photo' }.
   */
  async function read(src, opts) {
    opts = opts || {};
    let img;
    try { img = await loadGray(src, opts.maxSide || 1800); } catch (e) { return { ok: false, error: 'photo' }; }
    const corners = findCorners(blobs(darkMask(img), img.w, img.h), img.w, img.h);
    if (!corners) return { ok: false, error: 'no_sheet' };
    // try the 4 ways the sheet can be turned; the right one has a valid code strip
    let H = null, code = null;
    for (let k = 0; k < 4 && !code; k++) {
      const q = [0, 1, 2, 3].map(i => corners[(i + k) % 4]);
      const Hk = homography(MARKS, q.map(p => [p.cx, p.cy]));
      if (!Hk) continue;
      const c = readCode(img, Hk);
      if (c) { H = Hk; code = c; }
      else if (k === 0) H = Hk;
    }
    if (!H) return { ok: false, error: 'no_sheet' };
    const lay = code || (opts.expect && opts.expect.nQ ? { nQ: opts.expect.nQ, nOpt: opts.expect.nOpt || 4 } : null);
    if (!lay) return { ok: false, error: 'code' };
    const L = layout(lay.nQ, lay.nOpt);
    // safety check: the printed bubble outlines must be where the map says. If not, the corners were wrong
    // (a cut-off sheet, another page) and reading would give wrong answers, so refuse instead.
    const ringsAt = L.questions.flatMap(q => q.opts).filter((o, i) => i % 2 === 0)
      .map(o => darkness(img, H, o.x, o.y, L.r * 1.15, L.r * 1.3, L.r * 1.6, L.r * 0.85).score);
    const outline = median(ringsAt), seen = ringsAt.filter(v => v >= 0.08).length / Math.max(1, ringsAt.length);
    if (outline < 0.12 || seen < 0.7) return { ok: false, error: code ? 'no_sheet' : 'code', outline };   // real sheets: 0.19 to 0.33
    const cells = L.questions.map(q => q.opts.map(o => darkness(img, H, o.x, o.y, L.r * 0.55, L.r * 1.25, L.r * 1.55)));
    const pxPerMm = median(cells.flat().map(c => c.pxmm));
    if (pxPerMm < 2.6) return { ok: false, error: 'too_far' };
    // most bubbles are empty, so the median score says what "empty" looks like on this photo
    const base = median(cells.flat().map(c => c.score));
    const FILL = Math.min(0.5, Math.max(0.33, base + 0.25)), FAINT = Math.max(0.16, base + 0.08);   // a proper fill scores 0.5+, a tick about 0.3
    const answers = L.questions.map((q, i) => {
      const s = cells[i].map(c => c.score), order = s.map((v, k) => k).sort((a, b) => s[b] - s[a]);
      const top = s[order[0]], second = s[order[1]] || 0;
      let marked = '', flag = '';
      if (top < FAINT) marked = '';
      else if (top < FILL) { marked = LETTERS[order[0]]; flag = 'check'; }             // faint mark or a tick
      else {
        const filled = order.filter(k => s[k] >= FILL);
        if (filled.length === 1) marked = LETTERS[filled[0]];
        else if (top >= second * 1.6) { marked = LETTERS[order[0]]; flag = 'check'; }   // a darker mark beside a half-erased one
        else { marked = filled.map(k => LETTERS[k]).sort().join(''); flag = 'multiple'; }
      }
      if (!flag && second >= FAINT && second < FILL && marked) flag = 'check';            // another bubble was touched
      return { q: q.q, marked, flag, scores: s.map(v => Math.round(v * 100) / 100) };
    });
    return { ok: true, nQ: L.nQ, nOpt: L.nOpt, codeRead: !!code, answers, pxPerMm, outline, overlay: drawOverlay(img, H, L, cells, answers, corners) };
  }

  // a small copy of the photo with what was read: green = read, orange = check, red = more than one bubble
  function drawOverlay(img, H, L, cells, answers, corners) {
    const k = Math.min(1, 900 / Math.max(img.w, img.h)), c = document.createElement('canvas');
    c.width = Math.round(img.w * k); c.height = Math.round(img.h * k);
    const x = c.getContext('2d');
    x.drawImage(img.canvas, 0, 0, c.width, c.height);
    x.lineWidth = Math.max(1.5, 2 * k * 1.4);
    x.strokeStyle = 'rgba(31,79,216,.85)'; x.beginPath();
    corners.forEach((p, i) => x[i ? 'lineTo' : 'moveTo'](p.cx * k, p.cy * k)); x.closePath(); x.stroke();
    L.questions.forEach((q, i) => {
      const a = answers[i];
      q.opts.forEach((o, j) => {
        const on = a.marked.includes(o.letter);
        if (!on) return;
        const cell = cells[i][j];
        x.strokeStyle = a.flag === 'multiple' ? '#e5484d' : a.flag === 'check' ? '#f59e0b' : '#12a150';
        x.beginPath(); x.arc(cell.x * k, cell.y * k, Math.max(3, L.r * 1.35 * cell.pxmm * k), 0, Math.PI * 2); x.stroke();
      });
    });
    return c;
  }

  global.MarkLensOMR = { layout, svg, read, encode, decode, LETTERS, MAX_Q };
})(typeof window !== 'undefined' ? window : globalThis);
