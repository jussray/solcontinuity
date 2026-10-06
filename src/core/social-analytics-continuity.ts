import { createHash } from "node:crypto";

export const CHIEF_SOCIAL_ANALYTICS_DECISION_KIND = "chief-ai/social-analytics-decision-input@v1";
export const SOL_SOCIAL_ANALYTICS_CONTINUITY_KIND = "sol/social-analytics-continuity@v1";

const HASH = /^[0-9a-f]{64}$/i;

type RecordValue = Record<string, unknown>;

export interface ChiefSocialAnalyticsDecisionIdentity {
  version: 1;
  kind: typeof CHIEF_SOCIAL_ANALYTICS_DECISION_KIND;
  source_system: "founder-control-room";
  control_receipt_hash: string;
  challenger_receipt_hash: string;
  account_id: string;
  platform: string;
  primary_metric: string;
  comparison_state: "COMPATIBLE" | "UNRESOLVED";
  incompatibility_reasons: string[];
  control_value: number | null;
  challenger_value: number | null;
  recommendation: "MEASURE" | "UNRESOLVED";
}

export interface SocialAnalyticsContinuityMarker {
  version: 1;
  kind: typeof SOL_SOCIAL_ANALYTICS_CONTINUITY_KIND;
  source_decision_hash: string;
  control_receipt_hash: string;
  challenger_receipt_hash: string;
  account_id: string;
  platform: string;
  primary_metric: string;
  comparison_state: "COMPATIBLE" | "UNRESOLVED";
  current_gate: string;
  predecessor_cookie_id: string | null;
  continuity_fingerprint: string;
  cookie_id: string;
  authority: {
    state_lineage_only: true;
    creates_truth: false;
    creates_authority: false;
    publish_authorized: false;
    execution_authorized: false;
  };
}

function asRecord(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function text(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function sha(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fail(message: string): never {
  throw new Error(`SOCIAL_ANALYTICS_CONTINUITY_REJECTED: ${message}`);
}

function nullableNumber(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be a finite number or null`);
  return value;
}

export function validateChiefSocialAnalyticsDecision(input: unknown): ChiefSocialAnalyticsDecisionIdentity {
  const record = asRecord(input);
  if (!record) fail("decision must be an object");

  const controlHash = text(record.control_receipt_hash, 64).toLowerCase();
  const challengerHash = text(record.challenger_receipt_hash, 64).toLowerCase();
  const decisionHash = text(record.decision_hash, 64).toLowerCase();
  if (!HASH.test(controlHash)) fail("control_receipt_hash must be SHA-256");
  if (!HASH.test(challengerHash)) fail("challenger_receipt_hash must be SHA-256");
  if (!HASH.test(decisionHash)) fail("decision_hash must be SHA-256");

  const comparisonState = text(record.comparison_state, 40) as ChiefSocialAnalyticsDecisionIdentity["comparison_state"];
  if (!(["COMPATIBLE", "UNRESOLVED"] as const).includes(comparisonState)) fail("comparison_state is invalid");
  const recommendation = text(record.recommendation, 40) as ChiefSocialAnalyticsDecisionIdentity["recommendation"];
  if (!(["MEASURE", "UNRESOLVED"] as const).includes(recommendation)) fail("recommendation is invalid");

  const reasonsRaw = record.incompatibility_reasons;
  if (!Array.isArray(reasonsRaw) || reasonsRaw.some((value) => !text(value, 120))) {
    fail("incompatibility_reasons must be an array of strings");
  }
  const reasons = reasonsRaw.map((value) => text(value, 120));

  const identity: ChiefSocialAnalyticsDecisionIdentity = {
    version: 1,
    kind: CHIEF_SOCIAL_ANALYTICS_DECISION_KIND,
    source_system: "founder-control-room",
    control_receipt_hash: controlHash,
    challenger_receipt_hash: challengerHash,
    account_id: text(record.account_id, 200),
    platform: text(record.platform, 80).toLowerCase(),
    primary_metric: text(record.primary_metric, 80),
    comparison_state: comparisonState,
    incompatibility_reasons: reasons,
    control_value: nullableNumber(record.control_value, "control_value"),
    challenger_value: nullableNumber(record.challenger_value, "challenger_value"),
    recommendation,
  };

  if (record.version !== 1) fail("version must be 1");
  if (record.kind !== CHIEF_SOCIAL_ANALYTICS_DECISION_KIND) fail("unsupported Chief social analytics kind");
  if (record.source_system !== "founder-control-room") fail("source_system must be founder-control-room");
  if (!identity.account_id) fail("account_id is required");
  if (!identity.platform) fail("platform is required");
  if (!identity.primary_metric) fail("primary_metric is required");
  if (sha(identity) !== decisionHash) fail("decision_hash does not match exact Chief decision identity");

  const authority = asRecord(record.authority);
  if (!authority
      || authority.evidence_only !== true
      || authority.learning_authority !== "advisory_only"
      || authority.execution_authorized !== false
      || authority.publish_authorized !== false
      || authority.content_mutation_authorized !== false
      || authority.may_increase_authority !== false) {
    fail("Chief decision authority must remain advisory-only");
  }

  return identity;
}

export function buildSocialAnalyticsContinuityMarker(
  decisionInput: unknown,
  options: { current_gate?: string; predecessor_cookie_id?: string | null } = {},
): SocialAnalyticsContinuityMarker {
  const decision = validateChiefSocialAnalyticsDecision(decisionInput);
  const sourceDecisionHash = text(asRecord(decisionInput)?.decision_hash, 64).toLowerCase();
  const predecessorCookieId = options.predecessor_cookie_id === null
    ? null
    : text(options.predecessor_cookie_id, 160) || null;
  const currentGate = text(options.current_gate, 120) || decision.recommendation;

  const identity = {
    version: 1 as const,
    kind: SOL_SOCIAL_ANALYTICS_CONTINUITY_KIND as typeof SOL_SOCIAL_ANALYTICS_CONTINUITY_KIND,
    source_decision_hash: sourceDecisionHash,
    control_receipt_hash: decision.control_receipt_hash,
    challenger_receipt_hash: decision.challenger_receipt_hash,
    account_id: decision.account_id,
    platform: decision.platform,
    primary_metric: decision.primary_metric,
    comparison_state: decision.comparison_state,
    current_gate: currentGate,
    predecessor_cookie_id: predecessorCookieId,
  };
  const continuityFingerprint = sha(identity);

  return Object.freeze({
    ...identity,
    continuity_fingerprint: continuityFingerprint,
    cookie_id: `social:${continuityFingerprint.slice(0, 24)}`,
    authority: Object.freeze({
      state_lineage_only: true,
      creates_truth: false,
      creates_authority: false,
      publish_authorized: false,
      execution_authorized: false,
    }),
  });
}

export function compareSocialAnalyticsContinuity(
  marker: SocialAnalyticsContinuityMarker,
  decisionInput: unknown,
): { stale: boolean; reasons: string[] } {
  const decision = validateChiefSocialAnalyticsDecision(decisionInput);
  const decisionHash = text(asRecord(decisionInput)?.decision_hash, 64).toLowerCase();
  const reasons: string[] = [];
  if (marker.source_decision_hash !== decisionHash) reasons.push("decision-hash-changed");
  if (marker.control_receipt_hash !== decision.control_receipt_hash) reasons.push("control-receipt-changed");
  if (marker.challenger_receipt_hash !== decision.challenger_receipt_hash) reasons.push("challenger-receipt-changed");
  if (marker.account_id !== decision.account_id) reasons.push("account-changed");
  if (marker.platform !== decision.platform) reasons.push("platform-changed");
  if (marker.primary_metric !== decision.primary_metric) reasons.push("primary-metric-changed");
  if (marker.comparison_state !== decision.comparison_state) reasons.push("comparison-state-changed");
  return { stale: reasons.length > 0, reasons };
}
