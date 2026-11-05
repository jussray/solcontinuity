import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/dashboard/session.js', import.meta.url), 'utf8');
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(replies, protocol = 'https:') {
  const ids = ['session-form', 'console-token', 'session-login', 'session-logout', 'session-status'];
  const elements = Object.fromEntries(ids.map(id => [id, { hidden: true, disabled: false, value: '', textContent: '', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } }]));
  const events = new Map();
  const emitted = [];
  const document = { getElementById: id => elements[id], addEventListener(type, fn) { events.set(type, fn); }, dispatchEvent(event) { emitted.push(event.type); events.get(event.type)?.(event); } };
  Object.defineProperty(document, 'cookie', { get() { throw Error('Cookie access forbidden'); } });
  const calls = [];
  const context = { document, location: { protocol }, Event, fetch: async (url, options) => { calls.push({ url, options }); const next = replies.shift(); if (next instanceof Error) throw next; if (!next) throw Error('Unexpected fetch'); return next; } };
  vm.runInNewContext(source, context);
  return { elements, document, emitted, calls };
}
test('protected console supports server-owned login, clears token, and refreshes existing tools', async () => {
  const h = harness([response(200, { authRequired: true }), response(401), response(204)]);
  await tick();
  assert.equal(h.elements['session-form'].hidden, false);
  h.elements['console-token'].value = 'operator-test-token';
  await h.elements['session-form'].listeners.submit({ preventDefault() {} });
  const call = h.calls.at(-1);
  assert.equal(call.url, '/api/session/login');
  assert.equal(call.options.credentials, 'same-origin');
  assert.equal(JSON.parse(call.options.body).token, 'operator-test-token');
  assert.equal(h.elements['console-token'].value, '');
  assert.equal(h.elements['session-logout'].hidden, false);
  assert.equal(h.emitted.at(-1), 'sol-session-changed');
});
test('invalid token and throttling never announce successful sign-in or refresh data', async () => {
  for (const status of [401, 429, 503]) {
    const h = harness([response(200, { authRequired: true }), response(401), response(status)]);
    await tick();
    h.elements['console-token'].value = 'bad-token';
    await h.elements['session-form'].listeners.submit({ preventDefault() {} });
    assert.equal(h.elements['console-token'].value, '');
    assert.equal(h.elements['session-logout'].hidden, true);
    assert.equal(h.emitted.includes('sol-session-changed'), false);
    assert.equal(h.elements['session-login'].disabled, false);
  }
});
test('logout confirmation and failure remain distinct', async () => {
  for (const status of [204, 503]) {
    const h = harness([response(200, { authRequired: true }), response(200), response(status)]);
    await tick();
    await h.elements['session-logout'].listeners.click();
    assert.equal(h.calls.at(-1).url, '/api/session/logout');
    assert.equal(h.elements['session-logout'].hidden, status === 204);
    assert.equal(h.emitted.includes('sol-session-changed'), status === 204);
    assert.equal(h.elements['session-logout'].disabled, false);
  }
});
test('expired sessions show sign-in; static and unprotected modes never invent sign-in', async () => {
  const h = harness([response(200, { authRequired: true }), response(200)]);
  await tick();
  h.document.dispatchEvent(new Event('sol-session-required'));
  assert.equal(h.elements['session-form'].hidden, false);
  const offline = harness([], 'file:');
  await tick();
  assert.equal(offline.calls.length, 0);
  assert.match(offline.elements['session-status'].textContent, /Static recovery/);
  const unprotected = harness([response(200, { authRequired: false })]);
  await tick();
  assert.equal(unprotected.elements['session-form'].hidden, true);
  assert.match(unprotected.elements['session-status'].textContent, /not configured/);
});
test('network and malformed health failures never claim authenticated access', async () => {
  for (const next of [new Error('offline'), response(200, {})]) {
    const h = harness([next]);
    await tick();
    assert.equal(h.elements['session-logout'].hidden, true);
    assert.match(h.elements['session-status'].textContent, /No signed-in state/);
  }
});
test('a protected response started before sign-out cannot render afterward', async () => {
  const app = readFileSync(new URL('../src/dashboard/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('async function apiRequest(');
  const end = app.indexOf('function textElement(', start);
  let resolveResponse;
  const pending = new Promise(resolve => { resolveResponse = resolve; });
  const context = vm.createContext({ fetch: () => pending, canUseApi: () => true, document: { dispatchEvent() {} }, Event });
  vm.runInContext(`let sessionEpoch = 0; ${app.slice(start, end)}; globalThis.request = apiRequest; globalThis.endSession = () => { sessionEpoch += 1; };`, context);
  const result = context.request('/api/audit');
  context.endSession();
  resolveResponse(response(200, { privateResult: 'must not render' }));
  await assert.rejects(result, /Session changed/);
});
test('a stale initial access probe cannot override successful sign-in or sign-out', async () => {
  for (const signOut of [false, true]) {
    let resolveProbe;
    const probe = new Promise(resolve => { resolveProbe = resolve; });
    const h = harness([response(200, { authRequired: true }), probe, response(204), response(204)]);
    await tick();
    h.document.dispatchEvent(new Event('sol-session-required'));
    h.elements['console-token'].value = 'test-token';
    await h.elements['session-form'].listeners.submit({ preventDefault() {} });
    if (signOut) await h.elements['session-logout'].listeners.click();
    const message = h.elements['session-status'].textContent;
    resolveProbe(response(signOut ? 200 : 401));
    await tick();
    assert.equal(h.elements['session-status'].textContent, message);
    assert.equal(h.elements['session-logout'].hidden, signOut);
  }
});
