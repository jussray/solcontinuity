import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createSolContinuityServer, RedisSessionRevocationStore } from "../dist/src/api/server.js";

const checks = [];
const actual = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const expected = process.env.EXPECTED_HEAD_SHA || "";
const receipt = "artifacts/redis-revocation-actions.json";
const url = process.env.REDIS_TEST_URL || "redis://127.0.0.1:6379";
const prefix = "sc:proof:" + randomUUID().replaceAll("-", "") + ":";
const cookieSecret = "throwaway-redis-proof-cookie-secret";
const consoleToken = "throwaway-redis-proof-auth-token";

function prove(name, condition) {
  assert.ok(condition, "OPERATION_FAILED:" + name);
  checks.push(name);
}

async function start(store) {
  const server = createSolContinuityServer({
    consoleToken,
    cookieSecret,
    secureCookies: true,
    requireSharedSessionRevocation: true,
    sessionRevocationStore: store,
    rateLimit: { capacity: 120, refillPerSecond: 1 }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, base: "http://127.0.0.1:" + address.port };
}

async function stop(node) {
  if (node && node.server.listening) {
    await new Promise((resolve, reject) => node.server.close((error) => error ? reject(error) : resolve()));
  }
}

async function issueSession(base) {
  const response = await fetch(base + "/api/session/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: consoleToken })
  });
  prove("real-redis-backed-login", response.status === 204);
  const cookie = response.headers.getSetCookie().find((s) => s.startsWith("sc_session="));
  prove("session-cookie-issued", Boolean(cookie) && /HttpOnly/.test(cookie) && /Secure/.test(cookie) && /SameSite=Strict/.test(cookie));
  return cookie.split(";")[0];
}

async function status(base, cookie) {
  return (await fetch(base + "/api/overview", { headers: { cookie } })).status;
}

async function exercise() {
  prove("exact-commit", Boolean(expected) && expected === actual);
  const makeStore = () => new RedisSessionRevocationStore({ url, prefix, timeoutMs: 1200 });
  const a = await start(makeStore());
  const b = await start(makeStore());
  let c = null;
  let failed = null;
  try {
    const sessionA = await issueSession(a.base);
    const sessionB = await issueSession(b.base);
    prove("independent-cookie-values", sessionA !== sessionB);
    prove("instance-a-allows-first-session", await status(a.base, sessionA) === 200);
    prove("instance-b-allows-first-session", await status(b.base, sessionA) === 200);
    prove("instance-b-allows-second-session", await status(b.base, sessionB) === 200);
    const logout = await fetch(a.base + "/api/session/logout", {
      method: "POST", headers: { cookie: sessionA }
    });
    prove("redis-persistent-logout", logout.status === 204);
    prove("instance-a-rejects-replay", await status(a.base, sessionA) === 401);
    prove("instance-b-rejects-replay", await status(b.base, sessionA) === 401);
    prove("independent-session-survives", await status(b.base, sessionB) === 200);
    await Promise.all([stop(a), stop(b)]);
    // Reinstantiate both the HTTP server and Redis client while Redis remains alive.
    c = await start(makeStore());
    prove("new-server-after-restart-rejects-replay", await status(c.base, sessionA) === 401);
    prove("new-server-after-restart-preserves-other-session", await status(c.base, sessionB) === 200);
    const digest = createHash("sha256").update("test-expiry:" + prefix).digest("hex");
    const store = makeStore();
    await store.revoke(digest, Date.now() + 850);
    prove("redis-expiry-written", await store.isRevoked(digest) === true);
    let expired = false;
    for (let i = 0; i < 35; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (!(await makeStore().isRevoked(digest))) { expired = true; break; }
    }
    prove("redis-expiry-actually-elapses", expired);

    // An unavailable Redis must not produce success on login or on authenticated actions.
    const unreachable = new RedisSessionRevocationStore({ url: "redis://127.0.0.1:1", timeoutMs: 300 });
    failed = await start(unreachable);
    const deniedLogin = await fetch(failed.base + "/api/session/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: consoleToken })
    });
    prove("storage-outage-fails-login", deniedLogin.status === 500);
    prove("storage-outage-fails-protected-action", await status(failed.base, sessionB) === 500);
    const deniedLogout = await fetch(failed.base + "/api/session/logout", {
      method: "POST", headers: { cookie: sessionB }
    });
    prove("storage-outage-fails-logout", deniedLogout.status === 500);
  } finally {
    await Promise.all([stop(a), stop(b), stop(c), stop(failed)]);
  }
}

let error = null;
try {
  await exercise();
} catch (e) {
  error = e instanceof Error ? e.message.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 130) : "UNKNOWN_ERROR";
}
const report = {
  schema: "solcontinuity/redis-operational-proof@v1",
  commit: actual,
  expected,
  status: error ? "failed" : "passed_local_redis",
  scope: "GitHub Actions local Redis service and local HTTP servers only; NOT external production or cross-host cluster",
  checks,
  failure: error
};
report.evidenceFingerprint = "sha256:" + createHash("sha256").update(JSON.stringify(report)).digest("hex");
await mkdir("artifacts", { recursive: true });
await writeFile(receipt, JSON.stringify(report, null, 2) + "\n");
console.log("Redis action receipt status=" + report.status + " checks=" + checks.length + " commit=" + actual + " fingerprint=" + report.evidenceFingerprint);
if (error) {
  console.error("REDIS_ACTION_FAILED:" + error);
  process.exitCode = 1;
}
