import { readFile } from "node:fs/promises";
import { basename } from "node:path";

interface JsonRecord {
  readonly [key: string]: unknown;
}

export interface EvidenceHistoryRecord {
  readonly sourcePath: string;
  readonly generatedAt: string | null;
  readonly status: string;
  readonly network: string | null;
  readonly manifest: string | null;
  readonly provenance: {
    readonly kind: string | null;
    readonly source: string | null;
    readonly commit: string | null;
    readonly workflowRunId: string | null;
    readonly exactHeadVerified: boolean;
  };
  readonly providerSelection: readonly JsonRecord[];
  readonly funding: JsonRecord;
  readonly transaction: JsonRecord;
  readonly assessment: JsonRecord | null;
  readonly assessmentError: string | null;
}

export interface EvidenceHistoryResult {
  readonly records: readonly EvidenceHistoryRecord[];
  readonly errors: readonly { readonly sourcePath: string; readonly error: string }[];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function publicSourcePath(sourcePath: string): string {
  return basename(sourcePath);
}

function publicReadError(error: unknown): string {
  if (error instanceof SyntaxError) {
    return "Evidence source contains invalid JSON.";
  }
  if (error instanceof Error && error.message === "Evidence artifact must be a JSON object.") {
    return error.message;
  }
  if (isRecord(error) && typeof error.code === "string") {
    return `Evidence source unavailable (${error.code}).`;
  }
  return "Evidence source unavailable.";
}

function publicRouteUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function sanitizeProviders(value: unknown): readonly JsonRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const provider = record(item);
    return {
      id: stringOrNull(provider.id),
      provider: stringOrNull(provider.provider),
      url: publicRouteUrl(provider.url)
    };
  });
}

function sanitizeObservations(value: unknown): readonly JsonRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const observation = record(item);
    return {
      endpointId: stringOrNull(observation.endpointId),
      provider: stringOrNull(observation.provider),
      ok: observation.ok === true,
      elapsedMs: numberOrNull(observation.elapsedMs),
      error: stringOrNull(observation.error)
    };
  });
}

function sanitizeArtifact(sourcePath: string, artifact: JsonRecord): EvidenceHistoryRecord {
  const provenance = record(artifact.provenance);
  const funding = record(artifact.funding);
  const transaction = record(artifact.transaction);
  const broadcast = record(transaction.broadcast);
  const broadcastEvidence = record(broadcast.evidence);
  const verification = record(transaction.verification);

  return {
    sourcePath: publicSourcePath(sourcePath),
    generatedAt: stringOrNull(artifact.generatedAt),
    status: stringOrNull(artifact.status) ?? "unknown",
    network: stringOrNull(artifact.network),
    manifest: stringOrNull(artifact.manifest),
    provenance: {
      kind: stringOrNull(provenance.kind),
      source: stringOrNull(provenance.source),
      commit: stringOrNull(provenance.commit),
      workflowRunId: stringOrNull(provenance.workflowRunId),
      exactHeadVerified: provenance.exactHeadVerified === true
    },
    providerSelection: sanitizeProviders(artifact.providerSelection),
    funding: {
      mode: stringOrNull(funding.mode),
      payer: stringOrNull(funding.payer),
      balanceLamports: numberOrNull(funding.balanceLamports)
    },
    transaction: {
      kind: stringOrNull(transaction.kind),
      memo: stringOrNull(transaction.memo),
      blockhashCommitment: stringOrNull(transaction.blockhashCommitment),
      signature: stringOrNull(verification.signature) ?? stringOrNull(broadcast.value),
      broadcast: {
        selectedEndpointIds: stringArray(broadcastEvidence.selectedEndpointIds),
        agreementCount: numberOrNull(broadcastEvidence.agreementCount),
        providerAgreementCount: numberOrNull(broadcastEvidence.providerAgreementCount),
        observations: sanitizeObservations(broadcastEvidence.observations)
      },
      verification: {
        confirmedBy: stringArray(verification.confirmedBy),
        rejectedBy: stringArray(verification.rejectedBy),
        pendingAt: stringArray(verification.pendingAt),
        commitment: stringOrNull(verification.commitment)
      }
    },
    assessment: null,
    assessmentError: null
  };
}

async function scoreArtifact(artifact: JsonRecord, analyticsUrl: string): Promise<JsonRecord> {
  const response = await fetch(new URL("/evidence/score", analyticsUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ artifact }),
    signal: AbortSignal.timeout(5_000)
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok || !isRecord(payload)) {
    throw new Error(`Evidence analytics returned HTTP ${response.status}.`);
  }
  return payload;
}

export async function loadEvidenceHistory(
  sourcePaths: readonly string[],
  options: { readonly analyticsUrl?: string; readonly limit?: number } = {}
): Promise<EvidenceHistoryResult> {
  const records: EvidenceHistoryRecord[] = [];
  const errors: { sourcePath: string; error: string }[] = [];

  for (const sourcePath of sourcePaths) {
    try {
      const artifact = JSON.parse(await readFile(sourcePath, "utf8")) as unknown;
      if (!isRecord(artifact)) {
        throw new Error("Evidence artifact must be a JSON object.");
      }
      const sanitized = sanitizeArtifact(sourcePath, artifact);
      if (!options.analyticsUrl) {
        records.push(sanitized);
        continue;
      }
      try {
        records.push({
          ...sanitized,
          assessment: await scoreArtifact(artifact, options.analyticsUrl)
        });
      } catch (error) {
        records.push({
          ...sanitized,
          assessmentError: error instanceof Error ? error.message : String(error)
        });
      }
    } catch (error) {
      errors.push({
        sourcePath: publicSourcePath(sourcePath),
        error: publicReadError(error)
      });
    }
  }

  records.sort((left, right) => (right.generatedAt ?? "").localeCompare(left.generatedAt ?? ""));
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  return { records: records.slice(0, limit), errors };
}
