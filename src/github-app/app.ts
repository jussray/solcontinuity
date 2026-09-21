import { createHash, createHmac, createSign, timingSafeEqual } from "node:crypto";
import { auditManifest } from "../core/audit.js";
import { ManifestValidationError } from "../core/errors.js";
import { parseManifest } from "../core/manifest.js";
import type { ManifestAuditReport } from "../core/types.js";

const GITHUB_API_VERSION = "2026-03-10";

export const DEFAULT_MANIFEST_PATHS = [
  ".solcontinuity/manifest.json",
  "solcontinuity.manifest.json",
  "continuity-manifest.json"
] as const;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface GitHubAppConfig {
  readonly appId: string;
  readonly privateKey: string;
  readonly webhookSecret: string;
  readonly apiBaseUrl?: string;
  readonly manifestPaths?: readonly string[];
}

export interface GitHubWebhookResult {
  readonly state: "ignored" | "audited" | "missing-manifest" | "invalid-manifest";
  readonly repository?: string;
  readonly headSha?: string;
  readonly manifestPath?: string;
  readonly score?: number;
  readonly conclusion?: "success" | "failure" | "neutral";
  readonly proofCookie?: string;
  readonly checkRunId?: number;
}

interface WebhookTarget {
  readonly installationId: number;
  readonly repository: string;
  readonly headSha: string;
}

interface GitHubContentResponse {
  readonly type?: unknown;
  readonly encoding?: unknown;
  readonly content?: unknown;
}

interface InstallationTokenResponse {
  readonly token?: unknown;
}

interface CheckRunResponse {
  readonly id?: unknown;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function stringField(record: Readonly<Record<string, unknown>> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(record: Readonly<Record<string, unknown>> | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function normalizePrivateKey(value: string): string {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function createGitHubAppJwt(appId: string, privateKey: string, now = Math.floor(Date.now() / 1000)): string {
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    iat: now - 60,
    exp: now + 540,
    iss: appId
  });
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(normalizePrivateKey(privateKey)).toString("base64url");
  return `${unsigned}.${signature}`;
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature) {
    return false;
  }
  const match = /^sha256=([a-f0-9]{64})$/i.exec(signature);
  if (!match?.[1]) {
    return false;
  }
  const actual = Buffer.from(match[1], "hex");
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

function webhookTarget(event: string, payload: unknown): WebhookTarget | null {
  const root = asRecord(payload);
  const repository = stringField(asRecord(root?.repository), "full_name");
  const installationId = numberField(asRecord(root?.installation), "id");
  if (!repository || installationId === null) {
    return null;
  }

  if (event === "push") {
    const headSha = stringField(root, "after");
    return headSha && !/^0+$/.test(headSha) ? { installationId, repository, headSha } : null;
  }

  if (event === "pull_request") {
    const action = stringField(root, "action");
    if (!action || !new Set(["opened", "reopened", "synchronize", "ready_for_review"]).has(action)) {
      return null;
    }
    const pullRequest = asRecord(root?.pull_request);
    const headSha = stringField(asRecord(pullRequest?.head), "sha");
    return headSha ? { installationId, repository, headSha } : null;
  }

  return null;
}

function endpoint(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}${path}`;
}

async function readErrorBody(response: Response): Promise<string> {
  return (await response.text().catch(() => "")).slice(0, 1_000);
}

async function installationToken(
  config: GitHubAppConfig,
  installationId: number,
  fetchImpl: FetchLike
): Promise<string> {
  const apiBaseUrl = config.apiBaseUrl ?? "https://api.github.com";
  const response = await fetchImpl(endpoint(apiBaseUrl, `/app/installations/${installationId}/access_tokens`), {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${createGitHubAppJwt(config.appId, config.privateKey)}`,
      "x-github-api-version": GITHUB_API_VERSION
    }
  });
  if (!response.ok) {
    throw new Error(`GitHub installation token request failed (${response.status}): ${await readErrorBody(response)}`);
  }
  const body = await response.json() as InstallationTokenResponse;
  if (typeof body.token !== "string" || body.token.length === 0) {
    throw new Error("GitHub installation token response did not include a token.");
  }
  return body.token;
}

function encodeRepository(repository: string): string {
  return repository.split("/").map(encodeURIComponent).join("/");
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function readManifest(
  config: GitHubAppConfig,
  installationAccessToken: string,
  repository: string,
  headSha: string,
  fetchImpl: FetchLike
): Promise<{ readonly path: string; readonly raw: string } | null> {
  const apiBaseUrl = config.apiBaseUrl ?? "https://api.github.com";
  const paths = config.manifestPaths ?? DEFAULT_MANIFEST_PATHS;
  for (const path of paths) {
    const response = await fetchImpl(endpoint(
      apiBaseUrl,
      `/repos/${encodeRepository(repository)}/contents/${encodePath(path)}?ref=${encodeURIComponent(headSha)}`
    ), {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${installationAccessToken}`,
        "x-github-api-version": GITHUB_API_VERSION
      }
    });
    if (response.status === 404) {
      continue;
    }
    if (!response.ok) {
      throw new Error(`GitHub manifest read failed (${response.status}): ${await readErrorBody(response)}`);
    }
    const body = await response.json() as GitHubContentResponse;
    if (body.type !== "file" || body.encoding !== "base64" || typeof body.content !== "string") {
      throw new Error(`GitHub manifest response for ${path} was not a base64 file.`);
    }
    return {
      path,
      raw: Buffer.from(body.content.replace(/\s/g, ""), "base64").toString("utf8")
    };
  }
  return null;
}

function proofCookie(
  delivery: string,
  event: string,
  repository: string,
  headSha: string,
  manifestPath: string | null,
  score: number | null
): string {
  const digest = createHash("sha256")
    .update([delivery, event, repository, headSha, manifestPath ?? "none", score?.toString() ?? "na"].join("\n"))
    .digest("hex");
  return `sol-gh-${digest.slice(0, 24)}`;
}

function auditConclusion(report: ManifestAuditReport): "success" | "failure" {
  return report.findings.some((finding) => finding.severity === "critical" || finding.severity === "high")
    ? "failure"
    : "success";
}

function auditText(report: ManifestAuditReport): string {
  if (report.findings.length === 0) {
    return "No continuity findings.";
  }
  return report.findings
    .map((finding) => `- **${finding.severity.toUpperCase()} · ${finding.title}**\n  - Evidence: ${finding.evidence}\n  - Repair: ${finding.recommendation}`)
    .join("\n")
    .slice(0, 60_000);
}

async function publishCheck(
  config: GitHubAppConfig,
  installationAccessToken: string,
  repository: string,
  headSha: string,
  input: {
    readonly title: string;
    readonly summary: string;
    readonly text?: string;
    readonly conclusion: "success" | "failure" | "neutral";
  },
  fetchImpl: FetchLike
): Promise<number | undefined> {
  const apiBaseUrl = config.apiBaseUrl ?? "https://api.github.com";
  const output: { title: string; summary: string; text?: string } = {
    title: input.title,
    summary: input.summary
  };
  if (input.text) {
    output.text = input.text;
  }
  const response = await fetchImpl(endpoint(apiBaseUrl, `/repos/${encodeRepository(repository)}/check-runs`), {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${installationAccessToken}`,
      "content-type": "application/json",
      "x-github-api-version": GITHUB_API_VERSION
    },
    body: JSON.stringify({
      name: "Sol Continuity",
      head_sha: headSha,
      status: "completed",
      conclusion: input.conclusion,
      output
    })
  });
  if (!response.ok) {
    throw new Error(`GitHub check-run publication failed (${response.status}): ${await readErrorBody(response)}`);
  }
  const body = await response.json() as CheckRunResponse;
  return typeof body.id === "number" ? body.id : undefined;
}

export async function processGitHubWebhook(
  config: GitHubAppConfig,
  input: {
    readonly event: string;
    readonly delivery: string;
    readonly payload: unknown;
  },
  fetchImpl: FetchLike = fetch
): Promise<GitHubWebhookResult> {
  const target = webhookTarget(input.event, input.payload);
  if (!target) {
    return { state: "ignored" };
  }

  const token = await installationToken(config, target.installationId, fetchImpl);
  const manifest = await readManifest(config, token, target.repository, target.headSha, fetchImpl);
  if (!manifest) {
    const cookie = proofCookie(input.delivery, input.event, target.repository, target.headSha, null, null);
    const checkRunId = await publishCheck(config, token, target.repository, target.headSha, {
      title: "Sol Continuity manifest not found",
      summary: `No manifest was found at ${[...(config.manifestPaths ?? DEFAULT_MANIFEST_PATHS)].join(", ")}.\n\nExact head: \`${target.headSha}\`\nProof cookie: \`${cookie}\``,
      conclusion: "neutral"
    }, fetchImpl);
    return {
      state: "missing-manifest",
      repository: target.repository,
      headSha: target.headSha,
      conclusion: "neutral",
      proofCookie: cookie,
      ...(checkRunId === undefined ? {} : { checkRunId })
    };
  }

  let report: ManifestAuditReport;
  try {
    report = auditManifest(parseManifest(JSON.parse(manifest.raw) as unknown));
  } catch (error) {
    const cookie = proofCookie(input.delivery, input.event, target.repository, target.headSha, manifest.path, null);
    const detail = error instanceof ManifestValidationError
      ? error.issues.map((issue) => `- ${issue}`).join("\n").slice(0, 60_000)
      : error instanceof SyntaxError
        ? "Manifest file is not valid JSON."
        : "Manifest JSON was readable but could not be audited.";
    const checkRunId = await publishCheck(config, token, target.repository, target.headSha, {
      title: "Sol Continuity manifest is invalid",
      summary: `Manifest: \`${manifest.path}\`\nExact head: \`${target.headSha}\`\nProof cookie: \`${cookie}\``,
      text: detail,
      conclusion: "failure"
    }, fetchImpl);
    return {
      state: "invalid-manifest",
      repository: target.repository,
      headSha: target.headSha,
      manifestPath: manifest.path,
      conclusion: "failure",
      proofCookie: cookie,
      ...(checkRunId === undefined ? {} : { checkRunId })
    };
  }

  const conclusion = auditConclusion(report);
  const cookie = proofCookie(input.delivery, input.event, target.repository, target.headSha, manifest.path, report.score);
  const checkRunId = await publishCheck(config, token, target.repository, target.headSha, {
    title: `Sol Continuity score: ${report.score}/100`,
    summary: `Manifest: \`${manifest.path}\`\nChecks: ${report.passedChecks}/${report.totalChecks} passed\nExact head: \`${target.headSha}\`\nProof cookie: \`${cookie}\``,
    text: auditText(report),
    conclusion
  }, fetchImpl);

  return {
    state: "audited",
    repository: target.repository,
    headSha: target.headSha,
    manifestPath: manifest.path,
    score: report.score,
    conclusion,
    proofCookie: cookie,
    ...(checkRunId === undefined ? {} : { checkRunId })
  };
}
