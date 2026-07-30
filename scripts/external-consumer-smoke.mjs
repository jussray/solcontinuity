import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_PATH = join(ROOT, "test-results", "external-adoption-evidence.json");

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed with exit code ${result.status}.`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join("\n"));
  }
  return result.stdout.trim();
}

const consumerSource = `
import assert from "node:assert/strict";
import { MultiRpcClient } from "solcontinuity";
import { createSolContinuityServer } from "solcontinuity/server";

const fetchImpl = async (_url, init) => {
  const request = JSON.parse(String(init?.body ?? "{}"));
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: request.id,
    result: "devnet-genesis"
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
};

const client = new MultiRpcClient({
  endpoints: [
    { id: "operator-a", provider: "Operator A", url: "https://operator-a.invalid" },
    { id: "operator-b", provider: "Operator B", url: "https://operator-b.invalid" }
  ],
  fetchImpl
});

const quorum = await client.request("getGenesisHash", [], {
  mode: "quorum",
  minimumAgreement: 2,
  minimumProviderAgreement: 2
});
assert.equal(quorum.value, "devnet-genesis");
assert.equal(quorum.evidence.agreementCount, 2);
assert.equal(quorum.evidence.providerAgreementCount, 2);

const server = createSolContinuityServer({ evidencePaths: [] });
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.service, "solcontinuity-api");
  assert.equal(health.status, "ok");

  const overviewResponse = await fetch(`${baseUrl}/api/overview`);
  assert.equal(overviewResponse.status, 200);
  const overview = await overviewResponse.json();
  assert.equal(overview.project, "SolContinuity");
  assert.equal(overview.boundary, "application-layer resilience");

  const consoleResponse = await fetch(baseUrl);
  assert.equal(consoleResponse.status, 200);
  const html = await consoleResponse.text();
  assert.match(html, /<h1>SolContinuity<\/h1>/);

  console.log(JSON.stringify({
    quorum: {
      value: quorum.value,
      agreementCount: quorum.evidence.agreementCount,
      providerAgreementCount: quorum.evidence.providerAgreementCount
    },
    health: { service: health.service, status: health.status },
    overview: { project: overview.project, boundary: overview.boundary },
    consoleServed: true
  }));
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
`;

const tempRoot = await mkdtemp(join(tmpdir(), "solcontinuity-consumer-"));
try {
  const packDirectory = join(tempRoot, "pack");
  const consumerDirectory = join(tempRoot, "consumer");
  await mkdir(packDirectory, { recursive: true });
  await mkdir(consumerDirectory, { recursive: true });

  const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", packDirectory], ROOT));
  assert.ok(Array.isArray(packed) && packed.length === 1, "npm pack must return exactly one package.");
  const packageInfo = packed[0];
  const packagedPaths = packageInfo.files.map((file) => file.path);
  for (const requiredPath of [
    "dist/src/index.js",
    "dist/src/index.d.ts",
    "dist/src/api/server.js",
    "dist/src/api/server.d.ts",
    "dist/dashboard/index.html",
    "examples/resilience-manifest.json"
  ]) {
    assert.ok(packagedPaths.includes(requiredPath), `Missing packaged path: ${requiredPath}`);
  }
  assert.ok(!packagedPaths.some((path) => path.startsWith("test-results/")), "Runtime evidence must not ship in the package.");
  assert.ok(!packagedPaths.some((path) => path.includes(".env")), "Environment files must not ship in the package.");

  await writeFile(join(consumerDirectory, "package.json"), JSON.stringify({
    name: "solcontinuity-clean-room-consumer",
    private: true,
    type: "module"
  }, null, 2));

  const tarballPath = join(packDirectory, packageInfo.filename);
  run("npm", ["install", "--no-audit", "--no-fund", tarballPath], consumerDirectory);
  await writeFile(join(consumerDirectory, "consumer.mjs"), consumerSource);
  const consumerResult = JSON.parse(run("node", ["consumer.mjs"], consumerDirectory));

  const evidence = {
    schemaVersion: "1.0",
    status: "passed",
    generatedAt: new Date().toISOString(),
    package: {
      name: packageInfo.name,
      version: packageInfo.version,
      filename: packageInfo.filename,
      fileCount: packagedPaths.length,
      unpackedSize: packageInfo.unpackedSize
    },
    cleanRoom: consumerResult,
    boundary: "Automated clean-room packaging proves installability and self-host startup, not adoption by an independent human developer."
  };
  await mkdir(dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`External consumer verification passed: ${ARTIFACT_PATH}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
