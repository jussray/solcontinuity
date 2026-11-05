import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createSolContinuityServer, RedisSessionRevocationStore } from "../dist/src/api/server.js";

const expected = process.env.EXPECTED_HEAD_SHA || "";
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const container = "sc-aof-" + randomUUID().replaceAll("-", "").slice(0, 16);
const volume = container + "-data";
const url = "redis://127.0.0.1:6388";
const prefix = "sc:aof:" + randomUUID().replaceAll("-", "") + ":";
const secret = "local-only-aof-proof-cookie-signing-key";
const password = "local-only-aof-proof-console-token";
const steps = [];
let nodeA = null, nodeB = null, nodeC = null;
let volumeCreated = false;
let containerCreated = false;
function prove(name, condition) {
  assert.ok(condition, "OPERATION_FAILED:" + name);
  steps.push(name);
}
function docker(...args) {
  return execFileSync("docker", args, {
    encoding: "utf8", timeout: 25_000, stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}
const store = () => new RedisSessionRevocationStore({ url, prefix, timeoutMs: 650 });
async function ready() {
  for (let i = 0; i < 60; i++) {
    try {
      if (await store().isRevoked(createHash("sha256").update("readiness").digest("hex")) === false) return true;
    } catch { /* container may be restarting */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}
function bootRedis() {
  docker("run", "--detach", "--name", container,
    "--mount", "type=volume,source=" + volume + ",target=/data",
    "--publish", "127.0.0.1:6388:6379",
    "redis:7.4-alpine", "redis-server",
    "--appendonly", "yes", "--appendfsync", "always",
    "--save", "", "--maxmemory-policy", "noeviction");
  containerCreated = true;
}
async function app() {
  const server = createSolContinuityServer({
    consoleToken: password, cookieSecret: secret,
    secureCookies: true, sessionRevocationStore: store(),
    requireSharedSessionRevocation: true,
    rateLimit: { capacity: 100, refillPerSecond: 1 }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, origin: "http://127.0.0.1:" + address.port };
}
async function close(app) {
  if (app?.server.listening) {
    await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
  }
}
async function auth(origin) {
  const response = await fetch(origin + "/api/session/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: password })
  });
  prove("http-login-with-live-aof-redis", response.status === 204);
  const entry = response.headers.getSetCookie().find((s) => s.startsWith("sc_session="));
  prove("secure-session-issued", Boolean(entry && /HttpOnly/.test(entry) && /Secure/.test(entry) && /SameSite=Strict/.test(entry)));
  return entry.split(";")[0];
}
const check = async (app, cookie) => (await fetch(app.origin + "/api/overview", { headers: { cookie } })).status;
async function exercise() {
  prove("exact-commit", Boolean(expected) && expected === commit);
  docker("volume", "create", volume);
  volumeCreated = true;
  bootRedis();
  prove("redis-server-initial-start", await ready());
  const aof = docker("exec", container, "redis-cli", "CONFIG", "GET", "appendonly");
  prove("redis-aof-is-enabled", /(?:^|\n)yes\s*$/i.test(aof));
  const eviction = docker("exec", container, "redis-cli", "CONFIG", "GET", "maxmemory-policy");
  prove("redis-eviction-policy-noeviction", /(?:^|\n)noeviction\s*$/i.test(eviction));

  nodeA = await app();
  nodeB = await app();
  const sessionA = await auth(nodeA.origin);
  const sessionB = await auth(nodeB.origin);
  prove("unique-independent-sessions", sessionA !== sessionB);
  prove("first-session-cross-instance", await check(nodeB, sessionA) === 200);
  prove("second-session-active", await check(nodeA, sessionB) === 200);
  const logout = await fetch(nodeA.origin + "/api/session/logout", {
    method: "POST", headers: { cookie: sessionA }
  });
  prove("redis-aof-recorded-logout", logout.status === 204);
  prove("replay-denied-before-restart-a", await check(nodeA, sessionA) === 401);
  prove("replay-denied-before-restart-b", await check(nodeB, sessionA) === 401);

  // Restart the Redis SERVER and replace its container; keep the same AOF volume.
  docker("stop", "--time", "10", container);
  docker("rm", container);
  containerCreated = false;
  const unhealthy = await fetch(nodeA.origin + "/api/health");
  const health = await unhealthy.json();
  prove("redis-server-down-means-degraded-health",
    unhealthy.status === 503 && health.sessionStoreReady === false && health.status === "degraded");
  prove("redis-server-down-denies-protected-operation", await check(nodeA, sessionB) === 500);
  const deniedLogin = await fetch(nodeA.origin + "/api/session/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: password })
  });
  prove("redis-server-down-denies-login", deniedLogin.status === 500);
  const deniedLogout = await fetch(nodeA.origin + "/api/session/logout", {
    method: "POST", headers: { cookie: sessionB }
  });
  prove("redis-server-down-denies-logout", deniedLogout.status === 500);

  bootRedis();
  prove("redis-server-new-container-aof-ready", await ready());
  await Promise.all([close(nodeA), close(nodeB)]);
  nodeA = null;
  nodeB = null;
  nodeC = await app();
  const recovered = await fetch(nodeC.origin + "/api/health");
  const recoveredBody = await recovered.json();
  prove("aof-restore-reports-healthy", recovered.status === 200 && recoveredBody.sessionStoreReady === true);
  prove("aof-replayed-revocation-still-denies-session", await check(nodeC, sessionA) === 401);
  prove("independent-session-preserved-after-aof-restart", await check(nodeC, sessionB) === 200);
}
let failure = null;
try {
  await exercise();
} catch (error) {
  failure = error instanceof Error && error.message.startsWith("OPERATION_FAILED:")
    ? error.message.slice(0, 130)
    : "AOF_OPERATION_OR_RUNTIME_UNAVAILABLE";
} finally {
  await Promise.allSettled([close(nodeA), close(nodeB), close(nodeC)]);
  try { if (containerCreated) docker("rm", "--force", container); } catch { /* cleanup only */ }
  try { if (volumeCreated) docker("volume", "rm", "--force", volume); } catch { /* cleanup only */ }
}
const result = {
  schema: "solcontinuity/redis-aof-server-restart@v1",
  expected, commit,
  status: failure ? "failed" : "passed_local_aof_restart",
  scope: "GitHub-hosted Docker Redis with real AOF volume, local loopback HTTP; no managed production cluster",
  checks: steps,
  failure,
  productionVerified: false,
  mutationAuthorized: false
};
result.evidenceFingerprint = "sha256:" + createHash("sha256").update(JSON.stringify(result)).digest("hex");
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/redis-aof-restart.json", JSON.stringify(result, null, 2) + "\n");
console.log("Redis AOF restart proof status=" + result.status + " checks=" + steps.length +
  " commit=" + commit + " fingerprint=" + result.evidenceFingerprint);
if (failure) process.exitCode = 1;
