/* Runs the red-ink marks reader (redmarks.js) off the main thread, so the page stays smooth while a photo is examined.
   In:  { id, w, h, buffer (RGBA pixels) }
   Out: { id, page: {width, height, lineGap, margin, labels, marks} } or { id, error } */
importScripts('redmarks.js');

let model = null;
const getModel = () => model || (model = fetch('../models/marks-v2.json').then(r => {
  if (!r.ok) throw new Error('model ' + r.status);
  return r.json();
}).then(self.RedMarks.loadModel).catch(e => { model = null; throw e; }));

self.onmessage = async e => {
  const { id, w, h, buffer } = e.data || {};
  try {
    const pg = self.RedMarks.readPage(self.RedMarks.shrink({ width: w, height: h, data: new Uint8ClampedArray(buffer) }), await getModel());
    self.postMessage({ id, page: { width: pg.width, height: pg.height, lineGap: pg.lineGap, margin: pg.margin, labels: pg.labels, marks: pg.marks } });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
