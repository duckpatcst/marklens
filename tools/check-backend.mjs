#!/usr/bin/env node
/* MarkLens · backend contract check.
   Points at a running MarkLens back end and checks it answers the way docs/API.md says,
   so the front end will work with it without changes.

     node tools/check-backend.mjs http://localhost:8788 --code YOUR_ACCESS_CODE
     node tools/check-backend.mjs https://marklens.pages.dev --code YOUR_ACCESS_CODE --live

   --live also sends one tiny real AI job (task "tidy"), which uses one request of the free AI allowance.
   Exit code 0 = everything the front end relies on is there. */

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const base = String(args.find(a => /^https?:\/\//.test(a)) || process.env.MARKLENS_URL || 'http://localhost:8788').replace(/\/+$/, '');
const code = flag('--code') || process.env.ACCESS_CODE || '';
const live = args.includes('--live');

// Every error code the front end has a message for (index.html, ERR table / docs/API.md)
const KNOWN = ['locked', 'forbidden', 'bad_request', 'no_vision', 'too_large', 'busy', 'limit', 'site_limit',
  'image_rejected', 'invalid_json', 'ai_setup', 'upstream', 'not_configured'];

let failed = 0, warned = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.log('  ✗ ' + m); };
const warn = (m) => { warned++; console.log('  ! ' + m); };
const json = async (r) => { try { return await r.json(); } catch { return null; } };
const errShape = (j, status) => {
  if (!j || typeof j.error !== 'string') return bad(`error reply (${status}) is not {"error":"<code>"}`);
  if (!KNOWN.includes(j.error)) return bad(`unknown error code "${j.error}": add a message for it in index.html (ERR) and docs/API.md`);
  ok(`error reply uses a known code: ${j.error} (${status})`);
};

console.log(`\nMarkLens back end check: ${base}\n`);
let cookie = '';

// 1. The access gate
console.log('Access gate');
try {
  const r = await fetch(base + '/api/ai', { redirect: 'manual' });
  if (r.status === 401) { const j = await json(r); j && j.error === 'locked' ? ok('locked without a cookie: 401 {"error":"locked"}') : bad('401 but body is not {"error":"locked"}'); }
  else if (r.status === 503) warn('the site says it is closed (no ACCESS_CODE set on the back end)');
  else warn(`API answered ${r.status} without logging in (gate off?)`);
} catch (e) { console.log(`  ✗ cannot reach ${base}: ${e.cause?.code || e.message}\n    Is the back end running? (npx wrangler pages dev . --port 8788)`); process.exit(1); }

if (code) {
  const r = await fetch(base + '/__login', { method: 'POST', redirect: 'manual',
    headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, next: '/' }) });
  const set = r.headers.get('set-cookie') || '';
  const m = set.match(/ml_access=[^;]+/);
  if (r.status === 303 && m) { cookie = m[0]; ok('POST /__login with the code: 303 and an ml_access cookie'); }
  else bad(`POST /__login gave ${r.status}${m ? '' : ' with no ml_access cookie'} (wrong code?)`);
} else warn('no --code given, so the checks below run without logging in');

const H = (extra = {}) => ({ ...(cookie ? { cookie } : {}), ...extra });

// 2. GET /api/ai
console.log('\nGET /api/ai');
let cfg = null;
{
  const r = await fetch(base + '/api/ai', { headers: H() });
  cfg = await json(r);
  if (r.status !== 200 || !cfg) bad(`expected 200 JSON, got ${r.status}`);
  else {
    ok('200 JSON');
    const types = { enabled: 'boolean', vision: 'boolean', maxImages: 'number', providers: 'object', solveMax: 'number', topicsMax: 'number' };
    for (const [k, t] of Object.entries(types)) typeof cfg[k] === t ? ok(`${k}: ${JSON.stringify(cfg[k])}`) : bad(`${k} should be a ${t}, got ${JSON.stringify(cfg[k])}`);
    if (!cfg.enabled) warn('enabled is false: the site works, but AI reading and grading stay hidden (set GROQ_API_KEY or another provider)');
  }
}

// 3. POST /api/ai
console.log('\nPOST /api/ai');
{
  const r = await fetch(base + '/api/ai', { method: 'POST', headers: H({ origin: 'https://not-marklens.example', 'content-type': 'application/json' }), body: '{"task":"tidy"}' });
  const j = await json(r);
  if (cfg && !cfg.enabled) r.status === 503 ? ok('no AI set up: 503 not_configured') : bad(`expected 503 when AI is off, got ${r.status}`);
  else r.status === 403 ? ok('another site is refused: 403 forbidden') : bad(`a request from another site should get 403, got ${r.status}`);
  errShape(j, r.status);
}
if (cfg && cfg.enabled) {
  const r = await fetch(base + '/api/ai', { method: 'POST', headers: H({ origin: base, 'content-type': 'application/json' }), body: '{"task":"no-such-task"}' });
  r.status === 400 ? ok('unknown task: 400') : bad(`unknown task should get 400, got ${r.status}`);
  errShape(await json(r), r.status);
}
if (live && cfg && cfg.enabled) {
  console.log('\nOne real AI job (--live)');
  const r = await fetch(base + '/api/ai', { method: 'POST', headers: H({ origin: base, 'content-type': 'application/json' }),
    body: JSON.stringify({ task: 'tidy', kind: 'paper', text: '1. What is 2 + 2? (1 mark)\n2. Name the capital of France. (1 mark)', first: 1, last: 1, total: 1, paper: '' }) });
  const j = await json(r);
  if (r.status === 200 && j && typeof j.text === 'string' && j.text.trim()) { ok(`tidy answered (via ${j.via || '?'})`); console.log('    ' + j.text.trim().split('\n').slice(0, 3).join('\n    ')); }
  else if (r.status === 429) { warn('the AI said busy or limit; try again in a minute'); errShape(j, r.status); }
  else { bad(`tidy should reply {text, via}, got ${r.status}`); if (j && j.error) errShape(j, r.status); }
  if (j && j.text !== undefined && typeof j.via !== 'string') bad('reply is missing "via"');
}

console.log(`\n${failed ? '✗ ' + failed + ' problem(s)' : '✓ The front end will work with this back end'}${warned ? ', ' + warned + ' note(s)' : ''}\n`);
process.exit(failed ? 1 : 0);
