import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { createSolContinuityServer } from "../src/api/server.js";
import { ProcessLocalSessionRevocationStore, type SessionRevocationStore } from "../src/api/session-revocation.js";

test("production shared-session mode refuses to start without an injected store", () => {
  assert.throws(() => createSolContinuityServer({
    consoleToken: "local-test",
    requireSharedSessionRevocation: true
  }), /SHARED_SESSION_REVOCATION_STORE_REQUIRED/);
});

test("local revocation store retains only digests through the expiration boundary", async () => {
  const store = new ProcessLocalSessionRevocationStore();
  const digest = createHash("sha256").update("test-cookie-never-persisted").digest("hex");
  assert.equal(await store.isRevoked(digest), false);
  await store.revoke(digest, Date.now() + 60_000);
  assert.equal(await store.isRevoked(digest), true);
  await assert.rejects(() => store.revoke("not-a-valid-digest", Date.now() + 60_000), /INVALID_SESSION_DIGEST/);
});

test("session store outage fails protected requests and logout closed, not 200/204", async () => {
  const store: SessionRevocationStore = {
    async isRevoked() { throw new Error("STORE_UNAVAILABLE"); },
    async revoke() { throw new Error("STORE_UNAVAILABLE"); }
  };
  const server = createSolContinuityServer({
    consoleToken: "local-test-console-token",
    cookieSecret: "local-test-cookie-secret",
    requireSharedSessionRevocation: true,
    sessionRevocationStore: store,
    rateLimit: { capacity: 100, refillPerSecond: 1 }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const login = await fetch(base + "/api/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "local-test-console-token" })
    });
    assert.equal(login.status, 204);
    const cookie = login.headers.getSetCookie().find((entry) => entry.startsWith("sc_session="))?.split(";")[0];
    assert.ok(cookie);
    const blocked = await fetch(base + "/api/overview", { headers: { cookie } });
    assert.equal(blocked.status, 500);
    const blockedBody = await blocked.json() as { error: string };
    assert.equal(blockedBody.error, "INTERNAL_ERROR");
    const logout = await fetch(base + "/api/session/logout", { method: "POST", headers: { cookie } });
    assert.equal(logout.status, 500);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
