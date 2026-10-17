// The site's /api/ai function, run in Node with the AI companies replaced by stubs.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/ai.js';

let calls = [], replies = [];
beforeEach(() => { calls = []; replies = []; });
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  const r = replies.shift() || { status: 200, body: { choices: [{ message: { content: 'ok' } }] } };
  return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
};
const IMG = 'data:image/jpeg;base64,' + Buffer.from('fake jpeg bytes').toString('base64');
const post = (body, env, headers = {}) => onRequestPost({
  env,
  request: new Request('https://marklens.pages.dev/api/ai', { method: 'POST', headers: { origin: 'https://marklens.pages.dev', 'content-type': 'application/json', 'cf-connecting-ip': '10.0.0.' + Math.floor(Math.random() * 250), ...headers }, body: JSON.stringify(body) })
});

test('GET says which readers are switched on', async () => {
  let j = await (await onRequestGet({ env: {} })).json();
  assert.equal(j.enabled, false); assert.equal(j.vision, false);
  j = await (await onRequestGet({ env: { GOOGLE_VISION_API_KEY: 'k', GROQ_API_KEY: 'g' } })).json();
  assert.equal(j.enabled, true); assert.equal(j.vision, true);
});

test('vision: one photo goes to Google with the key in a header, and the answer comes straight back', async () => {
  replies.push({ status: 200, body: { responses: [{ fullTextAnnotation: { pages: [{ width: 10, height: 10, blocks: [] }] } }] } });
  const r = await post({ task: 'vision', kind: 'sheet', images: [IMG] }, { GOOGLE_VISION_API_KEY: 'secret-key' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { responses: [{ fullTextAnnotation: { pages: [{ width: 10, height: 10, blocks: [] }] } }] });
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.match(c.url, /^https:\/\/vision\.googleapis\.com\/v1\/images:annotate\?fields=/);
  assert.ok(!c.url.includes('secret-key'), 'key never in the URL');
  assert.equal(c.init.headers['x-goog-api-key'], 'secret-key');
  const sent = JSON.parse(c.init.body);
  assert.equal(sent.requests[0].features[0].type, 'DOCUMENT_TEXT_DETECTION');
  assert.deepEqual(sent.requests[0].imageContext.languageHints, ['en-t-i0-handwrit']);
  assert.equal(sent.requests[0].image.content, IMG.split(',')[1]);
});

test('vision: a printed paper has no handwriting hint; a refused field list is retried without it', async () => {
  replies.push({ status: 400, body: { error: { message: 'bad field mask' } } }, { status: 200, body: { responses: [{}] } });
  const r = await post({ task: 'vision', kind: 'paper', images: [IMG] }, { GOOGLE_VISION_API_KEY: 'k' });
  assert.equal(r.status, 200);
  assert.equal(calls.length, 2);
  assert.ok(!calls[1].url.includes('fields='));
  assert.equal(JSON.parse(calls[0].init.body).requests[0].imageContext, undefined);
});

test('vision: wrong key or billing off is reported as vision_key; bad input never reaches Google', async () => {
  replies.push({ status: 403, body: { error: {} } });
  let r = await post({ task: 'vision', images: [IMG] }, { GOOGLE_VISION_API_KEY: 'k' });
  assert.equal((await r.json()).error, 'vision_key');
  r = await post({ task: 'vision', images: ['data:image/jpeg;base64,abc"}],"x":"'] }, { GOOGLE_VISION_API_KEY: 'k' });
  assert.equal(r.status, 400);
  r = await post({ task: 'vision', images: [IMG, IMG] }, { GOOGLE_VISION_API_KEY: 'k' });
  assert.equal(r.status, 400);
  r = await post({ task: 'vision', images: [IMG] }, { GROQ_API_KEY: 'g' });
  assert.equal(r.status, 503);
  assert.equal(calls.length, 1);
});

test('marks: the red-tagged text goes to the AI with the instructions written here', async () => {
  replies.push({ status: 200, body: { choices: [{ message: { content: '1: 2/2 [m2]\nTotal: 2 [m1]' } }] } });
  const r = await post({ task: 'marks', text: 'PAGE 1\nQ1) x=4 ⟦m2 margin: 2⟧', paper: '1. Solve [2]', total: 1 }, { GROQ_API_KEY: 'g' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).text, '1: 2/2 [m2]\nTotal: 2 [m1]');
  const sent = JSON.parse(calls[0].init.body);
  assert.match(calls[0].url, /api\.groq\.com/);
  const prompt = sent.messages[0].content[0].text;
  assert.match(prompt, /RED INK is wrapped like ⟦m7: 3⟧/);
  assert.match(prompt, /Q1\) x=4 ⟦m2 margin: 2⟧/);
  assert.match(prompt, /1\. Solve \[2\]/);
  assert.equal(sent.messages[0].content.length, 1, 'text only, no photo');
});

test('sheet prompt tells the AI the red writing is the teacher\'s', async () => {
  await post({ task: 'sheet', images: [IMG], first: 1, last: 1, total: 2, paper: '1. Solve [2]' }, { GROQ_API_KEY: 'g' });
  const prompt = JSON.parse(calls[0].init.body).messages[0].content[0].text;
  assert.match(prompt, /EVERYTHING THE TEACHER WROTE IN RED INK IS SHOWN IN BRIGHT RED/);
  assert.match(prompt, /Total: <total awarded>/);
});

test('only this site may call it', async () => {
  const r = await post({ task: 'vision', images: [IMG] }, { GOOGLE_VISION_API_KEY: 'k' }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  assert.equal(calls.length, 0);
});

test('a same-site request without Origin is accepted by Sec-Fetch-Site, a cross-site one is not', async () => {
  replies.push({ status: 200, body: { responses: [{}] } });
  const mk = h => onRequestPost({ env: { GOOGLE_VISION_API_KEY: 'k' }, request: new Request('https://marklens.pages.dev/api/ai', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.1.1.' + Math.floor(Math.random() * 250), ...h }, body: JSON.stringify({ task: 'vision', images: [IMG] }) }) });
  assert.equal((await mk({ 'sec-fetch-site': 'same-origin' })).status, 200);
  assert.equal((await mk({ 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await mk({})).status, 403);
});
