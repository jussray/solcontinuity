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
