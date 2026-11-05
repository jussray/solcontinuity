import assert from 'node:assert/strict';
import test from 'node:test';

// Node >= 22.6 type-stripping imports the TS runtime directly. Standalone:
// run with `node --test tests/provider-runtime-guards.test.mjs`.
import { invokeSolProvider, solProviderStates } from '../src/api/provider-runtime.ts';

const KEY = 'TEST-KEY-NOT-A-REAL-SECRET';
const okFetch = () => {
  const wrapped = async () => { wrapped.calls++; return new Response(JSON.stringify({ id: 'resp_1', status: 'completed', output_text: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  wrapped.calls = 0;
  return wrapped;
};
function withEnv(vars, fn) {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  return Promise.resolve()
    .then(fn)
    .finally(() => { process.env = saved; });
}

test('muse requires an explicitly configured allow-listed model', async () => {
  await withEnv({ MODEL_API_KEY: KEY, SOL_MUSE_MODEL: undefined }, async () => {
    assert.equal(solProviderStates().muse.state, 'ABSENT');
  });
  await withEnv({ MODEL_API_KEY: KEY, SOL_MUSE_MODEL: 'muse-spark-9.9' }, async () => {
    assert.equal(solProviderStates().muse.state, 'ABSENT');
    const fetchImpl = okFetch();
    await assert.rejects(() => invokeSolProvider({ provider: 'muse', prompt: 'hi' }, fetchImpl), /MUSE_NOT_CONFIGURED/);
    assert.equal(fetchImpl.calls, 0);
  });
  await withEnv({ MODEL_API_KEY: KEY, SOL_MUSE_MODEL: 'muse-spark-1.3' }, async () => {
    assert.equal(solProviderStates().muse.state, 'INTEGRATED');
  });
});

test('non-standard sensitivity and non-allowlisted source reject pre-network', async () => {
  await withEnv({ MODEL_API_KEY: KEY, SOL_MUSE_MODEL: 'muse-spark-1.3' }, async () => {
    const f1 = okFetch();
    await assert.rejects(() => invokeSolProvider({ provider: 'muse', prompt: 'hi', sensitivity: 'crisis' }, f1), /SENSITIVE_CONTEXT_NOT_AUTHORIZED/);
    assert.equal(f1.calls, 0);
    const f2 = okFetch();
    await assert.rejects(() => invokeSolProvider({ provider: 'muse', prompt: 'hi', source: 'user' }, f2), /USER_CONTENT_NOT_AUTHORIZED/);
    assert.equal(f2.calls, 0);
    const ok = await invokeSolProvider({ provider: 'muse', prompt: 'hi' }, okFetch());
    assert.equal(ok.state, 'INTEGRATED');
    assert.equal(ok.evidenceRef, 'provider:meta:resp_1');
  });
});
