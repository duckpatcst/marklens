/* MarkLens: pages of a PDF (a question paper shared on WhatsApp, a scanned answer sheet).
   Uses pdf.js from vendor/pdfjs, loaded only when someone adds a PDF. A PDF made on a computer
   carries its text, so a question paper needs no reading at all; scanned pages become photos. */

const base = new URL('../vendor/pdfjs/', import.meta.url).href;
let lib = null;
async function pdfjs() {
  if (!lib) {
    lib = import(base + 'pdf.min.mjs').then(m => { m.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs'; return m; });
    lib.catch(() => { lib = null; });
  }
  return lib;
}

/** Lines of text of one PDF page, top to bottom, words left to right. */
async function pageText(page) {
  const tc = await page.getTextContent();
  const items = tc.items.filter(it => it.str && it.str.trim()).map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5], h: Math.abs(it.transform[3]) || Math.abs(it.height) || 8, w: it.width }));
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    const l = lines.find(L => Math.abs(L.y - it.y) <= 0.45 * Math.max(L.h, it.h));
    if (l) l.items.push(it); else lines.push({ y: it.y, h: it.h, items: [it] });
  }
  lines.sort((a, b) => b.y - a.y);
  return lines.map(l => {
    l.items.sort((a, b) => a.x - b.x);
    let out = '', end = null;
    for (const it of l.items) {
      if (end !== null && it.x - end > 0.25 * it.h && !out.endsWith(' ')) out += ' ';
      out += it.s; end = it.x + it.w;
    }
    return out.replace(/\s+/g, ' ').trim();
  }).filter(Boolean).join('\n');
}

/**
 * Every page of the PDF, in order: { text, blob, w, h }.
 * text is the PDF's own text (empty for a scan). blob is a JPEG of the page, longest side maxSide px,
 * made only when wantImage(text) says the page needs to be read from its picture.
 */
export async function* pdfPages(file, { maxSide = 2000, wantImage = t => t.length < 40, maxPages = 40 } = {}) {
  const m = await pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  // glyphs are drawn as shapes, not loaded as web fonts, so the site's strict content policy never gets in the way
  const task = m.getDocument({ data, wasmUrl: base + 'wasm/', isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  try {
    const n = Math.min(doc.numPages, maxPages);
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      let text = '';
      try { text = await pageText(page); } catch {}
      let blob = null, w = 0, h = 0;
      if (wantImage(text)) {
        const v1 = page.getViewport({ scale: 1 });
        const scale = Math.min(4, maxSide / Math.max(v1.width, v1.height));
        const vp = page.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: g, viewport: vp }).promise;
        blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
        w = c.width; h = c.height;
        c.width = c.height = 0;
      }
      page.cleanup();
      yield { index: i, count: doc.numPages, text, blob, w, h };
    }
  } finally {
    try { await task.destroy(); } catch {}
  }
}
