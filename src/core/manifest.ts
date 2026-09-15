import { ManifestValidationError } from "./errors.js";
import type { ContinuityManifest, ContinuityTarget, RpcEndpointConfig } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseEndpoint(value: unknown, path: string, issues: string[]): RpcEndpointConfig | null {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object.`);
    return null;
  }

  const id = value.id;
  const url = value.url;
  if (typeof id !== "string" || id.trim() === "") {
    issues.push(`${path}.id must be a non-empty string.`);
  }
  if (!isHttpUrl(url)) {
    issues.push(`${path}.url must be an http(s) URL.`);
  }

  if (typeof id !== "string" || !isHttpUrl(url)) {
    return null;
  }

  const endpoint: {
    id: string;
    url: string;
    provider?: string;
    timeoutMs?: number;
    headers?: Readonly<Record<string, string>>;
  } = { id, url };

  if (typeof value.provider === "string" && value.provider.trim() !== "") {
    endpoint.provider = value.provider;
  }
  if (typeof value.timeoutMs === "number" && Number.isFinite(value.timeoutMs) && value.timeoutMs > 0) {
    endpoint.timeoutMs = value.timeoutMs;
  }
  if (isRecord(value.headers)) {
    const headers: Record<string, string> = {};
    for (const [key, headerValue] of Object.entries(value.headers)) {
      if (typeof headerValue === "string") {
        headers[key] = headerValue;
      }
    }
    endpoint.headers = headers;
  }

  return endpoint;
}

function parseTarget(value: unknown, path: string, issues: string[]): ContinuityTarget | null {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object.`);
    return null;
  }

  const kinds = new Set(["program", "contract", "service", "resource", "other"]);
  if (typeof value.id !== "string" || value.id.trim() === "") {
    issues.push(`${path}.id must be a non-empty string.`);
  }
  if (typeof value.kind !== "string" || !kinds.has(value.kind)) {
    issues.push(`${path}.kind must be program, contract, service, resource, or other.`);
  }
  if (value.address !== undefined && (typeof value.address !== "string" || value.address.trim() === "")) {
    issues.push(`${path}.address must be a non-empty string when present.`);
  }
  if (value.url !== undefined && !isHttpUrl(value.url)) {
    issues.push(`${path}.url must be an http(s) URL when present.`);
  }
  if (value.address === undefined && value.url === undefined) {
    issues.push(`${path} must declare address or url.`);
  }

  if (
    typeof value.id !== "string" ||
    typeof value.kind !== "string" ||
    !kinds.has(value.kind) ||
    (value.address !== undefined && typeof value.address !== "string") ||
    (value.url !== undefined && !isHttpUrl(value.url)) ||
    (value.address === undefined && value.url === undefined)
  ) {
    return null;
  }

  return {
    id: value.id,
    kind: value.kind as ContinuityTarget["kind"],
    ...(typeof value.address === "string" ? { address: value.address } : {}),
    ...(typeof value.url === "string" ? { url: value.url } : {})
  };
}

function equivalentRoutes(left: readonly RpcEndpointConfig[], right: readonly RpcEndpointConfig[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((endpoint, index) => {
    const other = right[index];
    return Boolean(
      other &&
      endpoint.id === other.id &&
      endpoint.url === other.url &&
      (endpoint.provider ?? "") === (other.provider ?? "")
    );
  });
}

export function parseManifest(value: unknown): ContinuityManifest {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new ManifestValidationError(["Manifest root must be an object."]);
  }

  if (value.schemaVersion !== "1.0") {
    issues.push('schemaVersion must equal "1.0".');
  }
  if (typeof value.name !== "string" || value.name.trim() === "") {
    issues.push("name must be a non-empty string.");
  }
  if (typeof value.description !== "string" || value.description.trim() === "") {
    issues.push("description must be a non-empty string.");
  }

  const legacySolanaShape =
    typeof value.network === "string" || Array.isArray(value.programAddresses) || Array.isArray(value.rpcEndpoints);
  const platform = typeof value.platform === "string" && value.platform.trim() !== ""
    ? value.platform.trim()
    : legacySolanaShape
      ? "solana"
      : "";
  if (!platform) {
    issues.push("platform must be a non-empty string for platform-neutral manifests.");
  }

  const environment = typeof value.environment === "string" && value.environment.trim() !== ""
    ? value.environment.trim()
    : typeof value.network === "string" && value.network.trim() !== ""
      ? value.network.trim()
      : "";
  if (!environment) {
    issues.push("environment must be a non-empty string (legacy Solana manifests may use network).");
  }

  if (!isHttpUrl(value.sourceRepository)) {
    issues.push("sourceRepository must be an http(s) URL.");
  }
  if (typeof value.license !== "string" || value.license.trim() === "") {
    issues.push("license must be a non-empty string.");
  }

  const explicitPrograms = Array.isArray(value.programAddresses)
    ? value.programAddresses.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
  if (value.programAddresses !== undefined && !Array.isArray(value.programAddresses)) {
    issues.push("programAddresses must be an array when present.");
  }

  let targets: ContinuityTarget[] = [];
  if (Array.isArray(value.targets)) {
    targets = value.targets
      .map((item, index) => parseTarget(item, `targets[${index}]`, issues))
      .filter((item): item is ContinuityTarget => item !== null);
  } else if (value.targets !== undefined) {
    issues.push("targets must be an array when present.");
  } else if (explicitPrograms.length > 0) {
    targets = explicitPrograms.map((address, index) => ({
      id: `program-${index + 1}`,
      kind: "program",
      address
    }));
  }

  const parsedRoutes = Array.isArray(value.routes)
    ? value.routes
        .map((item, index) => parseEndpoint(item, `routes[${index}]`, issues))
        .filter((item): item is RpcEndpointConfig => item !== null)
    : null;
  if (value.routes !== undefined && !Array.isArray(value.routes)) {
    issues.push("routes must be an array when present.");
  }

  const parsedLegacyRoutes = Array.isArray(value.rpcEndpoints)
    ? value.rpcEndpoints
        .map((item, index) => parseEndpoint(item, `rpcEndpoints[${index}]`, issues))
        .filter((item): item is RpcEndpointConfig => item !== null)
    : null;
  if (value.rpcEndpoints !== undefined && !Array.isArray(value.rpcEndpoints)) {
    issues.push("rpcEndpoints must be an array when present.");
  }

  if (parsedRoutes && parsedLegacyRoutes && !equivalentRoutes(parsedRoutes, parsedLegacyRoutes)) {
    issues.push("routes and rpcEndpoints cannot disagree when both are present.");
  }
  const routes = parsedRoutes ?? parsedLegacyRoutes ?? [];
  if (routes.length === 0) {
    issues.push("routes must contain at least one valid endpoint (legacy manifests may use rpcEndpoints).");
  }

  if (!isRecord(value.frontend)) {
    issues.push("frontend must be an object.");
  }
  const frontendRecord = isRecord(value.frontend) ? value.frontend : {};
  if (!isHttpUrl(frontendRecord.primaryUrl)) {
    issues.push("frontend.primaryUrl must be an http(s) URL.");
  }
  if (frontendRecord.recoveryUrl !== undefined && !isHttpUrl(frontendRecord.recoveryUrl)) {
    issues.push("frontend.recoveryUrl must be an http(s) URL when present.");
  }
  if (frontendRecord.selfHostingGuide !== undefined && !isHttpUrl(frontendRecord.selfHostingGuide)) {
    issues.push("frontend.selfHostingGuide must be an http(s) URL when present.");
  }

  const dependencies = Array.isArray(value.dependencies)
    ? value.dependencies.filter((item): item is ContinuityManifest["dependencies"][number] => {
        if (!isRecord(item)) {
          return false;
        }
        return (
          typeof item.name === "string" &&
          typeof item.kind === "string" &&
          ["rpc", "indexer", "api", "storage", "identity", "other"].includes(item.kind) &&
          typeof item.required === "boolean" &&
          (item.replacement === undefined || typeof item.replacement === "string")
        );
      })
    : [];
  if (!Array.isArray(value.dependencies)) {
    issues.push("dependencies must be an array.");
  }

  if (!isRecord(value.verification)) {
    issues.push("verification must be an object.");
  }
  const verificationRecord = isRecord(value.verification) ? value.verification : {};
  const minimumRouteAgreement = typeof verificationRecord.minimumRouteAgreement === "number"
    ? verificationRecord.minimumRouteAgreement
    : verificationRecord.minimumRpcAgreement;
  if (
    typeof minimumRouteAgreement !== "number" ||
    !Number.isInteger(minimumRouteAgreement) ||
    minimumRouteAgreement < 1
  ) {
    issues.push("verification.minimumRouteAgreement must be an integer of at least 1 (legacy manifests may use minimumRpcAgreement).");
  }
  if (
    typeof verificationRecord.minimumRouteAgreement === "number" &&
    typeof verificationRecord.minimumRpcAgreement === "number" &&
    verificationRecord.minimumRouteAgreement !== verificationRecord.minimumRpcAgreement
  ) {
    issues.push("verification.minimumRouteAgreement and minimumRpcAgreement cannot disagree.");
  }

  const commitments = new Set(["processed", "confirmed", "finalized"]);
  const commitment = verificationRecord.commitment;
  if (commitment !== undefined && (typeof commitment !== "string" || !commitments.has(commitment))) {
    issues.push("verification.commitment must be processed, confirmed, or finalized when present.");
  }
  if (platform.toLowerCase() === "solana" && commitment === undefined) {
    issues.push("verification.commitment is required for the Solana adapter.");
  }
  if (typeof verificationRecord.publishEvidence !== "boolean") {
    issues.push("verification.publishEvidence must be a boolean.");
  }

  if (issues.length > 0) {
    throw new ManifestValidationError(issues);
  }

  const programAddresses = explicitPrograms.length > 0
    ? explicitPrograms
    : targets
        .filter((target) => target.kind === "program" && typeof target.address === "string")
        .map((target) => target.address as string);

  return {
    schemaVersion: "1.0",
    name: value.name as string,
    description: value.description as string,
    platform,
    environment,
    sourceRepository: value.sourceRepository as string,
    license: value.license as string,
    targets,
    routes,
    frontend: {
      primaryUrl: frontendRecord.primaryUrl as string,
      ...(typeof frontendRecord.recoveryUrl === "string"
        ? { recoveryUrl: frontendRecord.recoveryUrl }
        : {}),
      ...(typeof frontendRecord.selfHostingGuide === "string"
        ? { selfHostingGuide: frontendRecord.selfHostingGuide }
        : {})
    },
    dependencies,
    verification: {
      minimumRouteAgreement: minimumRouteAgreement as number,
      ...(typeof commitment === "string"
        ? { commitment: commitment as NonNullable<ContinuityManifest["verification"]["commitment"]> }
        : {}),
      publishEvidence: verificationRecord.publishEvidence as boolean,
      minimumRpcAgreement: minimumRouteAgreement as number
    },
    network: typeof value.network === "string" ? value.network : environment,
    programAddresses,
    rpcEndpoints: routes
  };
}
