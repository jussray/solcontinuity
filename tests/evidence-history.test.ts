import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadEvidenceHistory } from "../src/api/evidence-history.js";
import { createSolContinuityServer } from "../src/api/server.js";

async function withEvidenceServer(
  run: (baseUrl: string, root: string) => Promise<void>,
  mutateArtifact: (artifact: Record<string, unknown>) => void = () => undefined,
  expectedHeadSha?: string
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "solcontinuity-evidence-"));
  const dashboardRoot = join(root, "dashboard");
  const manifestPath = join(root, "manifest.json");
  const evidencePath = join(root, "evidence.json");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(dashboardRoot, { recursive: true }));
  await writeFile(join(dashboardRoot, "index.html"), "<!doctype html><title>test</title>", "utf8");
  await writeFile(
    manifestPath,
    await readFile(join(process.cwd(), "examples", "resilience-manifest.json"), "utf8"),
    "utf8"
  );
  const artifact = JSON.parse(
    await readFile(join(process.cwd(), "examples", "evidence", "live-devnet-evidence.sample.json"), "utf8")
  ) as Record<string, unknown>;
  const transaction = artifact.transaction as Record<string, unknown>;
  transaction.transactionBase64 = "signed-payload-must-not-leak";
  artifact.providerSelection = [
    {
      id: "private-route",
      provider: "Private Provider",
      url: "https://rpc.example.invalid/private-account?api-key=credential-must-not-leak"
    }
  ];
  mutateArtifact(artifact);
  await writeFile(evidencePath, JSON.stringify(artifact), "utf8");

  const server = createSolContinuityServer({
    dashboardRoot,
    exampleManifestPath: manifestPath,
    evidencePaths: [evidencePath],
    expectedHeadSha
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    await run(`http://127.0.0.1:${address.port}`, root);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await rm(root, { recursive: true, force: true });
  }
}

test("evidence history returns proof metadata without private evidence material", async () => {
  await withEvidenceServer(async (baseUrl, root) => {
    const response = await fetch(`${baseUrl}/api/evidence/history`);
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      readonly records: readonly {
        readonly sourcePath: string;
        readonly status: string;
        readonly provenance: { readonly exactHeadVerified: boolean };
        readonly providerSelection: readonly { readonly url: string | null }[];
        readonly transaction: { readonly signature: string | null };
      }[];
    };

    assert.equal(payload.records[0]?.status, "passed");
    assert.equal(payload.records[0]?.sourcePath, "evidence.json");
    assert.equal(payload.records[0]?.provenance.exactHeadVerified, false);
    assert.equal(payload.records[0]?.providerSelection[0]?.url, "https://rpc.example.invalid");
    assert.equal(
      payload.records[0]?.transaction.signature,
      "35hZLJzN7Bro33Ztg7nKmrUNCrKPyfkHsV7smAQTcJtFND8cEm3MmB3sbgzcQdQ9CpwEwmCMsNCqPrbFmqgXZ23q"
    );
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes(root), false);
    assert.equal(serialized.includes("credential-must-not-leak"), false);
    assert.equal(serialized.includes("/private-account"), false);
    assert.equal(serialized.includes("signed-payload-must-not-leak"), false);
    assert.equal(serialized.includes("transactionBase64"), false);
  });
});

test("evidence read errors redact local filesystem paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "solcontinuity-private-evidence-"));
  const missingPath = join(root, "private", "missing-evidence.json");
  try {
    const result = await loadEvidenceHistory([missingPath]);
    assert.equal(result.records.length, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]?.sourcePath, "missing-evidence.json");
    assert.match(result.errors[0]?.error ?? "", /^Evidence source unavailable/);
    assert.equal(JSON.stringify(result.errors).includes(root), false);
    assert.equal(JSON.stringify(result.errors).includes("/private/"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("overview does not promote a passed sample fixture into live Devnet proof", async () => {
  await withEvidenceServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/overview`);
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      readonly proofGates: Readonly<Record<string, boolean | null>>;
      readonly latestEvidence: { readonly status: string } | null;
    };

    assert.equal(payload.proofGates.liveDevnet, null);
    assert.equal(payload.latestEvidence?.status, "passed");

    for (const gate of [
      "strictTypeScript",
      "nodeTests",
      "pythonTests",
      "manifestRiskTests",
      "playwright",
      "automatedPackageSelfHost",
      "externalSelfHost"
    ]) {
      assert.equal(payload.proofGates[gate], null, `${gate} must stay UNKNOWN without an attached current receipt`);
    }
  });
});

test("overview verifies live Devnet only when receipt and served head match", async () => {
  await withEvidenceServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/overview`);
      assert.equal(response.status, 200);
      const payload = await response.json() as {
        readonly runtimeExpectedHead: string | null;
        readonly proofGates: Readonly<Record<string, boolean | null>>;
        readonly latestEvidence: {
          readonly provenance: {
            readonly kind: string | null;
            readonly commit: string | null;
            readonly exactHeadVerified: boolean;
          };
        } | null;
      };

      assert.equal(payload.runtimeExpectedHead, "candidate-head");
      assert.equal(payload.proofGates.liveDevnet, true);
      assert.equal(payload.latestEvidence?.provenance.kind, "live-devnet");
      assert.equal(payload.latestEvidence?.provenance.commit, "candidate-head");
      assert.equal(payload.latestEvidence?.provenance.exactHeadVerified, true);
    },
    (artifact) => {
      artifact.provenance = {
        kind: "live-devnet",
        source: "github-actions-workflow-dispatch",
        commit: "candidate-head",
        workflowRunId: "123",
        exactHeadVerified: true
      };
    },
    "candidate-head"
  );
});

test("overview invalidates an exact-head receipt generated for a stale commit", async () => {
  await withEvidenceServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/overview`);
      assert.equal(response.status, 200);
      const payload = await response.json() as {
        readonly runtimeExpectedHead: string | null;
        readonly proofGates: Readonly<Record<string, boolean | null>>;
        readonly latestEvidence: {
          readonly provenance: { readonly commit: string | null; readonly exactHeadVerified: boolean };
        } | null;
      };

      assert.equal(payload.runtimeExpectedHead, "current-head");
      assert.equal(payload.latestEvidence?.provenance.commit, "previous-head");
      assert.equal(payload.latestEvidence?.provenance.exactHeadVerified, true);
      assert.equal(payload.proofGates.liveDevnet, null);
    },
    (artifact) => {
      artifact.provenance = {
        kind: "live-devnet",
        source: "github-actions-workflow-dispatch",
        commit: "previous-head",
        workflowRunId: "122",
        exactHeadVerified: true
      };
    },
    "current-head"
  );
});
