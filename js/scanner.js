/* MarkLens page scanner: the camera inside the page, so a student photographs page after page
   without leaving MarkLens or tapping through the camera app each time. Each photo is handed over
   the moment it is taken, so reading starts while the next page is lined up.
   The overlay markup lives in index.html (#scanner); this file only drives it. */

export const cameraAvailable = () => !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

let open = null;

export async function openScanner({ title = 'Scan pages', onPhoto, onClose }) {
  if (open) return;
  const $ = s => document.querySelector(s);
  const root = $('#scanner'), video = $('#scanVideo'), shutter = $('#scanShutter'), done = $('#scanDone'), close = $('#scanClose');
  const torch = $('#scanTorch'), countEl = $('#scanCount'), last = $('#scanLast'), hint = $('#scanHint'), head = $('#scanTitle');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 } } });
  } catch (e) {
    const err = new Error(e && e.name === 'NotAllowedError' ? 'denied' : 'unavailable'); err.cause = e; throw err;
  }
  const track = stream.getVideoTracks()[0];
  let count = 0, lastUrl = null, torchOn = false, busy = false;
  head.textContent = title;
  countEl.textContent = 'No pages yet';
  last.hidden = true; hint.textContent = 'Hold the phone over one page so it fills the frame, then tap the round button. Do the next page the same way.';
  root.hidden = false; document.documentElement.classList.add('scanning');
  video.srcObject = stream;
  try { await video.play(); } catch {}
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  torch.hidden = !caps.torch;
  torch.setAttribute('aria-pressed', 'false');
  torch.onclick = async () => {
    torchOn = !torchOn;
    try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); torch.setAttribute('aria-pressed', String(torchOn)); } catch { torchOn = !torchOn; }
  };

  const grab = () => new Promise(res => {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return res(null);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(video, 0, 0, w, h);
    c.toBlob(b => { c.width = c.height = 0; res(b); }, 'image/jpeg', 0.92);
  });
  const take = async () => {
    if (busy) return;
    busy = true; root.classList.add('flash');
    setTimeout(() => root.classList.remove('flash'), 180);
    try { if (navigator.vibrate) navigator.vibrate(25); } catch {}
    const blob = await grab();
    busy = false;
    if (!blob) return;
    count++;
    countEl.textContent = count === 1 ? '1 page' : `${count} pages`;
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(blob); last.src = lastUrl; last.hidden = false;
    hint.textContent = 'Got it. Turn to the next page and tap again, or tap Done.';
    onPhoto && onPhoto(blob);
  };
  const finish = () => {
    stream.getTracks().forEach(t => t.stop());
    video.srcObject = null; root.hidden = true; document.documentElement.classList.remove('scanning');
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    document.removeEventListener('keydown', onKey);
    open = null;
    onClose && onClose(count);
  };
  const onKey = e => { if (e.key === 'Escape') finish(); else if (e.key === ' ' || e.key === 'Enter') { if (document.activeElement === shutter || document.activeElement === document.body) { e.preventDefault(); take(); } } };
  shutter.onclick = take;
  done.onclick = finish;
  close.onclick = finish;
  document.addEventListener('keydown', onKey);
  open = { finish };
  shutter.focus();
}
