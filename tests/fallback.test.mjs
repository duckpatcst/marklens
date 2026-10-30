// Tests for the automatic fallback chain in functions/api/ai.js: when one AI is busy, out of free usage or down,
// the next one takes over. The AI services are replaced by fakes, so nothing leaves this computer.
// Run from the project folder with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';

let state = {}, calls = [], sent = {};
const who = u => u.includes('groq.com') ? 'groq' : u.includes('openrouter.ai') ? 'openrouter' : u.includes('googleapis') ? 'gemini' : u.includes('omni.example') ? 'omni' : 'other';
globalThis.fetch = async (url, init = {}) => {
  const w = who(String(url));
  calls.push(w); sent[w] = { url: String(url), headers: init.headers, body: init.body ? JSON.parse(init.body) : null };
  const st = state[w] ?? 200;
  if (st === 'down') throw new TypeError('fetch failed');
  if (st === 'empty') return Response.json({ choices: [{ message: { content: '' } }] });
  if (st !== 200) return new Response('{}', { status: st, headers: { 'retry-after': String(state.retryAfter || 20) } });
  return w === 'gemini' ? Response.json({ candidates: [{ content: { parts: [{ text: 'from gemini' }] } }] })
    : Response.json({ choices: [{ message: { content: `from ${w}` } }] });
};
const AI = { run: async () => { calls.push('workers'); if (state.workers === 429) throw new Error('daily neuron limit'); return { response: 'from workers' }; } };
const ENV = { GROQ_API_KEY: 'g', OPENROUTER_API_KEY: 'o', AI };

// a fresh copy of the function for each test, so services rested by one test do not carry over
let n = 0;
const load = () => import(`../functions/api/ai.js?fallback=${n++}`);
const photo = 'data:image/jpeg;base64,AAAA';
async function post(m, env = ENV, body = { task: 'paper', images: [photo] }) {
  calls = [];
  const r = await m.onRequestPost({ request: new Request('https://marklens.test/api/ai', { method: 'POST', headers: { origin: 'https://marklens.test', 'content-type': 'application/json', cookie: `ml_dev=device${String(n * 100 + calls.length).padStart(12, '0')}${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify(body) }), env });
  return { status: r.status, ...(await r.json()), tried: [...calls] };
}
const get = async (m, env = ENV) => (await m.onRequestGet({ env })).json();

test('GET lists the chain in order: main AI, then Groq, OpenRouter, Omni Router, Workers AI', async () => {
  const m = await load();
  let g = await get(m);
  assert.deepEqual(g.providers, ['Groq', 'OpenRouter', 'Cloudflare Workers AI']);
  assert.equal(g.providerName, 'Groq');
  assert.equal(g.backup, 'OpenRouter and Cloudflare Workers AI');
  assert.equal(g.maxImages, 1);
  g = await get(m, { ...ENV, OMNI_API_KEY: 'k', OMNI_BASE_URL: 'https://omni.example/v1' });
  assert.deepEqual(g.providers, ['Groq', 'OpenRouter', 'Omni Router', 'Cloudflare Workers AI']);
  g = await get(m, { ...ENV, GEMINI_API_KEY: 'x' });
  assert.ok(!g.providers.includes('Google Gemini'), 'Gemini is never added unless named in AI_CHAIN');
  g = await get(m, { ...ENV, OMNI_API_KEY: 'k', OMNI_BASE_URL: 'http://localhost:20128/v1' });
  assert.ok(!g.providers.includes('Omni Router'), 'Omni Router needs an https address');
  assert.equal((await get(m, {})).enabled, false);
});

test('when Groq runs out, OpenRouter answers, and Groq is skipped until it is back', async () => {
  const m = await load();
  state = {};
  let r = await post(m);
  assert.equal(r.text, 'from groq'); assert.deepEqual(r.tried, ['groq']);
  state = { groq: 429, retryAfter: 600 };
  r = await post(m);
  assert.equal(r.status, 200); assert.equal(r.text, 'from openrouter'); assert.equal(r.via, 'OpenRouter');
  assert.deepEqual(r.tried, ['groq', 'openrouter']);
  r = await post(m);
  assert.deepEqual(r.tried, ['openrouter'], 'Groq is resting, so it is not asked again');
});

test('Groq and OpenRouter out: Cloudflare Workers AI answers; all out: "busy" with a wait', async () => {
  const m = await load();
  state = { groq: 429, openrouter: 429 };
  let r = await post(m);
  assert.equal(r.text, 'from workers'); assert.deepEqual(r.tried, ['groq', 'openrouter', 'workers']);
  state = { groq: 429, openrouter: 429, workers: 429 };
  r = await post(m);
  assert.equal(r.status, 429); assert.equal(r.error, 'busy'); assert.ok(r.retry_after >= 1 && r.retry_after <= 60);
  r = await post(m);
  assert.equal(r.status, 429); assert.deepEqual(r.tried, [], 'every AI is resting, so none is asked');
});

test('down, too slow or an empty answer also moves on; a rejected photo does not rest the AI', async () => {
  let m = await load();
  state = { groq: 'down' };
  assert.equal((await post(m)).text, 'from openrouter');
  m = await load(); state = { groq: 'empty' };
  assert.equal((await post(m)).text, 'from openrouter');
  m = await load(); state = { groq: 401 };
  assert.equal((await post(m)).text, 'from openrouter');
  m = await load(); state = { groq: 400 };
  let r = await post(m);
  assert.equal(r.text, 'from openrouter');
  state = {};
  r = await post(m);
  assert.deepEqual(r.tried, ['groq'], 'a 400 is about the photo, so Groq is asked again next time');
  m = await load(); state = { groq: 400, openrouter: 400, workers: 200 };
  assert.equal((await post(m, { GROQ_API_KEY: 'g', OPENROUTER_API_KEY: 'o' })).error, 'image_rejected');
});

test('text-only jobs use the chain too (grading, sorting Google Lens text)', async () => {
  const m = await load();
  state = { groq: 429 };
  const r = await post(m, ENV, { task: 'tidy', kind: 'paper', text: '1. What is 2+2? [1]' });
  assert.equal(r.status, 200); assert.equal(r.text, 'from openrouter');
});

test('AI_CHAIN sets the order and leaves out what is not named; Gemini only when named', async () => {
  let m = await load(); state = {};
  let r = await post(m, { ...ENV, AI_CHAIN: 'openrouter, groq' });
  assert.deepEqual(r.tried, ['openrouter']);
  assert.deepEqual((await get(m, { ...ENV, AI_CHAIN: 'openrouter,groq' })).providers, ['OpenRouter', 'Groq']);
  m = await load(); state = { groq: 429 };
  r = await post(m, { ...ENV, GEMINI_API_KEY: 'x', AI_CHAIN: 'groq,gemini' });
  assert.equal(r.text, 'from gemini'); assert.deepEqual(r.tried, ['groq', 'gemini']);
});

test('what each fallback is sent: OpenRouter free model with max_tokens; Omni Router at its address', async () => {
  let m = await load(); state = { groq: 429 };
  await post(m);
  assert.equal(sent.openrouter.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(sent.openrouter.headers.authorization, 'Bearer o');
  assert.equal(sent.openrouter.body.model, 'nvidia/nemotron-3.5-super-vl:free');
  assert.equal(sent.openrouter.body.max_tokens, 2400);
  assert.equal(sent.openrouter.body.max_completion_tokens, undefined);
  m = await load(); state = { groq: 429, openrouter: 429 };
  const r = await post(m, { ...ENV, OMNI_API_KEY: 'sk-test', OMNI_BASE_URL: 'https://omni.example/', OMNI_MODEL: 'vision-model' });
  assert.equal(r.text, 'from omni');
  assert.equal(sent.omni.url, 'https://omni.example/v1/chat/completions');
  assert.equal(sent.omni.body.model, 'vision-model');
});

test('a school using its own AI keeps its settings as the main AI', async () => {
  const m = await load(); state = {};
  const env = { AI_PROVIDER: 'openai', AI_BASE_URL: 'https://openrouter.ai/api/v1', AI_API_KEY: 'school', AI_MODEL: 'some/model', AI_NAME: 'our AI', AI_MAX_TOKENS_FIELD: 'max_tokens', AI };
  const g = await get(m, env);
  assert.deepEqual(g.providers, ['our AI', 'Cloudflare Workers AI']);
  const r = await post(m, env);
  assert.equal(r.via, 'our AI');
  assert.equal(sent.openrouter.body.model, 'some/model');
  assert.equal(sent.openrouter.headers.authorization, 'Bearer school');
});
