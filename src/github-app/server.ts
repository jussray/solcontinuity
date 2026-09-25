import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { processGitHubWebhook, verifyWebhookSignature, type GitHubAppConfig } from "./app.js";
import { FingerprintRateLimiter } from "../api/security.js";

const MAX_WEBHOOK_BYTES = 1_000_000;
const DELIVERY_TTL_MS = 10 * 60 * 1000;
const MAX_TRACKED_DELIVERIES = 2_000;
const WEBHOOK_RATE_LIMIT_CAPACITY = 120;
const WEBHOOK_RATE_LIMIT_REFILL_PER_SECOND = 2;
const REQUIRED_GITHUB_APP_ENV = [
  "SOLCONTINUITY_GITHUB_APP_ID",
  "SOLCONTINUITY_GITHUB_PRIVATE_KEY",
  "SOLCONTINUITY_GITHUB_WEBHOOK_SECRET"
] as const;

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_WEBHOOK_BYTES) {
      throw new Error("GitHub webhook body exceeds 1 MB.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function missingGitHubAppEnvironment(): string[] {
  return REQUIRED_GITHUB_APP_ENV.filter((name) => !process.env[name]?.trim());
}

export function githubAppConfigFromEnv(): GitHubAppConfig {
  const manifestPaths = process.env.SOLCONTINUITY_GITHUB_MANIFEST_PATHS
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const apiBaseUrl = process.env.SOLCONTINUITY_GITHUB_API_URL?.trim();
  return {
    appId: requiredEnv("SOLCONTINUITY_GITHUB_APP_ID"),
    privateKey: requiredEnv("SOLCONTINUITY_GITHUB_PRIVATE_KEY"),
    webhookSecret: requiredEnv("SOLCONTINUITY_GITHUB_WEBHOOK_SECRET"),
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
    ...(manifestPaths && manifestPaths.length > 0 ? { manifestPaths } : {})
  };
}

export function createGitHubAppBootstrapServer(missingEnvironmentVariables: string[]) {
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, {
        service: "solcontinuity-github-app",
        status: "registration-required",
        ready: false,
        missingEnvironmentVariables,
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/github/webhook") {
      json(response, 503, { error: "GITHUB_APP_NOT_CONFIGURED" });
      return;
    }

    json(response, 404, { error: "NOT_FOUND" });
  });
}

export function createGitHubAppServer(config: GitHubAppConfig) {
  const deliveries = new Map<string, number>();
  const rateLimiter = new FingerprintRateLimiter(WEBHOOK_RATE_LIMIT_CAPACITY, WEBHOOK_RATE_LIMIT_REFILL_PER_SECOND);

  function pruneDeliveries(now: number): void {
    for (const [delivery, seenAt] of deliveries) {
      if (now - seenAt > DELIVERY_TTL_MS) {
        deliveries.delete(delivery);
      }
    }
    while (deliveries.size > MAX_TRACKED_DELIVERIES) {
      const first = deliveries.keys().next().value as string | undefined;
      if (!first) {
        break;
      }
      deliveries.delete(first);
    }
  }

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, {
        service: "solcontinuity-github-app",
        status: "ok",
        ready: true,
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (request.method !== "POST" || url.pathname !== "/github/webhook") {
      json(response, 404, { error: "NOT_FOUND" });
      return;
    }

    const remoteAddress = request.socket.remoteAddress ?? "unknown";
    const rateLimit = rateLimiter.consume(remoteAddress);
    if (!rateLimit.allowed) {
      response.setHeader("retry-after", String(rateLimit.retryAfterSeconds ?? 1));
      json(response, 429, { error: "RATE_LIMITED", retryAfterSeconds: rateLimit.retryAfterSeconds });
      return;
    }

    try {
      const rawBody = await readBody(request);
      const signature = request.headers["x-hub-signature-256"];
      if (typeof signature !== "string" || !verifyWebhookSignature(rawBody, signature, config.webhookSecret)) {
        json(response, 401, { error: "INVALID_WEBHOOK_SIGNATURE" });
        return;
      }

      const event = request.headers["x-github-event"];
      const delivery = request.headers["x-github-delivery"];
      if (typeof event !== "string" || typeof delivery !== "string" || delivery.length === 0) {
        json(response, 400, { error: "MISSING_GITHUB_HEADERS" });
        return;
      }

      const now = Date.now();
      pruneDeliveries(now);
      if (deliveries.has(delivery)) {
        json(response, 202, { state: "duplicate", delivery });
        return;
      }
      deliveries.set(delivery, now);

      const payload = JSON.parse(rawBody.toString("utf8")) as unknown;
      const result = await processGitHubWebhook(config, { event, delivery, payload });
      json(response, 202, result);
    } catch (error) {
      if (error instanceof SyntaxError) {
        json(response, 400, { error: "INVALID_JSON" });
        return;
      }
      console.error(`SolContinuity GitHub App error: ${error instanceof Error ? error.message : "UnknownError"}`);
      json(response, 500, { error: "GITHUB_APP_FAILURE" });
    }
  });
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 4174);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const missingEnvironmentVariables = missingGitHubAppEnvironment();
  const server = missingEnvironmentVariables.length > 0
    ? createGitHubAppBootstrapServer(missingEnvironmentVariables)
    : createGitHubAppServer(githubAppConfigFromEnv());

  server.listen(port, "0.0.0.0", () => {
    const mode = missingEnvironmentVariables.length > 0 ? "registration-required" : "ready";
    console.log(`SolContinuity GitHub App listening on port ${port} (${mode})`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "UnknownError");
    process.exitCode = 1;
  });
}
