import { createHash } from "node:crypto";

export const FCR_COURT_CONTINUITY_HANDOFF_KIND = "juss/sol-court-continuity-handoff@v1";
export const SOL_COURT_CONTINUITY_MARKER_KIND = "sol/court-continuity@v1";

const FULL_SHA = /^[0-9a-f]{40}$/i;
const HASH = /^[0-9a-f]{64}$/i;

type JsonRecord = Record<string, unknown>;

export interface CourtContinuityAuthority {
  evidenceOnly: true;
  createsTruth: false;
  createsAuthority: false;
  executionAuthorized: false;
  mergeAuthorized: false;
  deployAuthorized: false;
  publishAuthorized: false;
  credentialMutationAuthorized: false;
  providerMutationAuthorized: false;
}

export interface CourtContinuityMarker {
  version: 1;
  kind: typeof SOL_COURT_CONTINUITY_MARKER_KIND;
  source_handoff_fingerprint: string;
  witness_receipt_fingerprint: string;
  repository: string;
  branch: string;
  head_sha: string;
  observed_at: string;
  expires_at: string;
  lease_state: "FRESH" | "EXPIRED";
  continuity_state: "FRESH" | "CHALLENGE";
  stale_witness_ids: string[];
  duplicate_chain_count: number;
  unique_evidence_chain_count: number;
  drift_reasons: string[];
  continuity_fingerprint: string;
  authority: CourtContinuityAuthority;
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`COURT_CONTINUITY_REJECTED: ${label} must be an object`);
  }
  return value as JsonRecord;
}

function text(value: unknown, label: string, max = 1000): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`COURT_CONTINUITY_REJECTED: ${label} is required`);
  }
  return value.trim().slice(0, max);
}

function fullSha(value: unknown, label: string): string {
  const normalized = text(value, label, 40).toLowerCase();
  if (!FULL_SHA.test(normalized)) {
    throw new Error(`COURT_CONTINUITY_REJECTED: ${label} must be a full git SHA`);
  }
  return normalized;
}

function hash(value: unknown, label: string): string {
  const normalized = text(value, label, 64).toLowerCase();
  if (!HASH.test(normalized)) {
    throw new Error(`COURT_CONTINUITY_REJECTED: ${label} must be SHA-256`);
  }
  return normalized;
}

function timestamp(value: unknown, label: string): { raw: string; ms: number } {
  const raw = text(value, label, 80);
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    throw new Error(`COURT_CONTINUITY_REJECTED: ${label} must be an ISO timestamp`);
  }
  return { raw, ms };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as JsonRecord;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function exactAuthority(value: unknown): CourtContinuityAuthority {
  const authority = asRecord(value, "authority");
  const expected: CourtContinuityAuthority = {
    evidenceOnly: true,
    createsTruth: false,
    createsAuthority: false,
    executionAuthorized: false,
    mergeAuthorized: false,
    deployAuthorized: false,
    publishAuthorized: false,
    credentialMutationAuthorized: false,
    providerMutationAuthorized: false,
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (authority[key] !== expectedValue) {
      throw new Error(`COURT_CONTINUITY_REJECTED: authority.${key} widened or missing`);
    }
  }
  return expected;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`COURT_CONTINUITY_REJECTED: ${label} must be a non-negative integer`);
  }
  return Number(value);
}

export function buildCourtContinuityMarker(
  input: unknown,
  options: { checkedAt?: string } = {},
): CourtContinuityMarker {
  const record = asRecord(input, "handoff");
  if (record.schema !== FCR_COURT_CONTINUITY_HANDOFF_KIND) {
    throw new Error("COURT_CONTINUITY_REJECTED: unsupported handoff schema");
  }

  const repository = text(record.repository, "repository", 300);
  const branch = text(record.branch, "branch", 200);
  const headSha = fullSha(record.headSha, "headSha");
  const witnessReceiptFingerprint = hash(record.witnessReceiptFingerprint, "witnessReceiptFingerprint");
  const sourceHandoffFingerprint = hash(record.handoffFingerprint, "handoffFingerprint");
  const observedAt = timestamp(record.observedAt, "observedAt");
  const expiresAt = timestamp(record.expiresAt, "expiresAt");
  if (expiresAt.ms <= observedAt.ms) {
    throw new Error("COURT_CONTINUITY_REJECTED: expiresAt must be after observedAt");
  }
  exactAuthority(record.authority);

  const handoffCore = { ...record };
  delete handoffCore.handoffFingerprint;
  if (sha256(handoffCore) !== sourceHandoffFingerprint) {
    throw new Error("COURT_CONTINUITY_REJECTED: handoff fingerprint mismatch");
  }

  const summary = asRecord(record.evidenceSummary, "evidenceSummary");
  const witnesses = Array.isArray(record.witnesses) ? record.witnesses : (() => {
    throw new Error("COURT_CONTINUITY_REJECTED: witnesses must be an array");
  })();

  const staleWitnessIds: string[] = [];
  const sourceFingerprints: string[] = [];
  for (const value of witnesses) {
    const witness = asRecord(value, "witness");
    const id = text(witness.id, "witness.id", 160);
    const witnessHead = fullSha(witness.headSha, "witness.headSha");
    const sourceFingerprint = text(witness.sourceFingerprint, "witness.sourceFingerprint", 240);
    sourceFingerprints.push(sourceFingerprint);
    if (witness.stale === true || witnessHead !== headSha) staleWitnessIds.push(id);
  }

  const duplicateChainCount = sourceFingerprints.length - new Set(sourceFingerprints).size;
  const uniqueEvidenceChainCount = new Set(sourceFingerprints).size;
  if (nonNegativeInteger(summary.duplicateChains, "evidenceSummary.duplicateChains") !== duplicateChainCount) {
    throw new Error("COURT_CONTINUITY_REJECTED: duplicate-chain summary disagrees with witnesses");
  }
  if (nonNegativeInteger(summary.uniqueChains, "evidenceSummary.uniqueChains") !== uniqueEvidenceChainCount) {
    throw new Error("COURT_CONTINUITY_REJECTED: unique-chain summary disagrees with witnesses");
  }

  const checkedAt = timestamp(options.checkedAt ?? new Date().toISOString(), "checkedAt");
  const leaseState = checkedAt.ms > expiresAt.ms ? "EXPIRED" : "FRESH";
  const driftReasons: string[] = [];
  if (leaseState === "EXPIRED") driftReasons.push("handoff-lease-expired");
  if (staleWitnessIds.length > 0) driftReasons.push("stale-or-mismatched-witness-present");

  const identity = {
    version: 1 as const,
    kind: SOL_COURT_CONTINUITY_MARKER_KIND,
    source_handoff_fingerprint: sourceHandoffFingerprint,
    witness_receipt_fingerprint: witnessReceiptFingerprint,
    repository,
    branch,
    head_sha: headSha,
    observed_at: observedAt.raw,
    expires_at: expiresAt.raw,
    lease_state: leaseState,
    continuity_state: driftReasons.length ? "CHALLENGE" as const : "FRESH" as const,
    stale_witness_ids: [...new Set(staleWitnessIds)],
    duplicate_chain_count: duplicateChainCount,
    unique_evidence_chain_count: uniqueEvidenceChainCount,
    drift_reasons: driftReasons,
  };

  return Object.freeze({
    ...identity,
    continuity_fingerprint: sha256(identity),
    authority: exactAuthority(record.authority),
  });
}
