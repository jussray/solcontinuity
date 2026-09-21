import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  processGitHubWebhook,
  verifyWebhookSignature,
  type GitHubAppConfig
} from "../src/github-app/app.js";

const validManifest = {
  schemaVersion: "1.0",
  name: "GitHub App Test",
  description: "A deterministic continuity manifest used to test the GitHub App adapter.",
  platform: "solana",
  environment: "devnet",
  sourceRepository: "https://github.com/example/project",
  license: "Apache-2.0",
  targets: [
    { id: "program", kind: "program", address: "11111111111111111111111111111111" }
  ],
  routes: [
    { id: "a", provider: "Provider A", url: "https://a.example.test" },
    { id: "b", provider: "Provider B", url: "https://b.example.test" },
    { id: "c", provider: "Provider C", url: "https://c.example.test" }
  ],
  frontend: {
    primaryUrl: "https://app.example.test",
    recoveryUrl: "https://recovery.example.test",
    selfHostingGuide: "https://docs.example.test/self-host"
  },
  dependencies: [],
  verification: {
    minimumRouteAgreement: 2,
    commitment: "confirmed",
    publishEvidence: true
  }
};

function testConfig(): GitHubAppConfig {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    appId: "12345",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    webhookSecret: "test-webhook-secret",
    apiBaseUrl: "https://github.test"
  };
}

test("verifyWebhookSignature accepts the matching sha256 signature and rejects tampering", () => {
  const body = Buffer.from('{"zen":"keep it bounded"}', "utf8");
  const secret = "bounded-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  assert.equal(verifyWebhookSignature(body, signature, secret), true);
  assert.equal(verifyWebhookSignature(Buffer.from("tampered", "utf8"), signature, secret), false);
  assert.equal(verifyWebhookSignature(body, "sha256=broken", secret), false);
});

test("processGitHubWebhook audits the exact head and publishes a success check", async () => {
  const config = testConfig();
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requests.push({ url, ...(init === undefined ? {} : { init }) });

    if (url.endsWith("/app/installations/42/access_tokens")) {
      return Response.json({ token: "installation-token" }, { status: 201 });
    }

    if (url.includes("/repos/example/project/contents/.solcontinuity/manifest.json?ref=head-sha-123")) {
      return Response.json({
        type: "file",
        encoding: "base64",
        content: Buffer.from(JSON.stringify(validManifest), "utf8").toString("base64")
      });
    }

    if (url.endsWith("/repos/example/project/check-runs")) {
      return Response.json({ id: 9001 }, { status: 201 });
    }

    return new Response("not found", { status: 404 });
  };

  const result = await processGitHubWebhook(config, {
    event: "pull_request",
    delivery: "delivery-123",
    payload: {
      action: "synchronize",
      installation: { id: 42 },
      repository: { full_name: "example/project" },
      pull_request: { head: { sha: "head-sha-123" } }
    }
  }, fakeFetch);

  assert.equal(result.state, "audited");
  assert.equal(result.repository, "example/project");
  assert.equal(result.headSha, "head-sha-123");
  assert.equal(result.manifestPath, ".solcontinuity/manifest.json");
  assert.equal(result.score, 100);
  assert.equal(result.conclusion, "success");
  assert.equal(result.checkRunId, 9001);
  assert.match(result.proofCookie ?? "", /^sol-gh-[a-f0-9]{24}$/);

  const checkRequest = requests.find((request) => request.url.endsWith("/check-runs"));
  assert.ok(checkRequest?.init?.body);
  const body = JSON.parse(String(checkRequest.init.body)) as {
    head_sha: string;
    conclusion: string;
    output: { summary: string };
  };
  assert.equal(body.head_sha, "head-sha-123");
  assert.equal(body.conclusion, "success");
  assert.match(body.output.summary, /Exact head: `head-sha-123`/);
  assert.match(body.output.summary, /Proof cookie: `sol-gh-/);
});

test("processGitHubWebhook publishes a neutral receipt when no manifest exists", async () => {
  const config = testConfig();

  const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/app/installations/7/access_tokens")) {
      return Response.json({ token: "installation-token" }, { status: 201 });
    }
    if (url.endsWith("/repos/example/project/check-runs")) {
      return Response.json({ id: 77 }, { status: 201 });
    }
    return new Response("not found", { status: 404 });
  };

  const result = await processGitHubWebhook(config, {
    event: "push",
    delivery: "delivery-missing",
    payload: {
      after: "push-head-sha",
      installation: { id: 7 },
      repository: { full_name: "example/project" }
    }
  }, fakeFetch);

  assert.equal(result.state, "missing-manifest");
  assert.equal(result.conclusion, "neutral");
  assert.equal(result.checkRunId, 77);
});
