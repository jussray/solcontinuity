import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSolContinuityServer } from "../src/api/server.js";

const validManifest = {
  schemaVersion: "1.0",
  name: "API Test",
  description: "A test manifest.",
  network: "devnet",
  sourceRepository: "https://github.com/jussray/solcontinuity",
  license: "Apache-2.0",
  programAddresses: ["11111111111111111111111111111111"],
  rpcEndpoints: [
    { id: "a", provider: "operator-a", url: "https://a.example.org" },
    { id: "b", provider: "operator-b", url: "https://b.example.org" },
    { id: "c", provider: "operator-c", url: "https://c.example.org" }
  ],
  frontend: {
    primaryUrl: "https://app.example.org",
    recoveryUrl: "https://recovery.example.org",
    selfHostingGuide: "https://docs.example.org/self-host"
  },
  dependencies: [],
  verification: { minimumRpcAgreement: 2, commitment: "confirmed", publishEvidence: true }
};

const genericManifest = {
  schemaVersion: "1.0",
  name: "Generic JSON-RPC API Test",
  description: "A platform-neutral continuity manifest.",
  platform: "evm",
  environment: "mainnet",
  sourceRepository: "https://github.com/jussray/solcontinuity",
  license: "Apache-2.0",
  targets: [
    { id: "settlement-contract", kind: "contract", address: "0x0000000000000000000000000000000000000001" }
  ],
  routes: [
    { id: "a", provider: "operator-a", url: "https://a.example.org" },
    { id: "b", provider: "operator-b", url: "https://b.example.org" },
    { id: "c", provider: "operator-c", url: "https://c.example.org" }
  ],
  frontend: {
    primaryUrl: "https://app.example.org",
    recoveryUrl: "https://recovery.example.org",
    selfHostingGuide: "https://docs.example.org/self-host"
  },
  dependencies: [],
  verification: { minimumRouteAgreement: 2, publishEvidence: true }
};

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "solcontinuity-api-"));
  await writeFile(join(root, "index.html"), "<h1>SolContinuity</h1>", "utf8");
  const manifestPath = join(root, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(validManifest), "utf8");

  const server = createSolContinuityServer({ dashboardRoot: root, exampleManifestPath: manifestPath });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not expose a TCP port.");
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("health endpoint exposes service state", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { service: string; status: string };
    assert.equal(payload.service, "solcontinuity-api");
    assert.equal(payload.status, "ok");
  });
});

test("overview exposes the standalone continuity boundary", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/overview`);
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { project: string; boundary: string };
    assert.equal(payload.project, "SolContinuity");
    assert.equal(payload.boundary, "application-layer continuity");
  });
});

test("audit endpoint uses the same typed core as the CLI", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/audit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validManifest)
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { score: number; findings: unknown[] };
    assert.equal(payload.score, 100);
    assert.deepEqual(payload.findings, []);
  });
});

test("audit endpoint accepts a platform-neutral manifest", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/audit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(genericManifest)
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { score: number; findings: unknown[] };
    assert.equal(payload.score, 100);
    assert.deepEqual(payload.findings, []);
  });
});

test("provider scoring proxies the configured analytics service", async () => {
  const analytics = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    assert.equal(request.url, "/score");
    assert.ok(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ score: 91, flags: [], truthBoundary: "supplied observations only" }));
  });
  analytics.listen(0, "127.0.0.1");
  await once(analytics, "listening");
  const address = analytics.address();
  if (!address || typeof address === "string") {
    throw new Error("Analytics mock did not expose a TCP port.");
  }

  const root = await mkdtemp(join(tmpdir(), "solcontinuity-proxy-"));
  await writeFile(join(root, "index.html"), "<h1>SolContinuity</h1>", "utf8");
  const manifestPath = join(root, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(validManifest), "utf8");
  const server = createSolContinuityServer({
    dashboardRoot: root,
    exampleManifestPath: manifestPath,
    analyticsUrl: `http://127.0.0.1:${address.port}`
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const serverAddress = server.address();
  if (!serverAddress || typeof serverAddress === "string") {
    throw new Error("Server did not expose a TCP port.");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${serverAddress.port}/api/provider-score`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ observations: [] })
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { score: number };
    assert.equal(payload.score, 91);
  } finally {
    await Promise.all([
      new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
      new Promise<void>((resolve, reject) => analytics.close((error) => (error ? reject(error) : resolve())))
    ]);
  }
});

test("provider scoring fails closed when analytics is not configured", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/provider-score`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ observations: [] })
    });
    assert.equal(response.status, 503);
    const payload = (await response.json()) as { error: string };
    assert.equal(payload.error, "ANALYTICS_NOT_CONFIGURED");
  });
});

test("every response issues a signed device-fingerprint cookie on first visit", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const setCookie = response.headers.get("set-cookie");
    assert.ok(setCookie?.includes("sc_device="));
    assert.match(setCookie ?? "", /HttpOnly/);
    assert.match(setCookie ?? "", /SameSite=Strict/);
  });
});

test("a returning device cookie is not reissued", async () => {
  await withServer(async (baseUrl) => {
    const first = await fetch(`${baseUrl}/api/health`);
    const cookie = first.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const second = await fetch(`${baseUrl}/api/health`, { headers: { cookie: cookie! } });
    assert.equal(second.headers.get("set-cookie"), null);
  });
});

test("rate limiting returns 429 once a fingerprint exhausts its budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "solcontinuity-ratelimit-"));
  await writeFile(join(root, "index.html"), "<h1>SolContinuity</h1>", "utf8");
  const manifestPath = join(root, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(validManifest), "utf8");
  const server = createSolContinuityServer({
    dashboardRoot: root,
    exampleManifestPath: manifestPath,
    rateLimit: { capacity: 2, refillPerSecond: 0.01 }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not expose a TCP port.");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const first = await fetch(`${baseUrl}/api/health`);
    const cookie = first.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const headers = { cookie: cookie! };
    await fetch(`${baseUrl}/api/health`, { headers });
    const limited = await fetch(`${baseUrl}/api/health`, { headers });
    assert.equal(limited.status, 429);
    const payload = (await limited.json()) as { error: string };
    assert.equal(payload.error, "RATE_LIMITED");
    assert.ok(limited.headers.get("retry-after"));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("session auth is enforced once a console token is configured", async () => {
  const root = await mkdtemp(join(tmpdir(), "solcontinuity-auth-"));
  await writeFile(join(root, "index.html"), "<h1>SolContinuity</h1>", "utf8");
  const manifestPath = join(root, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(validManifest), "utf8");
  const server = createSolContinuityServer({
    dashboardRoot: root,
    exampleManifestPath: manifestPath,
    consoleToken: "correct-token",
    cookieSecret: "test-cookie-secret"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not expose a TCP port.");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const healthResponse = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthResponse.status, 200);
    const healthPayload = (await healthResponse.json()) as { authRequired: boolean };
    assert.equal(healthPayload.authRequired, true);

    const unauthenticated = await fetch(`${baseUrl}/api/overview`);
    assert.equal(unauthenticated.status, 401);

    const wrongToken = await fetch(`${baseUrl}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "wrong-token" })
    });
    assert.equal(wrongToken.status, 401);

    const login = await fetch(`${baseUrl}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "correct-token" })
    });
    assert.equal(login.status, 204);
    const sessionCookies = login.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
    assert.ok(sessionCookies.includes("sc_session="));

    const authenticated = await fetch(`${baseUrl}/api/overview`, { headers: { cookie: sessionCookies } });
    assert.equal(authenticated.status, 200);

    const logout = await fetch(`${baseUrl}/api/session/logout`, {
      method: "POST",
      headers: { cookie: sessionCookies }
    });
    assert.equal(logout.status, 204);
    const loggedOutCookies = logout.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");

    const afterLogout = await fetch(`${baseUrl}/api/overview`, { headers: { cookie: loggedOutCookies } });
    assert.equal(afterLogout.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
