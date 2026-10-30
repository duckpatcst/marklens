// Unit tests for js/api.js, the front end's only door to the back end. Run with: node --test
// fetch is faked, so nothing is sent anywhere. If the back end's contract changes (docs/API.md), update these.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const API = createRequire(import.meta.url)('../js/api.js');

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const fake = replies => { const sent = []; globalThis.fetch = async (url, init = {}) => { sent.push({ url, init }); const r = replies.shift(); if (r instanceof Error) throw r; return r; }; return sent; };
const noWait = { sleep: async () => {} };

test('config: GET /api/ai, null when the AI is off or the back end is missing', async () => {
  let sent = fake([reply(200, { enabled: true, providerName: 'Groq', vision: true })]);
  assert.equal((await API.config()).providerName, 'Groq');
  assert.equal(sent[0].url, '/api/ai');
  fake([reply(200, { enabled: false })]); assert.equal(await API.config(), null);
  fake([reply(404, null)]); assert.equal(await API.config(), null);
  fake([new TypeError('network')]); assert.equal(await API.config(), null);
});

test('call: POSTs the job as JSON and returns the reply', async () => {
  const sent = fake([reply(200, { text: '1: 2/2', via: 'groq' })]);
  const j = await API.call({ task: 'tidy', kind: 'sheet', text: '1 2/2' }, null, noWait);
  assert.equal(j.text, '1: 2/2');
  assert.equal(sent[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(sent[0].init.body), { task: 'tidy', kind: 'sheet', text: '1 2/2' });
});

test('call: waits as long as "busy" asks, counting down, then retries', async () => {
  fake([reply(429, { error: 'busy', retry_after: 3 }), reply(200, { text: 'ok' })]);
  const ticks = [];
  assert.equal((await API.call({ task: 'paper' }, s => ticks.push(s), noWait)).text, 'ok');
  assert.deepEqual(ticks, [3, 2, 1]);
});

test('call: other errors are thrown with the back end\'s code', async () => {
  fake([reply(429, { error: 'limit' })]);
  await assert.rejects(API.call({ task: 'paper' }, null, noWait), { code: 'limit' });
  fake([reply(500, null)]);
  await assert.rejects(API.call({ task: 'paper' }, null, noWait), { code: 'upstream' });
  fake([reply(429, { error: 'busy' }), reply(429, { error: 'busy' })]);
  await assert.rejects(API.call({ task: 'paper' }, null, { ...noWait, tries: 1 }), { code: 'busy' });
});

test('setBase: a back end on another address', async () => {
  const sent = fake([reply(200, { enabled: true })]);
  API.setBase('https://api.example.com/'); await API.config(); API.setBase('');
  assert.equal(sent[0].url, 'https://api.example.com/api/ai');
});
