import assert from "node:assert/strict";
import test from "node:test";
import { invokeSolProvider, solProviderStates } from "../src/api/provider-runtime.js";

const originalFetch = globalThis.fetch;
const originalOpenAI = process.env.OPENAI_API_KEY;
const originalAnthropic = process.env.ANTHROPIC_API_KEY;
const originalMuse = process.env.MODEL_API_KEY;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalOpenAI;
  if (originalAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = originalAnthropic;
  if (originalMuse === undefined) delete process.env.MODEL_API_KEY; else process.env.MODEL_API_KEY = originalMuse;
});

test("provider states never expose secret values", () => {
  process.env.OPENAI_API_KEY = "openai-secret";
  process.env.ANTHROPIC_API_KEY = "anthropic-secret";
  process.env.MODEL_API_KEY = "muse-secret";
  const states = solProviderStates();
  const openai = states.openai;
  const anthropic = states.anthropic;
  const muse = states.muse;
  assert.ok(openai);
  assert.ok(anthropic);
  assert.ok(muse);
  assert.equal(openai.state, "INTEGRATED");
  assert.equal(anthropic.state, "INTEGRATED");
  assert.equal(muse.state, "INTEGRATED");
  assert.doesNotMatch(JSON.stringify(states), /secret/);
});

test("OpenAI invocation returns bounded evidence with no authority", async () => {
  process.env.OPENAI_API_KEY = "openai-key";
  const result = await invokeSolProvider({provider: "openai", prompt: "challenge continuity drift"}, async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer openai-key");
    assert.doesNotMatch(String(init?.body), /openai-key/);
    return new Response(JSON.stringify({id: "resp_sol_1", status: "completed", output_text: "Sol result"}), {status: 200});
  });
  assert.equal(result.evidenceRef, "provider:openai:resp_sol_1");
  assert.equal(result.authority, "none");
});

test("restricted provider context fails before network use", async () => {
  process.env.MODEL_API_KEY = "muse-key";
  await assert.rejects(
    () => invokeSolProvider({provider: "muse", prompt: "private", sensitivity: "restricted"}, async () => {
      throw new Error("network should not run");
    }),
    /RESTRICTED_CONTEXT/
  );
});

for (const status of ["incomplete", "failed", "cancelled", "queued", "in_progress", undefined]) {
  test(`OpenAI status ${status} rejects partial text without retrying`, async () => {
    process.env.OPENAI_API_KEY = "test-key";
    let calls = 0;
    await assert.rejects(() => invokeSolProvider({provider: "openai", prompt: "Challenge drift."}, async () => {
      calls += 1;
      return new Response(JSON.stringify({
        id: "resp_partial", status, output_text: "unfinished answer",
        error: {message: "untrusted-provider-detail"},
      }), {status: 200});
    }), {message: "OPENAI_NON_COMPLETED_RESPONSE"});
    assert.equal(calls, 1);
  });
}
