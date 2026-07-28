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

test("valid resilient manifest receives a clean audit", () => {
  const manifest = parseManifest(validManifest);
  const report = auditManifest(manifest, new Date("2026-07-28T12:00:00.000Z"));

  assert.equal(report.score, 100);
  assert.equal(report.findings.length, 0);
  assert.equal(report.passedChecks, report.totalChecks);
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
  assert.ok(report.findings.some((item) => item.id === "rpc-provider-concentration"));
  assert.ok(report.findings.some((item) => item.id === "irreplaceable-dependencies"));
  assert.ok(report.findings.some((item) => item.id === "recovery-frontend"));
});

test("invalid manifest reports precise validation issues", () => {
  assert.throws(
    () => parseManifest({ schemaVersion: "0" }),
    (error: unknown) => error instanceof ManifestValidationError && error.issues.length >= 5
  );
});
