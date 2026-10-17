/* Runs the red-pen reader (redpen.js) off the main thread, so the page stays smooth while a photo
   is examined. Messages in: { id, w, h, buffer (RGBA), want: { marks, highlight, boxes } }.
   Messages out: { id, marks, redShare, inks?, highlight? } or { id, error }. */
import * as RP from './redpen.js';

let model = null;
const getModel = () => model || (model = fetch(new URL('../models/digits-v1.json', import.meta.url)).then(r => {
  if (!r.ok) throw new Error('model ' + r.status);
  return r.json();
}).then(RP.loadModel).catch(e => { model = null; throw e; }));

const slim = m => ({
  kind: m.kind, got: m.got, max: m.max ?? null, text: m.text || '', conf: m.conf, circled: !!m.circled,
  margin: m.margin || '', top: !!m.top, x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1, w: m.w, h: m.h
});

self.onmessage = async e => {
  const { id, w, h, buffer, want = {} } = e.data || {};
  try {
    const img = { width: w, height: h, data: new Uint8ClampedArray(buffer) };
    const res = RP.readPage(img, await getModel(), { keep: true });
    const an = res.analysis, out = { id, marks: res.marks.map(slim), redShare: res.redShare }, transfer = [];
    if (Array.isArray(want.boxes)) out.inks = want.boxes.map(b => RP.inkInBox(an, b[0], b[1], b[2], b[3]).share);
    if (want.highlight) { const hl = RP.highlightRed(img, an); out.highlight = { w, h, buffer: hl.data.buffer }; transfer.push(hl.data.buffer); }
    self.postMessage(out, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
