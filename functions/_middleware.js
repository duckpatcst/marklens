/**
 * MarkLens access gate (Cloudflare Pages middleware). Runs before every page, file and /api call.
 *
 * Nobody can open MarkLens without the access code. The code is stored only as a Cloudflare secret:
 *   Pages project > Settings > Variables and Secrets > Add > Secret, name ACCESS_CODE, Production.
 * If ACCESS_CODE is not set (for example on preview addresses), the whole site stays locked.
 * Changing the code signs everyone out; share the new code only with people you choose.
 * People who know the code stay signed in for 30 days on that browser. /__logout signs out.
 *
 * Each browser also gets a random device id (cookie ml_dev). /api/ai counts AI use per device, and wrong
 * access codes are counted per device too, so a whole school sharing one Wi-Fi address is not treated as
 * one visitor. A per-address backstop (LOGIN_IP_LIMIT wrong tries per 15 minutes, default 50) still slows
 * guessing, so use a long access code (12 or more characters).
 */

const COOKIE = 'ml_access';
const MAX_AGE = 60 * 60 * 24 * 30;          // 30 days
const TRIES = { device: 8, ip: 50, windowMs: 15 * 60_000 };
const tries = new Map();                     // failed attempts per device and per address, best effort
const DEV = 'ml_dev', DEV_RE = /^[A-Za-z0-9_-]{16,64}$/, DEV_AGE = 400 * 24 * 3600;

export async function onRequest(ctx) {
  const { request, env, next } = ctx;
  const url = new URL(request.url);
  const code = String(env.ACCESS_CODE || '');

  // a random id for this browser, kept for 400 days; set on whatever response goes back
  let dev = readCookie(request, DEV);
  const freshDev = !DEV_RE.test(dev);
  if (freshDev) dev = crypto.randomUUID().replace(/-/g, '');
  const done = (res, status) => { const r = withPrivacy(res, status); if (freshDev) r.headers.append('set-cookie', `${DEV}=${dev}; Path=/; Max-Age=${DEV_AGE}; HttpOnly; Secure; SameSite=Lax`); return r; };

  if (!code) return withPrivacy(page('MarkLens is locked', '<p>This site is closed. The owner has not set an access code here.</p>', ''), 503);

  const token = await sign(code);

  if (url.pathname === '/__logout') {
    return done(new Response(null, { status: 303, headers: { location: '/', 'set-cookie': cookie('', 0) } }));
  }

  if (url.pathname === '/__login' && request.method === 'POST') {
    const origin = request.headers.get('origin');
    let sameHost = !origin;
    try { sameHost = sameHost || new URL(origin).host === url.host; } catch {}
    if (!sameHost) return done(new Response('Forbidden', { status: 403 }));
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    // A browser always has its device id from the login page. A try without one (a script) is counted
    // strictly per address, as before; real devices are counted on their own, with a looser address backstop.
    const keys = [freshDev ? ['login:ip8:' + ip, TRIES.device] : ['login:d:' + dev, TRIES.device], ['login:ip:' + ip, Number(env.LOGIN_IP_LIMIT) > 0 ? Number(env.LOGIN_IP_LIMIT) : TRIES.ip]];
    if (await tooMany(env, keys)) return done(loginPage('Too many wrong tries. Wait 15 minutes and try again.', '/'), 429);
    const form = await request.formData().catch(() => null);
    const given = String(form?.get('code') || '');
    const dest = safePath(String(form?.get('next') || '/'));
    if (given && (await sign(given)) === token) {
      await clearTries(env, keys.slice(0, 1));               // this device only; the address backstop keeps counting
      return done(new Response(null, { status: 303, headers: { location: dest, 'set-cookie': cookie(token, MAX_AGE) } }));
    }
    await addTry(env, keys);
    return done(loginPage('That access code is not right. Check it and try again.', dest), 401);
  }

  if (readCookie(request, COOKIE) === token) {
    const res = await next();
    return done(res);
  }

  if (url.pathname.startsWith('/api/')) {
    return done(new Response(JSON.stringify({ error: 'locked' }), { status: 401, headers: { 'content-type': 'application/json' } }));
  }
  return done(loginPage('', safePath(url.pathname + url.search)), 401);
}

/* ---------- helpers ---------- */

async function sign(value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(value), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('marklens-access-v1'));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function cookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
}

function safePath(p) {
  return /^\/(?!\/)[^\s\\]*$/.test(p) && !p.startsWith('/__') ? p : '/';
}

function withPrivacy(res, status) {
  const r = new Response(res.body, { status: status || res.status, headers: res.headers });
  r.headers.set('x-robots-tag', 'noindex, nofollow');
  r.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  if (!r.headers.has('cache-control') || r.status !== 200) r.headers.set('cache-control', 'private, no-store');
  else r.headers.set('cache-control', 'private, ' + r.headers.get('cache-control').replace(/\bpublic,?\s*/i, ''));
  return r;
}

// Wrong-code counters. Storage errors (for example the free KV plan's daily write limit) never block a login.
async function tooMany(env, keys) {
  const now = Date.now();
  for (const [k, limit] of keys) {
    const mem = (tries.get(k) || []).filter(t => now - t < TRIES.windowMs);
    tries.set(k, mem);
    if (mem.length >= limit) return true;
    if (env.RATE_LIMIT) { try { if ((Number(await env.RATE_LIMIT.get(k)) || 0) >= limit) return true; } catch {} }
  }
  return false;
}
async function addTry(env, keys) {
  for (const [k] of keys) {
    tries.set(k, [...(tries.get(k) || []), Date.now()]);
    if (env.RATE_LIMIT) {
      try { const n = (Number(await env.RATE_LIMIT.get(k)) || 0) + 1; await env.RATE_LIMIT.put(k, String(n), { expirationTtl: 900 }); } catch {}
    }
  }
  if (tries.size > 5000) tries.clear();
}
async function clearTries(env, keys) {
  for (const [k] of keys) { tries.delete(k); if (env.RATE_LIMIT) { try { await env.RATE_LIMIT.delete(k); } catch {} } }
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function loginPage(error, next) {
  return page('MarkLens', `
    <p class="lead">This site is private. Enter the access code you were given.</p>
    <form method="post" action="/__login">
      <input type="hidden" name="next" value="${esc(next)}">
      <label for="code">Access code</label>
      <input id="code" name="code" type="password" autocomplete="current-password" required autofocus>
      ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
      <button type="submit">Open MarkLens</button>
    </form>
    <p class="small">Don't have a code? Ask the person who runs this site.</p>`, '');
}

function page(title, body) {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>
:root{--bg:#f1f4f7;--surface:#fff;--ink:#13202e;--mute:#5a6879;--line:#dce2e9;--pen:#d92d3a;--blue:#1f4fd8;
  --f:'IBM Plex Sans','Segoe UI',system-ui,sans-serif;--d:'Bricolage Grotesque','Segoe UI',system-ui,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#0c131c;--surface:#131c28;--ink:#e6ecf3;--mute:#92a0b2;--line:#233044;--pen:#ff6a74;--blue:#7ba3ff;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.55 var(--f);padding:24px 16px}
main{width:100%;max-width:380px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:24px}
.logo{display:flex;align-items:center;gap:9px;font:800 1.25rem var(--d);margin-bottom:14px}
.logo i{width:22px;height:22px;border:2.5px solid var(--pen);border-radius:50%;position:relative;display:inline-block}
.logo i::after{content:"";position:absolute;left:11px;top:16px;width:9px;height:2.5px;background:var(--pen);transform:rotate(45deg);transform-origin:left}
.lead{color:var(--mute);margin:0 0 16px}
label{display:block;font-weight:600;font-size:.9rem;margin-bottom:6px}
input[type=password]{width:100%;font:inherit;font-size:16px;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:11px}
input:focus-visible,button:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
button{margin-top:14px;width:100%;min-height:44px;font:inherit;font-weight:600;color:var(--bg);background:var(--ink);border:0;border-radius:8px;cursor:pointer}
.err{color:var(--pen);font-size:.9rem;margin:10px 0 0}
.small{color:var(--mute);font-size:.82rem;margin:16px 0 0}
</style></head>
<body><main><div class="logo"><i></i>MarkLens</div>${body}</main></body></html>`, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" }
  });
}
