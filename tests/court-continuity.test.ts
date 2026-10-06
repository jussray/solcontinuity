import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { createSolContinuityServer } from "../src/api/server.js";
import {
  buildCourtContinuityMarker,
  FCR_COURT_CONTINUITY_HANDOFF_KIND,
} from "../src/core/court-continuity.js";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function handoff(overrides: Record<string, unknown> = {}) {
  const headSha = "a".repeat(40);
  const core = {
    schema: FCR_COURT_CONTINUITY_HANDOFF_KIND,
    caseId: "court-case-1",
    repository: "jussray/founder-control-room",
    branch: "main",
    headSha,
    witnessReceiptFingerprint: "b".repeat(64),
    observedAt: "2026-10-06T04:00:00Z",
    expiresAt: "2026-10-06T05:00:00Z",
    authority: {
      evidenceOnly: true,
      createsTruth: false,
      createsAuthority: false,
      executionAuthorized: false,
      mergeAuthorized: false,
      deployAuthorized: false,
      publishAuthorized: false,
      credentialMutationAuthorized: false,
      providerMutationAuthorized: false,
    },
    task: "challenge freshness and lineage",
    evidenceSummary: {
      total: 1,
      admissible: 1,
      stale: 0,
      uniqueChains: 1,
      duplicateChains: 0,
      statuses: { VERIFIED: 1, INFERRED: 0, UNKNOWN: 0, BLOCKED: 0, FAIL: 0 },
    },
    witnesses: [{
      id: "repo",
      status: "VERIFIED",
      class: "repository_source",
      evidenceRef: "github:main",
      sourceFingerprint: "chain:github:main",
      observedAt: "2026-10-06T04:10:00Z",
      headSha,
      duplicateOf: null,
      stale: false,
      staleReasons: [],
    }],
    ...overrides,
  };
  return { ...core, handoffFingerprint: sha(core) };
}

test("builds a non-authorizing fresh continuity marker", () => {
  const marker = buildCourtContinuityMarker(handoff(), { checkedAt: "2026-10-06T04:30:00Z" });
  assert.equal(marker.lease_state, "FRESH");
  assert.equal(marker.continuity_state, "FRESH");
  assert.equal(marker.authority.executionAuthorized, false);
  assert.equal(marker.authority.createsTruth, false);
  assert.match(marker.continuity_fingerprint, /^[0-9a-f]{64}$/);
});

test("expired handoff is challenged rather than promoted", () => {
  const marker = buildCourtContinuityMarker(handoff(), { checkedAt: "2026-10-06T06:00:00Z" });
  assert.equal(marker.lease_state, "EXPIRED");
  assert.equal(marker.continuity_state, "CHALLENGE");
  assert.ok(marker.drift_reasons.includes("handoff-lease-expired"));
});

test("tampered handoff fingerprint is rejected", () => {
  assert.throws(
    () => buildCourtContinuityMarker({ ...handoff(), branch: "other" }),
    /handoff fingerprint mismatch/,
  );
});

test("widened authority is rejected", () => {
  const source = handoff();
  assert.throws(
    () => buildCourtContinuityMarker({
      ...source,
      authority: { ...(source.authority as Record<string, unknown>), executionAuthorized: true },
    }),
    /authority.executionAuthorized widened or missing/,
  );
});

test("protected API accepts exact handoff and keeps authority at none", async () => {
  const root = await mkdtemp(join(tmpdir(), "sol-court-api-"));
  await writeFile(join(root, "index.html"), "<h1>SolContinuity</h1>", "utf8");
  const manifestPath = join(root, "manifest.json");
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: "1.0",
    name: "Court API Test",
    description: "Court adapter test",
    network: "devnet",
    sourceRepository: "https://github.com/jussray/solcontinuity",
    license: "Apache-2.0",
    programAddresses: ["11111111111111111111111111111111"],
    rpcEndpoints: [
      { id: "a", provider: "a", url: "https://a.example.org" },
      { id: "b", provider: "b", url: "https://b.example.org" },
    ],
    frontend: {
      primaryUrl: "https://app.example.org",
      recoveryUrl: "https://recovery.example.org",
      selfHostingGuide: "https://docs.example.org/self-host",
    },
    dependencies: [],
    verification: { minimumRpcAgreement: 2, commitment: "confirmed", publishEvidence: true },
  }), "utf8");

  const server = createSolContinuityServer({
    dashboardRoot: root,
    exampleManifestPath: manifestPath,
    courtBridgeToken: "court-bridge-token",
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server port unavailable");

  try {
    const base = `http://127.0.0.1:${address.port}`;
    const unauthorized = await fetch(`${base}/api/court/continuity`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(handoff()),
    });
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${base}/api/court/continuity`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer court-bridge-token",
      },
      body: JSON.stringify(handoff()),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      service: string;
      marker: { authority: { executionAuthorized: boolean } };
    };
    assert.equal(body.service, "solcontinuity-api");
    assert.equal(body.marker.authority.executionAuthorized, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});


test("stale witnesses do not inflate admissible unique-chain count", () => {
  const source = handoff();
  const stale = {
    id: "old-pr",
    status: "INFERRED",
    class: "repository_source",
    evidenceRef: "github:old-pr",
    sourceFingerprint: "chain:github:old-pr",
    observedAt: "2026-10-06T04:11:00Z",
    headSha: "c".repeat(40),
    duplicateOf: null,
    stale: true,
    staleReasons: ["head-sha-mismatch"],
  };
  const core = {
    ...source,
    evidenceSummary: {
      ...(source.evidenceSummary as Record<string, unknown>),
      total: 2,
      admissible: 1,
      stale: 1,
      uniqueChains: 1,
      duplicateChains: 0,
    },
    witnesses: [...(source.witnesses as unknown[]), stale],
  };
  const { handoffFingerprint: _ignored, ...withoutFingerprint } = core;
  const candidate = { ...withoutFingerprint, handoffFingerprint: sha(withoutFingerprint) };
  const marker = buildCourtContinuityMarker(candidate, { checkedAt: "2026-10-06T04:30:00Z" });
  assert.equal(marker.unique_evidence_chain_count, 1);
  assert.equal(marker.continuity_state, "CHALLENGE");
  assert.deepEqual(marker.stale_witness_ids, ["old-pr"]);
});
