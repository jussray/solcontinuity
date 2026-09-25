import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditManifest } from "../core/audit.js";
import { ManifestValidationError } from "../core/errors.js";
import { parseManifest } from "../core/manifest.js";
import { loadEvidenceHistory } from "./evidence-history.js";
import {
  FingerprintRateLimiter,
  clearSessionCookie,
  computeFingerprint,
  createSessionCookie,
  hasValidSession,
  parseCookies,
  resolveDeviceIdentity,
  timingSafeTokenEqual
} from "./security.js";

export interface SolContinuityServerOptions {
  readonly dashboardRoot?: string;
  readonly exampleManifestPath?: string;
  readonly analyticsUrl?: string;
  readonly evidencePaths?: readonly string[];
  readonly expectedHeadSha?: string | undefined;
  readonly consoleToken?: string | undefined;
  readonly cookieSecret?: string;
  readonly secureCookies?: boolean;
  readonly rateLimit?: { readonly capacity: number; readonly refillPerSecond: number };
}

const UNAUTHENTICATED_PATHS = new Set(["/api/health", "/api/session/login", "/api/session/logout"]);
const EXPENSIVE_REQUEST_COST = 4;
const LOGIN_ATTEMPT_COST = 8;

const contentTypes: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function json(response: ServerResponse, status: number, body: unknown, setCookies: readonly string[] = []): void {
  const headers: Record<string, string | string[]> = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
  if (setCookies.length > 0) {
    headers["set-cookie"] = [...setCookies];
  }
  if (status === 204) {
    response.writeHead(status, headers);
    response.end();
    return;
  }
  headers["content-type"] = "application/json; charset=utf-8";
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage, maxBytes = 256_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) {
      throw new Error("Request body exceeds 256 KB.");
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length > 0 ? (JSON.parse(raw) as unknown) : {};
}

function safeStaticPath(root: string, pathname: string): string | null {
  const normalized = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^[/\\]+/, "");
  const candidate = resolve(root, normalized);
  const resolvedRoot = resolve(root);
  return candidate === resolvedRoot || candidate.startsWith(`${resolvedRoot}/`) ? candidate : null;
}

async function loadExampleManifest(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export function createSolContinuityServer(options: SolContinuityServerOptions = {}) {
  const moduleDirectory = fileURLToPath(new URL(".", import.meta.url));
  const projectRoot = resolve(moduleDirectory, "../../..");
  const dashboardRoot = options.dashboardRoot ?? join(projectRoot, "dist", "dashboard");
  const exampleManifestPath = options.exampleManifestPath ?? join(projectRoot, "examples", "resilience-manifest.json");
  const analyticsUrl = options.analyticsUrl ?? process.env.SOLCONTINUITY_ANALYTICS_URL;
  const expectedHeadSha = (
    options.expectedHeadSha ??
    process.env.SOLCONTINUITY_EXPECTED_HEAD_SHA?.trim() ??
    process.env.EXPECTED_HEAD_SHA?.trim() ??
    ""
  ).trim() || null;
  const envEvidencePaths = process.env.SOLCONTINUITY_EVIDENCE_PATHS
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => resolve(projectRoot, item));
  const evidencePaths = options.evidencePaths ?? (
    envEvidencePaths && envEvidencePaths.length > 0
      ? envEvidencePaths
      : [join(projectRoot, "test-results", "live-devnet-evidence.json")]
  );
  const historyOptions = (limit: number) => analyticsUrl
    ? { analyticsUrl, limit }
    : { limit };
  const consoleToken = (options.consoleToken ?? process.env.SOLCONTINUITY_CONSOLE_TOKEN?.trim() ?? "").trim() || null;
  const cookieSecret = options.cookieSecret ?? process.env.SOLCONTINUITY_COOKIE_SECRET?.trim() ?? randomBytes(32).toString("hex");
  const secureCookies = options.secureCookies ?? process.env.SOLCONTINUITY_COOKIE_SECURE === "1";
  const rateLimiter = new FingerprintRateLimiter(
    options.rateLimit?.capacity ?? 60,
    options.rateLimit?.refillPerSecond ?? 1
  );

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const cookies = parseCookies(request.headers.cookie);
    const identity = resolveDeviceIdentity(cookies, cookieSecret, secureCookies);
    const setCookies: string[] = identity.setCookie ? [identity.setCookie] : [];
    const remoteAddress = request.socket.remoteAddress ?? "unknown";
    const fingerprint = computeFingerprint(identity.deviceId, remoteAddress, request.headers["user-agent"]);

    try {
      const isExpensive = request.method === "POST" && (url.pathname === "/api/audit" || url.pathname === "/api/provider-score");
      const isLoginAttempt = request.method === "POST" && url.pathname === "/api/session/login";
      const requestCost = isLoginAttempt ? LOGIN_ATTEMPT_COST : isExpensive ? EXPENSIVE_REQUEST_COST : 1;
      const rateLimit = rateLimiter.consume(fingerprint, requestCost);
      if (!rateLimit.allowed) {
        response.setHeader("retry-after", String(rateLimit.retryAfterSeconds ?? 1));
        json(response, 429, {
          error: "RATE_LIMITED",
          message: "Too many requests from this client.",
          retryAfterSeconds: rateLimit.retryAfterSeconds
        }, setCookies);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/session/login") {
        if (!consoleToken) {
          json(response, 503, { error: "AUTH_NOT_CONFIGURED" }, setCookies);
          return;
        }
        const payload = await readJson(request);
        const provided = typeof payload === "object" && payload !== null && "token" in payload
          ? (payload as { token: unknown }).token
          : null;
        if (typeof provided !== "string" || !timingSafeTokenEqual(provided, consoleToken)) {
          json(response, 401, { error: "INVALID_TOKEN" }, setCookies);
          return;
        }
        json(response, 204, null, [...setCookies, createSessionCookie(cookieSecret, secureCookies)]);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/session/logout") {
        json(response, 204, null, [...setCookies, clearSessionCookie(secureCookies)]);
        return;
      }

      if (consoleToken && url.pathname.startsWith("/api/") && !UNAUTHENTICATED_PATHS.has(url.pathname)) {
        if (!hasValidSession(cookies, cookieSecret)) {
          json(response, 401, { error: "AUTHENTICATION_REQUIRED" }, setCookies);
          return;
        }
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        json(response, 200, {
          service: "solcontinuity-api",
          status: "ok",
          analyticsConfigured: Boolean(analyticsUrl),
          evidenceSources: evidencePaths.length,
          runtimeHeadBound: Boolean(expectedHeadSha),
          authRequired: Boolean(consoleToken),
          timestamp: new Date().toISOString()
        }, setCookies);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/overview") {
        const manifest = parseManifest(await loadExampleManifest(exampleManifestPath));
        const report = auditManifest(manifest);
        const evidence = await loadEvidenceHistory(evidencePaths, historyOptions(1));
        const latestEvidence = evidence.records[0] ?? null;
        const liveDevnetVerified = Boolean(
          expectedHeadSha &&
          latestEvidence?.status === "passed" &&
          latestEvidence.provenance.kind === "live-devnet" &&
          latestEvidence.provenance.exactHeadVerified &&
          latestEvidence.provenance.commit === expectedHeadSha
        );
        json(response, 200, {
          project: "SolContinuity",
          boundary: "application-layer continuity",
          manifest: manifest.name,
          audit: report,
          analyticsConfigured: Boolean(analyticsUrl),
          runtimeExpectedHead: expectedHeadSha,
          latestEvidence,
          evidenceErrors: evidence.errors,
          proofGates: {
            strictTypeScript: null,
            nodeTests: null,
            pythonTests: null,
            manifestRiskTests: null,
            playwright: null,
            automatedPackageSelfHost: null,
            liveDevnet: liveDevnetVerified ? true : null,
            externalSelfHost: null
          }
        }, setCookies);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/evidence/history") {
        const rawLimit = url.searchParams.get("limit");
        const limit = rawLimit === null ? 20 : Number(rawLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          json(response, 400, {
            error: "INVALID_LIMIT",
            message: "limit must be an integer between 1 and 100."
          }, setCookies);
          return;
        }
        json(response, 200, await loadEvidenceHistory(evidencePaths, historyOptions(limit)), setCookies);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/audit") {
        const manifest = parseManifest(await readJson(request));
        json(response, 200, auditManifest(manifest), setCookies);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/provider-score") {
        if (!analyticsUrl) {
          json(response, 503, {
            error: "ANALYTICS_NOT_CONFIGURED",
            message: "Set SOLCONTINUITY_ANALYTICS_URL to enable provider scoring."
          }, setCookies);
          return;
        }
        const payload = await readJson(request);
        const upstream = await fetch(new URL("/score", analyticsUrl), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5_000)
        });
        const body = (await upstream.json()) as unknown;
        json(response, upstream.status, body, setCookies);
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        json(response, 405, { error: "METHOD_NOT_ALLOWED" }, setCookies);
        return;
      }

      const filePath = safeStaticPath(dashboardRoot, url.pathname);
      if (!filePath) {
        json(response, 400, { error: "INVALID_PATH" }, setCookies);
        return;
      }
      const metadata = await stat(filePath).catch(() => null);
      if (!metadata?.isFile()) {
        json(response, 404, { error: "NOT_FOUND" }, setCookies);
        return;
      }
      const body = await readFile(filePath);
      const staticHeaders: Record<string, string | string[]> = {
        "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
        "content-security-policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self' http://127.0.0.1:8001; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY"
      };
      if (setCookies.length > 0) {
        staticHeaders["set-cookie"] = setCookies;
      }
      response.writeHead(200, staticHeaders);
      if (request.method === "HEAD") {
        response.end();
      } else {
        response.end(body);
      }
    } catch (error) {
      if (error instanceof ManifestValidationError) {
        json(response, 400, { error: error.code, issues: error.issues }, setCookies);
        return;
      }
      if (error instanceof SyntaxError) {
        json(response, 400, { error: "INVALID_JSON", message: error.message }, setCookies);
        return;
      }
      console.error(`SolContinuity internal error: ${error instanceof Error ? error.name : "UnknownError"}`);
      json(response, 500, {
        error: "INTERNAL_ERROR",
        message: "Internal service failure."
      }, setCookies);
    }
  });
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 4173);
  const server = createSolContinuityServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`SolContinuity console: http://127.0.0.1:${port}`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.name : "UnknownError");
    process.exitCode = 1;
  });
}
