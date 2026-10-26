import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createSolContinuityServer } from "../dist/src/api/server.js";

const checks = [];
const observedHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const expectedHead = process.env.EXPECTED_HEAD_SHA || "";
const receiptPath = "artifacts/operational-actions.json";

function prove(name, condition) {
  assert.ok(condition, "OPERATION_FAILED:" + name);
  checks.push(name);
}

function cookieFrom(response, name) {
  const entry = response.headers.getSetCookie().find((value) => value.startsWith(name + "="));
  prove(name + "-issued", Boolean(entry));
  return { entry, pair: entry.split(";")[0] };
}

function cookiePolicy(name, value) {
  prove(name + "-http-only", /(?:^|;\s*)HttpOnly(?:;|$)/i.test(value));
  prove(name + "-secure", /(?:^|;\s*)Secure(?:;|$)/i.test(value));
  prove(name + "-strict", /(?:^|;\s*)SameSite=Strict(?:;|$)/i.test(value));
  prove(name + "-root-path", /(?:^|;\s*)Path=\/(?:;|$)/i.test(value));
}

async function startServer(options) {
  const server = createSolContinuityServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, base: "http://127.0.0.1:" + address.port };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function exercise() {
  prove("exact-head", Boolean(expectedHead) && observedHead === expectedHead);
  const auth = await startServer({
    consoleToken: "local-only-action-proof",
    cookieSecret: "ephemeral-local-action-proof-key-not-production",
    secureCookies: true,
    expectedHeadSha: expectedHead,
    rateLimit: { capacity: 40, refillPerSecond: 1 }
  });
  try {
    const health = await fetch(auth.base + "/api/health");
    const healthData = await health.json();
    prove("real-http-health", health.status === 200 && healthData.status === "ok" && healthData.runtimeHeadBound === true && healthData.authRequired === true);
    prove("no-store-health", health.headers.get("cache-control") === "no-store");
    const device = cookieFrom(health, "sc_device");
    cookiePolicy("device-cookie", device.entry);

    const unauthenticated = await fetch(auth.base + "/api/overview", { headers: { cookie: device.pair } });
    const rejected = await unauthenticated.json();
    prove("protected-action-rejected", unauthenticated.status === 401 && rejected.error === "AUTHENTICATION_REQUIRED");

    const denied = await fetch(auth.base + "/api/session/login", {
      method: "POST", headers: { "content-type": "application/json", cookie: device.pair },
      body: JSON.stringify({ token: "not-the-proof-token" })
    });
    prove("wrong-token-rejected", denied.status === 401);

    const login = await fetch(auth.base + "/api/session/login", {
      method: "POST", headers: { "content-type": "application/json", cookie: device.pair },
      body: JSON.stringify({ token: "local-only-action-proof" })
    });
    prove("real-http-login", login.status === 204);
    prove("no-store-login", login.headers.get("cache-control") === "no-store");
    const session = cookieFrom(login, "sc_session");
    cookiePolicy("session-cookie", session.entry);

    const jar = device.pair + "; " + session.pair;
    const authenticated = await fetch(auth.base + "/api/overview", { headers: { cookie: jar } });
    const overview = await authenticated.json();
    prove("protected-action-succeeded", authenticated.status === 200 && overview.project === "SolContinuity");

    const logout = await fetch(auth.base + "/api/session/logout", { method: "POST", headers: { cookie: jar } });
    prove("real-http-logout", logout.status === 204);
    const cleared = cookieFrom(logout, "sc_session");
    cookiePolicy("cleared-session-cookie", cleared.entry);
    prove("logout-expiration", /(?:^|;\s*)Max-Age=0(?:;|$)/i.test(cleared.entry));
    const afterLogout = await fetch(auth.base + "/api/overview", { headers: { cookie: device.pair + "; " + cleared.pair } });
    prove("logout-clears-client-cookie", afterLogout.status === 401);
    // Exercise the original signed session, not only the browser-cleared replacement.
    const replay = await fetch(auth.base + "/api/overview", { headers: { cookie: jar } });
    prove("logout-rejects-replayed-session", replay.status === 401);
  } finally {
    await closeServer(auth.server);
  }

  const limited = await startServer({
    secureCookies: true,
    cookieSecret: "ephemeral-rate-limit-proof-key",
    rateLimit: { capacity: 2, refillPerSecond: 0.0001 }
  });
  try {
    const initial = await fetch(limited.base + "/api/health");
    prove("fingerprint-first-action", initial.status === 200);
    const device = cookieFrom(initial, "sc_device");
    const again = await fetch(limited.base + "/api/health", { headers: { cookie: device.pair } });
    prove("fingerprint-second-action", again.status === 200);
    const rejected = await fetch(limited.base + "/api/health", { headers: { cookie: device.pair } });
    const body = await rejected.json();
    prove("stable-signed-device-rate-limit-enforced", rejected.status === 429 && body.error === "RATE_LIMITED" && Boolean(rejected.headers.get("retry-after")));
    const forged = await fetch(limited.base + "/api/health", { headers: { cookie: "sc_device=forged.signature" } });
    const replacement = cookieFrom(forged, "sc_device");
    prove("forged-device-cookie-replaced", forged.status === 200 && replacement.pair !== "sc_device=forged.signature");
  } finally {
    await closeServer(limited.server);
  }
}

let failure = null;
try {
  await exercise();
} catch (error) {
  // No cookies, session values, credentials, IP addresses or request bodies in receipts.
  failure = error instanceof Error ? error.message.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 140) : "UNKNOWN_ERROR";
}
const result = {
  schema: "solcontinuity/local-operational-action-proof@v1",
  repository: process.env.GITHUB_REPOSITORY || "jussray/solcontinuity",
  commit: observedHead,
  expectedHead,
  status: failure ? "failed" : "passed_local_actions",
  scope: "ephemeral loopback API only; does not verify deployed production or live provider/network actions",
  checks,
  failure
};
result.evidenceFingerprint = "sha256:" + createHash("sha256").update(JSON.stringify(result)).digest("hex");
await mkdir("artifacts", { recursive: true });
await writeFile(receiptPath, JSON.stringify(result, null, 2) + "\n");
console.log("Operational action receipt: status=" + result.status + " commit=" + observedHead + " checks=" + checks.length + " fingerprint=" + result.evidenceFingerprint);
if (failure) {
  console.error("LOCAL_OPERATION_PROOF_FAILED: " + failure);
  process.exitCode = 1;
}
