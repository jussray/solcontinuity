import { ManifestValidationError } from "./errors.js";
import type { DappManifest, RpcEndpointConfig } from "./types.js";

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

  if (typeof value.provider === "string") {
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

export function parseManifest(value: unknown): DappManifest {
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

  const networks = new Set(["devnet", "testnet", "mainnet-beta", "localnet"]);
  if (typeof value.network !== "string" || !networks.has(value.network)) {
    issues.push("network must be devnet, testnet, mainnet-beta, or localnet.");
  }
  if (!isHttpUrl(value.sourceRepository)) {
    issues.push("sourceRepository must be an http(s) URL.");
  }
  if (typeof value.license !== "string" || value.license.trim() === "") {
    issues.push("license must be a non-empty string.");
  }

  const programAddresses = Array.isArray(value.programAddresses)
    ? value.programAddresses.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
  if (!Array.isArray(value.programAddresses)) {
    issues.push("programAddresses must be an array.");
  }

  const rpcEndpoints = Array.isArray(value.rpcEndpoints)
    ? value.rpcEndpoints
        .map((item, index) => parseEndpoint(item, `rpcEndpoints[${index}]`, issues))
        .filter((item): item is RpcEndpointConfig => item !== null)
    : [];
  if (!Array.isArray(value.rpcEndpoints) || rpcEndpoints.length === 0) {
    issues.push("rpcEndpoints must contain at least one valid endpoint.");
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
    ? value.dependencies.filter((item): item is DappManifest["dependencies"][number] => {
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
  if (
    typeof verificationRecord.minimumRpcAgreement !== "number" ||
    !Number.isInteger(verificationRecord.minimumRpcAgreement) ||
    verificationRecord.minimumRpcAgreement < 1
  ) {
    issues.push("verification.minimumRpcAgreement must be an integer of at least 1.");
  }
  const commitments = new Set(["processed", "confirmed", "finalized"]);
  if (typeof verificationRecord.commitment !== "string" || !commitments.has(verificationRecord.commitment)) {
    issues.push("verification.commitment must be processed, confirmed, or finalized.");
  }
  if (typeof verificationRecord.publishEvidence !== "boolean") {
    issues.push("verification.publishEvidence must be a boolean.");
  }

  if (issues.length > 0) {
    throw new ManifestValidationError(issues);
  }

  return {
    schemaVersion: "1.0",
    name: value.name as string,
    description: value.description as string,
    network: value.network as DappManifest["network"],
    sourceRepository: value.sourceRepository as string,
    license: value.license as string,
    programAddresses,
    rpcEndpoints,
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
      minimumRpcAgreement: verificationRecord.minimumRpcAgreement as number,
      commitment: verificationRecord.commitment as DappManifest["verification"]["commitment"],
      publishEvidence: verificationRecord.publishEvidence as boolean
    }
  };
}
