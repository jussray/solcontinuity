import assert from "node:assert/strict";
import test from "node:test";
import { QuorumError } from "../src/core/errors.js";
import { MultiRpcClient } from "../src/core/multi-rpc-client.js";
import { createMockRpcServer } from "../src/testing/failure-simulator.js";

test("quorum returns the majority value and records evidence", async () => {
  const servers = await Promise.all([
    createMockRpcServer("a", { methodResults: { getBalance: { value: 42 } } }),
    createMockRpcServer("b", { methodResults: { getBalance: { value: 42 } } }),
    createMockRpcServer("c", { methodResults: { getBalance: { value: 99 } } })
  ]);

  try {
    const client = new MultiRpcClient({ endpoints: servers.map((server) => server.endpoint) });
    const result = await client.request<{ value: number }>("getBalance", [], {
      mode: "quorum",
      minimumAgreement: 2
    });

    assert.deepEqual(result.value, { value: 42 });
    assert.equal(result.evidence.agreementCount, 2);
    assert.deepEqual(new Set(result.evidence.selectedEndpointIds), new Set(["a", "b"]));
  } finally {
    await Promise.all(servers.map((server) => server.close()));
  }
});

test("first-success fails over from an unavailable endpoint", async () => {
  const servers = await Promise.all([
    createMockRpcServer("down", { failHttp: 503 }),
    createMockRpcServer("up", { methodResults: { getBlockHeight: 777 } })
  ]);

  try {
    const client = new MultiRpcClient({ endpoints: servers.map((server) => server.endpoint) });
    const result = await client.request<number>("getBlockHeight", [], { mode: "first-success" });

    assert.equal(result.value, 777);
    assert.deepEqual(result.evidence.selectedEndpointIds, ["up"]);
    assert.equal(result.evidence.observations[0]?.ok, false);
  } finally {
    await Promise.all(servers.map((server) => server.close()));
  }
});

test("quorum failure exposes endpoint evidence", async () => {
  const servers = await Promise.all([
    createMockRpcServer("a", { methodResults: { getSlot: 1 } }),
    createMockRpcServer("b", { methodResults: { getSlot: 2 } }),
    createMockRpcServer("c", { methodResults: { getSlot: 3 } })
  ]);

  try {
    const client = new MultiRpcClient({ endpoints: servers.map((server) => server.endpoint) });
    await assert.rejects(
      () => client.request<number>("getSlot", [], { mode: "quorum", minimumAgreement: 2 }),
      (error: unknown) => error instanceof QuorumError && error.code === "QUORUM_NOT_REACHED"
    );
  } finally {
    await Promise.all(servers.map((server) => server.close()));
  }
});

test("health check reports healthy and failed endpoints independently", async () => {
  const servers = await Promise.all([
    createMockRpcServer("healthy", { health: "ok", slot: 100 }),
    createMockRpcServer("failed", { failHttp: 500 })
  ]);

  try {
    const client = new MultiRpcClient({ endpoints: servers.map((server) => server.endpoint) });
    const health = await client.healthCheck();

    assert.equal(health.find((item) => item.endpointId === "healthy")?.healthy, true);
    assert.equal(health.find((item) => item.endpointId === "healthy")?.slot, 100);
    assert.equal(health.find((item) => item.endpointId === "failed")?.healthy, false);
  } finally {
    await Promise.all(servers.map((server) => server.close()));
  }
});

test("quorum can require agreement across independent providers", async () => {
  const servers = await Promise.all([
    createMockRpcServer("same-provider-a", { methodResults: { getBalance: 42 } }),
    createMockRpcServer("same-provider-b", { methodResults: { getBalance: 42 } }),
    createMockRpcServer("independent", { methodResults: { getBalance: 99 } })
  ]);

  try {
    const endpoints = servers.map((server, index) => ({
      ...server.endpoint,
      provider: index < 2 ? "concentrated-provider" : "independent-provider"
    }));
    const client = new MultiRpcClient({ endpoints });

    await assert.rejects(
      () =>
        client.request<number>("getBalance", [], {
          mode: "quorum",
          minimumAgreement: 2,
          minimumProviderAgreement: 2
        }),
      (error: unknown) => error instanceof QuorumError
    );
  } finally {
    await Promise.all(servers.map((server) => server.close()));
  }
});

test("transaction broadcast succeeds through one provider and preserves failed-route evidence", async () => {
  const servers = await Promise.all([
    createMockRpcServer("accepting", { methodResults: { sendTransaction: "devnet-signature" } }),
    createMockRpcServer("blocked", { failHttp: 503 })
  ]);

  try {
    const client = new MultiRpcClient({ endpoints: servers.map((server) => server.endpoint) });
    const result = await client.broadcastTransaction("signed-transaction-base64", {
      minimumAcceptances: 1,
      minimumProviderAcceptances: 1
    });

    assert.equal(result.value, "devnet-signature");
    assert.equal(result.evidence.agreementCount, 1);
    assert.equal(result.evidence.providerAgreementCount, 1);
    assert.equal(result.evidence.observations.length, 2);
    assert.equal(result.evidence.observations.find((item) => item.endpointId === "blocked")?.ok, false);
  } finally {
    await Promise.all(servers.map((server) => server.close()));
  }
});

test("transaction broadcast forwards the requested preflight commitment", async () => {
  const requests: unknown[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = typeof init?.body === "string" ? init.body : "";
    assert.notEqual(body, "");
    requests.push(JSON.parse(body) as unknown);
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: "test", result: "devnet-signature" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  const client = new MultiRpcClient({
    endpoints: [{ id: "a", provider: "operator-a", url: "https://a.example.org" }],
    fetchImpl
  });

  const result = await client.broadcastTransaction("signed-transaction-base64", {
    preflightCommitment: "confirmed"
  });

  assert.equal(result.value, "devnet-signature");
  const request = requests[0] as { readonly method?: unknown; readonly params?: readonly unknown[] } | undefined;
  assert.equal(request?.method, "sendTransaction");
  assert.ok(Array.isArray(request?.params));
  const config = request?.params?.[1] as Record<string, unknown> | undefined;
  assert.equal(config?.encoding, "base64");
  assert.equal(config?.skipPreflight, false);
  assert.equal(config?.preflightCommitment, "confirmed");
});
