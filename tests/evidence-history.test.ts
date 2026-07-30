import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSolContinuityServer } from "../src/api/server.js";

async function withEvidenceServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
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
  await writeFile(evidencePath, JSON.stringify(artifact), "utf8");

  const server = createSolContinuityServer({
    dashboardRoot,
    exampleManifestPath: manifestPath,
    evidencePaths: [evidencePath]
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await rm(root, { recursive: true, force: true });
  }
}

test("evidence history returns proof metadata without serialized transaction bytes", async () => {
  await withEvidenceServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/evidence/history`);
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      readonly records: readonly {
        readonly status: string;
        readonly transaction: { readonly signature: string | null };
      }[];
    };

    assert.equal(payload.records[0]?.status, "passed");
    assert.equal(
      payload.records[0]?.transaction.signature,
      "35hZLJzN7Bro33Ztg7nKmrUNCrKPyfkHsV7smAQTcJtFND8cEm3MmB3sbgzcQdQ9CpwEwmCMsNCqPrbFmqgXZ23q"
    );
    assert.equal(JSON.stringify(payload).includes("signed-payload-must-not-leak"), false);
    assert.equal(JSON.stringify(payload).includes("transactionBase64"), false);
  });
});

test("overview derives the live Devnet proof gate from the latest artifact", async () => {
  await withEvidenceServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/overview`);
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      readonly proofGates: { readonly liveDevnet: boolean };
      readonly latestEvidence: { readonly status: string } | null;
    };

    assert.equal(payload.proofGates.liveDevnet, true);
    assert.equal(payload.latestEvidence?.status, "passed");
  });
});
