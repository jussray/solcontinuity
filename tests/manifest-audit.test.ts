import assert from "node:assert/strict";
import test from "node:test";
import { auditManifest } from "../src/core/audit.js";
import { ManifestValidationError } from "../src/core/errors.js";
import { parseManifest } from "../src/core/manifest.js";

const validManifest = {
  schemaVersion: "1.0",
  name: "Test dApp",
  description: "A test manifest.",
  network: "devnet",
  sourceRepository: "https://example.org/source",
  license: "Apache-2.0",
  programAddresses: ["11111111111111111111111111111111"],
  rpcEndpoints: [
    { id: "a", provider: "one", url: "https://a.example.org" },
    { id: "b", provider: "two", url: "https://b.example.org" },
    { id: "c", provider: "three", url: "https://c.example.org" }
  ],
  frontend: {
    primaryUrl: "https://app.example.org",
    recoveryUrl: "https://recovery.example.org",
    selfHostingGuide: "https://docs.example.org"
  },
  dependencies: [
    { name: "optional indexer", kind: "indexer", required: false, replacement: "direct RPC" }
  ],
  verification: {
    minimumRpcAgreement: 2,
    commitment: "confirmed",
    publishEvidence: true
  }
};

test("legacy Solana manifest remains compatible and receives a clean audit", () => {
  const manifest = parseManifest(validManifest);
  const report = auditManifest(manifest, new Date("2026-07-28T12:00:00.000Z"));

  assert.equal(manifest.platform, "solana");
  assert.equal(manifest.environment, "devnet");
  assert.deepEqual(manifest.routes, manifest.rpcEndpoints);
  assert.equal(manifest.targets[0]?.kind, "program");
  assert.equal(report.score, 100);
  assert.equal(report.findings.length, 0);
  assert.equal(report.passedChecks, report.totalChecks);
});

test("platform-neutral manifest supports a non-Solana JSON-RPC application", () => {
  const manifest = parseManifest({
    schemaVersion: "1.0",
    name: "EVM continuity example",
    description: "A platform-neutral manifest using three independent JSON-RPC routes.",
    platform: "evm",
    environment: "mainnet",
    sourceRepository: "https://example.org/evm-app",
    license: "Apache-2.0",
    targets: [
      { id: "settlement-contract", kind: "contract", address: "0x0000000000000000000000000000000000000001" }
    ],
    routes: [
      { id: "a", provider: "one", url: "https://a.example.org" },
      { id: "b", provider: "two", url: "https://b.example.org" },
      { id: "c", provider: "three", url: "https://c.example.org" }
    ],
    frontend: {
      primaryUrl: "https://app.example.org",
      recoveryUrl: "https://recovery.example.org",
      selfHostingGuide: "https://docs.example.org"
    },
    dependencies: [],
    verification: {
      minimumRouteAgreement: 2,
      publishEvidence: true
    }
  });

  const report = auditManifest(manifest, new Date("2026-07-28T12:00:00.000Z"));
  assert.equal(manifest.platform, "evm");
  assert.equal(manifest.environment, "mainnet");
  assert.equal(manifest.network, "mainnet");
  assert.deepEqual(manifest.routes, manifest.rpcEndpoints);
  assert.equal(report.score, 100);
  assert.equal(report.findings.length, 0);
});

test("audit detects concentrated and irreplaceable infrastructure", () => {
  const manifest = parseManifest({
    ...validManifest,
    rpcEndpoints: [{ id: "only", provider: "single-provider", url: "https://rpc.example.org" }],
    frontend: { primaryUrl: "https://app.example.org" },
    dependencies: [{ name: "private API", kind: "api", required: true }],
    verification: { minimumRpcAgreement: 1, commitment: "confirmed", publishEvidence: false }
  });
  const report = auditManifest(manifest);

  assert.ok(report.score < 50);
  assert.ok(report.findings.some((item) => item.id === "route-provider-concentration"));
  assert.ok(report.findings.some((item) => item.id === "irreplaceable-dependencies"));
  assert.ok(report.findings.some((item) => item.id === "recovery-frontend"));
});

test("manifest rejects conflicting modern and legacy route declarations", () => {
  assert.throws(
    () => parseManifest({
      ...validManifest,
      routes: [{ id: "modern", provider: "one", url: "https://modern.example.org" }]
    }),
    (error: unknown) =>
      error instanceof ManifestValidationError &&
      error.issues.some((issue) => issue.includes("routes and rpcEndpoints cannot disagree"))
  );
});

test("invalid manifest reports precise validation issues", () => {
  assert.throws(
    () => parseManifest({ schemaVersion: "0" }),
    (error: unknown) => error instanceof ManifestValidationError && error.issues.length >= 5
  );
});
