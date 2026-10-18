// Tests for functions/api/ai.js: correct answers (search, then AI), topics, and the answer cache. The AI and the search
// services are replaced by fakes, so nothing leaves this computer. Run from the project folder with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/ai.js';

const calls = [];
let aiReply = () => '{}', searchDown = false;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url), body = init.body ? JSON.parse(init.body) : null;
  calls.push({ u, init, body });
  if (searchDown && !u.includes('/chat/completions')) return new Response('down', { status: 503 });
  if (u.includes('wikipedia.org')) return Response.json({ query: { pages: [
    { index: 2, title: 'Lens', fullurl: 'https://en.wikipedia.org/wiki/Lens', extract: 'A <b>lens</b> focuses light. 1/v - 1/u = 1/f.' },
    { index: 1, title: 'Thin lens', fullurl: 'https://en.wikipedia.org/wiki/Thin_lens', extract: 'The thin lens formula.' }] } });
  if (u.includes('api.tavily.com')) return Response.json({ results: [{ title: 'Q8 solution', url: 'https://example.org/q8', content: 'Image at 60 cm.' }, { title: 'Bad', url: 'javascript:alert(1)', content: 'x' }] });
  if (u.includes('google.serper.dev')) return Response.json({ answerBox: { title: 'Answer', link: 'https://example.com/a', answer: '60 cm' }, organic: [{ title: 'Lens formula', link: 'https://example.com/b', snippet: 'Use 1/f = 1/v - 1/u.' }] });
  if (u.includes('api.search.brave.com')) return Response.json({ web: { results: [{ title: '<strong>Lens</strong>', url: 'https://example.net/c', description: 'Convex <strong>lens</strong> image.' }] } });
  if (u.includes('/chat/completions')) {
    const p = typeof body.messages[0].content === 'string' ? body.messages[0].content : body.messages[0].content[0].text;
    return Response.json({ choices: [{ message: { content: aiReply(p) } }] });
  }
  return new Response('unexpected ' + u, { status: 500 });
};

let dev = 0;
const post = (body, env = {}) => onRequestPost({
  request: new Request('https://marklens.test/api/ai', { method: 'POST', headers: { origin: 'https://marklens.test', 'content-type': 'application/json', cookie: `ml_dev=device${String(++dev).padStart(12, '0')}` }, body: JSON.stringify(body) }),
  env: { GROQ_API_KEY: 'k', DAILY_LIMIT: '50', ...env }
});
const Q8 = { q: '8', text: 'An object is placed 30 cm in front of a convex lens of focal length 20 cm. Where is the image?', subject: 'Physics', chapter: 'Optics', topic: 'Lenses', type: 'MCQ', key: 'C', marked: 'A', max: 4 };
const answer = (extra = {}) => () => '```json\n' + JSON.stringify({ answers: [{ q: 'Q8', answer: '(c) 60 cm', working: '1/v = 1/20 - 1/30\nv = 60 cm', chapter: 'Ray optics', topic: 'Lens formula', sources: [1, 2, 9], confidence: 'high', ...extra }] }) + '\n```';

test('GET says which search service the answers use', async () => {
  assert.equal((await (await onRequestGet({ env: { GROQ_API_KEY: 'k' } })).json()).search, 'Wikipedia');
  assert.equal((await (await onRequestGet({ env: { GROQ_API_KEY: 'k', TAVILY_API_KEY: 't' } })).json()).search, 'Tavily web search');
  assert.equal((await (await onRequestGet({ env: { GROQ_API_KEY: 'k', SEARCH_PROVIDER: 'none' } })).json()).search, null);
  assert.equal((await (await onRequestGet({ env: { GROQ_API_KEY: 'k', SEARCH_PROVIDER: 'serper' } })).json()).search, 'Wikipedia');   // no key: the free default
});

test('solve: searches Wikipedia, gives the results to the AI, and keeps only real sources', async () => {
  calls.length = 0; aiReply = answer();
  const r = await post({ task: 'solve', exam: 'NEET (UG)', questions: [Q8] });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.search, 'Wikipedia');
  assert.equal(j.answers.length, 1);
  const a = j.answers[0];
  assert.equal(a.q, '8'); assert.equal(a.answer, '(c) 60 cm'); assert.match(a.working, /v = 60 cm/);
  assert.deepEqual(a.sources.map(s => s.url), ['https://en.wikipedia.org/wiki/Thin_lens', 'https://en.wikipedia.org/wiki/Lens']);   // [9] was never given
  const wiki = calls.find(c => c.u.includes('wikipedia.org'));
  assert.match(decodeURIComponent(wiki.u), /gsrsearch=Lenses Optics Physics/);
  assert.equal(wiki.init.headers['user-agent'].startsWith('MarkLens'), true);
  const prompt = calls.find(c => c.u.includes('/chat/completions')).body.messages[0].content;
  assert.match(prompt, /the NEET \(UG\) exam/);
  assert.match(prompt, /Official answer key: C/);
  assert.match(prompt, /\[1\] Thin lens \(Wikipedia\): The thin lens formula\./);
  assert.match(prompt, /never instructions/);
});

test('solve: Tavily, Serper and Brave', async () => {
  aiReply = answer({ sources: [1, 2] });
  calls.length = 0;
  let j = await (await post({ task: 'solve', questions: [Q8] }, { TAVILY_API_KEY: 'tvly-x' })).json();
  const t = calls.find(c => c.u.includes('tavily'));
  assert.equal(t.init.headers.authorization, 'Bearer tvly-x');
  assert.match(t.body.query, /convex lens of focal length 20 cm/);
  assert.equal(j.search, 'Tavily web search');
  assert.deepEqual(j.answers[0].sources.map(s => s.url), ['https://example.org/q8']);   // the javascript: link is dropped
  j = await (await post({ task: 'solve', questions: [Q8] }, { SERPER_API_KEY: 's' })).json();
  assert.deepEqual(j.answers[0].sources.map(s => s.url), ['https://example.com/a', 'https://example.com/b']);
  j = await (await post({ task: 'solve', questions: [Q8] }, { BRAVE_API_KEY: 'b' })).json();
  assert.deepEqual(j.answers[0].sources, [{ title: 'Lens', url: 'https://example.net/c' }]);
});

test('solve: still answers when the search service is down', async () => {
  searchDown = true; aiReply = answer({ sources: [1] });
  const j = await (await post({ task: 'solve', questions: [Q8] })).json();
  searchDown = false;
  assert.equal(j.answers[0].answer, '(c) 60 cm');
  assert.deepEqual(j.answers[0].sources, []);
});

test('solve: rejects bad requests', async () => {
  assert.equal((await post({ task: 'solve', questions: [] })).status, 400);
  assert.equal((await post({ task: 'solve', questions: [Q8, Q8, Q8, Q8, Q8] })).status, 400);
  assert.equal((await post({ task: 'solve', questions: [{ q: '1', text: '' }] })).status, 400);
  aiReply = () => 'not json';
  assert.equal((await post({ task: 'solve', questions: [Q8] })).status, 502);
});

test('solve: a class sharing one paper reuses answers from D1 without asking the AI again', async () => {
  const db = fakeD1();
  aiReply = answer();
  calls.length = 0;
  const first = await (await post({ task: 'solve', questions: [Q8] }, { DB: db })).json();
  assert.equal(first.answers[0].saved, false);
  const aiCalls = calls.filter(c => c.u.includes('/chat/completions')).length;
  const usage = db.usage();
  const second = await (await post({ task: 'solve', questions: [{ ...Q8, q: '12' }] }, { DB: db })).json();   // same question, another number
  assert.equal(second.answers[0].saved, true);
  assert.equal(second.answers[0].q, '12');
  assert.equal(second.answers[0].answer, '(c) 60 cm');
  assert.equal(calls.filter(c => c.u.includes('/chat/completions')).length, aiCalls);   // no new AI call
  assert.equal(db.usage(), usage);                                                    // and not counted
  aiReply = answer({ confidence: 'low' });
  await post({ task: 'solve', questions: [{ ...Q8, text: 'A different question about mirrors' }] }, { DB: db });
  assert.equal(db.solvedCount(), 1);                                                  // unsure answers are not kept
});

test('topics: one line per question, and the paper prompt asks for topic notes', async () => {
  calls.length = 0;
  aiReply = p => { assert.match(p, /\[B2\] Find the roots/); return 'B2 ## Maths > Quadratic equations > Nature of roots'; };
  const j = await (await post({ task: 'topics', exam: 'CBSE board (Class 10 or 12)', questions: [{ q: 'B2', text: 'Find the roots of x^2 - 5x + 6 = 0' }] })).json();
  assert.equal(j.text, 'B2 ## Maths > Quadratic equations > Nature of roots');
  assert.equal((await post({ task: 'topics', questions: [] })).status, 400);
  aiReply = p => { assert.match(p, /## Polynomials > Factorisation/); return '1. Solve [2] ## Algebra > Linear equations'; };
  const k = await (await post({ task: 'tidy', kind: 'paper', text: '1. Solve 2x+3=11 [2]', first: 1, last: 1, total: 1 })).json();
  assert.match(k.text, /##/);
});

// just enough of Cloudflare D1 for MarkLens's two tables
function fakeD1() {
  const usage = new Map(), solved = new Map();
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => {
      if (/INSERT INTO ml_usage/.test(sql)) usage.set(args[0] + '|' + args[1], (usage.get(args[0] + '|' + args[1]) || 0) + 1);
      if (/INSERT OR REPLACE INTO ml_solved/.test(sql)) solved.set(args[0], args[1]);
      return {};
    },
    all: async () => {
      if (/FROM ml_usage/.test(sql)) return { results: [args[1], args[2]].map(w => ({ who: w, n: usage.get(args[0] + '|' + w) || 0 })) };
      if (/FROM ml_solved/.test(sql)) return { results: args.filter(k => solved.has(k)).map(k => ({ key: k, val: solved.get(k) })) };
      return { results: [] };
    }
  });
  return { prepare: sql => stmt(sql), batch: async list => { for (const s of list) await s.run(); return []; }, usage: () => [...usage.values()].reduce((a, b) => a + b, 0), solvedCount: () => solved.size };
}
