import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditManifest } from "../core/audit.js";
import { ManifestValidationError } from "../core/errors.js";
import { parseManifest } from "../core/manifest.js";
import { loadEvidenceHistory } from "./evidence-history.js";

export interface SolContinuityServerOptions {
  readonly dashboardRoot?: string;
  readonly exampleManifestPath?: string;
  readonly analyticsUrl?: string;
  readonly evidencePaths?: readonly string[];
}

const contentTypes: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
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

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        json(response, 200, {
          service: "solcontinuity-api",
          status: "ok",
          analyticsConfigured: Boolean(analyticsUrl),
          evidenceSources: evidencePaths.length,
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/overview") {
        const manifest = parseManifest(await loadExampleManifest(exampleManifestPath));
        const report = auditManifest(manifest);
        const evidence = await loadEvidenceHistory(evidencePaths, historyOptions(1));
        const latestEvidence = evidence.records[0] ?? null;
        json(response, 200, {
          project: "SolContinuity",
          boundary: "application-layer resilience",
          manifest: manifest.name,
          audit: report,
          analyticsConfigured: Boolean(analyticsUrl),
          latestEvidence,
          evidenceErrors: evidence.errors,
          proofGates: {
            strictTypeScript: true,
            nodeTests: true,
            pythonTests: true,
            playwright: true,
            liveDevnet: latestEvidence?.status === "passed",
            externalSelfHost: false
          }
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/evidence/history") {
        const rawLimit = url.searchParams.get("limit");
        const limit = rawLimit === null ? 20 : Number(rawLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          json(response, 400, {
            error: "INVALID_LIMIT",
            message: "limit must be an integer between 1 and 100."
          });
          return;
        }
        json(response, 200, await loadEvidenceHistory(evidencePaths, historyOptions(limit)));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/audit") {
        const manifest = parseManifest(await readJson(request));
        json(response, 200, auditManifest(manifest));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/provider-score") {
        if (!analyticsUrl) {
          json(response, 503, {
            error: "ANALYTICS_NOT_CONFIGURED",
            message: "Set SOLCONTINUITY_ANALYTICS_URL to enable provider scoring."
          });
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
        json(response, upstream.status, body);
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        json(response, 405, { error: "METHOD_NOT_ALLOWED" });
        return;
      }

      const filePath = safeStaticPath(dashboardRoot, url.pathname);
      if (!filePath) {
        json(response, 400, { error: "INVALID_PATH" });
        return;
      }
      const metadata = await stat(filePath).catch(() => null);
      if (!metadata?.isFile()) {
        json(response, 404, { error: "NOT_FOUND" });
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
        "content-security-policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self' http://127.0.0.1:8001; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY"
      });
      if (request.method === "HEAD") {
        response.end();
      } else {
        response.end(body);
      }
    } catch (error) {
      if (error instanceof ManifestValidationError) {
        json(response, 400, { error: error.code, issues: error.issues });
        return;
      }
      if (error instanceof SyntaxError) {
        json(response, 400, { error: "INVALID_JSON", message: error.message });
        return;
      }
      json(response, 500, {
        error: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error)
      });
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
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
